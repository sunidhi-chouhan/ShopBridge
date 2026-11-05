import type { OrderView } from "../../../shared/types";
import { formatInr, imageAlt } from "../../../shared/catalog";
import { Badge } from "./Badge";
import { cardClass } from "./Card";
import { ProductPhoto } from "./ProductPhoto";

export function statusTone(status: OrderView["status"]): "warning" | "accent" | "success" {
  if (status === "placed") return "warning";
  if (status === "packed") return "accent";
  return "success";
}

export function statusCopy(status: OrderView["status"]): string {
  if (status === "placed") return "Placed";
  if (status === "packed") return "Packed";
  return "Completed";
}

export function OrderCard({
  order,
  onOpen,
  party,
}: {
  order: OrderView;
  onOpen?: () => void;
  party?: "seller" | "buyer";
}) {
  const first = order.items[0];
  const extra = order.items.length - 1;
  const when = new Date(order.createdAt).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const who = party === "seller" ? order.buyer.name : order.seller.name;
  const names = first ? `${first.name}${extra > 0 ? ` + ${extra}` : ""}` : "Order";

  const body = (
    <>
      <span className="order-card-frame">
        {first ? <ProductPhoto src={first.image} alt={imageAlt(first.image, first.name)} /> : null}
      </span>
      <span className="order-card-copy">
        <span className="order-card-id">{order.id}</span>
        <strong>{names}</strong>
        <span className="meta">
          {who} · {when}
        </span>
      </span>
      <span className="order-card-meta">
        <Badge tone={statusTone(order.status)}>{statusCopy(order.status)}</Badge>
        <strong className="order-card-total">{formatInr(order.total)}</strong>
        {onOpen ? <span className="order-card-view">View order</span> : null}
      </span>
    </>
  );

  if (onOpen) {
    return (
      <button type="button" className={cardClass("product", "order-card")} onClick={onOpen}>
        {body}
      </button>
    );
  }

  return <div className={cardClass("product", "order-card is-static")}>{body}</div>;
}
