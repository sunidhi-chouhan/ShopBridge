import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SYSTEM_USER_ID, SYSTEM_USER_NAME, type ConversationView, type PublicUser } from "../../../shared/types";
import { chatCredentials, listConversations } from "../api";
import {
  channelSummaries,
  connectChat,
  connectedSince,
  markRead,
  subscribeAllMessages,
  subscribeLink,
  systemText,
  type ChatLine,
} from "./nexconn";

export type Notice = {
  id: string;
  orderId: string;
  title: string;
  sender: string;
  preview: string;
};

export type ConversationMeta = { pinned: boolean; muted: boolean; draft: string; lastAt: number };

type Presence = {
  conversations: ConversationView[] | null;
  /** Per-conversation SDK state: pinned, muted (no-disturb), saved draft, last activity. */
  meta: Record<string, ConversationMeta>;
  setMeta: (orderId: string, change: Partial<ConversationMeta>) => void;
  error: string | null;
  unread: Record<string, number>;
  previews: Record<string, string>;
  totalUnread: number;
  notices: Notice[];
  dismiss: (id: string) => void;
  /** The conversation currently on screen (no notifications or unread for it). */
  setActive: (orderId: string | null) => void;
  /** Mark a conversation read (SDK unread counter + local badge). */
  markOpened: (orderId: string) => void;
  refresh: () => Promise<void>;
  senderName: (userId: string) => string;
};

const PresenceContext = createContext<Presence | null>(null);

export function usePresence(): Presence {
  const value = useContext(PresenceContext);
  if (!value) throw new Error("usePresence must be used inside PresenceProvider");
  return value;
}

const NOTICE_MS = 7000;
const MAX_NOTICES = 3;

function previewOf(line: ChatLine | null, photoLabel: string): string {
  if (!line) return "";
  if (line.kind === "image") return `📷 ${photoLabel}`;
  return line.system ? systemText(line.text) : line.text;
}

function namesFrom(conversations: ConversationView[]): Map<string, string> {
  const names = new Map<string, string>([[SYSTEM_USER_ID, SYSTEM_USER_NAME]]);
  for (const item of conversations) {
    names.set(item.counterpart.id, item.counterpart.name);
    if (item.support) {
      names.set(item.support.member.id, item.support.member.name);
      if (item.support.volunteer) names.set(item.support.volunteer.id, item.support.volunteer.name);
      if (item.support.coordinator) names.set(item.support.coordinator.id, item.support.coordinator.name);
    }
  }
  return names;
}

/**
 * App-wide chat presence: one Nexconn connection for the signed-in user, live unread
 * counts per order conversation, and in-app notifications for new messages.
 */
