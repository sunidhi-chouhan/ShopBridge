import type { CatalogSort } from "../../shared/catalog";
import type {
  ApiErrorBody,
  CartView,
  Category,
  ConversationView,
  HelpKind,
  HelpRequestView,
  OrderView,
  ProductView,
  PublicUser,
  RequestStatus,
} from "../../shared/types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type UnauthorizedListener = () => void;

const unauthorizedListeners = new Set<UnauthorizedListener>();

/** Fired when any authenticated API call returns 401. App should return to sign-in. */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

function notifyUnauthorized(): void {
  for (const listener of unauthorizedListeners) listener();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => null)) as (T & ApiErrorBody) | null;
  if (!response.ok) {
    const message = body && "error" in body ? body.error.message : "Something went wrong. Try again.";
    const code = body && "error" in body ? body.error.code : "SERVER_ERROR";
    if (response.status === 401 && code === "UNAUTHENTICATED") notifyUnauthorized();
    throw new ApiError(response.status, code, message);
  }
  return body as T;
}

export function getMe(): Promise<{ user: PublicUser }> {
  return request("/api/me");
}

export function signIn(email: string, password: string): Promise<{ user: PublicUser }> {
  return request("/api/session", { method: "POST", body: JSON.stringify({ email, password }) });
}

export function registerBuyer(name: string, email: string, password: string): Promise<{ user: PublicUser }> {
  return request("/api/register", { method: "POST", body: JSON.stringify({ name, email, password }) });
}

export type DemoAccount = "buyer" | "seller" | "support";

export function signInDemo(account: DemoAccount): Promise<{ user: PublicUser }> {
  return request("/api/demo", { method: "POST", body: JSON.stringify({ account }) });
}

export function signOut(): Promise<{ ok: boolean }> {
  return request("/api/logout", { method: "POST", body: "{}" });
}

export function listRequests(): Promise<{ requests: HelpRequestView[] }> {
  return request("/api/requests");
}

export function listVolunteers(): Promise<{ volunteers: PublicUser[] }> {
  return request("/api/volunteers");
}

export function createHelpRequest(kind: HelpKind, note: string): Promise<{ request: HelpRequestView }> {
  return request("/api/requests", { method: "POST", body: JSON.stringify({ kind, note }) });
}

export function assignVolunteer(requestId: string, volunteerId: string): Promise<{ request: HelpRequestView; nexconn: boolean }> {
  return request(`/api/requests/${requestId}/assign`, {
    method: "POST",
    body: JSON.stringify({ volunteerId }),
  });
}

export function openRoom(requestId: string): Promise<{ request: HelpRequestView; nexconn: boolean }> {
  return request(`/api/requests/${requestId}/room`, { method: "POST", body: "{}" });
}

export function updateStatus(
  requestId: string,
  status: Extract<RequestStatus, "in_progress" | "completed">,
): Promise<{ request: HelpRequestView; nexconn: boolean }> {
  return request(`/api/requests/${requestId}/status`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export function chatCredentials(): Promise<{ appKey: string; token: string; userId: string }> {
  return request("/api/chat/token", { method: "POST", body: "{}" });
}

export type CatalogQuery = {
  q?: string;
  category?: Category | "";
  min?: string;
  max?: string;
  available?: boolean;
  sort?: CatalogSort;
};

export function listProducts(query: CatalogQuery = {}): Promise<{ products: ProductView[] }> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  if (query.min) params.set("min", query.min);
  if (query.max) params.set("max", query.max);
  if (query.available) params.set("available", "1");
  if (query.sort && query.sort !== "relevance") params.set("sort", query.sort);
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return request(`/api/products${suffix}`);
}

export function getProduct(id: string): Promise<{ product: ProductView }> {
  return request(`/api/products/${id}`);
}

export function getCart(): Promise<{ cart: CartView }> {
  return request("/api/cart");
}

export function setCartItem(productId: string, quantity: number): Promise<{ cart: CartView }> {
  return request("/api/cart", { method: "PUT", body: JSON.stringify({ productId, quantity }) });
}

export function checkout(): Promise<{ orders: OrderView[]; nexconn: boolean; roomsReady: boolean }> {
  return request("/api/checkout", { method: "POST", body: "{}" });
}

export function listOrders(): Promise<{ orders: OrderView[] }> {
  return request("/api/orders");
}

export function getOrder(id: string): Promise<{ order: OrderView }> {
  return request(`/api/orders/${id}`);
}

export function openOrderRoom(id: string): Promise<{ order: OrderView; nexconn: boolean }> {
  return request(`/api/orders/${id}/room`, { method: "POST", body: "{}" });
}

export function requestOrderSupport(id: string, note: string): Promise<{ request: HelpRequestView; order: OrderView }> {
  return request(`/api/orders/${id}/support`, { method: "POST", body: JSON.stringify({ note }) });
}

export function claimOrderSupport(requestId: string): Promise<{ request: HelpRequestView; nexconn: boolean }> {
  return request(`/api/requests/${requestId}/claim`, { method: "POST", body: "{}" });
}

export function listConversations(): Promise<{ conversations: ConversationView[] }> {
  return request("/api/conversations");
}

export function listSellerProducts(): Promise<{ products: ProductView[] }> {
  return request("/api/seller/products");
}

export function createProduct(body: {
  name: string;
  description: string;
  category: Category;
  price: number;
  stock: number;
  images: string[];
  published: boolean;
}): Promise<{ product: ProductView }> {
  return request("/api/seller/products", { method: "POST", body: JSON.stringify(body) });
}

export function patchProduct(
  id: string,
  body: Partial<{
    name: string;
    description: string;
    category: Category;
    price: number;
    stock: number;
    images: string[];
    published: boolean;
  }>,
): Promise<{ product: ProductView }> {
  return request(`/api/seller/products/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteProduct(id: string): Promise<{ ok: boolean }> {
  return request(`/api/seller/products/${id}`, { method: "DELETE", body: "{}" });
}
