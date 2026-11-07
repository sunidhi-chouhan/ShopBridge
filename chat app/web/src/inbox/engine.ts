/**
 * Inbox chat operations on the Nexconn Chat SDK. Every action maps to a verified SDK API:
 *  reply → SendReferenceMessageParams · edit → BaseChannel.updateMessage
 *  delete → deleteMessageForAll / deleteMessagesForMe · reactions → message metadata
 *  read receipts → sendReadReceiptResponse / getMessageReadReceiptInfo
 *  photos/files/voice → Helper.createSend*MessageParams + sendMediaMessage
 *  transcript → message.requestSpeechToText · drafts/pin/mute → channel APIs
 *  typing, order/call/pin cards → registered custom message types.
 */
import {
  BaseChannel,
  ChannelNoDisturbLevel,
  GroupChannel,
  GroupChannelIdentifier,
  Helper,
  MessageType,
  SendMediaMessageParams,
  SendMessageParams,
  SendReferenceMessageParams,
  SendTextMessageParams,
  type Message,
} from "@nexconn/chat";
import { MESSAGE_TYPES, SYSTEM_USER_ID } from "../../../shared/types";
import { isSystemLine, markRead, paced, systemText } from "../chat/nexconn";

export type IxKind = "text" | "image" | "gif" | "file" | "voice" | "offer" | "track" | "order" | "call" | "sys";

export type IxMessage = {
  id: string;
  channelId: string;
  senderId: string;
  at: number;
  kind: IxKind;
  text: string;
  mine: boolean;
  edited: boolean;
  recalled: boolean;
  reply: { id: string; senderId: string; text: string } | null;
  url?: string;
  thumb?: string;
  name?: string;
  size?: number;
  duration?: number;
  payload?: Record<string, any>;
  reactions: Record<string, string[]>;
  status?: "sending" | "sent" | "read" | "failed";
  raw: Message | null;
  transcript?: string | null;
};

const REACTION_PREFIX = "rx_";
/** Sent with every user message so reactions (message metadata) can be added later. */
const METADATA_SEED = { sb: "1" };

function reactionsOf(raw: Message): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const meta = raw.metadata;
  if (!meta || typeof meta.forEach !== "function") return out;
  meta.forEach((value, key) => {
    if (!key.startsWith(REACTION_PREFIX) || !value) return;
    const userId = key.slice(REACTION_PREFIX.length);
    (out[value] ??= []).push(userId);
  });
  return out;
}

export function toIx(raw: Message, selfId: string): IxMessage | null {
  const content = (raw.content ?? {}) as Record<string, any>;
  const type = raw.messageType;
  if (type === MESSAGE_TYPES.typing || type === MESSAGE_TYPES.edit) return null;
  const base = {
    id: raw.messageId || `${raw.senderUserId}-${raw.sentTime}`,
    channelId: raw.channelIdentifier?.channelId ?? "",
    senderId: raw.senderUserId,
    at: raw.sentTime || Date.now(),
    mine: raw.senderUserId === selfId,
    edited: Boolean(raw.hasChanged),
    recalled: false,
    reply: null,
    reactions: reactionsOf(raw),
    raw,
    status: raw.senderUserId === selfId ? ("sent" as const) : undefined,
  };
  switch (type) {
    case MessageType.TEXT: {
      const text = String(content.text ?? content.content ?? "");
      if (!text) return null;
      if (isSystemLine(raw.senderUserId, text, base.at)) return { ...base, kind: "sys", text: systemText(text), mine: false };
      return { ...base, kind: "text", text };
    }
    case MessageType.REFERENCE:
      return {
        ...base,
        kind: "text",
        text: String(content.text ?? ""),
        reply: {
          id: String(content.referMsgId ?? content.referMsgUid ?? ""),
          senderId: String(content.referMsgSenderId ?? content.referMsgUserId ?? ""),
          // The SDK embeds the quoted message; use it when the original is not loaded.
          text: String(content.referMsg?.text ?? content.referMsg?.content ?? ""),
        },
      };
    case MessageType.IMAGE:
      return {
        ...base,
        kind: "image",
        text: "",
        url: content.remoteUrl || undefined,
        thumb: content.thumbnailBase64 ? `data:image/jpeg;base64,${content.thumbnailBase64}` : undefined,
      };
    case MessageType.GIF:
      return { ...base, kind: "gif", text: "", url: content.remoteUrl };
    case MessageType.FILE:
      return { ...base, kind: "file", text: "", url: content.remoteUrl, name: content.name, size: Number(content.size) || 0 };
    case MessageType.HD_VOICE:
      return { ...base, kind: "voice", text: "", url: content.remoteUrl, duration: Number(content.duration) || 0 };
    case MESSAGE_TYPES.offer:
      return { ...base, kind: "offer", text: "", payload: content };
    case MESSAGE_TYPES.track:
      return { ...base, kind: "track", text: "", payload: content };
    case MESSAGE_TYPES.order:
      return { ...base, kind: "order", text: "", payload: content };
    case MESSAGE_TYPES.call:
      return { ...base, kind: "call", text: "", payload: content };
    case MESSAGE_TYPES.pin:
      return { ...base, kind: "sys", text: "", payload: { pin: content.targetId ?? null } };
    default:
      return null;
  }
}

