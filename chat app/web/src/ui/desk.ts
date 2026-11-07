import type { ProductView, RequestStatus } from "../../../shared/types";

export function formatDeskWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "4 min", "2 h", "3 d" since an ISO time. */
export function formatWaiting(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

export function requestTone(status: RequestStatus): "neutral" | "accent" | "warning" | "success" {
  if (status === "requested") return "warning";
  if (status === "assigned") return "accent";
  if (status === "in_progress") return "neutral";
  return "success";
}

export function productStatus(product: ProductView): { label: "Live" | "Draft" | "Out of stock"; tone: "success" | "neutral" | "warning" } {
  if (!product.published) return { label: "Draft", tone: "neutral" };
  if (product.stock === 0) return { label: "Out of stock", tone: "warning" };
  return { label: "Live", tone: "success" };
}
