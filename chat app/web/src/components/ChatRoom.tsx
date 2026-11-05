import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { chatCredentials } from "../api";
import { loadLanguagePrefs, saveLanguagePrefs, type LanguagePrefs } from "../chat/languagePrefs";
import { connectSaathi, loadHistory, sendChat, subscribeRoom, type ChatLine } from "../chat/nexconn";
import {
  countTranslationStates,
  requestTranslations,
  subscribeTranslationCache,
  syncNexconnTranslationLanguage,
} from "../chat/translate";
import { isSystemEvent } from "../conversation/format";
import { LanguageBar } from "../conversation/LanguageBar";
import { MessageComposer } from "../conversation/MessageComposer";
import { MessageTimeline } from "../conversation/MessageTimeline";
import { TranslationNotice } from "../conversation/TranslationNotice";
import { copy } from "../copy";
import { ErrorState, LoadingState } from "../ui/StateView";

type Phase =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready" };

function merge(current: ChatLine[], incoming: ChatLine[]): ChatLine[] {
  const byId = new Map(current.map((line) => [line.id, line]));
  for (const line of incoming) byId.set(line.id, line);
  return [...byId.values()].sort((a, b) => a.sentTime - b.sentTime);
}

export function ChatRoom({
  channelId,
  selfId,
  names,
  orderLabel,
  roles,
  compact = false,
}: {
  channelId: string;
  selfId: string;
  names: Record<string, string>;
  orderLabel?: string;
  roles?: Record<string, string>;
  compact?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ status: "loading" });
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [prefs, setPrefs] = useState<LanguagePrefs>(() => loadLanguagePrefs(selfId));
  const [langNotice, setLangNotice] = useState<string | null>(null);
  const [cacheTick, setCacheTick] = useState(0);
  const [roomRetrying, setRoomRetrying] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const attempt = useRef(0);
  const seeded = useRef(false);

  useEffect(() => {
    setPrefs(loadLanguagePrefs(selfId));
  }, [selfId]);

  useEffect(() => subscribeTranslationCache(() => setCacheTick((value) => value + 1)), []);

  useEffect(() => {
    const token = attempt.current + 1;
    attempt.current = token;
    let unsubscribe = () => {};
    setPhase({ status: "loading" });
    setLines([]);
    seeded.current = false;

    const open = async () => {
      const credentials = await chatCredentials();
      await connectSaathi(credentials.appKey, credentials.token, credentials.userId);
      const stored = loadLanguagePrefs(selfId);
      setPrefs(stored);
      await syncNexconnTranslationLanguage(stored.targetLanguage).catch(() => {
        // Console Translation may be off — messaging still works.
      });
      if (attempt.current !== token) return;
      unsubscribe = subscribeRoom(channelId, (line) => {
        setLines((current) => merge(current, [line]));
      });
      const history = await loadHistory(channelId);
      if (attempt.current !== token) return;
      setLines((current) => merge(history, current));
      seeded.current = true;
      setPhase({ status: "ready" });
    };

    open().catch((error: unknown) => {
      if (attempt.current !== token) return;
      const message = error instanceof Error ? error.message : copy.retry;
      setPhase({ status: "error", message });
    });

    return () => {
      attempt.current += 1;
      unsubscribe();
    };
  }, [channelId, retryToken, selfId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines.length, lines[lines.length - 1]?.id]);

  const peerLines = useMemo(
    () => lines.filter((line) => line.senderId !== selfId && !isSystemEvent(line.text)),
    [lines, selfId],
  );

  const translationCounts = useMemo(() => {
    void cacheTick;
    return countTranslationStates(
      peerLines.map((line) => line.id),
      prefs.targetLanguage,
    );
  }, [cacheTick, peerLines, prefs.targetLanguage]);

  useEffect(() => {
    if (phase.status !== "ready" || !prefs.autoTranslate) return;
    if (peerLines.length === 0) return;
    void requestTranslations(peerLines, prefs.targetLanguage);
  }, [peerLines, phase.status, prefs.autoTranslate, prefs.targetLanguage]);

  useEffect(() => {
    if (translationCounts.pending === 0) setRoomRetrying(false);
  }, [translationCounts.pending]);

  async function onPrefsChange(next: LanguagePrefs) {
    setPrefs(next);
    saveLanguagePrefs(selfId, next);
    setLangNotice(null);
    try {
      await syncNexconnTranslationLanguage(next.targetLanguage);
    } catch {
      setLangNotice("Preference saved. Nexconn language sync needs Console Translation enabled.");
    }
    if (next.autoTranslate && peerLines.length > 0) {
      void requestTranslations(peerLines, next.targetLanguage, { force: true });
    }
  }

  async function onRetryRoomTranslations() {
    if (roomRetrying || translationCounts.pending > 0 || peerLines.length === 0) return;
    setRoomRetrying(true);
    await requestTranslations(peerLines, prefs.targetLanguage, { force: true });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const line = await sendChat(channelId, text);
      setLines((current) => merge(current, [line]));
      setDraft("");
    } catch (error: unknown) {
      setSendError(error instanceof Error ? error.message : "The message was not sent.");
    } finally {
      setSending(false);
    }
  }

  const statusLabel =
    translationCounts.pending > 0
      ? "Translating…"
      : translationCounts.failed > 0
        ? "Translation unavailable"
        : translationCounts.ready > 0
          ? "Translated"
          : null;

  const showSharedFailure = translationCounts.failed > 0 && translationCounts.pending === 0;

  return (
    <section className={compact ? "room is-compact" : "room"} aria-label="Conversation">
      {orderLabel ? (
        <p className="room-order">
          Order · <strong>{orderLabel}</strong>
        </p>
      ) : null}
      <LanguageBar
        prefs={prefs}
        onChange={(next) => void onPrefsChange(next)}
        statusLabel={statusLabel}
        compact
      />
      {langNotice ? (
        <p className="meta language-bar-notice" role="status">
          {langNotice}
        </p>
      ) : null}
      {showSharedFailure ? (
        <TranslationNotice
          pending={translationCounts.pending > 0}
          retrying={roomRetrying}
          onRetry={() => void onRetryRoomTranslations()}
        />
      ) : null}
      {phase.status === "loading" ? <LoadingState label={copy.chatLoading} /> : null}
      {phase.status === "error" ? (
        <ErrorState message={phase.message} onRetry={() => setRetryToken((value) => value + 1)} />
      ) : null}
      {phase.status === "ready" ? (
        <div className="room-body">
          <div className="room-scroll">
            <MessageTimeline
              lines={lines}
              selfId={selfId}
              names={names}
              roles={roles}
              animateNew={seeded.current}
              targetLanguage={prefs.targetLanguage}
              autoTranslate={prefs.autoTranslate}
              sharedFailureNotice={showSharedFailure}
            />
            <div ref={bottomRef} />
          </div>
          <MessageComposer
            draft={draft}
            sending={sending}
            sendError={sendError}
            onDraftChange={setDraft}
            onSubmit={(event) => void onSubmit(event)}
          />
        </div>
      ) : null}
    </section>
  );
}
