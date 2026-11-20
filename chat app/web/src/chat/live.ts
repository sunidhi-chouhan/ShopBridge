/**
 * Live sale rooms on Nexconn open channels.
 *
 * - enterChannel / exitChannel: no persistent membership, so any signed-in viewer can drop in.
 * - OpenChannelHandler: live participant count, who joined, room metadata (featured product,
 *   sold count) and room destruction when the host ends the session.
 * - Text chat carries the sender's name in `senderUserInfo`, so viewers need no lookup.
 * - Hearts are a live-only custom message (SB:Heart), batched to respect the 5 msg/s limit.
 * - SB:Live events (start, feature, sale, end) come only from the ShopBridge system user.
 */
import {
  MessageType,
  NCEngine,
  OpenChannel,
  OpenChannelHandler,
  OpenChannelParticipantActionType,
  SendMessageParams,
  SendTextMessageParams,
  type Message,
} from "@nexconn/chat";
import { MESSAGE_TYPES, SYSTEM_USER_ID, type LiveEvent, type LiveProduct, type Role } from "../../../shared/types";
import { chatCredentials } from "../api";
import { connectChat, subscribeOpenMessages } from "./nexconn";

export type LiveChat = {
  id: string;
  senderId: string;
  name: string;
  role: Role | null;
  text: string;
  sentTime: number;
};

export type LiveSignal =
  | { type: "chat"; line: LiveChat }
  | { type: "heart"; count: number; senderId: string }
  | { type: "event"; id: string; event: LiveEvent; sentTime: number }
  | { type: "viewers"; count: number }
  | { type: "joined"; name: string }
  | { type: "state"; featured?: LiveProduct | null; sold?: number }
  | { type: "destroyed" };

type Listener = (signal: LiveSignal) => void;
const listeners = new Map<string, Set<Listener>>();
let handlerReady = false;
let stopMessages: (() => void) | null = null;

function dispatch(channelId: string, signal: LiveSignal): void {
  listeners.get(channelId)?.forEach((listener) => listener(signal));
}

function parseProduct(value: string | undefined): LiveProduct | null | undefined {
  if (value === undefined) return undefined;
  try {
    const product = JSON.parse(value) as LiveProduct;
    return product && typeof product.id === "string" ? product : null;
  } catch {
    return null;
  }
}

function nameFromExtra(extra: string | undefined): string {
  try {
    const name = (JSON.parse(extra ?? "{}") as { name?: unknown }).name;
    return typeof name === "string" ? name.slice(0, 40) : "";
  } catch {
    return "";
  }
}

/** Convert a raw open channel message into a live signal (null for anything else). */
export function toSignal(message: Message): LiveSignal | null {
  const content = (message.content ?? {}) as Record<string, any>;
  const id = message.messageId || `${message.senderUserId}-${message.sentTime}`;
  const sentTime = message.sentTime || Date.now();
  if (message.messageType === MESSAGE_TYPES.live) {
    // Only the server may announce sales or change the stage.
    if (message.senderUserId !== SYSTEM_USER_ID || typeof content.kind !== "string") return null;
    return { type: "event", id, event: content as LiveEvent, sentTime };
  }
  if (message.messageType === MESSAGE_TYPES.heart) {
    const count = Math.max(1, Math.min(10, Number(content.count) || 1));
    return { type: "heart", count, senderId: message.senderUserId };
  }
  if (message.messageType === MessageType.TEXT) {
    const text = typeof content.text === "string" ? content.text : typeof content.content === "string" ? content.content : "";
    if (!text.trim()) return null;
    const info = (content.senderUserInfo ?? content.user ?? {}) as { name?: unknown; extra?: unknown };
    const role = info.extra === "member" || info.extra === "volunteer" || info.extra === "coordinator" ? info.extra : null;
    return {
      type: "chat",
      line: {
        id,
        senderId: message.senderUserId,
        name: typeof info.name === "string" && info.name ? info.name.slice(0, 40) : "Viewer",
        role,
        text: text.slice(0, 500),
        sentTime,
      },
    };
  }
  return null;
}

