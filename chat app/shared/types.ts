export const ROLES = ["member", "volunteer", "coordinator"] as const;
export type Role = (typeof ROLES)[number];

export const KINDS = ["groceries", "transport", "companion"] as const;
export type HelpKind = (typeof KINDS)[number];

export const STATUSES = ["requested", "assigned", "in_progress", "completed"] as const;
export type RequestStatus = (typeof STATUSES)[number];

export const CATEGORIES = ["textile", "home", "jewelry", "leather", "fragrance", "tableware"] as const;
export type Category = (typeof CATEGORIES)[number];

export const ORDER_STATUSES = ["placed", "packed", "completed"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type PublicUser = {
  id: string;
  name: string;
  role: Role;
  sample: boolean;
  email?: string;
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
  createdAt: string;
  updatedAt: string;
};

export type ConversationView = {
  id: string;
  orderId: string;
  channelId: string | null;
  title: string;
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

export type OrderView = {
  id: string;
  status: OrderStatus;
  payment: "simulated";
  buyer: PublicUser;
  seller: PublicUser;
  items: OrderItemView[];
  total: number;
  channelId: string | null;
  createdAt: string;
};
