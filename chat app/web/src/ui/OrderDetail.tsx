import { useEffect, useState } from "react";
import type { OrderView, PublicUser } from "../../../shared/types";
import { getOrder } from "../api";
import { OrderConversation } from "../conversation/OrderConversation";
import { OrderContextHeader } from "../conversation/OrderContextHeader";
import { OrderSummary } from "../conversation/OrderSummary";
import { PageTrail } from "./PageTrail";
import { ErrorState, LoadingState } from "./StateView";

export function OrderDetail({
  id,
  user,
  onBack,
  party = "buyer",
}: {
  id: string;
  user: PublicUser;
  onBack: () => void;
  party?: "buyer" | "seller" | "support";
}) {
  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOrder(id)
      .then((result) => setOrder(result.order))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not open that order."));
  }, [id]);

  if (!order && !error) return <LoadingState label="Opening the order" />;
  if (error || !order) return <ErrorState message={error ?? "Missing order."} onRetry={onBack} />;

  return (
    <article className="order-detail is-compact">
      <PageTrail items={[{ label: "Orders", onClick: onBack }, { label: order.id }]} />
      <OrderContextHeader order={order} party={party} />
      <OrderSummary order={order} />
      <section className="order-detail-chat" aria-label="Order conversation">
        <p className="kicker">Conversation</p>
        <h2 className="order-detail-chat-title">Talk about this order</h2>
        <OrderConversation orderId={order.id} user={user} party={party} embedded />
      </section>
    </article>
  );
}
