import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { easeOut, useMotionOn } from "./motion";
import { PulseDot } from "./flair";

/**
 * Landing showcase: one order conversation playing out in two languages, then support
 * joining and a live sale. Illustrative copy, labelled as a preview.
 */
type Beat =
  | { kind: "msg"; side: "in" | "out"; who: string; lang: string; text: string; reads: string; readsLang: string }
  | { kind: "event"; text: string }
  | { kind: "live"; text: string; sub: string };

const BEATS: Beat[] = [
  {
    kind: "msg",
    side: "in",
    who: "Asha · reads Hindi",
    lang: "hi",
    text: "साड़ी का ज़री बॉर्डर थोड़ा उधड़ा हुआ है 😕",
    reads: "The zari border of the sari is a little frayed.",
    readsLang: "en",
  },
  {
    kind: "msg",
    side: "out",
    who: "Meera · writes English",
    lang: "en",
    text: "So sorry! I’ll ship a replacement today.",
    reads: "माफ़ कीजिए! मैं आज ही बदली हुई साड़ी भेज दूँगी।",
    readsLang: "hi",
  },
  { kind: "event", text: "Kabir from support joined · sees the full history" },
  { kind: "live", text: "Live from the loom", sub: "24 watching · Rohan just bought" },
];

const STEP_MS = 1900;

export function HeroBoard({ paused = false }: { paused?: boolean }) {
  const motionOn = useMotionOn();
  const live = motionOn && !paused;
  const [step, setStep] = useState(live ? 0 : BEATS.length * 2);

  useEffect(() => {
    if (!live) {
      setStep(BEATS.length * 2);
      return;
    }
    const timer = window.setInterval(() => setStep((value) => (value >= BEATS.length * 2 + 2 ? 0 : value + 1)), STEP_MS);
    return () => window.clearInterval(timer);
  }, [live]);

  // Each message takes two steps: the original lands, then its translation resolves.
  const visible = BEATS.map((beat, index) => ({ beat, index, shown: step >= index * 2, translated: step >= index * 2 + 1 })).filter(
    (item) => item.shown,
  );

  return (
    <div className="hero-board" aria-label="Preview: an order conversation translated live">
      <div className="hero-board-head">
        <span className="hero-board-avatars" aria-hidden="true">
          <span>AR</span>
          <span>MJ</span>
          <span>KS</span>
        </span>
        <span className="hero-board-title">
          <strong>Order · Maheshwari sari</strong>
          <small>
            <PulseDot tone="ok" /> Nexconn · translating live
          </small>
        </span>
      </div>
      <ol className="hero-board-feed">
        <AnimatePresence initial={false}>
          {visible.map(({ beat, index, translated }) => (
            <motion.li
              key={index}
              layout={live}
              className={`hb-item hb-${beat.kind}${beat.kind === "msg" ? ` is-${beat.side}` : ""}`}
              initial={live ? { opacity: 0, y: 14, scale: 0.97 } : false}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={live ? { opacity: 0, y: -6 } : undefined}
              transition={{ duration: 0.5, ease: easeOut }}
            >
              {beat.kind === "msg" ? (
                <>
                  <span className="hb-who">{beat.who}</span>
                  <span className="hb-bubble" lang={beat.lang}>
                    {beat.text}
                  </span>
                  <AnimatePresence initial={false}>
                    {translated ? (
                      <motion.span
                        className="hb-reads"
                        lang={beat.readsLang}
                        initial={live ? { opacity: 0, height: 0 } : false}
                        animate={{ opacity: 1, height: "auto" }}
                        transition={{ duration: 0.45, ease: easeOut }}
                      >
                        <em>{beat.side === "in" ? "Meera reads" : "Asha reads"}</em> {beat.reads}
                      </motion.span>
                    ) : live ? (
                      <span className="hb-typing" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : null}
                  </AnimatePresence>
                </>
              ) : beat.kind === "event" ? (
                beat.text
              ) : (
                <>
                  <span className="hb-live-pill">● Live</span>
                  <strong>{beat.text}</strong>
                  <small>{beat.sub}</small>
                </>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  );
}
