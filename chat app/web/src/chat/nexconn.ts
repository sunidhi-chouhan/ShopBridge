import {
  AreaCode,
  BaseChannel,
  GroupChannel,
  GroupChannelIdentifier,
  LogLevel,
  MessageHandler,
  NCEngine,
  SendTextMessageParams,
  type Message,
} from "@nexconn/chat";
import { ensureTranslateHandler } from "./translate";

export type ChatLine = {
  id: string;
  senderId: string;
  text: string;
  sentTime: number;
};

type Listener = (line: ChatLine) => void;

const listeners = new Map<string, Set<Listener>>();
let handlerReady = false;
let initializedKey: string | null = null;
let activeUserId = "";
let connectTask: Promise<void> | null = null;

function readText(message: Message): string {
  const content = message.content as { text?: unknown; content?: unknown };
  if (typeof content?.text === "string" && content.text.trim()) return content.text;
  if (typeof content?.content === "string" && content.content.trim()) return content.content;
  return "";
}

function toLine(message: Message): ChatLine | null {
  const text = readText(message);
  if (!text) return null;
  return {
    id: message.messageId || `${message.senderUserId}-${message.sentTime}`,
    senderId: message.senderUserId,
    text,
    sentTime: message.sentTime || Date.now(),
  };
}

function ensureHandler(): void {
  if (handlerReady) return;
  NCEngine.addMessageHandler(
    "saathi",
    new MessageHandler({
      onMessageReceived({ messages }) {
        for (const message of messages) {
          const line = toLine(message);
          const channelId = message.channelIdentifier?.channelId;
          if (!line || !channelId) continue;
          listeners.get(channelId)?.forEach((listener) => listener(line));
        }
      },
    }),
  );
  handlerReady = true;
}

export async function connectSaathi(appKey: string, token: string, userId: string): Promise<void> {
  if (activeUserId === userId && NCEngine.getCurrentUserId() === userId) return;
  if (connectTask) return connectTask;

  connectTask = (async () => {
    if (!initializedKey) {
      NCEngine.initialize({ appKey, logLevel: LogLevel.WARN, areaCode: AreaCode.SG });
      initializedKey = appKey;
      ensureHandler();
      ensureTranslateHandler();
    } else if (initializedKey !== appKey) {
      throw new Error("The Nexconn App Key changed. Reload the page.");
    }

    if (NCEngine.getCurrentUserId() && NCEngine.getCurrentUserId() !== userId) {
      await NCEngine.disconnect();
      activeUserId = "";
    }

    if (NCEngine.getCurrentUserId() !== userId) {
      const result = await NCEngine.connect({ token });
      if (!result.isOk) throw new Error("Could not connect to the Nexconn help room.");
    }
    activeUserId = userId;
  })().finally(() => {
    connectTask = null;
  });

  return connectTask;
}

export async function disconnectSaathi(): Promise<void> {
  if (!initializedKey) return;
  await NCEngine.disconnect().catch(() => undefined);
  activeUserId = "";
}

export function subscribeRoom(channelId: string, listener: Listener): () => void {
  const set = listeners.get(channelId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(channelId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(channelId);
  };
}

export async function loadHistory(channelId: string): Promise<ChatLine[]> {
  const group = new GroupChannel(channelId);
  await group.join().catch(() => undefined);
  const query = BaseChannel.createMessagesQuery({
    channelIdentifier: new GroupChannelIdentifier(channelId),
    pageSize: 40,
    isAscending: false,
    startTime: Date.now(),
  });
  const result = await query.loadNextPage();
  if (!result.isOk || !result.data) throw new Error("Could not load messages in this room.");
  await group.clearUnreadCount().catch(() => undefined);
  return result.data.data
    .map(toLine)
    .filter((line): line is ChatLine => line !== null)
    .sort((a, b) => a.sentTime - b.sentTime);
}

export async function sendChat(channelId: string, text: string): Promise<ChatLine> {
  const group = new GroupChannel(channelId);
  const result = await group.sendMessage(new SendTextMessageParams({ text }));
  if (!result.isOk || !result.data) throw new Error("The message was not sent.");
  const line = toLine(result.data);
  if (!line) throw new Error("The message was not sent.");
  return line;
}

export async function channelUnread(channelId: string): Promise<number> {
  const group = new GroupChannel(channelId);
  await group.join().catch(() => undefined);
  return group.unreadCount ?? 0;
}

/** Latest message + unread for inbox rows. Does not clear unread. */
export async function channelSnapshot(
  channelId: string,
): Promise<{ unread: number; preview: string; sentTime: number }> {
  const group = new GroupChannel(channelId);
  await group.join().catch(() => undefined);
  const unread = group.unreadCount ?? 0;
  const query = BaseChannel.createMessagesQuery({
    channelIdentifier: new GroupChannelIdentifier(channelId),
    pageSize: 1,
    isAscending: false,
    startTime: Date.now(),
  });
  const result = await query.loadNextPage();
  const message = result.isOk && result.data?.data?.[0] ? toLine(result.data.data[0]) : null;
  return {
    unread,
    preview: message?.text ?? "",
    sentTime: message?.sentTime ?? 0,
  };
}