/** Latest pin set in the conversation (SB:Pin messages), or null. */
export function currentPin(messages: IxMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const pin = messages[i].payload?.pin;
    if (messages[i].kind === "sys" && pin !== undefined) return pin ?? null;
  }
  return null;
}

const channel = (channelId: string) => new GroupChannel(channelId);
const identifier = (channelId: string) => new GroupChannelIdentifier(channelId);

export async function loadPage(channelId: string, selfId: string, before = Date.now()) {
  const query = BaseChannel.createMessagesQuery({
    channelIdentifier: identifier(channelId),
    pageSize: 40,
    isAscending: false,
    startTime: before,
  });
  const result = await query.loadNextPage();
  if (!result.isOk || !result.data) throw new Error("Could not load messages in this conversation.");
  const raw = result.data.data;
  const messages = raw
    .map((item) => toIx(item, selfId))
    .filter((item): item is IxMessage => item !== null)
    .sort((a, b) => a.at - b.at);
  return { messages, hasMore: raw.length >= 40 };
}

/** Read counts for my messages (group read receipts). */
export async function readCounts(channelId: string, ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const result = await paced(() => channel(channelId).getMessageReadReceiptInfo(ids)).catch(() => null);
  if (result?.isOk && result.data) for (const info of result.data) map.set(info.messageId, info.readCount);
  return map;
}

const receiptQueue = new Map<string, { ids: Set<string>; timer: number }>();
const receipted = new Set<string>();

/** Tell senders their messages were seen (batched per channel, paced to avoid rate limits). */
export function sendReadReceipts(channelId: string, messages: IxMessage[]): Promise<void> {
  const ids = messages.filter((m) => !m.mine && m.raw?.needReceipt && !m.raw.sentReceipt && !receipted.has(m.id)).map((m) => m.id);
  void markRead(channelId);
  if (ids.length === 0) return Promise.resolve();
  const entry = receiptQueue.get(channelId) ?? { ids: new Set<string>(), timer: 0 };
  ids.forEach((id) => entry.ids.add(id));
  if (entry.timer) window.clearTimeout(entry.timer);
  entry.timer = window.setTimeout(() => {
    receiptQueue.delete(channelId);
    const batch = [...entry.ids];
    batch.forEach((id) => receipted.add(id));
    void paced(() => channel(channelId).sendReadReceiptResponse(batch)).catch(() => undefined);
  }, 700);
  receiptQueue.set(channelId, entry);
  return Promise.resolve();
}

function prepare<P extends SendMessageParams<any>>(params: P): P {
  params.needReceipt = true;
  params.metadata = { ...METADATA_SEED };
  return params;
}

async function deliver(channelId: string, params: SendMessageParams<any>, selfId: string): Promise<IxMessage> {
  const result = await channel(channelId).sendMessage(prepare(params));
  if (!result.isOk || !result.data) throw new Error("The message was not sent.");
  const message = toIx(result.data, selfId);
  if (!message) throw new Error("The message was not sent.");
  return message;
}

export function sendText(channelId: string, text: string, selfId: string, replyTo: IxMessage | null) {
  if (replyTo?.raw) {
    return deliver(
      channelId,
      new SendReferenceMessageParams({
        text,
        referMsgId: replyTo.id,
        referMsgType: replyTo.raw.messageType,
        referMsgSenderId: replyTo.senderId,
        referMsg: replyTo.raw.content,
      }),
      selfId,
    );
  }
  return deliver(channelId, new SendTextMessageParams({ text }), selfId);
}

