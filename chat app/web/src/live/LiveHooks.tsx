import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { LiveView, PublicUser } from "../../../shared/types";
import { listLive } from "../api";
import { Button } from "../ui/Button";
import { PulseDot } from "../ui/flair";
import { easeOut, useMotionOn } from "../ui/motion";
import { navigate } from "../ui/route";
import "../ui/flair.css";

/** Live sessions, refreshed every 20 s while mounted. */
function useLiveSessions(): LiveView[] | null {
  const [sessions, setSessions] = useState<LiveView[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      listLive()
        .then((result) => alive && setSessions(result.sessions))
        .catch(() => alive && setSessions([]));
    void load();
    const timer = window.setInterval(load, 20_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  return sessions;
}

/** Shop banner: someone is live right now. */
export function LiveNowBanner() {
  const sessions = useLiveSessions();
  const motionOn = useMotionOn();
  const top = sessions?.[0] ?? null;
  return (
    <AnimatePresence>
      {top ? (
        <motion.button
          type="button"
          className="live-banner"
          onClick={() => navigate("live", top.id)}
          initial={motionOn ? { opacity: 0, y: -10, scale: 0.98 } : false}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={motionOn ? { opacity: 0, y: -10 } : undefined}
          transition={{ duration: 0.5, ease: easeOut }}
        >
          <span className="live-banner-pill">
            <PulseDot /> Live now
          </span>
          <span className="live-banner-text">
            <strong>{top.seller.name}</strong> is showing {top.featured ? <em>{top.featured.name}</em> : "new pieces"}
            {top.viewers ? ` · ${top.viewers} watching` : ""}
            {sessions && sessions.length > 1 ? ` · +${sessions.length - 1} more` : ""}
          </span>
          <span className="live-banner-cta">Join →</span>
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
}

/** Seller dashboard card: go live, or return to the running session. */
export function GoLivePromo({ user }: { user: PublicUser }) {
  const sessions = useLiveSessions();
  const mine = sessions?.find((session) => session.seller.id === user.id) ?? null;
  return (
    <div className="live-promo">
      <div>
        <p className="promo-kicker">
          <PulseDot /> {mine ? "You are live" : "Live from the loom"}
        </p>
        <p className="promo-title">{mine ? mine.title : "Sell live, in every language."}</p>
        <p className="promo-sub">
          {mine
            ? `${mine.viewers ?? 0} watching · ${mine.sold} sold so far`
            : "Put a piece on stage. Buyers ask in their language, you answer in yours, they buy in one tap."}
        </p>
      </div>
      <Button onClick={() => navigate("live", mine?.id ?? null)}>{mine ? "Return to room →" : "Go live →"}</Button>
    </div>
  );
}
