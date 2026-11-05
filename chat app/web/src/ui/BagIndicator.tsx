import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { easeOut, useMotionOn } from "./motion";

function BagMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M6 8h12l-.9 12.2a1 1 0 0 1-1 .8H7.9a1 1 0 0 1-1-.8L6 8z" />
      <path d="M9 8V7a3 3 0 0 1 6 0v1" />
    </svg>
  );
}

export function BagIndicator({
  count,
  bump,
  onClick,
}: {
  count: number;
  bump: number;
  onClick: () => void;
}) {
  const motionOn = useMotionOn();
  const [pop, setPop] = useState(false);
  const bornAt = useRef(bump);
  const hideTimer = useRef<number>(0);

  useEffect(() => {
    if (bump === bornAt.current) return;
    bornAt.current = bump;
    if (!motionOn || bump === 0) return;
    window.clearTimeout(hideTimer.current);
    setPop(true);
    hideTimer.current = window.setTimeout(() => setPop(false), 900);
  }, [bump, motionOn]);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const label = count === 1 ? "Bag, 1 item" : `Bag, ${count} items`;

  return (
    <button
      type="button"
      className={`bag-indicator${pop ? " is-pop" : ""}`}
      onClick={onClick}
      aria-label={label}
    >
      <span className="bag-indicator-icon">
        <BagMark />
        {count > 0 ? (
          <span className="bag-indicator-badge" aria-hidden="true">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={count}
                initial={motionOn ? { opacity: 0, y: 6 } : false}
                animate={{ opacity: 1, y: 0 }}
                exit={motionOn ? { opacity: 0, y: -6 } : undefined}
                transition={{ duration: 0.28, ease: easeOut }}
              >
                {count}
              </motion.span>
            </AnimatePresence>
          </span>
        ) : null}
      </span>
      <span className="bag-indicator-copy">Bag</span>
      {pop ? (
        <span className="bag-indicator-ok" role="status">
          Added
        </span>
      ) : null}
    </button>
  );
}
