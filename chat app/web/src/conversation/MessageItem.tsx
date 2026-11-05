import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ChatLine } from "../chat/nexconn";
import { languageLabel } from "../chat/languagePrefs";
import {
  getCachedTranslation,
  requestTranslations,
  subscribeTranslation,
  type TranslationState,
} from "../chat/translate";
import { Button } from "../ui/Button";
import { easeOut, useMotionOn } from "../ui/motion";
import { formatMessageTime } from "./format";

export function MessageItem({
  line,
  mine,
  name,
  role,
  animate,
  targetLanguage,
  autoTranslate,
  sharedFailureNotice,
}: {
  line: ChatLine;
  mine: boolean;
  name: string;
  role?: string;
  animate: boolean;
  targetLanguage: string;
  autoTranslate: boolean;
  /** When true, Console hint is shown once above the timeline — keep per-message UI minimal. */
  sharedFailureNotice?: boolean;
}) {
  const motionOn = useMotionOn();
  const [translation, setTranslation] = useState<TranslationState>(() =>
    getCachedTranslation(line.id, targetLanguage),
  );
  const [showOriginal, setShowOriginal] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const autoKey = useRef<string | null>(null);

  useEffect(() => {
    return subscribeTranslation(line.id, targetLanguage, (state) => {
      setTranslation(state);
      if (state.status !== "pending") setRetrying(false);
    });
  }, [line.id, targetLanguage]);

  useEffect(() => {
    if (mine || !autoTranslate) return;
    const attemptKey = `${line.id}::${targetLanguage}`;
    if (autoKey.current === attemptKey) return;
    const cached = getCachedTranslation(line.id, targetLanguage);
    if (cached.status === "ready" || cached.status === "pending" || cached.status === "error") {
      autoKey.current = attemptKey;
      return;
    }
    autoKey.current = attemptKey;
    void requestTranslations([line], targetLanguage);
  }, [autoTranslate, line, mine, targetLanguage]);

  async function onRetry() {
    if (retrying || translation.status === "pending") return;
    setRetrying(true);
    await requestTranslations([line], targetLanguage, { force: true });
  }

  const translated =
    translation.status === "ready" && translation.text && translation.text !== line.text
      ? translation
      : null;
  const isPending = translation.status === "pending" || retrying;
  const isFailed = translation.status === "error" && !isPending;

  return (
    <motion.li
      className={mine ? "message is-mine" : "message"}
      initial={motionOn && animate ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: easeOut }}
    >
      <span className="who">
        {mine ? "You" : name}
        {role ? <span className="role-tag"> · {role}</span> : null}
        <span className="when"> · {formatMessageTime(line.sentTime)}</span>
      </span>
      {translated && !showOriginal ? null : <p className="message-original">{line.text}</p>}
      {translated ? (
        <div className="message-translation" lang={translated.targetLanguage}>
          <p className="message-translation-kicker meta">
            Translated · {languageLabel(translated.targetLanguage)}
          </p>
          <p className="message-translation-text">{translated.text}</p>
          <button
            type="button"
            className="text-back message-translation-toggle"
            onClick={() => setShowOriginal((value) => !value)}
          >
            {showOriginal ? "Hide original" : "Show original"}
          </button>
        </div>
      ) : null}
      {!mine && !translated && isPending ? (
        <p className="message-translate-progress meta" aria-live="polite">
          Translating…
        </p>
      ) : null}
      {!mine && !translated && isFailed && !sharedFailureNotice ? (
        <div className="message-translate-fail">
          <div className="message-translate-fail-copy">
            <p className="message-translate-fail-title">Translation unavailable</p>
            <p className="meta">Enable Translation in Nexconn Console to translate this message.</p>
          </div>
          <Button variant="secondary" pending={retrying} disabled={retrying} onClick={() => void onRetry()}>
            {retrying ? "Retrying" : "Retry translation"}
          </Button>
        </div>
      ) : null}
      {!mine && !translated && translation.status === "idle" && !autoTranslate ? (
        <div className="message-translate-fail">
          <Button variant="secondary" onClick={() => void onRetry()}>
            Translate to {languageLabel(targetLanguage)}
          </Button>
        </div>
      ) : null}
    </motion.li>
  );
}
