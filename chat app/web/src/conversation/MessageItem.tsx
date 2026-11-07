import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Language } from "../../../shared/types";
import type { ChatLine } from "../chat/nexconn";
import { languageLabel } from "../chat/languagePrefs";
import { getCachedTranslation, requestTranslations, subscribeTranslation, type TranslationState } from "../chat/translate";
import { t } from "../i18n";
import { Button } from "../ui/Button";
import { easeOut, useMotionOn } from "../ui/motion";
import { formatMessageTime } from "./format";

export function MessageItem({
  line,
  mine,
  name,
  role,
  senderLanguage,
  animate,
  targetLanguage,
  autoTranslate,
  sharedFailureNotice,
}: {
  line: ChatLine;
  mine: boolean;
  name: string;
  role?: string;
  /** Sender's reading language, used as the `lang` of the original text. */
  senderLanguage?: Language | null;
  animate: boolean;
  targetLanguage: Language;
  autoTranslate: boolean;
  /** When true, the failure hint is shown once above the timeline — keep per-message UI minimal. */
  sharedFailureNotice?: boolean;
}) {
  const motionOn = useMotionOn();
  const [translation, setTranslation] = useState<TranslationState>(() => getCachedTranslation(line.id, targetLanguage));
  const [showOriginal, setShowOriginal] = useState(true);
  const [retrying, setRetrying] = useState(false);

  useEffect(
    () =>
      subscribeTranslation(line.id, targetLanguage, (state) => {
        setTranslation(state);
        if (state.status !== "pending") setRetrying(false);
      }),
    [line.id, targetLanguage],
  );

  async function onTranslate(force: boolean) {
    if (retrying || translation.status === "pending") return;
    setRetrying(true);
    await requestTranslations([line], targetLanguage, { force });
  }

  const translated =
    line.kind === "text" && translation.status === "ready" && translation.text && translation.text.trim() !== line.text.trim()
      ? translation
      : null;
  const isPending = translation.status === "pending" || retrying;
  const isFailed = translation.status === "error" && !isPending;
  const who = mine ? t(targetLanguage, "you") : name;

  return (
    <motion.li
      className={mine ? "message is-mine" : "message"}
      initial={motionOn && animate ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: easeOut }}
    >
      <span className="who">
        {who}
        {role ? <span className="role-tag"> · {role}</span> : null}
        <span className="when"> · {formatMessageTime(line.sentTime)}</span>
      </span>
      {line.kind === "image" ? (
        <a
          className="message-photo"
          href={line.imageUrl ?? line.thumbnail}
          target="_blank"
          rel="noopener noreferrer"
        >
          <img src={line.thumbnail ?? line.imageUrl} alt={`${t(targetLanguage, "photo")} · ${who}`} loading="lazy" />
        </a>
      ) : null}
      {line.kind === "text" && (!translated || showOriginal) ? (
        <p className="message-original" lang={senderLanguage ?? undefined}>
          {line.text}
        </p>
      ) : null}
      {translated ? (
        <div className="message-translation" lang={translated.targetLanguage}>
          <p className="message-translation-kicker meta">
            {t(targetLanguage, "translated")} · {languageLabel(translated.targetLanguage)}
          </p>
          <p className="message-translation-text">{translated.text}</p>
          <button type="button" className="text-back message-translation-toggle" onClick={() => setShowOriginal((v) => !v)}>
            {showOriginal ? t(targetLanguage, "hideOriginal") : t(targetLanguage, "showOriginal")}
          </button>
        </div>
      ) : null}
      {!mine && line.kind === "text" && !translated && isPending ? (
        <p className="message-translate-progress meta">{t(targetLanguage, "translating")}</p>
      ) : null}
      {!mine && line.kind === "text" && !translated && isFailed && !sharedFailureNotice ? (
        <div className="message-translate-fail">
          <p className="message-translate-fail-title">{t(targetLanguage, "translationOff")}</p>
          <Button variant="secondary" pending={retrying} disabled={retrying} onClick={() => void onTranslate(true)}>
            {t(targetLanguage, "retryTranslation")}
          </Button>
        </div>
      ) : null}
      {!mine && line.kind === "text" && !translated && translation.status === "idle" && !autoTranslate ? (
        <div className="message-translate-fail">
          <Button variant="secondary" onClick={() => void onTranslate(false)}>
            {t(targetLanguage, "translateTo")} {languageLabel(targetLanguage)}
          </Button>
        </div>
      ) : null}
    </motion.li>
  );
}
