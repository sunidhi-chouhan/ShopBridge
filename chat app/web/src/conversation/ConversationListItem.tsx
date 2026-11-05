import type { ConversationView } from "../../../shared/types";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { formatDeskWhen } from "../ui/desk";
import { statusCopy, statusTone } from "../ui/OrderCard";

export function ConversationListItem({
  item,
  selected,
  unread,
  preview,
  onSelect,
}: {
  item: ConversationView;
  selected: boolean;
  unread: number;
  preview: string;
  onSelect: () => void;
}) {
  const snippet = preview.trim() || "No messages yet";
  const supportOpen = Boolean(item.support && item.support.status !== "completed");

  return (
    <button
      type="button"
      className={selected ? "conv-list-item is-selected" : "conv-list-item"}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
    >
      <Avatar name={item.counterpart.name} />
      <span className="conv-list-copy">
        <span className="conv-list-top">
          <strong className="conv-list-name">{item.counterpart.name}</strong>
          <time dateTime={item.updatedAt}>{formatDeskWhen(item.updatedAt)}</time>
        </span>
        <span className="conv-list-title">
          {item.title}
          <span className="conv-list-sep" aria-hidden="true">
            ·
          </span>
          <span className="cell-id">{item.orderId}</span>
        </span>
        <span className="conv-list-bottom">
          <span className="conv-list-preview">{snippet}</span>
          <span className="conv-list-end">
            {unread > 0 ? (
              <span className="unread-pill" aria-label={`${unread} unread`}>
                {unread}
              </span>
            ) : null}
            {supportOpen ? <Badge tone="accent">Support</Badge> : null}
            <Badge tone={statusTone(item.status)}>{statusCopy(item.status)}</Badge>
          </span>
        </span>
      </span>
    </button>
  );
}
