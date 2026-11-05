import { useEffect, useState } from "react";
import type { HelpRequestView, OrderView, PublicUser } from "../../../shared/types";
import { formatInr, imageAlt } from "../../../shared/catalog";
import { listOrders, listRequests } from "../api";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { formatDeskWhen, requestTone } from "../ui/desk";
import { Metric, MetricGrid } from "../ui/Metric";
import { OrderDetail } from "../ui/OrderDetail";
import { ProductPhoto } from "../ui/ProductPhoto";
import { statusCopy, statusTone } from "../ui/OrderCard";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateView";
import { copy, kindLabel, statusLabel } from "../copy";

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
  const assigned = requests ?? [];
  const pending = sales.filter((order) => order.status !== "completed").length;
  const completed = sales.filter((order) => order.status === "completed").length;
  const revenue = sales.reduce((sum, order) => sum + order.total, 0);

  return (
    <div className="studio-stack desk-page">
      <section className="order-ledger">
        <header className="page-mast">
          <p className="kicker">Sales</p>
          <h1 className="page-title">Orders for your pieces.</h1>
          <p className="lede">Simulated checkouts that include your published work. Open a row for the buyer, items, and status.</p>
        </header>
        <MetricGrid>
          <Metric label="Total orders" value={String(sales.length)} />
          <Metric label="Pending" value={String(pending)} />
          <Metric label="Completed" value={String(completed)} />
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
                      <td>
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
        <p className="kicker">Assigned requests</p>
        <h2 className="section-title">Requests for you</h2>
        {assigned.length === 0 ? (
          <EmptyState
            compact
            title={copy.noRequests}
            detail="When a support agent assigns you, the request appears here and in Inbox."
            scene="inbox"
            actionLabel="Open Inbox"
            onAction={onInbox}
          />
        ) : (
          <Card variant="compact" className="assign-list">
            <ul>
              {assigned.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.member.name}</strong>
                    <p className="meta">
                      {kindLabel(item.kind)} · {formatDeskWhen(item.updatedAt)}
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