export async function sendFile(channelId: string, file: File, selfId: string, onProgress: (pct: number) => void) {
  if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} is over 20 MB. Send a smaller file.`);
  const make =
    file.type === "image/gif"
      ? Helper.createSendGIFMessageParams(file)
      : file.type.startsWith("image/")
        ? Helper.createSendImageMessageParams(file)
        : Helper.createSendFileMessageParams(file);
  const prepared = await make;
  if (!prepared.isOk || !prepared.data) throw new Error(`Could not prepare ${file.name}.`);
  // Union of image/GIF/file params; the SDK accepts any SendMediaMessageParams.
  const params = prepare(prepared.data as SendMediaMessageParams<Record<string, any>>);
  params.onUploadProgress = (pct: number) => onProgress(pct);
  const result = await channel(channelId).sendMediaMessage(params);
  if (!result.isOk || !result.data) throw new Error(`${file.name} was not sent.`);
  return toIx(result.data, selfId)!;
}

export async function sendVoice(channelId: string, blob: Blob, seconds: number, selfId: string) {
  const type = blob.type || "audio/webm";
  const extension = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
  const file = new File([blob], `voice-${Date.now()}.${extension}`, { type });
  const prepared = await Helper.createSendHDVoiceMessageParams(file);
  if (!prepared.isOk || !prepared.data) throw new Error("Could not prepare the voice message.");
  const content = prepared.data.content as { duration?: number };
  if (!content.duration) content.duration = seconds;
  const result = await channel(channelId).sendMediaMessage(prepare(prepared.data));
  if (!result.isOk || !result.data) throw new Error("The voice message was not sent.");
  return toIx(result.data, selfId)!;
}

export function sendCustom(channelId: string, type: string, content: Record<string, unknown>, selfId: string) {
  return deliver(channelId, new SendMessageParams(content, type), selfId);
}

let lastTyping = 0;
/**
 * Live "typing" signal (custom, not stored; group channels have no typing API). Throttled to
 * one per 4 s; a rate-limited send (20604) frees the throttle so the next keystroke retries.
 */
export function sendTyping(channelId: string, kind: "text" | "voice", stillTyping: () => boolean = () => true, retried = false): void {
  if (!retried && Date.now() - lastTyping < 4000) return;
  lastTyping = Date.now();
  const retry = () => {
    lastTyping = 0;
    // Rate-limited during the conversation's opening burst: retry once if they are still typing.
    if (!retried) window.setTimeout(() => stillTyping() && sendTyping(channelId, kind, stillTyping, true), 1200);
  };
  void channel(channelId)
    .sendMessage(new SendMessageParams({ kind }, MESSAGE_TYPES.typing))
    .then((result) => {
      if (!result.isOk) retry();
    })
    .catch(retry);
}

export async function editMessage(message: IxMessage, text: string): Promise<void> {
  if (!message.raw) throw new Error("This message cannot be edited.");
  const content = { ...(message.raw.content as Record<string, unknown>), text };
  const result = await BaseChannel.updateMessage({
    messageId: message.id,
    content,
    channelIdentifier: identifier(message.channelId),
  });
  if (!result.isOk) throw new Error("This message can no longer be edited.");
  // The edit is stored by updateMessage; this live notice updates clients that are open now.
  void paced(() =>
    channel(message.channelId).sendMessage(new SendMessageParams({ targetId: message.id, text }, MESSAGE_TYPES.edit)),
  )
    .then((sent) => {
      if (!sent.isOk) console.warn(`[sb] edit notice not sent (code ${sent.code})`);
    })
    .catch((error: unknown) => console.warn("[sb] edit notice failed", error));
}

export async function deleteForAll(message: IxMessage): Promise<void> {
  if (!message.raw) throw new Error("This message cannot be deleted.");
  const result = await channel(message.channelId).deleteMessageForAll(message.raw);
  if (!result.isOk) throw new Error("This message can no longer be deleted for everyone.");
}

export async function deleteForMe(message: IxMessage): Promise<void> {
  if (!message.raw) return;
  const result = await channel(message.channelId).deleteMessagesForMe([message.raw]);
  if (!result.isOk) throw new Error("This message could not be deleted.");
}

/** One reaction per person: stored as message metadata `rx_<userId>` = emoji. */
export async function setReaction(message: IxMessage, selfId: string, emoji: string | null): Promise<void> {
  if (!message.raw) throw new Error("You cannot react to this message.");
  const key = `${REACTION_PREFIX}${selfId}`;
  const result = emoji ? await message.raw.setMetadata({ [key]: emoji }) : await message.raw.deleteMetadata([key]);
  if (!result.isOk) throw new Error("Reactions are not available on this message.");
}

export async function requestTranscript(message: IxMessage): Promise<void> {
  if (!message.raw) throw new Error("No transcript for this message.");
  const result = await message.raw.requestSpeechToText();
  if (!result.isOk) throw new Error("Speech-to-text is not enabled for this app.");
}

export async function saveDraft(channelId: string, text: string): Promise<void> {
  const ch = channel(channelId);
  await (text ? ch.saveDraft(text) : ch.clearDraft()).catch(() => undefined);
}

export async function setPinned(channelId: string, pinned: boolean): Promise<void> {
  const ch = channel(channelId);
  const result = pinned ? await ch.pin() : await ch.unpin();
  if (!result.isOk) throw new Error("Could not update the pin.");
}

export async function setMuted(channelId: string, muted: boolean): Promise<void> {
  const result = await channel(channelId).setNoDisturbLevel(muted ? ChannelNoDisturbLevel.MUTED : ChannelNoDisturbLevel.DEFAULT);
  if (!result.isOk) throw new Error("Could not update notifications.");
}

export function applyReactionChange(
  message: IxMessage,
  set?: Record<string, string>,
  removed?: string[],
): IxMessage {
  const byUser = new Map<string, string>();
  for (const [emoji, users] of Object.entries(message.reactions)) for (const user of users) byUser.set(user, emoji);
  for (const [key, value] of Object.entries(set ?? {})) if (key.startsWith(REACTION_PREFIX)) byUser.set(key.slice(3), value);
  for (const key of removed ?? []) if (key.startsWith(REACTION_PREFIX)) byUser.delete(key.slice(3));
  const reactions: Record<string, string[]> = {};
  for (const [user, emoji] of byUser) if (emoji) (reactions[emoji] ??= []).push(user);
  return { ...message, reactions };
}

export const isSystemSender = (id: string) => id === SYSTEM_USER_ID;
