import type { PublicUser } from "../../../shared/types";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";

export function ConversationHeader({
  counterpart,
  title,
  orderId,
  statusLabel,
  statusTone,
  subtitle,
  onBack,
}: {
  counterpart: PublicUser;
  title: string;
  orderId: string;
  statusLabel?: string;
  statusTone?: "warning" | "accent" | "success" | "neutral";
  subtitle?: string;
  onBack?: () => void;
}) {
  return (
    <div className="conv-header-wrap">
      {onBack ? (
        <button type="button" className="text-back conv-back" onClick={onBack}>
          <span aria-hidden="true">←</span> Back to conversations
        </button>
      ) : null}
      <header className="conv-header">
        <Avatar name={counterpart.name} />
        <div className="conv-header-copy">
          <p className="conv-header-name">{counterpart.name}</p>
          <p className="conv-header-meta">
            {title} · <span className="cell-id">{orderId}</span>
          </p>
          {subtitle ? <p className="conv-header-meta">{subtitle}</p> : null}
        </div>
        {statusLabel ? <Badge tone={statusTone ?? "neutral"}>{statusLabel}</Badge> : null}
      </header>
    </div>
  );
}
