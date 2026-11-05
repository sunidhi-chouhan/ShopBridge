import { useEffect, useState } from "react";
import type { OrderView, PublicUser } from "../../../shared/types";
import { listOrders } from "../api";
import { OrderCard } from "../ui/OrderCard";
import { OrderDetail } from "../ui/OrderDetail";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateView";

export function BuyerOrders({ user, onShop }: { user: PublicUser; onShop: () => void }) {
  const [orders, setOrders] = useState<OrderView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  function load() {
    return listOrders().then((result) => setOrders(result.orders));
  }

  useEffect(() => {
    load().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load orders."));
  }, []);

  if (!orders && !error) return <LoadingState label="Opening your orders" />;
  if (error) {
    return (
      <ErrorState
        message={error}
        onRetry={() =>
          void load().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load orders."))
        }
      />
    );
  }
  if (!orders || orders.length === 0) {
    return (
      <section className="order-ledger">
        <header className="page-mast">
          <p className="kicker">Purchases</p>
          <h1 className="page-title">Your orders.</h1>
        </header>
        <EmptyState
          title="The book is still empty."
          detail="When you place a simulated checkout, it will appear here with a lasting ID, the seller, and its status."
          scene="orders"
          actionLabel="Browse the floor"
          onAction={onShop}
        />
      </section>
    );
  }

  if (openId) {
    return <OrderDetail id={openId} user={user} party="buyer" onBack={() => setOpenId(null)} />;
  }

  return (
    <section className="order-ledger">
      <header className="page-mast">
        <p className="kicker">Purchases</p>
        <h1 className="page-title">Your orders.</h1>
      </header>
      <ul className="order-card-list">
        {orders.map((order) => (
          <li key={order.id}>
            <OrderCard order={order} onOpen={() => setOpenId(order.id)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
