import { useCallback, useEffect, useRef, useState } from "react";
import { MESSAGE_TYPES } from "../../../shared/types";
import { chatCredentials } from "../api";
import { connectChat, subscribeChatEvents } from "../chat/nexconn";
import { forgetTranslation } from "../chat/translate";
import {
  applyReactionChange,
  currentPin,
  deleteForAll,
  deleteForMe,
  editMessage,
  loadPage,
  readCounts,
  sendCustom,
  sendFile,
  sendReadReceipts,
  sendText,
  sendVoice,
  setReaction,
  toIx,
  type IxMessage,
} from "./engine";

type Phase = "loading" | "ready" | "error";

export function useConversation(channelId: string | null, selfId: string) {
  const [messages, setMessages] = useState<IxMessage[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [typing, setTyping] = useState<{ userId: string; kind: "text" | "voice" } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [reload, setReload] = useState(0);
  const typingTimer = useRef<number | null>(null);
  const list = useRef<IxMessage[]>([]);
  list.current = messages;

  const upsert = useCallback((incoming: IxMessage[], replaceId?: string) => {
    setMessages((current) => {
      const byId = new Map(current.filter((m) => m.id !== replaceId).map((m) => [m.id, m]));
      for (const message of incoming) {
        const existing = byId.get(message.id);
        byId.set(message.id, existing ? { ...message, status: existing.status === "read" ? "read" : message.status, transcript: existing.transcript } : message);
      }
      return [...byId.values()].sort((a, b) => a.at - b.at);
    });
  }, []);

  const patch = useCallback((id: string, change: (m: IxMessage) => IxMessage) => {
    setMessages((current) => current.map((m) => (m.id === id ? change(m) : m)));
  }, []);

  // Load history and read receipts.
  useEffect(() => {
    if (!channelId) return;
    let alive = true;
    setPhase("loading");
    setMessages([]);
    setHidden(new Set());
    setTyping(null);
    (async () => {
      const credentials = await chatCredentials();
      await connectChat(credentials.appKey, credentials.token, credentials.userId);
      const page = await loadPage(channelId, selfId);
      if (!alive) return;
      const counts = await readCounts(channelId, page.messages.filter((m) => m.mine).map((m) => m.id));
      const withStatus = page.messages.map((m) => (m.mine && (counts.get(m.id) ?? 0) > 0 ? { ...m, status: "read" as const } : m));
      setMessages(withStatus);
      setHasMore(page.hasMore);
      setPhase("ready");
      void sendReadReceipts(channelId, withStatus);
    })().catch((caught: unknown) => {
      if (!alive) return;
      setError(caught instanceof Error ? caught.message : "Could not open this conversation.");
      setPhase("error");
    });
    return () => {
      alive = false;
    };
  }, [channelId, selfId, reload]);

  // Live SDK events for this channel.
  useEffect(() => {
    if (!channelId) return;
    return subscribeChatEvents((event) => {
      if (event.type === "message") {
        const raw = event.raw;
        if (raw.channelIdentifier?.channelId !== channelId) return;
        if (raw.messageType === MESSAGE_TYPES.typing) {
          if (raw.senderUserId === selfId) return;
          const kind = (raw.content as { kind?: string })?.kind === "voice" ? "voice" : "text";
          setTyping({ userId: raw.senderUserId, kind });
          if (typingTimer.current) window.clearTimeout(typingTimer.current);
          typingTimer.current = window.setTimeout(() => setTyping(null), 6000);
          return;
        }
        if (raw.messageType === MESSAGE_TYPES.edit) {
          const { targetId, text } = (raw.content ?? {}) as { targetId?: string; text?: string };
          if (targetId && typeof text === "string") {
            forgetTranslation(targetId);
            patch(targetId, (m) => (m.senderId === raw.senderUserId ? { ...m, text, edited: true } : m));
          }
          return;
        }
        const message = toIx(raw, selfId);
        if (!message) return;
        if (!message.mine) setTyping(null);
        upsert([message]);
        if (!message.mine && document.visibilityState === "visible") void sendReadReceipts(channelId, [message]);
      } else if (event.type === "updated") {
        const updated = event.raws
          .filter((raw) => raw.channelIdentifier?.channelId === channelId)
          .map((raw) => toIx(raw, selfId))
          .filter((m): m is IxMessage => m !== null)
          .map((m) => ({ ...m, edited: true }));
        updated.forEach((m) => forgetTranslation(m.id));
        if (updated.length) upsert(updated);
      } else if (event.type === "deleted") {
        const ids = new Set(event.ids);
        setMessages((current) => current.map((m) => (ids.has(m.id) ? { ...m, recalled: true, reactions: {} } : m)));
      } else if (event.type === "metadata" && event.channelId === channelId) {
        patch(event.messageId, (m) => applyReactionChange(m, event.set, event.removed));
      } else if (event.type === "receipt" && event.channelId === channelId && event.readCount > 0) {
        patch(event.messageId, (m) => ({ ...m, status: "read" }));
      } else if (event.type === "stt") {
        patch(event.messageId, (m) => ({
          ...m,
          transcript: event.text ?? (event.code === 0 ? "" : "Transcript unavailable for this message."),
        }));
      }
    });
  }, [channelId, selfId, upsert, patch]);

  useEffect(() => {
    if (!channelId) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void sendReadReceipts(channelId, list.current);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [channelId]);

  const loadOlder = useCallback(async () => {
    if (!channelId || !list.current[0]) return;
    const page = await loadPage(channelId, selfId, list.current[0].at - 1);
    upsert(page.messages);
    setHasMore(page.hasMore);
  }, [channelId, selfId, upsert]);

  /** Optimistic send: a local "sending" bubble is replaced by the server message, or marked failed. */
  const optimistic = useCallback(
    async (draft: Partial<IxMessage>, task: (onProgress: (pct: number) => void) => Promise<IxMessage>) => {
      if (!channelId) return;
      const localId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const local: IxMessage = {
        id: localId,
        channelId,
        senderId: selfId,
        at: Date.now(),
        kind: "text",
        text: "",
        mine: true,
        edited: false,
        recalled: false,
        reply: null,
        reactions: {},
        raw: null,
        status: "sending",
        ...draft,
      };
      upsert([local]);
      const run = async () => {
        try {
          const sent = await task((pct) => patch(localId, (m) => ({ ...m, payload: { ...(m.payload ?? {}), progress: pct } })));
          upsert([{ ...sent, reply: sent.reply ?? local.reply }], localId);
        } catch (caught: unknown) {
          patch(localId, (m) => ({
            ...m,
            status: "failed",
            payload: { ...(m.payload ?? {}), error: caught instanceof Error ? caught.message : "Not sent", retry: run },
          }));
        }
      };
      await run();
    },
    [channelId, selfId, upsert, patch],
  );

  const actions = {
    sendText: (text: string, replyTo: IxMessage | null) =>
      optimistic({ text, reply: replyTo ? { id: replyTo.id, senderId: replyTo.senderId, text: replyTo.text } : null }, () =>
        sendText(channelId!, text, selfId, replyTo),
      ),
    sendFile: (file: File) =>
      optimistic(
        {
          kind: file.type.startsWith("image/") ? "image" : "file",
          name: file.name,
          size: file.size,
          thumb: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
          payload: { progress: 0 },
        },
        (onProgress) => sendFile(channelId!, file, selfId, onProgress),
      ),
    sendVoice: (blob: Blob, seconds: number) =>
      optimistic({ kind: "voice", duration: seconds, url: URL.createObjectURL(blob) }, () =>
        sendVoice(channelId!, blob, seconds, selfId),
      ),
    sendCard: (type: string, content: Record<string, unknown>, kind: IxMessage["kind"] = "order") =>
      optimistic({ kind, payload: content }, () => sendCustom(channelId!, type, content, selfId)),
    retry: (message: IxMessage) => (message.payload?.retry as (() => Promise<void>) | undefined)?.(),
    react: async (message: IxMessage, emoji: string) => {
      const mine = Object.entries(message.reactions).find(([, users]) => users.includes(selfId))?.[0] ?? null;
      const next = mine === emoji ? null : emoji;
      patch(message.id, (m) => applyReactionChange(m, next ? { [`rx_${selfId}`]: next } : {}, next ? [] : [`rx_${selfId}`]));
      await setReaction(message, selfId, next);
    },
    edit: async (message: IxMessage, text: string) => {
      await editMessage(message, text);
      forgetTranslation(message.id);
      patch(message.id, (m) => ({ ...m, text, edited: true }));
    },
    deleteForAll: async (message: IxMessage) => {
      await deleteForAll(message);
      patch(message.id, (m) => ({ ...m, recalled: true, reactions: {} }));
    },
    deleteForMe: async (message: IxMessage) => {
      setHidden((current) => new Set(current).add(message.id));
      try {
        await deleteForMe(message);
      } catch (caught) {
        setHidden((current) => {
          const next = new Set(current);
          next.delete(message.id);
          return next;
        });
        throw caught;
      }
    },
    pin: async (targetId: string | null) => {
      const sent = await sendCustom(channelId!, MESSAGE_TYPES.pin, { targetId }, selfId);
      upsert([sent]);
    },
    loadOlder,
    reload: () => setReload((value) => value + 1),
  };

  const visible = messages.filter((m) => !hidden.has(m.id));
  return {
    phase,
    error,
    hasMore,
    typing,
    messages: visible.filter((m) => !(m.kind === "sys" && m.payload?.pin !== undefined)),
    pinnedId: currentPin(messages),
    actions,
  };
}
