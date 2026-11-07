import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Language } from "../../../shared/types";
import { chatCredentials } from "../api";
import { useSession } from "../app/session";
import {
  connectChat,
  currentLinkState,
  loadHistory,
  markRead,
  sendChat,
  sendImage,
  subscribeLink,
  subscribeRoom,
  type ChatLine,
  type LinkState,
} from "../chat/nexconn";
import { usePresence } from "../chat/presence";
import {
  countTranslationStates,
  requestTranslations,
  subscribeTranslationCache,
  syncNexconnTranslationLanguage,
  translateText,
} from "../chat/translate";
import { LanguageBar } from "../conversation/LanguageBar";
import { MessageComposer } from "../conversation/MessageComposer";
import { MessageTimeline } from "../conversation/MessageTimeline";
import { TranslationNotice } from "../conversation/TranslationNotice";
import { t } from "../i18n";
import { Button } from "../ui/Button";
import { ErrorState, LoadingState } from "../ui/StateView";

type Phase = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

function merge(current: ChatLine[], incoming: ChatLine[]): ChatLine[] {
  const byId = new Map(current.map((line) => [line.id, line]));
  for (const line of incoming) byId.set(line.id, line);
  return [...byId.values()].sort((a, b) => a.sentTime - b.sentTime);
}

export type PreviewTarget = { name: string; language: Language };

