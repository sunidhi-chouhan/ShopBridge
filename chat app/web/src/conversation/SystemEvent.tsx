import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Language } from "../../../shared/types";
import { systemText, type ChatLine } from "../chat/nexconn";
import { getCachedTranslation, subscribeTranslation, type TranslationState } from "../chat/translate";
import { t } from "../i18n";
import { easeOut, useMotionOn } from "../ui/motion";
import { formatMessageTime } from "./format";

/** Order event card. Shown in the reader's language when a translation is available. */
export function SystemEvent({
  line,
  animate,
  targetLanguage,
  autoTranslate,
}: {
  line: ChatLine;
  animate: boolean;
  targetLanguage: Language;
  autoTranslate: boolean;
}) {
  const motionOn = useMotionOn();
  const [translation, setTranslation] = useState<TranslationState>(() => getCachedTranslation(line.id, targetLanguage));
  const [showOriginal, setShowOriginal] = useState(false);

  useEffect(() => subscribeTranslation(line.id, targetLanguage, setTranslation), [line.id, targetLanguage]);

  const original = systemText(line.text);
  const translated =
    autoTranslate && translation.status === "ready" && translation.text !== line.text ? systemText(translation.text) : null;

  return (
    <motion.li
      className="message is-update"
      initial={motionOn && animate ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: easeOut }}
    >
      <span className="who">
        {t(targetLanguage, "system")}
        <span className="when"> · {formatMessageTime(line.sentTime)}</span>
      </span>
      {translated && !showOriginal ? (
        <p lang={targetLanguage}>{translated}</p>
      ) : (
        <p lang="en">{original}</p>
      )}
      {translated ? (
        <button type="button" className="text-back message-translation-toggle" onClick={() => setShowOriginal((v) => !v)}>
          {showOriginal ? t(targetLanguage, "hideOriginal") : t(targetLanguage, "showOriginal")}
        </button>
      ) : null}
    </motion.li>
  );
}
