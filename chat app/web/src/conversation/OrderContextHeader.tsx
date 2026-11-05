import type { OrderView } from "../../../shared/types";
import { Badge } from "../ui/Badge";
import { statusCopy, statusTone } from "../ui/OrderCard";

export function OrderContextHeader({
  order,
  party,
}: {
  order: OrderView;
  party: "buyer" | "seller" | "support";
}) {
  const first = order.items[0];
  const extra = order.items.length - 1;
  const title = first ? `${first.name}${extra > 0 ? ` + ${extra}` : ""}` : "Order";
  const who = party === "seller" ? order.buyer.name : party === "support" ? order.buyer.name : order.seller.name;
  const when = new Date(order.createdAt).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <header className="order-context">
      <div className="order-context-copy">
        <p className="order-context-kicker">
          Order <span className="cell-id">{order.id}</span>
        </p>
        <h1 className="order-context-title">{title}</h1>
        <p className="order-context-meta">
          {who} · {when}
        </p>
      </div>
      <Badge tone={statusTone(order.status)}>{statusCopy(order.status)}</Badge>
    </header>
  );
}
