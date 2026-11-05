import { useEffect, useState } from "react";
import type { HelpRequestView, OrderView, PublicUser } from "../../../shared/types";
import { getOrder, listRequests, openOrderRoom, requestOrderSupport } from "../api";
import { ChatRoom } from "../components/ChatRoom";
import { copy } from "../copy";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { statusCopy, statusTone } from "../ui/OrderCard";
import { ErrorState, LoadingState } from "../ui/StateView";
import { TextArea } from "../ui/TextField";
import { useToast } from "../ui/Toast";
import { ConversationHeader } from "./ConversationHeader";

function participants(order: OrderView, support: HelpRequestView | null) {
  return {
    names: {
      [order.buyer.id]: order.buyer.name,
      [order.seller.id]: order.seller.name,
      ...(support?.coordinator ? { [support.coordinator.id]: support.coordinator.name } : {}),
    },
    roles: {
      [order.buyer.id]: "Buyer",
      [order.seller.id]: "Seller",
      ...(support?.coordinator ? { [support.coordinator.id]: "Support" } : {}),
    },
  };
}

export function OrderConversation({
  orderId,
  user,
  party,
  onBack,
  embedded = false,
}: {
  orderId: string;
  user: PublicUser;
  party: "buyer" | "seller" | "support";
  onBack?: () => void;
  /** When true, omit the outer page chrome used on Order Detail. */
  embedded?: boolean;
}) {
  const [order, setOrder] = useState<OrderView | null>(null);
  const [support, setSupport] = useState<HelpRequestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRoom, setPendingRoom] = useState(false);
  const [pendingSupport, setPendingSupport] = useState(false);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const toast = useToast();

  function load() {
    return Promise.all([getOrder(orderId), listRequests()]).then(([orderResult, requestResult]) => {
      setOrder(orderResult.order);
      const linked = requestResult.requests
        .filter((item) => item.orderId === orderId)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
      setSupport(linked ?? null);
    });
  }

  useEffect(() => {
    load().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not open that order."));
  }, [orderId]);

  if (!order && !error) return <LoadingState label="Opening the conversation" />;
  if (error || !order) return <ErrorState message={error ?? "Missing order."} onRetry={onBack} />;

  const first = order.items[0];
  const extra = order.items.length - 1;
  const title = first ? `${first.name}${extra > 0 ? ` + ${extra}` : ""}` : "Order";
  const counterpart = party === "seller" || party === "support" ? order.buyer : order.seller;
  const { names, roles } = participants(order, support);

  async function ensureRoom() {
    setPendingRoom(true);
    setError(null);
    try {
      const result = await openOrderRoom(order!.id);
      setOrder(result.order);
      toast("Order conversation is ready.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not open the conversation.");
    } finally {
      setPendingRoom(false);
    }
  }

  async function askSupport() {
    if (pendingSupport) return;
    setPendingSupport(true);
    setError(null);
    try {
      const result = await requestOrderSupport(order!.id, note.trim());
      setOrder(result.order);
      setSupport(result.request);
      setAsking(false);
      setNote("");
      toast(copy.orderSupportToast);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not request order support.");
    } finally {
      setPendingSupport(false);
    }
  }

  return (
    <div className={embedded ? "order-conversation is-embedded" : "order-conversation"}>
      <ConversationHeader
        counterpart={counterpart}
        title={title}
        orderId={order.id}
        statusLabel={statusCopy(order.status)}
        statusTone={statusTone(order.status)}
        onBack={onBack}
      />
      {party === "support" ? (
        <p className="support-parties meta" aria-label="Order parties">
          Buyer {order.buyer.name} · Seller {order.seller.name} · {title}
        </p>
      ) : null}
      {support ? (
        <div className="support-context" aria-label="Order support context">
          <p className="kicker">Order support</p>
          <p className="support-context-status meta">
            {support.status.replace("_", " ")}
            {support.coordinator ? ` · ${support.coordinator.name}` : " · waiting for an agent"}
          </p>
          {support.note ? <p className="support-context-note">{support.note}</p> : null}
        </div>
      ) : null}
      {!order.channelId ? (
        <Card variant="compact" className="order-conversation-open">
          <p className="lede">The Nexconn room is not open yet. Open it to message about this order.</p>
          <Button pending={pendingRoom} onClick={() => void ensureRoom()}>
            Open conversation
          </Button>
        </Card>
      ) : (
        <ChatRoom
          channelId={order.channelId}
          selfId={user.id}
          names={names}
          roles={roles}
          orderLabel={`${order.id} · ${title}`}
          compact
        />
      )}
      {party === "buyer" && order.channelId ? (
        <div className="support-escalate">
          {support ? (
            <p className="meta">
              Order support · {support.status.replace("_", " ")}
              {support.coordinator ? ` · ${support.coordinator.name}` : " · waiting for an agent"}
            </p>
          ) : asking ? (
            <Card variant="compact" className="support-form">
              <p className="help-dialog-lede">
                An agent joins this order’s Nexconn channel — the same room as you and the seller. This is not
                general community help.
              </p>
              <TextArea
                id="support-note"
                label="What should order support know?"
                hint="Describe the issue with this purchase. Optional but helpful."
                value={note}
                rows={3}
                maxLength={280}
                onChange={(event) => setNote(event.target.value)}
              />
              <div className="dialog-actions">
                <Button pending={pendingSupport} onClick={() => void askSupport()}>
                  Request order support
                </Button>
                <Button variant="secondary" onClick={() => setAsking(false)}>
                  Cancel
                </Button>
              </div>
            </Card>
          ) : (
            <Button variant="secondary" onClick={() => setAsking(true)}>
              Get order support
            </Button>
          )}
        </div>
      ) : null}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
