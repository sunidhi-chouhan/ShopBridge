/**
 * PostgreSQL store (production).
 *
 * Every operation runs targeted SQL: reads never write, and writes touch only the
 * rows they change, inside a transaction with row locks. The only whole-database
 * write is `reseedDemo`, which is refused in production.
 */
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { imagesForProductName, isAllowedProductImage, type CatalogSort } from "../shared/catalog";
import {
  nextOrderStatus,
  type CartView,
  type Category,
  type ConversationView,
  type HelpKind,
  type HelpRequestView,
  type Language,
  type OrderStatus,
  type OrderView,
  type ProductView,
  type PublicUser,
  type RequestStatus,
  type Resolution,
  type Role,
} from "../shared/types";
import { SESSION_MS, demoPassword, hashPassword, verifyPassword } from "./auth";
import { checkDatabaseReady, mapDbError, withClient, withTransaction } from "./db/pool";
import { DEMO_ACCOUNTS, DEMO_EMAILS, DEMO_PARTIES, demoId, type DemoParty, type DemoPlan, type DemoUserIds } from "./demo-seed";
import { HttpError } from "./errors";
import type { OrderItemRecord, OrderRecord, ProductRecord, RequestRecord, UserRecord } from "./store-types";

export type { UserRecord, RequestRecord, OrderRecord, ProductRecord } from "./store-types";

/** Live sessions kept per account. Shared demo accounts get many so concurrent judges never evict each other. */
const SESSION_CAP = 8;
const SAMPLE_SESSION_CAP = 500;

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

/** JSON-compat helper for health/facade; Postgres has no file store. */
export function storePaths(): { dataDir: string; storeFile: string; backupDir: string; storeExists: boolean } {
  return { dataDir: "(postgres)", storeFile: "(postgres)", backupDir: "(postgres)", storeExists: true };
}

export async function databaseReady(): Promise<{ ready: boolean; error?: string }> {
  return checkDatabaseReady();
}

async function read<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  try {
    return await withClient(fn);
  } catch (error) {
    mapDbError(error);
  }
}

async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  try {
    return await withTransaction(fn);
  } catch (error) {
    mapDbError(error);
  }
}

function idFor(prefix: string): string {
  return `${prefix}${randomBytes(6).toString("hex")}`;
}

function sessionToken(): string {
  return randomBytes(24).toString("hex");
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return new Date(String(value)).toISOString();
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code: string }).code === "23505");
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

const USER_COLS = "id, name, email, password_hash, role, sample, language, created_at";

function rowToUser(row: Row): UserRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role as Role,
    sample: Boolean(row.sample),
    sessionToken: null,
    sessionExpiresAt: null,
    sessions: [],
    language: (row.language as Language | null) ?? null,
    createdAt: iso(row.created_at),
  };
}

export function toPublicUser(user: UserRecord): PublicUser {
  return { id: user.id, name: user.name, role: user.role, sample: user.sample, language: user.language ?? null };
}

export function toSessionUser(user: UserRecord): PublicUser {
  return { ...toPublicUser(user), email: user.email };
}

async function usersByIds(client: PoolClient, ids: Array<string | null | undefined>): Promise<Map<string, UserRecord>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const map = new Map<string, UserRecord>();
  if (unique.length === 0) return map;
  const res = await client.query(`SELECT ${USER_COLS} FROM users WHERE id = ANY($1::text[])`, [unique]);
  for (const row of res.rows) map.set(row.id, rowToUser(row));
  return map;
}

const REQUEST_COLS =
  "id, kind, note, status, member_id, volunteer_id, coordinator_id, channel_id, order_id, resolution, resolution_note, resolved_at, created_at, updated_at";

