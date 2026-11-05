import type { OrderView } from "../../../shared/types";
import { formatInr, imageAlt } from "../../../shared/catalog";
import { ProductPhoto } from "../ui/ProductPhoto";

export function OrderSummary({ order }: { order: OrderView }) {
  return (
    <div className="order-summary">
      <ul className="order-summary-list">
        {order.items.map((item) => (
          <li key={item.productId} className="order-summary-row">
            <span className="order-summary-thumb">
              <ProductPhoto src={item.image} alt={imageAlt(item.image, item.name)} />
            </span>
            <span className="order-summary-copy">
              <strong>{item.name}</strong>
              <span className="meta">
                {item.quantity} × {formatInr(item.price)}
              </span>
            </span>
            <span className="order-summary-line">{formatInr(item.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <p className="order-summary-total">
        Total <strong>{formatInr(order.total)}</strong>
      </p>
    </div>
  );
}
