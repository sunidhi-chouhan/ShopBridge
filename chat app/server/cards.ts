import type { OrderRecord } from "./store-types";

/** Content of server-sent order cards. Clients read live state (offer accepted?) from the order record. */
export function cardContent(card: "offer" | "track", order: OrderRecord): Record<string, unknown> {
  if (card === "offer" && order.offer) {
    return {
      orderId: order.id,
      offerId: order.offer.id,
      amount: order.offer.amount,
      was: order.originalTotal ?? order.total,
      note: order.offer.note ?? "",
    };
  }
  const shipment = order.shipment ?? { courier: "", awb: "", eta: null };
  return { orderId: order.id, courier: shipment.courier, awb: shipment.awb, eta: shipment.eta ?? "" };
}