export function ChatRoom({
  channelId,
  orderId,
  selfId,
  names,
  roles,
  languages,
  previewTarget,
  onSystemEvent,
  onLines,
}: {
  channelId: string;
  orderId: string;
  selfId: string;
  names: Record<string, string>;
  roles?: Record<string, string>;
  /** Known reading language per participant (sets `lang` on originals for screen readers). */
  languages?: Record<string, Language | null | undefined>;
  /** Show how the main other party will read the draft, when their language differs. */
  previewTarget?: PreviewTarget | null;
  /** Called when an order event (shipped, support joined, resolution…) arrives live. */
  onSystemEvent?: () => void;
  /** Latest loaded lines (used by the support assistant). */
  onLines?: (lines: ChatLine[]) => void;
}) {
  const { language, autoTranslate, setLanguage, setAutoTranslate } = useSession();
  const presence = usePresence();
  const [phase, setPhase] = useState<Phase>({ status: "loading" });
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [upload, setUpload] = useState<number | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [langNotice, setLangNotice] = useState<string | null>(null);
  const [cacheTick, setCacheTick] = useState(0);
  const [roomRetrying, setRoomRetrying] = useState(false);
  const [link, setLink] = useState<LinkState>(() => currentLinkState());
  const [preview, setPreview] = useState<{ text: string | null; pending: boolean } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const keepOffset = useRef<number | null>(null);
  const attempt = useRef(0);
  const seeded = useRef(false);
  const onSystemRef = useRef(onSystemEvent);
  onSystemRef.current = onSystemEvent;

  useEffect(() => subscribeTranslationCache(() => setCacheTick((value) => value + 1)), []);
  useEffect(() => subscribeLink(setLink), []);
  useEffect(() => onLines?.(lines), [lines, onLines]);

  // The support case brief can hand a reviewed AI draft to this composer (never auto-sent).
  useEffect(() => {
    const onDraft = (event: Event) => {
      const text = (event as CustomEvent<string>).detail;
      if (typeof text === "string") setDraft(text);
      document.getElementById("chat-draft")?.focus();
    };
    window.addEventListener("shopbridge:draft", onDraft);
    return () => window.removeEventListener("shopbridge:draft", onDraft);
  }, []);

  // This conversation is on screen: no notifications for it, and keep it marked read.
  useEffect(() => {
    presence.setActive(orderId);
    presence.markOpened(orderId);
    return () => presence.setActive(null);
  }, [orderId, presence.setActive, presence.markOpened]);

  useEffect(() => {
    const token = attempt.current + 1;
    attempt.current = token;
    let unsubscribe = () => {};
    setPhase({ status: "loading" });
    setLines([]);
    seeded.current = false;

    const open = async () => {
      const credentials = await chatCredentials();
      await connectChat(credentials.appKey, credentials.token, credentials.userId);
      await syncNexconnTranslationLanguage(language).catch(() => undefined);
      if (attempt.current !== token) return;
      unsubscribe = subscribeRoom(channelId, (line) => {
        setLines((current) => merge(current, [line]));
        if (line.system) onSystemRef.current?.();
        if (line.senderId !== selfId && document.visibilityState === "visible") void markRead(channelId);
      });
      const history = await loadHistory(channelId);
      if (attempt.current !== token) return;
      setLines((current) => merge(history.lines, current));
      setHasMore(history.hasMore);
      seeded.current = true;
      setPhase({ status: "ready" });
      void markRead(channelId);
    };

    open().catch((error: unknown) => {
      if (attempt.current !== token) return;
      setPhase({ status: "error", message: error instanceof Error ? error.message : "Could not open the conversation." });
    });

    return () => {
      attempt.current += 1;
      unsubscribe();
    };
    // `language` is applied separately below; re-opening the room on change is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, retryToken, selfId]);

  // Keep the newest message in view; when older history is prepended, hold the reading position.
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    if (keepOffset.current !== null) {
      node.scrollTop = node.scrollHeight - keepOffset.current;
      keepOffset.current = null;
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [lines.length, lines[lines.length - 1]?.id, phase.status]);

  // Mark read again when the tab becomes visible.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void markRead(channelId);
        presence.markOpened(orderId);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [channelId, orderId, presence.markOpened]);

  /** Every text message in the conversation — peers, yours, and order events. */
  const textLines = useMemo(() => lines.filter((line) => line.kind === "text"), [lines]);

  const translationCounts = useMemo(() => {
    void cacheTick;
    return countTranslationStates(
      textLines.filter((line) => line.senderId !== selfId).map((line) => line.id),
      language,
    );
  }, [cacheTick, textLines, language, selfId]);

  // Translate the whole loaded conversation (and anything new) into the reading language.
  useEffect(() => {
    if (phase.status !== "ready" || !autoTranslate || textLines.length === 0) return;
    void requestTranslations(textLines, language);
  }, [textLines, phase.status, autoTranslate, language]);

  useEffect(() => {
    if (translationCounts.pending === 0) setRoomRetrying(false);
  }, [translationCounts.pending]);

  // Live preview of how the other party will read the draft.
  useEffect(() => {
    const text = draft.trim();
    if (!previewTarget || previewTarget.language === language || text.length < 2 || link !== "connected") {
      setPreview(null);
      return;
    }
    setPreview((current) => ({ text: current?.text ?? null, pending: true }));
    let alive = true;
    const timer = window.setTimeout(() => {
      void translateText(text, previewTarget.language).then((result) => {
        if (alive) setPreview({ text: result && result !== text ? result : null, pending: false });
      });
    }, 650);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [draft, previewTarget, language, link]);

  async function onLanguageChange(next: Language) {
    setLangNotice(null);
    try {
      await setLanguage(next);
    } catch {
      setLangNotice("Could not save your language. Try again.");
    }
  }

  async function onRetryRoomTranslations() {
    if (roomRetrying || translationCounts.pending > 0 || textLines.length === 0) return;
    setRoomRetrying(true);
    await requestTranslations(textLines, language, { force: true });
  }

  const loadOlder = useCallback(async () => {
    const oldest = lines[0];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await loadHistory(channelId, oldest.sentTime - 1);
      const node = scrollRef.current;
      keepOffset.current = node ? node.scrollHeight - node.scrollTop : null;
      setLines((current) => merge(page.lines, current));
      setHasMore(page.hasMore);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingOlder(false);
    }
  }, [channelId, lines, loadingOlder]);

  async function onSubmit(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const line = await sendChat(channelId, text);
      setLines((current) => merge(current, [line]));
      setDraft("");
      setPreview(null);
    } catch (error: unknown) {
      setSendError(error instanceof Error ? error.message : "The message was not sent.");
    } finally {
      setSending(false);
    }
  }

  async function onAttach(file: File) {
    setSendError(null);
    setUpload(0);
    try {
      const line = await sendImage(channelId, file, setUpload);
      setLines((current) => merge(current, [line]));
    } catch (error: unknown) {
      setSendError(error instanceof Error ? error.message : "The photo was not sent.");
    } finally {
      setUpload(null);
    }
  }

  const statusLabel =
    translationCounts.pending > 0
      ? t(language, "translating")
      : translationCounts.failed > 0
        ? t(language, "translationOff")
        : translationCounts.ready > 0
          ? t(language, "translated")
          : null;

  const showSharedFailure = translationCounts.failed > 0 && translationCounts.pending === 0;

  return (
    <section className="room is-compact" aria-label="Conversation">
      <LanguageBar
        uiLanguage={language}
        language={language}
        autoTranslate={autoTranslate}
        onLanguage={(next) => void onLanguageChange(next)}
        onAutoTranslate={setAutoTranslate}
        statusLabel={statusLabel}
        compact
      />
      {langNotice ? (
        <p className="meta language-bar-notice" role="status">
          {langNotice}
        </p>
      ) : null}
      {phase.status === "ready" && link !== "connected" ? (
        <div className="note room-link" role="status">
          <p>{link === "connecting" ? t(language, "reconnecting") : link === "elsewhere" ? t(language, "elsewhere") : t(language, "offline")}</p>
          {link === "connecting" ? null : (
            <Button variant="secondary" onClick={() => setRetryToken((value) => value + 1)}>
              {link === "elsewhere" ? t(language, "useHere") : t(language, "reconnect")}
            </Button>
          )}
        </div>
      ) : null}
      {showSharedFailure ? (
        <TranslationNotice
          pending={translationCounts.pending > 0}
          retrying={roomRetrying}
          onRetry={() => void onRetryRoomTranslations()}
        />
      ) : null}
      {phase.status === "loading" ? <LoadingState label="Opening the conversation" /> : null}
      {phase.status === "error" ? (
        <ErrorState message={phase.message} onRetry={() => setRetryToken((value) => value + 1)} />
      ) : null}
      {phase.status === "ready" ? (
        <div className="room-body">
          <div className="room-scroll" ref={scrollRef} tabIndex={0} aria-label="Message history">
            {hasMore ? (
              <div className="room-older">
                <Button variant="quiet" pending={loadingOlder} onClick={() => void loadOlder()}>
                  {t(language, "loadOlder")}
                </Button>
              </div>
            ) : null}
            <MessageTimeline
              lines={lines}
              selfId={selfId}
              names={names}
              roles={roles}
              languages={languages}
              animateNew={seeded.current}
              targetLanguage={language}
              autoTranslate={autoTranslate}
              sharedFailureNotice={showSharedFailure}
            />
          </div>
          <MessageComposer
            language={language}
            draft={draft}
            sending={sending}
            upload={upload}
            sendError={sendError}
            preview={
              previewTarget && preview
                ? { name: previewTarget.name, language: previewTarget.language, text: preview.text, pending: preview.pending }
                : null
            }
            disabled={link !== "connected"}
            onDraftChange={setDraft}
            onSubmit={(event) => void onSubmit(event)}
            onSend={() => void onSubmit()}
            onAttach={(file) => void onAttach(file)}
          />
        </div>
      ) : null}
    </section>
  );
}
