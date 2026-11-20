/**
 * Small "alive" pieces shared across screens: an infinite marquee, numbers that count up,
 * name-tagged cursors that roam like a multiplayer canvas, and a headline word that
 * rotates through languages. All of them stand still when the viewer prefers reduced motion.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useInView } from "motion/react";
import { easeOut, useMotionOn } from "./motion";
import "./flair.css";

// ---------------------------------------------------------------------------
// Marquee
// ---------------------------------------------------------------------------

export function Marquee({
  items,
  speed = 38,
  tone = "ink",
  label,
}: {
  items: ReactNode[];
  /** Seconds for one full loop. */
  speed?: number;
  tone?: "ink" | "accent" | "plain";
  label?: string;
}) {
  const motionOn = useMotionOn();
  const row = (hidden: boolean) => (
    <ul className="marquee-row" aria-hidden={hidden || undefined}>
      {items.map((item, index) => (
        <li key={index} className="marquee-item">
          {item}
          <span className="marquee-star" aria-hidden="true">
            ✦
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <div
      className={`marquee is-${tone}${motionOn ? "" : " is-still"}`}
      style={{ ["--marquee-speed" as string]: `${speed}s` }}
      aria-label={label}
      role={label ? "marquee" : undefined}
    >
      <div className="marquee-track">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CountUp: animates the number inside a formatted value ("₹12,400", "38", "4 sold")
// ---------------------------------------------------------------------------

const NUMBER = /^(\D*?)(\d[\d,]*)(.*)$/;

export function CountUp({ value, duration = 1.1 }: { value: string; duration?: number }) {
  const motionOn = useMotionOn();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const match = value.match(NUMBER);
  const target = match ? Number(match[2].replace(/,/g, "")) : NaN;
  const grouped = match ? match[2].includes(",") : false;
  const [shown, setShown] = useState(() => (motionOn && match ? 0 : target));
  const previous = useRef(0);

  useEffect(() => {
    if (!match || !Number.isFinite(target)) return;
    if (!motionOn) {
      setShown(target);
      return;
    }
    if (!inView) return;
    const controls = animate(previous.current, target, {
      duration,
      ease: easeOut,
      onUpdate: (latest) => setShown(Math.round(latest)),
    });
    previous.current = target;
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, inView, motionOn]);

  if (!match || !Number.isFinite(target)) return <>{value}</>;
  const number = grouped ? shown.toLocaleString("en-IN") : String(shown);
  return (
    <span ref={ref} className="count-up" aria-label={value}>
      <span aria-hidden="true">
        {match[1]}
        {number}
        {match[3]}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Roaming cursors (decorative): who is in the conversation, and what they read
// ---------------------------------------------------------------------------

export type CursorSpec = { name: string; note: string; color: string; path: { x: number[]; y: number[] }; duration: number };

export function LiveCursors({ cursors, paused = false }: { cursors: CursorSpec[]; paused?: boolean }) {
  const motionOn = useMotionOn();
  const live = motionOn && !paused;
  return (
    <div className="cursors" aria-hidden="true">
      {cursors.map((cursor) => (
        <motion.div
          key={cursor.name}
          className="cursor"
          style={{ ["--cursor" as string]: cursor.color }}
          initial={{ left: `${cursor.path.x[0]}%`, top: `${cursor.path.y[0]}%`, opacity: 0 }}
          animate={
            live
              ? { left: cursor.path.x.map((v) => `${v}%`), top: cursor.path.y.map((v) => `${v}%`), opacity: 1 }
              : { left: `${cursor.path.x[0]}%`, top: `${cursor.path.y[0]}%`, opacity: 1 }
          }
          transition={
            live
              ? {
                  left: { duration: cursor.duration, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" },
                  top: { duration: cursor.duration * 0.83, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" },
                  opacity: { duration: 0.6, delay: 0.9 },
                }
              : { duration: 0.3 }
          }
        >
          <svg width="18" height="20" viewBox="0 0 18 20">
            <path d="M1 1l15 8.2-6.6 1.6L6.2 18z" fill="var(--cursor)" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          <span className="cursor-tag">
            <strong>{cursor.name}</strong> {cursor.note}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rotating word (e.g. a language name in its own script)
// ---------------------------------------------------------------------------

export function RotatingWord({
  words,
  interval = 2400,
  paused = false,
  className,
}: {
  words: { text: string; lang: string }[];
  interval?: number;
  paused?: boolean;
  className?: string;
}) {
  const motionOn = useMotionOn();
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!motionOn || paused) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % words.length), interval);
    return () => window.clearInterval(timer);
  }, [motionOn, paused, interval, words.length]);
  const word = words[index];
  return (
    <span className={`rotator ${className ?? ""}`}>
      <AnimatePresence initial={false}>
        <motion.span
          key={word.text}
          lang={word.lang}
          className="rotator-word"
          initial={motionOn ? { y: "100%", opacity: 0 } : false}
          animate={{ y: "0%", opacity: 1 }}
          exit={motionOn ? { y: "-100%", opacity: 0 } : undefined}
          transition={{ duration: 0.45, ease: easeOut }}
        >
          {word.text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pulse dot
// ---------------------------------------------------------------------------

export function PulseDot({ tone = "live" }: { tone?: "live" | "ok" }) {
  return <span className={`pulse-dot is-${tone}`} aria-hidden="true" />;
}
