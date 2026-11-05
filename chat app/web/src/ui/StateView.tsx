import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Button } from "./Button";
import { Card } from "./Card";
import { fadeUp, useMotionOn } from "./motion";
import { SbLoader } from "./SbLoader";

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="state" aria-busy="true">
      <SbLoader tone="inline" label={label} />
    </div>
  );
}

function Motif({ kind }: { kind: "shop" | "orders" | "inbox" | "products" | "plain" }) {
  return (
    <div className={`empty-motif is-${kind}`} aria-hidden="true">
      <span className="empty-ring" />
      <span className="empty-sb">SB</span>
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  actionLabel,
  onAction,
  scene = "plain",
  inset = false,
  compact = false,
}: {
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
  scene?: "shop" | "orders" | "inbox" | "products" | "plain";
  inset?: boolean;
  compact?: boolean;
}) {
  const motionOn = useMotionOn();
  const tight = inset || compact;
  return (
    <motion.div className="empty-wrap" initial={motionOn ? "hidden" : false} animate="show" variants={fadeUp}>
      <Card
        variant={tight ? "compact" : "feature"}
        className={["empty-card", inset ? "is-inset" : "", compact ? "is-compact" : ""].filter(Boolean).join(" ")}
      >
        <Motif kind={scene} />
        <p className="state-title">{title}</p>
        {detail ? <p className="lede">{detail}</p> : null}
        {actionLabel && onAction ? (
          <Button onClick={onAction}>
            {actionLabel}
            <span aria-hidden="true">→</span>
          </Button>
        ) : null}
      </Card>
    </motion.div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <p>{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function SuccessState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="state state-success">
      <p className="state-title">{title}</p>
      {detail ? <p>{detail}</p> : null}
    </div>
  );
}

export function PageFrame({ title, kicker, children }: { title: string; kicker?: string; children: ReactNode }) {
  return (
    <div className="page-frame">
      {kicker ? <p className="kicker">{kicker}</p> : null}
      <h1 className="page-title">{title}</h1>
      {children}
    </div>
  );
}
