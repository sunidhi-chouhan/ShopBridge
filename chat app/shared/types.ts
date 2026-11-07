export const ROLES = ["member", "volunteer", "coordinator"] as const;
export type Role = (typeof ROLES)[number];

export const KINDS = ["groceries", "transport", "companion"] as const;
export type HelpKind = (typeof KINDS)[number];

export const STATUSES = ["requested", "assigned", "in_progress", "completed"] as const;
export type RequestStatus = (typeof STATUSES)[number];

export const CATEGORIES = ["textile", "home", "jewelry", "leather", "fragrance", "tableware"] as const;
export type Category = (typeof CATEGORIES)[number];

/** "completed" is legacy (kept for existing rows); new orders move placed → packed → shipped → delivered. */
export const ORDER_STATUSES = ["placed", "packed", "shipped", "delivered", "completed"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Seller-driven order steps, in order. */
export const ORDER_FLOW = ["placed", "packed", "shipped", "delivered"] as const;

export function nextOrderStatus(status: OrderStatus): OrderStatus | null {
  const index = (ORDER_FLOW as readonly string[]).indexOf(status);
  if (index === -1 || index === ORDER_FLOW.length - 1) return null;
  return ORDER_FLOW[index + 1];
}

export const RESOLUTIONS = ["replacement", "refund", "return", "info"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/** Reading languages offered in the app. Codes are Nexconn translation language codes. */
export const LANGUAGES = ["en", "hi", "ar", "zh", "es", "fr"] as const;
export type Language = (typeof LANGUAGES)[number];

/**
 * Nexconn user id that posts order events (shipped, support joined, resolution…).
 * Only messages from this sender render as system events, so users cannot spoof them.
 */
export const SYSTEM_USER_ID = "shopbridgesystem";
export const SYSTEM_USER_NAME = "ShopBridge";
/** Before this instant, order events were posted from the acting user's id (legacy channels). */
export const LEGACY_EVENT_CUTOFF = Date.parse("2026-11-07T00:00:00Z");

export type PublicUser = {
  id: string;
  name: string;
  role: Role;
  sample: boolean;
  email?: string;
  /** Preferred reading language (null until the user picks one). */
  language?: Language | null;
};

export type HelpRequestView = {
  id: string;
  kind: HelpKind;
  note: string;
  status: RequestStatus;
  member: PublicUser;
  volunteer: PublicUser | null;
  coordinator: PublicUser | null;
  channelId: string | null;
  orderId: string | null;
  resolution: Resolution | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConversationView = {
  id: string;
  orderId: string;
  channelId: string | null;
  title: string;
  /** First item's photo. */
  image: string;
  total: number;
  status: OrderStatus;
  counterpart: PublicUser;
  support: HelpRequestView | null;
  createdAt: string;
  updatedAt: string;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

export type ProductView = {
  id: string;
  name: string;
  description: string;
  category: Category;
  price: number;
  stock: number;
  published: boolean;
  featured: boolean;
  sample: boolean;
  images: string[];
  seller: PublicUser;
  createdAt: string;
  updatedAt: string;
};

export type CartItemView = {
  product: ProductView;
  quantity: number;
  lineTotal: number;
};

export type CartView = {
  items: CartItemView[];
  subtotal: number;
};

export type OrderItemView = {
  productId: string;
  name: string;
  image: string;
  quantity: number;
  price: number;
  lineTotal: number;
  seller: PublicUser;
};

export type OfferView = {
  id: string;
  amount: number;
  /** Order total before the offer. */
  was: number;
  note: string | null;
  state: "open" | "accepted" | "declined";
};

export type ShipmentView = { courier: string; awb: string; eta: string | null };

/** Custom Nexconn message types used in order conversations. */
export const MESSAGE_TYPES = {
  offer: "SB:Offer",
  track: "SB:Track",
  order: "SB:Order",
  call: "SB:Call",
  pin: "SB:Pin",
  typing: "SB:Typing",
  edit: "SB:Edit",
} as const;

export type OrderView = {
  id: string;
  status: OrderStatus;
  payment: "simulated";
  buyer: PublicUser;
  seller: PublicUser;
  items: OrderItemView[];
  total: number;
  channelId: string | null;
  offer: OfferView | null;
  shipment: ShipmentView | null;
  createdAt: string;
  updatedAt: string;
};
