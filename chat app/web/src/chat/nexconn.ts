import {
  AreaCode,
  BaseChannel,
  ConnectionStatus,
  ConnectionStatusHandler,
  GroupChannel,
  GroupChannelIdentifier,
  Helper,
  LogLevel,
  MessageHandler,
  MessageType,
  NCEngine,
  SendTextMessageParams,
  type Message,
} from "@nexconn/chat";
import { LEGACY_EVENT_CUTOFF, MESSAGE_TYPES, SYSTEM_USER_ID } from "../../../shared/types";
import { hangUpForExit, installCallSdk, startCallEngine } from "./calls";
import { ensureTranslateHandler } from "./translate";

export type ChatLine = {
  id: string;
  channelId: string;
  senderId: string;
  /** Text body (empty for images). */
  text: string;
  sentTime: number;
  kind: "text" | "image";
  imageUrl?: string;
  thumbnail?: string;
  /** Order event posted by the ShopBridge system sender. */
  system: boolean;
};

type Listener = (line: ChatLine) => void;

const roomListeners = new Map<string, Set<Listener>>();
const globalListeners = new Set<Listener>();
let handlerReady = false;
let initializedKey: string | null = null;
let activeUserId = "";
let connectTask: Promise<void> | null = null;

const EVENT_PREFIX = "Update ·";

/**
 * Nexconn rate-limits bursts of client requests (ErrorCode 20604 SEND_FREQUENCY_TOO_FAST).
 * Background calls (read sync, receipts, typing, previews) go through this pacer so user
 * messages are never starved.
 */
const PACE_MS = 250;
let paceChain: Promise<unknown> = Promise.resolve();
export function paced<T>(task: () => Promise<T>): Promise<T> {
  const run = paceChain.then(task);
  paceChain = run.then(
    () => new Promise((resolve) => setTimeout(resolve, PACE_MS)),
    () => new Promise((resolve) => setTimeout(resolve, PACE_MS)),
  );
  return run;
}

/** Every SDK message event, raw, for the inbox (edits, deletes, reactions, receipts, transcripts). */
export type ChatEvent =
  | { type: "message"; raw: Message }
  | { type: "updated"; raws: Message[] }
  | { type: "deleted"; ids: string[] }
  | { type: "metadata"; messageId: string; channelId: string; set?: Record<string, string>; removed?: string[] }
  | { type: "receipt"; messageId: string; channelId: string; readCount: number }
  | { type: "stt"; messageId: string; text: string | null; code: number };

const eventListeners = new Set<(event: ChatEvent) => void>();

