import type { Category, HelpKind, Language, OrderStatus, RequestStatus, Resolution, Role } from "../shared/types";

export type SessionRecord = {
  token: string;
  expiresAt: string;
};

export type UserRecord = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  sample: boolean;
  sessionToken: string | null;
  sessionExpiresAt: string | null;
  sessions: SessionRecord[];
  language?: Language | null;
  createdAt: string;
};

export type RequestRecord = {
  id: string;
  kind: HelpKind;
  note: string;
  status: RequestStatus;
  memberId: string;
  volunteerId: string | null;
  coordinatorId: string | null;
  channelId: string | null;
  orderId: string | null;
  resolution?: Resolution | null;
  resolutionNote?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProductRecord = {
  id: string;
  sellerId: string;
  name: string;
  description: string;
  category: Category;
  price: number;
  stock: number;
  published: boolean;
  featured: boolean;
  sample: boolean;
  images: string[];
  createdAt: string;
  updatedAt: string;
};

export type CartItemRecord = {
  productId: string;
  quantity: number;
};

export type OrderItemRecord = {
  productId: string;
  sellerId: string;
  name: string;
  image: string;
  quantity: number;
  price: number;
};

export type OrderRecord = {
  id: string;
  buyerId: string;
  sellerId: string;
  status: OrderStatus;
  payment: "simulated";
  items: OrderItemRecord[];
  total: number;
  channelId: string | null;
  createdAt: string;
  updatedAt?: string;
  originalTotal?: number | null;
  offer?: { id: string; amount: number; note: string | null; state: "open" | "accepted" | "declined" } | null;
  shipment?: { courier: string; awb: string; eta: string | null } | null;
};

export type Database = {
  users: UserRecord[];
  requests: RequestRecord[];
  products: ProductRecord[];
  orders: OrderRecord[];
  carts: Record<string, CartItemRecord[]>;
  /** JSON backend only: shared demo reset epoch. */
  demoEpoch?: string;
};