function rowToRequest(row: Row): RequestRecord {
  return {
    id: row.id,
    kind: row.kind as HelpKind,
    note: row.note,
    status: row.status as RequestStatus,
    memberId: row.member_id,
    volunteerId: row.volunteer_id ?? null,
    coordinatorId: row.coordinator_id ?? null,
    channelId: row.channel_id ?? null,
    orderId: row.order_id ?? null,
    resolution: (row.resolution as Resolution | null) ?? null,
    resolutionNote: row.resolution_note ?? null,
    resolvedAt: row.resolved_at ? iso(row.resolved_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function requestView(users: Map<string, UserRecord>, request: RequestRecord): HelpRequestView {
  const member = users.get(request.memberId);
  if (!member) throw new HttpError(500, "STORE_ERROR", "The member on this request is missing.");
  const volunteer = request.volunteerId ? users.get(request.volunteerId) : undefined;
  const coordinator = request.coordinatorId ? users.get(request.coordinatorId) : undefined;
  return {
    id: request.id,
    kind: request.kind,
    note: request.note,
    status: request.status,
    member: toPublicUser(member),
    volunteer: volunteer ? toPublicUser(volunteer) : null,
    coordinator: coordinator ? toPublicUser(coordinator) : null,
    channelId: request.channelId,
    orderId: request.orderId ?? null,
    resolution: request.resolution ?? null,
    resolutionNote: request.resolutionNote ?? null,
    resolvedAt: request.resolvedAt ?? null,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

async function requestViews(client: PoolClient, requests: RequestRecord[]): Promise<HelpRequestView[]> {
  const users = await usersByIds(
    client,
    requests.flatMap((request) => [request.memberId, request.volunteerId, request.coordinatorId]),
  );
  return requests.map((request) => requestView(users, request));
}

async function lockRequest(client: PoolClient, requestId: string): Promise<RequestRecord | null> {
  const res = await client.query(`SELECT ${REQUEST_COLS} FROM requests WHERE id = $1 FOR UPDATE`, [requestId]);
  return res.rows[0] ? rowToRequest(res.rows[0]) : null;
}

async function saveRequest(client: PoolClient, request: RequestRecord): Promise<void> {
  await client.query(
    `UPDATE requests
        SET status = $2, volunteer_id = $3, coordinator_id = $4, channel_id = $5, updated_at = $6,
            resolution = $7, resolution_note = $8, resolved_at = $9
      WHERE id = $1`,
    [
      request.id,
      request.status,
      request.volunteerId,
      request.coordinatorId,
      request.channelId,
      request.updatedAt,
      request.resolution ?? null,
      request.resolutionNote ?? null,
      request.resolvedAt ?? null,
    ],
  );
}

/**
 * Images shown for a product. Mirrors the catalogue normalisation the store used to
 * write back on every request — now applied on read, without mutating data.
 */
function displayImages(name: string, sample: boolean, stored: string[]): string[] {
  const mapped = imagesForProductName(name);
  if (sample) return mapped ?? stored;
  const allowed = stored.filter((src) => isAllowedProductImage(src));
  if (mapped && (!allowed[0] || !mapped.includes(allowed[0]))) return mapped;
  return allowed;
}

function parseImages(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    try {
      return parseImages(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

const PRODUCT_SELECT = `
  SELECT p.id, p.seller_id, p.name, p.description, p.category, p.price, p.stock, p.published, p.featured,
         p.sample, p.images, p.created_at, p.updated_at,
         u.name AS seller_name, u.role AS seller_role, u.sample AS seller_sample
    FROM products p
    JOIN users u ON u.id = p.seller_id`;

function rowToProduct(row: Row): ProductRecord {
  return {
    id: row.id,
    sellerId: row.seller_id,
    name: row.name,
    description: row.description,
    category: row.category as Category,
    price: Number(row.price),
    stock: Number(row.stock),
    published: Boolean(row.published),
    featured: Boolean(row.featured),
    sample: Boolean(row.sample),
    images: parseImages(row.images),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function productView(product: ProductRecord, seller: PublicUser): ProductView {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    category: product.category,
    price: product.price,
    stock: product.stock,
    published: product.published,
    featured: product.featured,
    sample: product.sample,
    images: displayImages(product.name, product.sample, product.images),
    seller,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

function productRowView(row: Row): ProductView {
  return productView(rowToProduct(row), {
    id: row.seller_id,
    name: row.seller_name,
    role: row.seller_role as Role,
    sample: Boolean(row.seller_sample),
  });
}

const ORDER_COLS =
  "id, buyer_id, seller_id, status, payment, total, channel_id, created_at, updated_at, original_total, offer_id, offer_amount, offer_note, offer_state, courier, awb, eta";

async function loadOrderRecords(client: PoolClient, rows: Row[]): Promise<OrderRecord[]> {
  if (rows.length === 0) return [];
  const items = await client.query(
    `SELECT order_id, product_id, seller_id, name, image, quantity, price
       FROM order_items WHERE order_id = ANY($1::text[]) ORDER BY id ASC`,
    [rows.map((row) => row.id)],
  );
  const byOrder = new Map<string, OrderItemRecord[]>();
  for (const row of items.rows) {
    const list = byOrder.get(row.order_id) ?? [];
    list.push({
      productId: row.product_id,
      sellerId: row.seller_id,
      name: row.name,
      image: row.image ?? "",
      quantity: Number(row.quantity),
      price: Number(row.price),
    });
    byOrder.set(row.order_id, list);
  }
  return rows.map((row) => ({
    id: row.id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    status: row.status as OrderStatus,
    payment: "simulated",
    items: byOrder.get(row.id) ?? [],
    total: Number(row.total),
    channelId: row.channel_id ?? null,
    createdAt: iso(row.created_at),
    updatedAt: row.updated_at ? iso(row.updated_at) : iso(row.created_at),
    originalTotal: row.original_total === null || row.original_total === undefined ? null : Number(row.original_total),
    offer: row.offer_id
      ? { id: row.offer_id, amount: Number(row.offer_amount), note: row.offer_note ?? null, state: row.offer_state }
      : null,
    shipment: row.courier ? { courier: row.courier, awb: row.awb ?? "", eta: row.eta ?? null } : null,
  }));
}

function orderView(users: Map<string, UserRecord>, order: OrderRecord): OrderView {
  const buyer = users.get(order.buyerId);
  const seller = users.get(order.sellerId);
  if (!buyer || !seller) throw new HttpError(500, "STORE_ERROR", "A person on this order is missing.");
  return {
    id: order.id,
    status: order.status,
    payment: "simulated",
    buyer: toPublicUser(buyer),
    seller: toPublicUser(seller),
    items: order.items.map((item) => ({
      productId: item.productId,
      name: item.name,
      image: item.image,
      quantity: item.quantity,
      price: item.price,
      lineTotal: item.price * item.quantity,
      seller: toPublicUser(users.get(item.sellerId) ?? seller),
    })),
    total: order.total,
    channelId: order.channelId,
    offer: offerView(order),
    shipment: order.shipment ?? null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt ?? order.createdAt,
  };
}

export function offerView(order: OrderRecord): OrderView["offer"] {
  if (!order.offer) return null;
  return {
    id: order.offer.id,
    amount: order.offer.amount,
    was: order.originalTotal ?? order.total,
    note: order.offer.note,
    state: order.offer.state,
  };
}

async function orderViews(client: PoolClient, orders: OrderRecord[]): Promise<OrderView[]> {
  const users = await usersByIds(
    client,
    orders.flatMap((order) => [order.buyerId, order.sellerId, ...order.items.map((item) => item.sellerId)]),
  );
  return orders.map((order) => orderView(users, order));
}

async function findOrder(client: PoolClient, orderId: string, lock = false): Promise<OrderRecord | null> {
  const res = await client.query(`SELECT ${ORDER_COLS} FROM orders WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [orderId]);
  if (!res.rows[0]) return null;
  return (await loadOrderRecords(client, res.rows))[0];
}

// ---------------------------------------------------------------------------
// Accounts and sessions
// ---------------------------------------------------------------------------

async function attachSession(client: PoolClient, user: UserRecord): Promise<PublicUser & { sessionToken: string }> {
  const token = sessionToken();
  const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
  const cap = user.sample ? SAMPLE_SESSION_CAP : SESSION_CAP;
  await client.query("DELETE FROM sessions WHERE user_id = $1 AND expires_at <= now()", [user.id]);
  await client.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [token, user.id, expiresAt]);
  await client.query(
    `DELETE FROM sessions
      WHERE user_id = $1
        AND token NOT IN (SELECT token FROM sessions WHERE user_id = $1 ORDER BY expires_at DESC LIMIT $2)`,
    [user.id, cap],
  );
  // Legacy columns kept in step for older import/verify scripts.
  await client.query("UPDATE users SET session_token = $2, session_expires_at = $3 WHERE id = $1", [
    user.id,
    token,
    expiresAt,
  ]);
  return { ...toSessionUser(user), sessionToken: token };
}

export async function registerBuyer(
  name: string,
  email: string,
  password: string,
): Promise<PublicUser & { sessionToken: string }> {
  const passwordHash = await hashPassword(password);
  try {
    return await withTransaction(async (client) => {
      const taken = await client.query("SELECT 1 FROM users WHERE email = $1", [email]);
      if (taken.rowCount) throw new HttpError(409, "EMAIL_TAKEN", "That email already has an account.");
      const user: UserRecord = {
        id: idFor("m"),
        name,
        email,
        passwordHash,
        role: "member",
        sample: false,
        sessionToken: null,
        sessionExpiresAt: null,
        sessions: [],
        createdAt: new Date().toISOString(),
      };
      await client.query(
        `INSERT INTO users (id, name, email, password_hash, role, sample, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [user.id, user.name, user.email, user.passwordHash, user.role, user.sample, user.createdAt],
      );
      return attachSession(client, user);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "EMAIL_TAKEN", "That email already has an account.");
    mapDbError(error);
  }
}

let dummyHash: string | null = null;

async function rejectCredentials(password: string): Promise<never> {
  dummyHash ??= await hashPassword("shopbridge-dummy-password");
  await verifyPassword(password, dummyHash);
  throw new HttpError(401, "INVALID_CREDENTIALS", "Email or password is wrong.");
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<PublicUser & { sessionToken: string }> {
  const match = await read(async (client) => {
    const res = await client.query(`SELECT ${USER_COLS} FROM users WHERE email = $1`, [email]);
    return res.rows[0] ? rowToUser(res.rows[0]) : null;
  });
  if (!match) return rejectCredentials(password);
  if (!(await verifyPassword(password, match.passwordHash))) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Email or password is wrong.");
  }
  return tx((client) => attachSession(client, match));
}

export function signInDemo(party: DemoParty): Promise<PublicUser & { sessionToken: string }> {
  const spec = DEMO_ACCOUNTS[party];
  return tx(async (client) => {
    const res = await client.query(`SELECT ${USER_COLS} FROM users WHERE email = $1 AND sample = TRUE`, [spec.email]);
    if (!res.rows[0]) throw new HttpError(503, "DEMO_MISSING", "Demo accounts are missing. Run npm run seed.");
    return attachSession(client, rowToUser(res.rows[0]));
  });
}

export function clearSession(token: string): Promise<void> {
  return tx(async (client) => {
    const removed = await client.query("DELETE FROM sessions WHERE token = $1 RETURNING user_id", [token]);
    const owners = await client.query("SELECT id FROM users WHERE session_token = $1", [token]);
    const userIds = new Set<string>([
      ...removed.rows.map((row) => row.user_id as string),
      ...owners.rows.map((row) => row.id as string),
    ]);
    for (const userId of userIds) {
      const latest = await client.query(
        "SELECT token, expires_at FROM sessions WHERE user_id = $1 ORDER BY expires_at DESC LIMIT 1",
        [userId],
      );
      await client.query("UPDATE users SET session_token = $2, session_expires_at = $3 WHERE id = $1", [
        userId,
        latest.rows[0]?.token ?? null,
        latest.rows[0]?.expires_at ?? null,
      ]);
    }
  });
}

export function userBySession(token: string): Promise<UserRecord | null> {
  return read(async (client) => {
    const res = await client.query(
      `SELECT ${USER_COLS.split(", ").map((col) => `u.${col}`).join(", ")}, (s.expires_at > now()) AS live
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = $1`,
      [token],
    );
    if (res.rows[0]) return res.rows[0].live ? rowToUser(res.rows[0]) : null;
    // Legacy single-session column, only for tokens that predate the sessions table.
    const legacy = await client.query(
      `SELECT ${USER_COLS} FROM users WHERE session_token = $1 AND session_expires_at > now()`,
      [token],
    );
    return legacy.rows[0] ? rowToUser(legacy.rows[0]) : null;
  });
}

export function listVolunteers(): Promise<PublicUser[]> {
  return read(async (client) => {
    const res = await client.query(`SELECT ${USER_COLS} FROM users WHERE role = 'volunteer' ORDER BY created_at ASC`);
    return res.rows.map((row) => toPublicUser(rowToUser(row)));
  });
}

// ---------------------------------------------------------------------------
// Requests (order support + legacy community help)
// ---------------------------------------------------------------------------

function visibleTo(user: UserRecord, request: RequestRecord): boolean {
  if (user.role === "coordinator") return true;
  if (user.role === "member") return request.memberId === user.id;
  return request.volunteerId === user.id;
}

export function listRequests(user: UserRecord): Promise<HelpRequestView[]> {
  return read(async (client) => {
    const where =
      user.role === "coordinator" ? "TRUE" : user.role === "member" ? "member_id = $1" : "volunteer_id = $1";
    const res = await client.query(
      `SELECT ${REQUEST_COLS} FROM requests WHERE ${where} ORDER BY created_at DESC`,
      user.role === "coordinator" ? [] : [user.id],
    );
    return requestViews(client, res.rows.map(rowToRequest));
  });
}

export function createRequest(member: UserRecord, kind: HelpKind, note: string): Promise<HelpRequestView> {
  return tx(async (client) => {
    await client.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [member.id]);
    const open = await client.query(
      "SELECT 1 FROM requests WHERE member_id = $1 AND status <> 'completed' AND order_id IS NULL LIMIT 1",
      [member.id],
    );
    if (open.rowCount) throw new HttpError(409, "REQUEST_OPEN", "Finish the current request before starting another.");
    const now = new Date().toISOString();
    const request: RequestRecord = {
      id: idFor("r"),
      kind,
      note,
      status: "requested",
      memberId: member.id,
      volunteerId: null,
      coordinatorId: null,
      channelId: null,
      orderId: null,
      createdAt: now,
      updatedAt: now,
    };
    await insertRequest(client, request);
    return (await requestViews(client, [request]))[0];
  });
}

async function insertRequest(client: PoolClient, request: RequestRecord): Promise<void> {
  await client.query(
    `INSERT INTO requests
       (id, kind, note, status, member_id, volunteer_id, coordinator_id, channel_id, order_id,
        resolution, resolution_note, resolved_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      request.id,
      request.kind,
      request.note,
      request.status,
      request.memberId,
      request.volunteerId,
      request.coordinatorId,
      request.channelId,
      request.orderId,
      request.resolution ?? null,
      request.resolutionNote ?? null,
      request.resolvedAt ?? null,
      request.createdAt,
      request.updatedAt,
    ],
  );
}

export type RoomParticipants = {
  request: RequestRecord;
  member: UserRecord;
  volunteer: UserRecord;
  coordinator: UserRecord;
};

export function prepareAssignment(
  coordinator: UserRecord,
  requestId: string,
  volunteerId: string,
): Promise<RoomParticipants> {
  return read(async (client) => {
    const res = await client.query(`SELECT ${REQUEST_COLS} FROM requests WHERE id = $1`, [requestId]);
    const request = res.rows[0] ? rowToRequest(res.rows[0]) : null;
    const users = await usersByIds(client, [request?.memberId, volunteerId]);
    const member = request ? users.get(request.memberId) : undefined;
    const volunteer = users.get(volunteerId);
    if (!request || !member) throw new HttpError(404, "NOT_FOUND", "That request does not exist.");
    if (request.status !== "requested" || request.channelId) {
      throw new HttpError(409, "ALREADY_ASSIGNED", "This request already has a volunteer.");
    }
    if (!volunteer || volunteer.role !== "volunteer") throw new HttpError(422, "VALIDATION_ERROR", "Choose a volunteer.");
    if (volunteer.id === member.id) {
      throw new HttpError(422, "VALIDATION_ERROR", "The member cannot be their own volunteer.");
    }
    return { request, member, volunteer, coordinator };
  });
}

export function saveAssignment(
  requestId: string,
  volunteerId: string,
  coordinatorId: string,
  channelId: string | null,
): Promise<HelpRequestView> {
  return tx(async (client) => {
    const request = await lockRequest(client, requestId);
    if (!request) throw new HttpError(404, "NOT_FOUND", "That request does not exist.");
    if (request.status !== "requested") {
      throw new HttpError(409, "ALREADY_ASSIGNED", "This request already has a volunteer.");
    }
    request.volunteerId = volunteerId;
    request.coordinatorId = coordinatorId;
    request.channelId = channelId;
    request.status = "assigned";
    request.updatedAt = new Date().toISOString();
    await saveRequest(client, request);
    return (await requestViews(client, [request]))[0];
  });
}

export function prepareRoom(coordinator: UserRecord, requestId: string): Promise<RoomParticipants> {
  return read(async (client) => {
    const res = await client.query(`SELECT ${REQUEST_COLS} FROM requests WHERE id = $1`, [requestId]);
    const request = res.rows[0] ? rowToRequest(res.rows[0]) : null;
    const users = await usersByIds(client, [request?.memberId, request?.volunteerId]);
    const member = request ? users.get(request.memberId) : undefined;
    const volunteer = request?.volunteerId ? users.get(request.volunteerId) : undefined;
    if (!request || !member || !volunteer) {
      throw new HttpError(404, "NOT_FOUND", "Assign a volunteer before opening the room.");
    }
    if (request.coordinatorId && request.coordinatorId !== coordinator.id) {
      throw new HttpError(403, "FORBIDDEN", "Another coordinator is already on this request.");
    }
    return { request, member, volunteer, coordinator };
  });
}

export function saveChannel(requestId: string, channelId: string): Promise<HelpRequestView> {
  return tx(async (client) => {
    const request = await lockRequest(client, requestId);
    if (!request) throw new HttpError(404, "NOT_FOUND", "That request does not exist.");
    request.channelId = channelId;
    request.updatedAt = new Date().toISOString();
    await saveRequest(client, request);
    return (await requestViews(client, [request]))[0];
  });
}

/**
 * Who may move a request forward. Order support is a buyer–seller dispute, so only the
 * support agent on the case may advance or close it — never the seller.
 */
export function canChangeRequestStatus(actor: UserRecord, request: RequestRecord): boolean {
  if (request.orderId) {
    return actor.role === "coordinator" && request.coordinatorId === actor.id;
  }
  return actor.role === "coordinator" || (actor.role === "volunteer" && actor.id === request.volunteerId);
}

export function changeStatus(
  actor: UserRecord,
  requestId: string,
  status: Extract<RequestStatus, "in_progress" | "completed">,
): Promise<{ view: HelpRequestView; previous: RequestStatus }> {
  return tx(async (client) => {
    const request = await lockRequest(client, requestId);
    if (!request) throw new HttpError(404, "NOT_FOUND", "That request does not exist.");
    if (request.orderId) {
      throw new HttpError(409, "USE_RESOLUTION", "Order support moves forward by proposing a resolution.");
    }
    if (!canChangeRequestStatus(actor, request)) {
      throw new HttpError(
        403,
        "FORBIDDEN",
        request.orderId
          ? "Only the support agent on this case can update it."
          : "Only the assigned volunteer or a coordinator can update status.",
      );
    }
    const expected = status === "in_progress" ? "assigned" : "in_progress";
    if (request.status !== expected) throw new HttpError(409, "BAD_STATUS", "Update the request one step at a time.");
    const previous = request.status;
    request.status = status;
    request.updatedAt = new Date().toISOString();
    await saveRequest(client, request);
    return { view: (await requestViews(client, [request]))[0], previous };
  });
}

export function requestRecord(requestId: string): Promise<RequestRecord | null> {
  return read(async (client) => {
    const res = await client.query(`SELECT ${REQUEST_COLS} FROM requests WHERE id = $1`, [requestId]);
    return res.rows[0] ? rowToRequest(res.rows[0]) : null;
  });
}

export function canReadRequest(user: UserRecord, request: RequestRecord): boolean {
  return visibleTo(user, request);
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export type ProductQuery = {
  q?: string;
  category?: Category;
  min?: number;
  max?: number;
  available?: boolean;
  sort?: CatalogSort;
};

const SORT_SQL: Record<CatalogSort, string> = {
  relevance: "p.featured DESC, p.created_at DESC",
  "price-asc": "p.price ASC, p.created_at ASC",
  "price-desc": "p.price DESC, p.created_at ASC",
  newest: "p.created_at DESC",
};

export function listCatalog(query: ProductQuery): Promise<ProductView[]> {
  return read(async (client) => {
    const needle = query.q?.trim().toLowerCase() || null;
    const order = SORT_SQL[query.sort ?? "relevance"] ?? SORT_SQL.relevance;
    const res = await client.query(
      `${PRODUCT_SELECT}
        WHERE p.published
          AND ($1::text IS NULL OR p.category = $1)
          AND ($2::float8 IS NULL OR p.price >= $2)
          AND ($3::float8 IS NULL OR p.price <= $3)
          AND (NOT $4::boolean OR p.stock > 0)
          AND ($5::text IS NULL OR strpos(lower(concat_ws(' ', p.name, p.description, p.category, u.name)), $5) > 0)
        ORDER BY ${order}`,
      [query.category ?? null, query.min ?? null, query.max ?? null, query.available === true, needle],
    );
    return res.rows.map(productRowView);
  });
}

export function getProduct(id: string, actor: UserRecord | null): Promise<ProductView> {
  return read(async (client) => {
    const res = await client.query(`${PRODUCT_SELECT} WHERE p.id = $1`, [id]);
    const row = res.rows[0];
    if (!row) throw new HttpError(404, "NOT_FOUND", "That product does not exist.");
    const owner = actor?.role === "volunteer" && actor.id === row.seller_id;
    if (!row.published && !owner) throw new HttpError(404, "NOT_FOUND", "That product does not exist.");
    return productRowView(row);
  });
}

export function listSellerProducts(seller: UserRecord): Promise<ProductView[]> {
  return read(async (client) => {
    const res = await client.query(`${PRODUCT_SELECT} WHERE p.seller_id = $1 ORDER BY p.updated_at DESC`, [seller.id]);
    return res.rows.map(productRowView);
  });
}

type ProductInput = {
  name: string;
  description: string;
  category: Category;
  price: number;
  stock: number;
  images: string[];
  published: boolean;
};

export function createProduct(seller: UserRecord, input: ProductInput): Promise<ProductView> {
  if (seller.role !== "volunteer") throw new HttpError(403, "FORBIDDEN", "Only a seller can add products.");
  return tx(async (client) => {
    const now = new Date().toISOString();
    const product: ProductRecord = {
      id: idFor("p"),
      sellerId: seller.id,
      ...input,
      featured: false,
      sample: false,
      createdAt: now,
      updatedAt: now,
    };
    await client.query(
      `INSERT INTO products
         (id, seller_id, name, description, category, price, stock, published, featured, sample, images, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)`,
      [
        product.id,
        product.sellerId,
        product.name,
        product.description,
        product.category,
        product.price,
        product.stock,
        product.published,
        product.featured,
        product.sample,
        JSON.stringify(product.images),
        product.createdAt,
        product.updatedAt,
      ],
    );
    return productView(product, toPublicUser(seller));
  });
}

export function updateProduct(seller: UserRecord, id: string, input: Partial<ProductInput>): Promise<ProductView> {
  return tx(async (client) => {
    const res = await client.query(`${PRODUCT_SELECT} WHERE p.id = $1 AND p.seller_id = $2 FOR UPDATE OF p`, [
      id,
      seller.id,
    ]);
    if (!res.rows[0]) throw new HttpError(404, "NOT_FOUND", "That product does not exist.");
    const product = rowToProduct(res.rows[0]);
    if (input.name !== undefined) product.name = input.name;
    if (input.description !== undefined) product.description = input.description;
    if (input.category !== undefined) product.category = input.category;
    if (input.price !== undefined) product.price = input.price;
    if (input.stock !== undefined) product.stock = input.stock;
    if (input.images !== undefined) product.images = input.images;
    if (input.published !== undefined) product.published = input.published;
    product.updatedAt = new Date().toISOString();
    await client.query(
      `UPDATE products
          SET name = $2, description = $3, category = $4, price = $5, stock = $6, images = $7::jsonb,
              published = $8, updated_at = $9
        WHERE id = $1`,
      [
        product.id,
        product.name,
        product.description,
        product.category,
        product.price,
        product.stock,
        JSON.stringify(product.images),
        product.published,
        product.updatedAt,
      ],
    );
    return productView(product, toPublicUser(seller));
  });
}

export function deleteProduct(seller: UserRecord, id: string): Promise<void> {
  return tx(async (client) => {
    // cart_items rows go with it (ON DELETE CASCADE); order_items keep their own copy.
    const res = await client.query("DELETE FROM products WHERE id = $1 AND seller_id = $2", [id, seller.id]);
    if (!res.rowCount) throw new HttpError(404, "NOT_FOUND", "That product does not exist.");
  });
}

// ---------------------------------------------------------------------------
// Cart and checkout
// ---------------------------------------------------------------------------

async function cartView(client: PoolClient, userId: string): Promise<CartView> {
  const res = await client.query(
    `${PRODUCT_SELECT.replace("SELECT p.id", "SELECT ci.quantity AS cart_quantity, p.id")}
       JOIN cart_items ci ON ci.product_id = p.id
      WHERE ci.user_id = $1 AND p.published
      ORDER BY p.name ASC`,
    [userId],
  );
  const items = res.rows.map((row) => {
    const product = productRowView(row);
    const quantity = Number(row.cart_quantity);
    return { product, quantity, lineTotal: product.price * quantity };
  });
  return { items, subtotal: items.reduce((sum, item) => sum + item.lineTotal, 0) };
}

export function getCart(buyer: UserRecord): Promise<CartView> {
  return read((client) => cartView(client, buyer.id));
}

export function setCartItem(buyer: UserRecord, productId: string, quantity: number): Promise<CartView> {
  if (buyer.role !== "member") throw new HttpError(403, "FORBIDDEN", "Only a buyer can use the cart.");
  return tx(async (client) => {
    const res = await client.query("SELECT id, seller_id, name, stock, published FROM products WHERE id = $1", [productId]);
    const product = res.rows[0];
    if (!product || !product.published) throw new HttpError(404, "NOT_FOUND", "That product does not exist.");
    if (product.seller_id === buyer.id) throw new HttpError(422, "VALIDATION_ERROR", "You cannot buy your own listing.");
    if (quantity === 0) {
      await client.query("DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2", [buyer.id, productId]);
      return cartView(client, buyer.id);
    }
    if (Number(product.stock) < quantity) {
      throw new HttpError(409, "OUT_OF_STOCK", `Only ${product.stock} left of ${product.name}.`);
    }
    await client.query(
      `INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
      [buyer.id, productId, quantity],
    );
    return cartView(client, buyer.id);
  });
}

export function checkout(buyer: UserRecord): Promise<OrderView[]> {
  if (buyer.role !== "member") throw new HttpError(403, "FORBIDDEN", "Only a buyer can check out.");
  return tx(async (client) => {
    // Serialise checkouts for this buyer, then lock the products being bought.
    await client.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [buyer.id]);
    const res = await client.query(
      `${PRODUCT_SELECT.replace("SELECT p.id", "SELECT ci.quantity AS cart_quantity, p.id")}
         JOIN cart_items ci ON ci.product_id = p.id
        WHERE ci.user_id = $1 AND p.published
        ORDER BY p.name ASC
        FOR UPDATE OF p`,
      [buyer.id],
    );
    if (res.rows.length === 0) throw new HttpError(422, "CART_EMPTY", "Your bag is empty.");
    const lines = res.rows.map((row) => ({ view: productRowView(row), quantity: Number(row.cart_quantity) }));
    for (const line of lines) {
      if (line.view.stock < line.quantity) {
        throw new HttpError(409, "OUT_OF_STOCK", `Only ${line.view.stock} left of ${line.view.name}.`);
      }
    }
    const groups = new Map<string, typeof lines>();
    for (const line of lines) {
      const list = groups.get(line.view.seller.id) ?? [];
      list.push(line);
      groups.set(line.view.seller.id, list);
    }
    const now = new Date().toISOString();
    const created: OrderRecord[] = [];
    for (const [sellerId, group] of groups) {
      const order: OrderRecord = {
        id: idFor("o"),
        buyerId: buyer.id,
        sellerId,
        status: "placed",
        payment: "simulated",
        items: group.map((line) => ({
          productId: line.view.id,
          sellerId,
          name: line.view.name,
          image: line.view.images[0] ?? "",
          quantity: line.quantity,
          price: line.view.price,
        })),
        total: group.reduce((sum, line) => sum + line.view.price * line.quantity, 0),
        channelId: null,
        createdAt: now,
        updatedAt: now,
      };
      for (const line of group) {
        await client.query("UPDATE products SET stock = stock - $2 WHERE id = $1", [line.view.id, line.quantity]);
      }
      await client.query(
        `INSERT INTO orders (id, buyer_id, seller_id, status, payment, total, channel_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [order.id, order.buyerId, order.sellerId, order.status, order.payment, order.total, order.channelId, order.createdAt],
      );
      for (const item of order.items) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, seller_id, name, image, quantity, price)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [order.id, item.productId, item.sellerId, item.name, item.image, item.quantity, item.price],
        );
      }
      created.push(order);
    }
    await client.query("DELETE FROM cart_items WHERE user_id = $1", [buyer.id]);
    return orderViews(client, created);
  });
}

// ---------------------------------------------------------------------------
// Orders and conversations
// ---------------------------------------------------------------------------

export function listOrders(user: UserRecord): Promise<OrderView[]> {
  return read(async (client) => {
    const column = user.role === "member" ? "buyer_id" : user.role === "volunteer" ? "seller_id" : null;
    if (!column) return [];
    const res = await client.query(`SELECT ${ORDER_COLS} FROM orders WHERE ${column} = $1 ORDER BY created_at DESC`, [
      user.id,
    ]);
    return orderViews(client, await loadOrderRecords(client, res.rows));
  });
}

async function canAccessOrder(client: PoolClient, user: UserRecord, order: OrderRecord): Promise<boolean> {
  if (user.role === "member") return order.buyerId === user.id;
  if (user.role === "volunteer") return order.sellerId === user.id;
  if (user.role === "coordinator") {
    const res = await client.query(
      `SELECT 1 FROM requests
        WHERE order_id = $1 AND (coordinator_id = $2 OR (status = 'requested' AND coordinator_id IS NULL))
        LIMIT 1`,
      [order.id, user.id],
    );
    return Boolean(res.rowCount);
  }
  return false;
}

export function getOrder(user: UserRecord, id: string): Promise<OrderView> {
  return read(async (client) => {
    const order = await findOrder(client, id);
    if (!order || !(await canAccessOrder(client, user, order))) {
      throw new HttpError(404, "NOT_FOUND", "That order does not exist.");
    }
    return (await orderViews(client, [order]))[0];
  });
}

export function saveOrderChannel(orderId: string, channelId: string): Promise<OrderView> {
  return tx(async (client) => {
    const res = await client.query("UPDATE orders SET channel_id = $2 WHERE id = $1", [orderId, channelId]);
    if (!res.rowCount) throw new HttpError(404, "NOT_FOUND", "That order does not exist.");
    const order = await findOrder(client, orderId);
    return (await orderViews(client, [order!]))[0];
  });
}

export function orderParticipants(orderId: string): Promise<{
  order: OrderRecord;
  buyer: UserRecord;
  seller: UserRecord;
  productLabel: string;
}> {
  return read(async (client) => {
    const order = await findOrder(client, orderId);
    if (!order) throw new HttpError(404, "NOT_FOUND", "That order does not exist.");
    const users = await usersByIds(client, [order.buyerId, order.sellerId]);
    const buyer = users.get(order.buyerId);
    const seller = users.get(order.sellerId);
    if (!buyer || !seller) throw new HttpError(500, "STORE_ERROR", "The parties on this order are missing.");
    return { order, buyer, seller, productLabel: order.items[0]?.name ?? order.id };
  });
}

export function assertOrderRoomAccess(user: UserRecord, orderId: string): Promise<OrderView> {
  return getOrder(user, orderId);
}

export function listConversations(user: UserRecord): Promise<ConversationView[]> {
  return read(async (client) => {
    let res;
    if (user.role === "member" || user.role === "volunteer") {
      const column = user.role === "member" ? "buyer_id" : "seller_id";
      res = await client.query(`SELECT ${ORDER_COLS} FROM orders WHERE ${column} = $1 ORDER BY created_at DESC`, [user.id]);
    } else if (user.role === "coordinator") {
      res = await client.query(
        `SELECT ${ORDER_COLS} FROM orders o
          WHERE EXISTS (SELECT 1 FROM requests r WHERE r.order_id = o.id AND r.coordinator_id = $1)
          ORDER BY created_at DESC`,
        [user.id],
      );
    } else {
      return [];
    }
    const orders = await loadOrderRecords(client, res.rows);
    if (orders.length === 0) return [];
    const latest = await client.query(
      `SELECT DISTINCT ON (order_id) ${REQUEST_COLS}
         FROM requests WHERE order_id = ANY($1::text[])
        ORDER BY order_id, updated_at DESC`,
      [orders.map((order) => order.id)],
    );
    const supportByOrder = new Map<string, RequestRecord>(
      latest.rows.map((row) => [row.order_id as string, rowToRequest(row)]),
    );
    const supports = [...supportByOrder.values()];
    const users = await usersByIds(client, [
      ...orders.flatMap((order) => [order.buyerId, order.sellerId]),
      ...supports.flatMap((request) => [request.memberId, request.volunteerId, request.coordinatorId]),
    ]);
    return orders.map((order) => {
      const buyer = users.get(order.buyerId);
      const seller = users.get(order.sellerId);
      if (!buyer || !seller) throw new HttpError(500, "STORE_ERROR", "The parties on this order are missing.");
      const counterpart = user.role === "volunteer" ? buyer : seller;
      const support = supportByOrder.get(order.id);
      return {
        id: order.id,
        orderId: order.id,
        channelId: order.channelId,
        title: order.items[0]?.name ?? `Order ${order.id}`,
        image: order.items[0]?.image ?? "",
        total: order.total,
        status: order.status,
        counterpart: toPublicUser(counterpart),
        support: support ? requestView(users, support) : null,
        createdAt: order.createdAt,
        updatedAt: support?.updatedAt ?? order.createdAt,
      } satisfies ConversationView;
    });
  });
}

export function createOrderSupport(buyer: UserRecord, orderId: string, note: string): Promise<HelpRequestView> {
  if (buyer.role !== "member") throw new HttpError(403, "FORBIDDEN", "Only a buyer can request order support.");
  return tx(async (client) => {
    const order = await findOrder(client, orderId, true);
    if (!order || order.buyerId !== buyer.id) throw new HttpError(404, "NOT_FOUND", "That order does not exist.");
    if (!order.channelId) {
      throw new HttpError(409, "ROOM_MISSING", "Open the order conversation before requesting support.");
    }
    const open = await client.query(
      "SELECT 1 FROM requests WHERE order_id = $1 AND status <> 'completed' LIMIT 1",
      [orderId],
    );
    if (open.rowCount) throw new HttpError(409, "REQUEST_OPEN", "Support is already open for this order.");
    const now = new Date().toISOString();
    const request: RequestRecord = {
      id: idFor("r"),
      kind: "companion",
      note: note || `Support for order ${order.id}`,
      status: "requested",
      memberId: buyer.id,
      volunteerId: order.sellerId,
      coordinatorId: null,
      channelId: order.channelId,
      orderId: order.id,
      resolution: null,
      resolutionNote: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await insertRequest(client, request);
    return (await requestViews(client, [request]))[0];
  });
}

export function claimOrderSupport(
  coordinator: UserRecord,
  requestId: string,
): Promise<{ view: HelpRequestView; channelId: string; sellerId: string; buyerId: string }> {
  if (coordinator.role !== "coordinator") {
    throw new HttpError(403, "FORBIDDEN", "Only a support agent can claim order support.");
  }
  return tx(async (client) => {
    const request = await lockRequest(client, requestId);
    if (!request || !request.orderId) throw new HttpError(404, "NOT_FOUND", "That support request does not exist.");
    const order = await findOrder(client, request.orderId);
    if (!order || !order.channelId) throw new HttpError(409, "ROOM_MISSING", "The order conversation is not ready.");
    if (request.coordinatorId && request.coordinatorId !== coordinator.id) {
      throw new HttpError(409, "ALREADY_ASSIGNED", "Another support agent is already on this order.");
    }
    request.coordinatorId = coordinator.id;
    request.channelId = order.channelId;
    if (!request.volunteerId) request.volunteerId = order.sellerId;
    if (request.status === "requested") request.status = "assigned";
    request.updatedAt = new Date().toISOString();
    await saveRequest(client, request);
    return {
      view: (await requestViews(client, [request]))[0],
      channelId: order.channelId,
      sellerId: order.sellerId,
      buyerId: order.buyerId,
    };
  });
}

// ---------------------------------------------------------------------------
// Preferences, order lifecycle and support resolution
// ---------------------------------------------------------------------------

export function setUserLanguage(user: UserRecord, language: Language): Promise<PublicUser> {
  return tx(async (client) => {
    await client.query("UPDATE users SET language = $2 WHERE id = $1", [user.id, language]);
    return toSessionUser({ ...user, language });
  });
}

/** Seller moves their own order one step: placed → packed → shipped → delivered. */
export function advanceOrder(
  seller: UserRecord,
  orderId: string,
  status: OrderStatus,
  shipment?: { courier: string; awb: string; eta: string | null } | null,
): Promise<{ order: OrderView; previous: OrderStatus }> {
  return tx(async (client) => {
    const order = await findOrder(client, orderId, true);
    if (!order || seller.role !== "volunteer" || order.sellerId !== seller.id) {
      throw new HttpError(404, "NOT_FOUND", "That order does not exist.");
    }
    if (nextOrderStatus(order.status) !== status) {
      throw new HttpError(409, "BAD_STATUS", "Move the order one step at a time.");
    }
    const previous = order.status;
    const now = new Date().toISOString();
    const nextShipment = status === "shipped" && shipment ? shipment : order.shipment ?? null;
    await client.query(
      "UPDATE orders SET status = $2, updated_at = $3, courier = $4, awb = $5, eta = $6 WHERE id = $1",
      [order.id, status, now, nextShipment?.courier ?? null, nextShipment?.awb ?? null, nextShipment?.eta ?? null],
    );
    return {
      order: (await orderViews(client, [{ ...order, status, updatedAt: now, shipment: nextShipment }]))[0],
      previous,
    };
  });
}

/** The agent on the case proposes an outcome; the buyer then accepts or declines it. */
export function proposeResolution(
  agent: UserRecord,
  requestId: string,
  resolution: Resolution,
  note: string,
): Promise<HelpRequestView> {
  return tx(async (client) => {
    const request = await lockRequest(client, requestId);
    if (!request || !request.orderId) throw new HttpError(404, "NOT_FOUND", "That support case does not exist.");
    if (agent.role !== "coordinator" || request.coordinatorId !== agent.id) {
      throw new HttpError(403, "FORBIDDEN", "Only the support agent on this case can propose a resolution.");
    }
    if (request.status !== "assigned" && request.status !== "in_progress") {
      throw new HttpError(409, "BAD_STATUS", "This case is not open for a proposal.");
    }
    request.status = "in_progress";
    request.resolution = resolution;
    request.resolutionNote = note || null;
    request.resolvedAt = null;
    request.updatedAt = new Date().toISOString();
    await saveRequest(client, request);
    return (await requestViews(client, [request]))[0];
  });
}

export function respondToResolution(buyer: UserRecord, requestId: string, accept: boolean): Promise<HelpRequestView> {
  return tx(async (client) => {
    const request = await lockRequest(client, requestId);
    if (!request || !request.orderId || request.memberId !== buyer.id) {
      throw new HttpError(404, "NOT_FOUND", "That support case does not exist.");
    }
    if (request.status !== "in_progress" || !request.resolution) {
      throw new HttpError(409, "BAD_STATUS", "There is no proposal to answer.");
    }
    const now = new Date().toISOString();
    if (accept) {
      request.status = "completed";
      request.resolvedAt = now;
    } else {
      request.status = "assigned";
      request.resolution = null;
      request.resolutionNote = null;
    }
    request.updatedAt = now;
    await saveRequest(client, request);
    return (await requestViews(client, [request]))[0];
  });
}

// ---------------------------------------------------------------------------
// Shared demo environment
// ---------------------------------------------------------------------------

const RESET_LOCK_KEY = 742302;

export function getDemoEpoch(): Promise<string | null> {
  return read(async (client) => {
    const res = await client.query("SELECT value FROM demo_state WHERE key = 'epoch'");
    return res.rows[0]?.value ?? null;
  });
}

/** Existing demo user ids by party (missing parties get fresh ids). */
export function demoUserIds(): Promise<DemoUserIds> {
  return read(async (client) => {
    const res = await client.query("SELECT id, email FROM users WHERE email = ANY($1::text[])", [DEMO_EMAILS]);
    const byEmail = new Map(res.rows.map((row) => [row.email as string, row.id as string]));
    const prefix: Record<DemoParty, string> = { buyer: "m", seller: "v", support: "c" };
    const ids = {} as DemoUserIds;
    for (const party of DEMO_PARTIES) ids[party] = byEmail.get(DEMO_ACCOUNTS[party].email) ?? demoId(prefix[party]);
    return ids;
  });
}

export type DemoResetMeta = { actorId: string | null; actorRole: string | null; client: string | null };

async function insertPlan(client: PoolClient, plan: DemoPlan): Promise<void> {
  for (const product of plan.products) {
    await client.query(
      `INSERT INTO products
         (id, seller_id, name, description, category, price, stock, published, featured, sample, images, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)`,
      [
        product.id,
        product.sellerId,
        product.name,
        product.description,
        product.category,
        product.price,
        product.stock,
        product.published,
        product.featured,
        product.sample,
        JSON.stringify(product.images),
        product.createdAt,
        product.updatedAt,
      ],
    );
  }
  for (const { order, request } of plan.orders) {
    await client.query(
      `INSERT INTO orders (id, buyer_id, seller_id, status, payment, total, channel_id, created_at, updated_at,
                           original_total, offer_id, offer_amount, offer_note, offer_state, courier, awb, eta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        order.id,
        order.buyerId,
        order.sellerId,
        order.status,
        order.payment,
        order.total,
        order.channelId,
        order.createdAt,
        order.updatedAt ?? order.createdAt,
        order.originalTotal ?? null,
        order.offer?.id ?? null,
        order.offer?.amount ?? null,
        order.offer?.note ?? null,
        order.offer?.state ?? null,
        order.shipment?.courier ?? null,
        order.shipment?.awb ?? null,
        order.shipment?.eta ?? null,
      ],
    );
    for (const item of order.items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, seller_id, name, image, quantity, price)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [order.id, item.productId, item.sellerId, item.name, item.image, item.quantity, item.price],
      );
    }
    if (request) await insertRequest(client, request);
  }
}

/**
 * Restore the shared demo to its canonical state, atomically.
 *
 * Scope: the three demo accounts and everything attached to them — the demo seller's
 * products, every order where a demo account is buyer or seller (with items and support
 * cases), and carts holding demo products or belonging to demo accounts. Other accounts
 * are never deleted. Sessions are kept so people stay signed in.
 */
export function applyDemoReset(
  plan: DemoPlan,
  users: DemoUserIds,
  passwordHash: string | null,
  meta: DemoResetMeta,
): Promise<{ epoch: string }> {
  return tx(async (client) => {
    const locked = await client.query("SELECT pg_try_advisory_xact_lock($1) AS ok", [RESET_LOCK_KEY]);
    if (!locked.rows[0].ok) throw new HttpError(409, "RESET_IN_PROGRESS", "A demo reset is already running.");
    await client.query("SET LOCAL lock_timeout = '10s'");
    const startedAt = new Date().toISOString();

    // 1. Demo accounts first (same lock order as checkout: user rows, then tables).
    for (const party of DEMO_PARTIES) {
      const spec = DEMO_ACCOUNTS[party];
      const existing = await client.query("SELECT id FROM users WHERE email = $1 FOR UPDATE", [spec.email]);
      if (existing.rows[0]) {
        await client.query(
          `UPDATE users SET name = $2, role = $3, sample = TRUE, language = $4,
                  password_hash = COALESCE($5, password_hash)
            WHERE id = $1`,
          [existing.rows[0].id, spec.name, spec.role, spec.language, passwordHash],
        );
        users[party] = existing.rows[0].id;
      } else {
        if (!passwordHash) throw new HttpError(503, "DEMO_PASSWORD_MISSING", "Set SHOPBRIDGE_DEMO_PASSWORD to recreate demo accounts.");
        await client.query(
          `INSERT INTO users (id, name, email, password_hash, role, sample, language, created_at)
           VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7)`,
          [users[party], spec.name, spec.email, passwordHash, spec.role, spec.language, startedAt],
        );
      }
    }
    const ids = DEMO_PARTIES.map((party) => users[party]);

    // 2. Block concurrent writers on demo tables until we commit (reads still work).
    await client.query("LOCK TABLE products, cart_items, orders, order_items, requests IN EXCLUSIVE MODE");

    // 3. Remove demo-scoped records only.
    const orderIds = (
      await client.query("SELECT id FROM orders WHERE buyer_id = ANY($1::text[]) OR seller_id = ANY($1::text[])", [ids])
    ).rows.map((row) => row.id as string);
    await client.query(
      `DELETE FROM requests
        WHERE order_id = ANY($1::text[])
           OR (order_id IS NULL AND (member_id = ANY($2::text[]) OR volunteer_id = ANY($2::text[]) OR coordinator_id = ANY($2::text[])))`,
      [orderIds, ids],
    );
    await client.query("DELETE FROM order_items WHERE order_id = ANY($1::text[])", [orderIds]);
    await client.query("DELETE FROM orders WHERE id = ANY($1::text[])", [orderIds]);
    await client.query(
      `DELETE FROM cart_items
        WHERE user_id = ANY($1::text[]) OR product_id IN (SELECT id FROM products WHERE seller_id = ANY($1::text[]))`,
      [ids],
    );
    await client.query("DELETE FROM products WHERE seller_id = ANY($1::text[])", [ids]);

    // 4. Canonical data.
    await insertPlan(client, plan);

    // 5. Epoch (clients refresh when it changes) and audit trail.
    const epoch = new Date().toISOString();
    await client.query(
      `INSERT INTO demo_state (key, value, updated_at) VALUES ('epoch', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [epoch],
    );
    await client.query(
      `INSERT INTO demo_resets (actor_id, actor_role, client, started_at, finished_at, outcome, detail)
       VALUES ($1, $2, $3, $4, now(), 'success', $5)`,
      [meta.actorId, meta.actorRole, meta.client, startedAt, `orders=${plan.orders.length} products=${plan.products.length}`],
    );
    return { epoch };
  }).catch((error) => {
    if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "55P03") {
      throw new HttpError(409, "RESET_BUSY", "The demo is busy. Try the reset again in a moment.");
    }
    throw error;
  });
}

/** Audit a failed reset attempt (separate transaction, best effort). */
export async function recordDemoResetFailure(meta: DemoResetMeta, detail: string): Promise<void> {
  try {
    await withClient((client) =>
      client.query(
        `INSERT INTO demo_resets (actor_id, actor_role, client, started_at, finished_at, outcome, detail)
         VALUES ($1, $2, $3, now(), now(), 'failed', $4)`,
        [meta.actorId, meta.actorRole, meta.client, detail.slice(0, 500)],
      ),
    );
  } catch {
    /* auditing must never mask the original error */
  }
}

/** Destructive full wipe + canonical data. Local/dev only; refused in production. */
export async function reseedDemo(): Promise<{ backup: string | null }> {
  if (process.env.NODE_ENV === "production") {
    throw new HttpError(403, "FORBIDDEN", "Reseed is disabled against PostgreSQL in production.");
  }
  const { buildDemoPlan } = await import("./demo-seed");
  const users: DemoUserIds = { buyer: demoId("m"), seller: demoId("v"), support: demoId("c") };
  const passwordHash = await hashPassword(demoPassword());
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [RESET_LOCK_KEY]);
    await client.query("TRUNCATE cart_items, order_items, requests, orders, products, sessions, users");
  });
  const { attachChannels } = await import("./demo-seed");
  const plan = attachChannels(buildDemoPlan(users), (orderId) => `order${orderId}`);
  await applyDemoReset(plan, users, passwordHash, { actorId: null, actorRole: "seed", client: null });
  return { backup: null };
}

// ---------------------------------------------------------------------------
// Seller price offers (validated here; the buyer cannot set a price)
// ---------------------------------------------------------------------------

export function makeOffer(seller: UserRecord, orderId: string, amount: number, note: string): Promise<OrderView> {
  return tx(async (client) => {
    const order = await findOrder(client, orderId, true);
    if (!order || seller.role !== "volunteer" || order.sellerId !== seller.id) {
      throw new HttpError(404, "NOT_FOUND", "That order does not exist.");
    }
    if (order.status !== "placed" && order.status !== "packed") {
      throw new HttpError(409, "BAD_STATUS", "Offers can only be made before the order ships.");
    }
    const base = order.originalTotal ?? order.total;
    if (!(amount > 0 && amount < base)) {
      throw new HttpError(422, "VALIDATION_ERROR", "An offer must be lower than the original price.");
    }
    const offer = { id: demoId("f"), amount: Math.round(amount), note: note || null, state: "open" as const };
    await client.query(
      `UPDATE orders SET offer_id = $2, offer_amount = $3, offer_note = $4, offer_state = 'open',
              original_total = COALESCE(original_total, total), updated_at = now()
        WHERE id = $1`,
      [order.id, offer.id, offer.amount, offer.note],
    );
    return (await orderViews(client, [{ ...order, offer, originalTotal: base }]))[0];
  });
}

export function respondToOffer(buyer: UserRecord, orderId: string, offerId: string, accept: boolean): Promise<OrderView> {
  return tx(async (client) => {
    const order = await findOrder(client, orderId, true);
    if (!order || order.buyerId !== buyer.id) throw new HttpError(404, "NOT_FOUND", "That order does not exist.");
    if (!order.offer || order.offer.id !== offerId || order.offer.state !== "open") {
      throw new HttpError(409, "OFFER_CLOSED", "This offer is no longer open.");
    }
    const state = accept ? ("accepted" as const) : ("declined" as const);
    const total = accept ? order.offer.amount : order.total;
    await client.query("UPDATE orders SET offer_state = $2, total = $3, updated_at = now() WHERE id = $1", [
      order.id,
      state,
      total,
    ]);
    return (await orderViews(client, [{ ...order, total, offer: { ...order.offer, state } }]))[0];
  });
}