export function PresenceProvider({ user, children }: { user: PublicUser; children: ReactNode }) {
  const [conversations, setConversations] = useState<ConversationView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [meta, setMetaState] = useState<Record<string, ConversationMeta>>({});
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const [notices, setNotices] = useState<Notice[]>([]);
  const active = useRef<string | null>(null);
  const byChannel = useRef(new Map<string, ConversationView>());
  const names = useRef(new Map<string, string>());
  const seen = useRef(new Set<string>());

  const dismiss = useCallback((id: string) => {
    setNotices((current) => current.filter((item) => item.id !== id));
  }, []);

  const loadSummaries = useCallback(async () => {
    const summaries = await channelSummaries([...byChannel.current.keys()], user.id);
    const nextUnread: Record<string, number> = {};
    const nextPreview: Record<string, string> = {};
    const nextMeta: Record<string, ConversationMeta> = {};
    for (const [channelId, summary] of summaries) {
      const item = byChannel.current.get(channelId);
      if (!item) continue;
      nextUnread[item.orderId] = item.orderId === active.current ? 0 : summary.unread;
      nextPreview[item.orderId] = previewOf(summary.latest, "Photo");
      nextMeta[item.orderId] = {
        pinned: summary.pinned,
        muted: summary.muted,
        draft: summary.draft,
        lastAt: summary.latestRaw?.sentTime ?? 0,
      };
    }
    setUnread(nextUnread);
    setMetaState((current) => ({ ...current, ...nextMeta }));
    setPreviews((current) => ({ ...current, ...nextPreview }));
  }, []);

  const refresh = useCallback(async () => {
    const result = await listConversations();
    setError(null);
    byChannel.current = new Map(
      result.conversations.filter((item) => item.channelId).map((item) => [item.channelId!, item]),
    );
    names.current = namesFrom(result.conversations);
    setConversations(result.conversations);
    try {
      const credentials = await chatCredentials();
      await connectChat(credentials.appKey, credentials.token, credentials.userId);
      await loadSummaries();
    } catch {
      // Chat may be unavailable (no keys / offline); the list still works.
    }
  }, [loadSummaries]);

  useEffect(() => {
    refresh().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load conversations."));
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 30000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // Re-sync counters after a reconnect (messages may have arrived while offline).
  useEffect(
    () =>
      subscribeLink((state) => {
        if (state === "connected") void loadSummaries().catch(() => undefined);
      }),
    [loadSummaries],
  );

  useEffect(
    () =>
      subscribeAllMessages((line) => {
        const item = byChannel.current.get(line.channelId);
        if (!item) {
          // A conversation we have not listed yet (new order): refresh the list.
          void refresh().catch(() => undefined);
          return;
        }
        setPreviews((current) => ({ ...current, [item.orderId]: previewOf(line, "Photo") }));
        setMetaState((current) => ({
          ...current,
          [item.orderId]: { ...(current[item.orderId] ?? { pinned: false, muted: false, draft: "" }), lastAt: line.sentTime },
        }));
        if (line.senderId === user.id) return;
        const viewing = active.current === item.orderId && document.visibilityState === "visible";
        if (viewing) return; // the open conversation marks itself read

        setUnread((current) => ({ ...current, [item.orderId]: (current[item.orderId] ?? 0) + 1 }));
        // Skip duplicates and the backlog delivered right after connecting.
        if (seen.current.has(line.id) || line.sentTime < connectedSince() - 3000) return;
        if (metaRef.current[item.orderId]?.muted) return;
        seen.current.add(line.id);
        const notice: Notice = {
          id: line.id,
          orderId: item.orderId,
          title: item.title,
          sender: names.current.get(line.senderId) ?? item.counterpart.name,
          preview: previewOf(line, "Photo").slice(0, 110),
        };
        setNotices((current) => [...current.filter((entry) => entry.orderId !== item.orderId), notice].slice(-MAX_NOTICES));
        window.setTimeout(() => dismiss(notice.id), NOTICE_MS);
      }),
    [dismiss, refresh, user.id],
  );

  const setActive = useCallback((orderId: string | null) => {
    active.current = orderId;
    if (orderId) {
      setNotices((current) => current.filter((item) => item.orderId !== orderId));
    }
  }, []);

  const markOpened = useCallback((orderId: string) => {
    setUnread((current) => (current[orderId] ? { ...current, [orderId]: 0 } : current));
    const channelId = [...byChannel.current.values()].find((item) => item.orderId === orderId)?.channelId;
    if (channelId) void markRead(channelId);
  }, []);

  const setMeta = useCallback((orderId: string, change: Partial<ConversationMeta>) => {
    setMetaState((current) => ({
      ...current,
      [orderId]: { ...(current[orderId] ?? { pinned: false, muted: false, draft: "", lastAt: 0 }), ...change },
    }));
  }, []);

  const senderName = useCallback((userId: string) => names.current.get(userId) ?? "", []);

  // Muted conversations keep their own badge but do not count toward the nav total.
  const totalUnread = useMemo(
    () => Object.entries(unread).reduce((sum, [orderId, value]) => sum + (meta[orderId]?.muted ? 0 : value), 0),
    [unread, meta],
  );

  const value = useMemo(
    () => ({
      conversations,
      meta,
      setMeta,
      error,
      unread,
      previews,
      totalUnread,
      notices,
      dismiss,
      setActive,
      markOpened,
      refresh,
      senderName,
    }),
    [conversations, meta, setMeta, error, unread, previews, totalUnread, notices, dismiss, setActive, markOpened, refresh, senderName],
  );

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}
