import type { HelpKind, ProductView, RequestStatus } from "../../../shared/types";
import { kindLabel, statusLabel } from "../copy";

export function formatDeskWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
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

export function requestPreview(note: string, kind: HelpKind): string {
  const trimmed = note.trim();
  return trimmed || kindLabel(kind);
}

export function requestChip(status: RequestStatus): string {
  return statusLabel(status);
}