function ensureHandlers(): void {
  if (!handlerReady) {
    NCEngine.addOpenChannelHandler(
      "shopbridge-live",
      new OpenChannelHandler({
        onParticipantChanged({ channelId, participantCount, actions }) {
          dispatch(channelId, { type: "viewers", count: participantCount });
          for (const action of actions) {
            if (action.action !== OpenChannelParticipantActionType.ENTER) continue;
            const name = nameFromExtra(action.extra);
            if (name) dispatch(channelId, { type: "joined", name });
          }
        },
        onMetadataChanged({ changeInfo }) {
          for (const change of changeInfo) {
            if (change.key === "featured") dispatch(change.channelId, { type: "state", featured: parseProduct(change.value) });
            if (change.key === "sold") dispatch(change.channelId, { type: "state", sold: Number(change.value) || 0 });
          }
        },
        onChannelDestroyed({ channelId }) {
          dispatch(channelId, { type: "destroyed" });
        },
      }),
    );
    handlerReady = true;
  }
  if (!stopMessages) {
    stopMessages = subscribeOpenMessages((message) => {
      const channelId = message.channelIdentifier?.channelId ?? "";
      const signal = toSignal(message);
      if (signal) dispatch(channelId, signal);
    });
  }
}

export function subscribeLive(channelId: string, listener: Listener): () => void {
  const set = listeners.get(channelId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(channelId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(channelId);
  };
}

export type EnteredRoom = {
  viewers: number;
  history: LiveSignal[];
  featured: LiveProduct | null | undefined;
  sold: number | undefined;
};

/** Connect (if needed), enter the open channel, and read its recent history and metadata. */
export async function enterLive(channelId: string, me: { name: string }): Promise<EnteredRoom> {
  const credentials = await chatCredentials();
  await connectChat(credentials.appKey, credentials.token, credentials.userId);
  ensureHandlers();
  const channel = new OpenChannel(channelId);
  const entered = await channel.enterChannel({ messageCount: 30, extra: JSON.stringify({ name: me.name }) });
  if (!entered.isOk || !entered.data) {
    throw new Error(entered.code === 23410 ? "This live session has ended." : "Could not join the live room. Try again.");
  }
  const [historyResult, metadataResult] = await Promise.all([
    OpenChannel.createOpenChannelMessagesQuery({ channelId, pageSize: 30, isAscending: false, startTime: 0 })
      .loadNextPage()
      .catch(() => null),
    channel.getMetadata().catch(() => null),
  ]);
  const raws = historyResult?.isOk && historyResult.data ? historyResult.data.data : [];
  const history = raws
    .slice()
    .sort((a, b) => a.sentTime - b.sentTime)
    .map(toSignal)
    .filter((signal): signal is LiveSignal => signal !== null && signal.type !== "heart");
  const metadata = metadataResult?.isOk && metadataResult.data ? metadataResult.data : {};
  return {
    viewers: entered.data.participantCount,
    history,
    featured: parseProduct(metadata.featured),
    sold: metadata.sold !== undefined ? Number(metadata.sold) || 0 : undefined,
  };
}

export async function exitLive(channelId: string): Promise<void> {
  await new OpenChannel(channelId).exitChannel().catch(() => undefined);
}

export async function sendLiveText(
  channelId: string,
  text: string,
  me: { id: string; name: string; role: Role },
): Promise<LiveChat> {
  const params = new SendTextMessageParams({
    text,
    senderUserInfo: { userId: me.id, name: me.name, extra: me.role },
  });
  const result = await new OpenChannel(channelId).sendMessage(params);
  if (!result.isOk || !result.data) {
    throw new Error("Message not sent. Try again.");
  }
  const signal = toSignal(result.data);
  if (signal?.type === "chat") return signal.line;
  return { id: result.data.messageId, senderId: me.id, name: me.name, role: me.role, text, sentTime: Date.now() };
}

/** Hearts tapped within a short window go out as one message (open channels allow 5 msg/s). */
const pendingHearts = new Map<string, { count: number; timer: number }>();

export function sendHeart(channelId: string): void {
  const pending = pendingHearts.get(channelId);
  if (pending) {
    pending.count = Math.min(10, pending.count + 1);
    return;
  }
  const entry = {
    count: 1,
    timer: window.setTimeout(() => {
      pendingHearts.delete(channelId);
      void new OpenChannel(channelId)
        .sendMessage(new SendMessageParams({ count: entry.count }, MESSAGE_TYPES.heart))
        .catch(() => undefined);
    }, 600),
  };
  pendingHearts.set(channelId, entry);
}