export function subscribeChatEvents(listener: (event: ChatEvent) => void): () => void {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

function emit(event: ChatEvent): void {
  // Opt-in diagnostics: set window.__sbTrace = true in the console to log incoming SDK events.
  if ((window as unknown as { __sbTrace?: boolean }).__sbTrace) {
    console.log("[sb-event]", event.type, event.type === "message" ? `${event.raw.messageType} ${JSON.stringify(event.raw.content).slice(0, 120)}` : "");
  }
  for (const listener of eventListeners) listener(event);
}

/**
 * Custom message types (registered after NCEngine.initialize and before connect, as the SDK requires).
 * Typing and edit notices are live-only custom messages: group channels have no typing API,
 * and other clients did not receive onMessagesUpdated for edits in testing.
 */
function registerCustomMessages(): void {
  NCEngine.registerCustomMessages([
    { messageType: MESSAGE_TYPES.offer, isPersisted: true, isCounted: true },
    { messageType: MESSAGE_TYPES.track, isPersisted: true, isCounted: true },
    { messageType: MESSAGE_TYPES.order, isPersisted: true, isCounted: true },
    { messageType: MESSAGE_TYPES.call, isPersisted: true, isCounted: true },
    { messageType: MESSAGE_TYPES.pin, isPersisted: true, isCounted: false },
    // Live-only signals: not stored, not counted. (Status messages were not delivered in group channels.)
    { messageType: MESSAGE_TYPES.typing, isPersisted: false, isCounted: false },
    { messageType: MESSAGE_TYPES.edit, isPersisted: false, isCounted: false },
  ]);
}

/** One-line summary of any message, for list previews and notifications. */
export function summarize(message: Message): string {
  const content = (message.content ?? {}) as Record<string, any>;
  switch (message.messageType) {
    case MessageType.IMAGE:
      return "📷 Photo";
    case MessageType.GIF:
      return "GIF";
    case MessageType.FILE:
      return `📄 ${content.name ?? "File"}`;
    case MessageType.HD_VOICE:
      return `🎤 Voice message (${Math.round(Number(content.duration) || 0)}s)`;
    case MessageType.REFERENCE:
      return String(content.text ?? "");
    case MESSAGE_TYPES.offer:
      return `🏷️ Offer · ₹${Number(content.amount).toLocaleString("en-IN")}`;
    case MESSAGE_TYPES.track:
      return "🚚 Shipment update";
    case MESSAGE_TYPES.order:
      return "📦 Order shared";
    case MESSAGE_TYPES.call:
      return `${content.missed ? "Missed " : ""}${content.media === "video" ? "video" : "voice"} call`;
    default:
      return typeof content.text === "string" ? content.text : typeof content.content === "string" ? content.content : "";
  }
}

/**
 * A message is an order event only when the ShopBridge system user sent it. Before the
 * cutoff, events were posted from the acting user's id; those legacy events are accepted
 * because their server timestamps predate the change and cannot be forged.
 */
export function isSystemLine(senderId: string, text: string, sentTime: number): boolean {
  if (!text.startsWith(EVENT_PREFIX)) return false;
  return senderId === SYSTEM_USER_ID || sentTime < LEGACY_EVENT_CUTOFF;
}

export function systemText(text: string): string {
  return text.replace(/^Update ·\s*/, "");
}

// ---------------------------------------------------------------------------
// Connection state
// ---------------------------------------------------------------------------

/** UI-facing connection state, derived from Nexconn ConnectionStatus events. */
export type LinkState = "connected" | "connecting" | "offline" | "elsewhere";
type LinkListener = (state: LinkState) => void;
const linkListeners = new Set<LinkListener>();
let linkState: LinkState = "connecting";
let connectedAt = 0;

function setLinkState(next: LinkState): void {
  if (next === "connected" && linkState !== "connected") connectedAt = Date.now();
  if (next === linkState) return;
  linkState = next;
  for (const listener of linkListeners) listener(next);
}

export function currentLinkState(): LinkState {
  return linkState;
}

/** When the current connection was established (used to skip offline-sync notification floods). */
export function connectedSince(): number {
  return connectedAt;
}

export function subscribeLink(listener: LinkListener): () => void {
  linkListeners.add(listener);
  return () => {
    linkListeners.delete(listener);
  };
}

/** @nexconn/engine ErrorCode.RC_DISCONN_KICK — same account signed in on another device. */
const KICKED_BY_OTHER_DEVICE = 31010;

function linkStateFor(status: ConnectionStatus, code?: number): LinkState {
  if (status === ConnectionStatus.CONNECTED) return "connected";
  if (status === ConnectionStatus.CONNECTING || status === ConnectionStatus.SUSPENDED) return "connecting";
  if (code === KICKED_BY_OTHER_DEVICE) return "elsewhere";
  return "offline";
}

function ensureConnectionHandler(): void {
  NCEngine.addConnectionStatusHandler(
    "shopbridge-connection",
    new ConnectionStatusHandler({
      onConnectionStatusChanged({ status, code }) {
        const next = linkStateFor(status, code);
        // Force a real reconnect next time instead of trusting a stale user id.
        if (next === "offline" || next === "elsewhere") activeUserId = "";
        setLinkState(next);
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function toLine(message: Message): ChatLine | null {
  const channelId = message.channelIdentifier?.channelId ?? "";
  const id = message.messageId || `${message.senderUserId}-${message.sentTime}`;
  const sentTime = message.sentTime || Date.now();
  const content = (message.content ?? {}) as Record<string, unknown>;
  if (
    message.messageType === MESSAGE_TYPES.typing ||
    message.messageType === MESSAGE_TYPES.pin ||
    message.messageType === MESSAGE_TYPES.edit
  )
    return null;
  if (message.messageType !== MessageType.IMAGE && message.messageType !== MessageType.TEXT) {
    const text = summarize(message);
    if (!text) return null;
    return { id, channelId, senderId: message.senderUserId, text, sentTime, kind: "text", system: false };
  }
  if (message.messageType === MessageType.IMAGE) {
    const imageUrl = typeof content.remoteUrl === "string" ? content.remoteUrl : "";
    const thumb = typeof content.thumbnailBase64 === "string" ? content.thumbnailBase64 : "";
    if (!imageUrl && !thumb) return null;
    return {
      id,
      channelId,
      senderId: message.senderUserId,
      text: "",
      sentTime,
      kind: "image",
      imageUrl: imageUrl || undefined,
      thumbnail: thumb ? `data:image/jpeg;base64,${thumb}` : undefined,
      system: false,
    };
  }
  const text =
    typeof content.text === "string" && content.text.trim()
      ? content.text
      : typeof content.content === "string" && content.content.trim()
        ? content.content
        : "";
  if (!text) return null;
  return {
    id,
    channelId,
    senderId: message.senderUserId,
    text,
    sentTime,
    kind: "text",
    system: isSystemLine(message.senderUserId, text, sentTime),
  };
}

function ensureHandler(): void {
  if (handlerReady) return;
  NCEngine.addMessageHandler(
    "shopbridge-messages",
    new MessageHandler({
      onMessageReceived({ messages }) {
        for (const message of messages) {
          emit({ type: "message", raw: message });
          const line = toLine(message);
          if (!line || !line.channelId) continue;
          roomListeners.get(line.channelId)?.forEach((listener) => listener(line));
          globalListeners.forEach((listener) => listener(line));
        }
      },
      onMessagesUpdated({ messages }) {
        emit({ type: "updated", raws: messages });
      },
      onMessageDeleted({ messages }) {
        emit({ type: "deleted", ids: messages.map((item) => item.messageId) });
      },
      onMessageMetadataUpdated({ messageId, channelIdentifier, metadata }) {
        emit({ type: "metadata", messageId, channelId: channelIdentifier.channelId, set: metadata });
      },
      onMessageMetadataDeleted({ messageId, channelIdentifier, keys }) {
        emit({ type: "metadata", messageId, channelId: channelIdentifier.channelId, removed: keys });
      },
      onMessageReceiptResponse({ responses }) {
        for (const item of responses) {
          emit({ type: "receipt", messageId: item.messageId, channelId: item.channelIdentifier.channelId, readCount: item.readCount });
        }
      },
      onSpeechToTextCompleted({ messageId, info, code }) {
        emit({ type: "stt", messageId, text: info?.text ?? null, code });
      },
    }),
  );
  handlerReady = true;
}

export async function connectChat(appKey: string, token: string, userId: string): Promise<void> {
  if (activeUserId === userId && NCEngine.getCurrentUserId() === userId && linkState === "connected") return;
  if (connectTask) return connectTask;

  connectTask = (async () => {
    if (!initializedKey) {
      // Order matters: Call SDK install before initialize; custom types right after initialize
      // (the SDK requires registration after init and before messages arrive); call engine last.
      await installCallSdk().catch(() => undefined);
      NCEngine.initialize({ appKey, logLevel: LogLevel.WARN, areaCode: AreaCode.SG });
      registerCustomMessages();
      initializedKey = appKey;
      ensureHandler();
      ensureConnectionHandler();
      ensureTranslateHandler();
      startCallEngine();
    } else if (initializedKey !== appKey) {
      throw new Error("The Nexconn App Key changed. Reload the page.");
    }

    if (NCEngine.getCurrentUserId() && NCEngine.getCurrentUserId() !== userId) {
      await NCEngine.disconnect();
      activeUserId = "";
    }

    if (NCEngine.getCurrentUserId() !== userId || linkState !== "connected") {
      setLinkState("connecting");
      const result = await NCEngine.connect({ token });
      if (!result.isOk) {
        setLinkState("offline");
        throw new Error("Could not connect to Nexconn chat. Check your connection and try again.");
      }
    }
    setLinkState("connected");
    activeUserId = userId;
  })().finally(() => {
    connectTask = null;
  });

  return connectTask;
}

export async function disconnectChat(): Promise<void> {
  if (!initializedKey) return;
  await hangUpForExit();
  await NCEngine.disconnect().catch(() => undefined);
  activeUserId = "";
  setLinkState("connecting");
}

export function subscribeRoom(channelId: string, listener: Listener): () => void {
  const set = roomListeners.get(channelId) ?? new Set<Listener>();
  set.add(listener);
  roomListeners.set(channelId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) roomListeners.delete(channelId);
  };
}

/** Every incoming message on any channel (used for unread counts and notifications). */
export function subscribeAllMessages(listener: Listener): () => void {
  globalListeners.add(listener);
  return () => {
    globalListeners.delete(listener);
  };
}

const PAGE_SIZE = 40;

/**
 * One page of history, newest first from `before`, returned oldest-first.
 * Membership is managed by the server (channels are join-locked), so no client join.
 */
export async function loadHistory(
  channelId: string,
  before = Date.now(),
): Promise<{ lines: ChatLine[]; hasMore: boolean }> {
  const query = BaseChannel.createMessagesQuery({
    channelIdentifier: new GroupChannelIdentifier(channelId),
    pageSize: PAGE_SIZE,
    isAscending: false,
    startTime: before,
  });
  const result = await query.loadNextPage();
  if (!result.isOk || !result.data) throw new Error("Could not load messages in this conversation.");
  const raw = result.data.data;
  return {
    lines: raw
      .map(toLine)
      .filter((line): line is ChatLine => line !== null)
      .sort((a, b) => a.sentTime - b.sentTime),
    hasMore: raw.length >= PAGE_SIZE,
  };
}

const readTimers = new Map<string, number>();
const LAST_READ_KEY = "shopbridge.lastRead";

function lastReadMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(LAST_READ_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

/** Mark a conversation read for this user (SDK unread counter). Coalesced per channel. */
export function markRead(channelId: string): Promise<void> {
  try {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ ...lastReadMap(), [channelId]: Date.now() }));
  } catch {
    /* storage unavailable */
  }
  const existing = readTimers.get(channelId);
  if (existing) window.clearTimeout(existing);
  readTimers.set(
    channelId,
    window.setTimeout(() => {
      readTimers.delete(channelId);
      void paced(() => new GroupChannel(channelId).clearUnreadCount()).catch(() => undefined);
    }, 900),
  );
  return Promise.resolve();
}

export async function sendChat(channelId: string, text: string): Promise<ChatLine> {
  const group = new GroupChannel(channelId);
  const result = await group.sendMessage(new SendTextMessageParams({ text }));
  if (!result.isOk || !result.data) throw new Error("The message was not sent.");
  const line = toLine(result.data);
  if (!line) throw new Error("The message was not sent.");
  return line;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Send a photo (e.g. evidence of damage) as a Nexconn image message. */
export async function sendImage(
  channelId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ChatLine> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Choose an image under 5 MB.");
  const params = await Helper.createSendImageMessageParams(file);
  if (!params.isOk || !params.data) throw new Error("This image could not be prepared.");
  params.data.onUploadProgress = (progress) => onProgress?.(progress);
  const result = await new GroupChannel(channelId).sendMediaMessage(params.data);
  if (!result.isOk || !result.data) throw new Error("The photo was not sent.");
  const line = toLine(result.data);
  if (!line) throw new Error("The photo was not sent.");
  return line;
}

export type ChannelSummary = {
  channelId: string;
  unread: number;
  latest: ChatLine | null;
  latestRaw: Message | null;
  draft: string;
  pinned: boolean;
  muted: boolean;
};

/**
 * Unread counts and latest message per channel. Uses the SDK channel list in one call when
 * the App Key supports it; otherwise (ErrorCode 35011 METHOD_NOT_AVAILABLE) reads the latest
 * page of each order channel, paced, and counts messages since this device last read it.
 */
export async function channelSummaries(channelIds: string[] = [], selfId = ""): Promise<Map<string, ChannelSummary>> {
  const query = BaseChannel.createChannelsQuery({ pageSize: 100 });
  const result = await query.loadNextPage().catch(() => null);
  const map = new Map<string, ChannelSummary>();
  if (!result?.isOk || !result.data) {
    const lastRead = lastReadMap();
    for (const channelId of channelIds) {
      const page = await paced(() =>
        BaseChannel.createMessagesQuery({
          channelIdentifier: new GroupChannelIdentifier(channelId),
          pageSize: 20,
          isAscending: false,
          startTime: Date.now(),
        }).loadNextPage(),
      ).catch(() => null);
      const raws = page?.isOk && page.data ? page.data.data : [];
      const latestRaw = raws.find((raw) => raw.messageType !== MESSAGE_TYPES.typing && raw.messageType !== MESSAGE_TYPES.edit) ?? null;
      const since = lastRead[channelId] ?? 0;
      const unread = raws.filter((raw) => raw.senderUserId !== selfId && raw.sentTime > since && raw.isCounted !== false).length;
      map.set(channelId, {
        channelId,
        unread: since ? unread : 0,
        latest: latestRaw ? toLine(latestRaw) : null,
        latestRaw,
        draft: "",
        pinned: false,
        muted: false,
      });
    }
    return map;
  }
  for (const channel of result.data.data) {
    const latest = channel.latestMessage ? toLine(channel.latestMessage) : null;
    map.set(channel.channelId, {
      channelId: channel.channelId,
      unread: channel.unreadCount ?? 0,
      latest,
      latestRaw: channel.latestMessage ?? null,
      draft: channel.draft ?? "",
      pinned: Boolean(channel.isPinned),
      muted: channel.noDisturbLevel === 5,
    });
  }
  return map;
}
