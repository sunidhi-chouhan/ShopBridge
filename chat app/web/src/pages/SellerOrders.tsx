import { useEffect, useState } from "react";
import { nextOrderStatus, type HelpRequestView, type OrderView, type PublicUser } from "../../../shared/types";
import { formatInr, imageAlt } from "../../../shared/catalog";
import { advanceOrder, listOrders, listRequests } from "../api";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { formatDeskWhen, formatWaiting, requestTone } from "../ui/desk";
import { Metric, MetricGrid } from "../ui/Metric";
import { OrderDetail } from "../ui/OrderDetail";
import { ProductPhoto } from "../ui/ProductPhoto";
import { statusCopy, statusTone } from "../ui/OrderCard";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateView";
import { useToast } from "../ui/Toast";
import { statusLabel } from "../copy";

function productNames(order: OrderView): string {
  const first = order.items[0];
  if (!first) return "Order";
  const extra = order.items.length - 1;
  return extra > 0 ? `${first.name} + ${extra}` : first.name;
}

export function SellerOrders({ user, onInbox }: { user: PublicUser; onInbox: () => void }) {
  const [orders, setOrders] = useState<OrderView[] | null>(null);
  const [requests, setRequests] = useState<HelpRequestView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const toast = useToast();

  async function onAdvance(order: OrderView) {
    const next = nextOrderStatus(order.status);
    if (!next || advancing) return;
    setAdvancing(order.id);
    try {
      const result = await advanceOrder(order.id, next);
      setOrders((current) => current?.map((item) => (item.id === order.id ? result.order : item)) ?? null);
      toast(`Marked ${statusCopy(next).toLowerCase()}. The buyer sees it in the order conversation.`);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not update the order.");
    } finally {
      setAdvancing(null);
    }
  }

  function load() {
    return Promise.all([listOrders(), listRequests()]).then(([orderResult, requestResult]) => {
      setError(null);
      setOrders(orderResult.orders);
      setRequests(requestResult.requests);
    });
  }

  useEffect(() => {
    load().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load sales."));
  }, []);

  if (openId) {
    return <OrderDetail id={openId} user={user} onBack={() => setOpenId(null)} party="seller" />;
  }

  if (!orders && !requests && !error) return <LoadingState label="Opening sales" />;
  if (error) {
    return (
      <ErrorState
        message={error}
        onRetry={() => void load().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load sales."))}
      />
    );
  }

  const sales = orders ?? [];
  const cases = (requests ?? []).filter((item) => item.orderId);
  const pending = sales.filter((order) => order.status !== "completed" && order.status !== "delivered").length;
  const completed = sales.filter((order) => order.status === "completed" || order.status === "delivered").length;
  const revenue = sales.reduce((sum, order) => sum + order.total, 0);

  return (
    <div className="studio-stack desk-page">
      <section className="order-ledger">
        <header className="page-mast">
          <p className="kicker">Sales</p>
          <h1 className="page-title">Orders for your pieces.</h1>
          <p className="lede">Move each order forward here. Every step is posted into the buyer’s conversation, in their language.</p>
        </header>
        <MetricGrid>
          <Metric label="Total orders" value={String(sales.length)} />
          <Metric label="To fulfil" value={String(pending)} />
          <Metric label="Delivered" value={String(completed)} />
          <Metric label="Revenue" value={formatInr(revenue)} />
        </MetricGrid>
        {sales.length === 0 ? (
          <EmptyState
            compact
            title="No sales yet."
            detail="When a buyer checks out one of your published pieces, the order appears here."
            scene="orders"
          />
        ) : (
          <div className="studio-table-wrap">
            <table className="studio-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Product</th>
                  <th>Buyer</th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th> </th>
                </tr>
              </thead>
              <tbody>
                {sales.map((order) => {
                  const first = order.items[0];
                  return (
                    <tr key={order.id}>
                      <td className="cell-id">{order.id}</td>
                      <td>
                        <div className="studio-piece">
                          {first ? <ProductPhoto src={first.image} alt={imageAlt(first.image, first.name)} /> : null}
                          <span>{productNames(order)}</span>
                        </div>
                      </td>
                      <td>{order.buyer.name}</td>
                      <td>{formatDeskWhen(order.createdAt)}</td>
                      <td>{formatInr(order.total)}</td>
                      <td>
                        <Badge tone={statusTone(order.status)}>{statusCopy(order.status)}</Badge>
                      </td>
                      <td className="cell-actions">
                        {nextOrderStatus(order.status) ? (
                          <Button
                            variant="secondary"
                            pending={advancing === order.id}
                            onClick={() => void onAdvance(order)}
                          >
                            Mark {statusCopy(nextOrderStatus(order.status)!).toLowerCase()}
                          </Button>
                        ) : null}
                        <Button variant="quiet" onClick={() => setOpenId(order.id)}>
                          View
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section>
        <p className="kicker">Support</p>
        <h2 className="section-title">Support cases on your orders</h2>
        {cases.length === 0 ? (
          <EmptyState
            compact
            title="No support cases."
            detail="If a buyer asks for help, an agent joins that order conversation and the case shows here."
            scene="inbox"
          />
        ) : (
          <Card variant="compact" className="assign-list">
            <ul>
              {cases.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.member.name}</strong>
                    <p className="meta">
                      Order <span className="cell-id">{item.orderId}</span> ·{" "}
                      {item.status === "completed" ? `resolved ${formatDeskWhen(item.updatedAt)}` : `open ${formatWaiting(item.createdAt)}`}
                      {item.coordinator ? ` · ${item.coordinator.name}` : ""}
                    </p>
                  </div>
                  <Badge tone={requestTone(item.status)}>{statusLabel(item.status)}</Badge>
                </li>
              ))}
            </ul>
            <Button variant="secondary" onClick={onInbox}>
              Open Inbox
            </Button>
          </Card>
        )}
      </section>
    </div>
  );
}
