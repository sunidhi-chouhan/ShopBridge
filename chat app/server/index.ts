import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { loadEnvFile } from "./env";
import { HttpError } from "./errors";
import {
  NexconnError,
  createOrderRoom,
  issueAccessToken,
  joinGroupMembers,
  nexconnAppKey,
  nexconnConfigured,
  sendCustomMessage,
  sendSystemText,
} from "./nexconn";
import { cardContent } from "./cards";
import { formatInr } from "../shared/catalog";
import { MESSAGE_TYPES } from "../shared/types";
import { currentDemoEpoch, demoResetEnabled, resetDemoForUser, startDemoEpochWatch } from "./demo-reset";
import { clientKey } from "./auth";
import { draftReply, parseTranscript } from "./assist";
import { SESSION_MS, assertAuthRate, parseDemoParty, reseedAllowed } from "./auth";
import {
  advanceOrder,
  assertOrderRoomAccess,
  makeOffer,
  respondToOffer,
  canReadRequest,
  checkout,
  claimOrderSupport,
  clearSession,
  createOrderSupport,
  createProduct,
  deleteProduct,
  getCart,
  getOrder,
  getProduct,
  listCatalog,
  listConversations,
  listOrders,
  listRequests,
  listSellerProducts,
  orderParticipants,
  proposeResolution,
  registerBuyer,
  reseedDemo,
  requestRecord,
  respondToResolution,
  saveOrderChannel,
  setCartItem,
  setUserLanguage,
  signInDemo,
  signInWithPassword,
  persistenceBackend,
  storePaths,
  toSessionUser,
  updateProduct,
  userBySession,
} from "./store";
import { checkDatabaseReady, databaseUrlConfigured, withClient } from "./db/pool";
import { applyMigrations } from "./db/migrate";

loadEnvFile();
import {
  parseCategory,
  parseDescription,
  parseEmail,
  parseId,
  parseImages,
  parseLanguage,
  parseName,
  parseNote,
  parseOrderStatus,
  parsePassword,
  parsePrice,
  parseProductName,
  parsePublished,
  parseQuantity,
  parseResolution,
  parseResolutionNote,
  parseShortText,
  parseStock,
  requireObject,
} from "./validate";
import { CATEGORIES, type Category, type HelpRequestView, type OrderStatus, type PublicUser, type Resolution } from "../shared/types";

const port = Number(process.env.PORT || 8787);
const COOKIE = "shopbridge_session";
/** Cookie name used before the rename; still accepted so nobody is signed out by the upgrade. */
const LEGACY_COOKIE = "saathi_session";
const webRoot = path.resolve("dist/web");

const RESOLUTION_LABEL: Record<Resolution, string> = {
  replacement: "Replacement",
  refund: "Refund",
  return: "Return and refund",
  info: "Information shared",
};

function orderEventText(status: OrderStatus, actor: string): string {
  if (status === "packed") return `Update · Packed by ${actor}.`;
  if (status === "shipped") return "Update · Shipped. On its way to the buyer.";
  if (status === "delivered") return "Update · Delivered.";
  return `Update · Order status changed to ${status}.`;
}

function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "X-Demo-Epoch": currentDemoEpoch() ?? "",
    ...extraHeaders,
  });
  res.end(payload);
}

function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) {
    sendJson(res, error.status, { error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof NexconnError) {
    sendJson(res, 502, { error: { code: "NEXCONN_ERROR", message: error.message } });
    return;
  }
  sendJson(res, 500, { error: { code: "SERVER_ERROR", message: "Something went wrong. Try again." } });
}

/** True when Origin is same-site as this request (or missing). Allows Vite→API on loopback. */
function isTrustedDemoResetOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  let originHost: string;
  let originHostname: string;
  try {
    const url = new URL(origin);
    originHost = url.host;
    originHostname = url.hostname;
  } catch {
    return false;
  }
  const forwarded = req.headers["x-forwarded-host"];
  const hostHeader = (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined) || req.headers.host;
  if (!hostHeader) return false;
  if (originHost === hostHeader) return true;

  const hostHostname = hostHeader.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  const loopback = new Set(["localhost", "127.0.0.1", "::1"]);
  // Local only: browser talks to Vite (e.g. :5173) which proxies to the API (:8787).
  if (process.env.NODE_ENV !== "production" && loopback.has(originHostname) && loopback.has(hostHostname)) {
    return true;
  }

  const publicOrigin = process.env.SHOPBRIDGE_PUBLIC_ORIGIN?.trim();
  if (publicOrigin) {
    try {
      return new URL(publicOrigin).host === originHost;
    } catch {
      return false;
    }
  }
  return false;
}

function cookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function sessionCookie(token: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

function sendAuth(res: ServerResponse, status: number, session: PublicUser & { sessionToken: string }): void {
  const { sessionToken: token, ...user } = session;
  sendJson(res, status, { user }, { "Set-Cookie": sessionCookie(token, Math.floor(SESSION_MS / 1000)) });
}

async function readJson(req: IncomingMessage, limit = 16_384): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > limit) throw new HttpError(413, "BODY_TOO_LARGE", "Request body is too large.");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be JSON.");
  }
}

function sessionTokenFrom(req: IncomingMessage): string | undefined {
  const jar = cookies(req);
  return jar[COOKIE] ?? jar[LEGACY_COOKIE];
}

async function currentUser(req: IncomingMessage) {
  const token = sessionTokenFrom(req);
  if (!token) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const user = await userBySession(token);
  if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
  return user;
}

/** Order event from the ShopBridge system user. Best effort: a chat hiccup never fails the action. */
async function announce(channelId: string | null, text: string): Promise<boolean> {
  if (!channelId || !nexconnConfigured()) return false;
  try {
    await sendSystemText(channelId, text);
    return true;
  } catch (error) {
    console.warn(`Could not post order event to ${channelId}: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

async function openOrderNexconnRoom(orderId: string) {
  if (!nexconnConfigured()) {
    throw new HttpError(503, "NEXCONN_NOT_CONFIGURED", "Add the Nexconn App Key and App Secret to .env, then try again.");
  }
  const people = await orderParticipants(orderId);
  if (people.order.channelId) return saveOrderChannel(orderId, people.order.channelId);
  await issueAccessToken(people.buyer.id, people.buyer.name);
  await issueAccessToken(people.seller.id, people.seller.name);
  const channelId = await createOrderRoom({
    orderId: people.order.id,
    buyerId: people.buyer.id,
    sellerId: people.seller.id,
    productLabel: people.productLabel,
  });
  await announce(channelId, `Update · Order conversation opened for ${people.productLabel}.`);
  return saveOrderChannel(orderId, channelId);
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/api/health") {
    const nexconn = nexconnConfigured();
    if (databaseUrlConfigured()) {
      const db = await checkDatabaseReady();
      const body = {
        ok: db.ready,
        backend: "postgres" as const,
        nexconn,
        database: { ready: db.ready },
      };
      if (!db.ready) {
        sendJson(res, 503, {
          ...body,
          error: { code: "DATABASE_UNAVAILABLE", message: "Database is not ready." },
        });
        return;
      }
      sendJson(res, 200, body);
      return;
    }
    if (process.env.NODE_ENV === "production") {
      sendJson(res, 503, {
        ok: false,
        backend: "none",
        nexconn,
        error: {
          code: "DATABASE_REQUIRED",
          message: "DATABASE_URL is required in production.",
        },
      });
      return;
    }
    const paths = storePaths();
    const body = {
      ok: paths.storeExists,
      backend: "json" as const,
      nexconn,
      store: { dataDir: paths.dataDir, exists: paths.storeExists },
    };
    if (!paths.storeExists) {
      sendJson(res, 503, {
        ...body,
        error: {
          code: "STORE_MISSING",
          message: "Local store.json is missing.",
        },
      });
      return;
    }
    sendJson(res, 200, body);
    return;
  }

  if (req.method === "POST" && pathname === "/api/register") {
    assertAuthRate(req);
    const body = requireObject(await readJson(req));
    sendAuth(res, 201, await registerBuyer(parseName(body.name), parseEmail(body.email), parsePassword(body.password)));
    return;
  }

  if (req.method === "POST" && pathname === "/api/session") {
    assertAuthRate(req);
    const body = requireObject(await readJson(req));
    sendAuth(res, 200, await signInWithPassword(parseEmail(body.email), parsePassword(body.password)));
    return;
  }

  if (req.method === "POST" && pathname === "/api/demo") {
    assertAuthRate(req, "demo");
    const body = requireObject(await readJson(req));
    sendAuth(res, 200, await signInDemo(parseDemoParty(body.account)));
    return;
  }

  if (req.method === "POST" && pathname === "/api/logout") {
    const token = sessionTokenFrom(req);
    if (token) await clearSession(token);
    res.setHeader("Set-Cookie", [sessionCookie("", 0), `${LEGACY_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`]);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/me") {
    const user = await currentUser(req);
    sendJson(res, 200, { user: toSessionUser(user) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/dev/reseed") {
    if (!reseedAllowed()) {
      throw new HttpError(403, "FORBIDDEN", "Reseed is disabled in this environment.");
    }
    const result = await reseedDemo();
    sendJson(res, 200, { ok: true, backup: result.backup });
    return;
  }

  if (req.method === "GET" && pathname === "/api/requests") {
    const user = await currentUser(req);
    sendJson(res, 200, { requests: await listRequests(user) });
    return;
  }

  // Retired community-help endpoints from the earlier prototype. Order support replaces them.
  if (
    (req.method === "GET" && pathname === "/api/volunteers") ||
    (req.method === "POST" && pathname === "/api/requests") ||
    (req.method === "POST" && /^\/api\/requests\/[a-z0-9]+\/(assign|room|status)$/.test(pathname))
  ) {
    await currentUser(req);
    throw new HttpError(410, "GONE", "Community help has been retired. Use order support from an order conversation.");
  }

  if (req.method === "PATCH" && pathname === "/api/me/preferences") {
    const user = await currentUser(req);
    const body = requireObject(await readJson(req));
    sendJson(res, 200, { user: await setUserLanguage(user, parseLanguage(body.language)) });
    return;
  }

  if (req.method === "GET" && pathname === "/api/demo/status") {
    const user = await currentUser(req);
    sendJson(res, 200, {
      resetEnabled: demoResetEnabled(),
      canReset: demoResetEnabled() && user.sample,
      epoch: currentDemoEpoch(),
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/demo/reset") {
    // CSRF: a custom header cannot be sent cross-site without a CORS preflight (which this
    // server never grants), and the Origin, when present, must be this host (or the Vite
    // proxy front-end on loopback during local development).
    if (req.headers["x-shopbridge-intent"] !== "reset-demo") {
      throw new HttpError(403, "FORBIDDEN", "Missing reset confirmation header.");
    }
    if (!isTrustedDemoResetOrigin(req)) {
      throw new HttpError(403, "FORBIDDEN", "Cross-site reset requests are not allowed.");
    }
    const user = await currentUser(req);
    if (!demoResetEnabled()) throw new HttpError(404, "NOT_FOUND", "That page does not exist.");
    assertAuthRate(req, "reset");
    const body = requireObject(await readJson(req));
    if (body.confirm !== "RESET") {
      throw new HttpError(422, "VALIDATION_ERROR", "Confirm the reset to continue.");
    }
    const result = await resetDemoForUser(user, clientKey(req));
    sendJson(res, 200, { ok: true, ...result }, { "X-Demo-Epoch": result.epoch });
    return;
  }

  if (req.method === "POST" && pathname === "/api/chat/token") {
    const user = await currentUser(req);
    if (!nexconnConfigured()) {
      throw new HttpError(503, "NEXCONN_NOT_CONFIGURED", "Add the Nexconn App Key and App Secret to .env, then reload.");
    }
    const token = await issueAccessToken(user.id, user.name);
    sendJson(res, 200, { appKey: nexconnAppKey(), token, userId: user.id });
    return;
  }

  if (req.method === "GET" && pathname === "/api/products") {
    await currentUser(req);
    const q = url.searchParams.get("q")?.trim() || undefined;
    const categoryRaw = url.searchParams.get("category");
    const category = categoryRaw && CATEGORIES.includes(categoryRaw as Category) ? (categoryRaw as Category) : undefined;
    const minRaw = url.searchParams.get("min");
    const maxRaw = url.searchParams.get("max");
    const min = minRaw ? Number(minRaw) : undefined;
    const max = maxRaw ? Number(maxRaw) : undefined;
    const available = url.searchParams.get("available") === "1";
    const sortRaw = url.searchParams.get("sort");
    const sort =
      sortRaw === "price-asc" || sortRaw === "price-desc" || sortRaw === "newest" || sortRaw === "relevance"
        ? sortRaw
        : "relevance";
    sendJson(res, 200, {
      products: await listCatalog({
        q,
        category,
        min: min !== undefined && Number.isFinite(min) ? min : undefined,
        max: max !== undefined && Number.isFinite(max) ? max : undefined,
        available,
        sort,
      }),
    });
    return;
  }

  const productMatch = pathname.match(/^\/api\/products\/([a-z0-9]+)$/);
  if (req.method === "GET" && productMatch) {
    const user = await currentUser(req);
    sendJson(res, 200, { product: await getProduct(parseId(productMatch[1]), user) });
    return;
  }

  if (req.method === "GET" && pathname === "/api/cart") {
    const user = await currentUser(req);
    if (user.role !== "member") throw new HttpError(403, "FORBIDDEN", "Only a buyer can use the cart.");
    sendJson(res, 200, { cart: await getCart(user) });
    return;
  }

  if (req.method === "PUT" && pathname === "/api/cart") {
    const user = await currentUser(req);
    if (user.role !== "member") throw new HttpError(403, "FORBIDDEN", "Only a buyer can use the cart.");
    const body = requireObject(await readJson(req));
    const productId = parseId(typeof body.productId === "string" ? body.productId : "");
    sendJson(res, 200, { cart: await setCartItem(user, productId, parseQuantity(body.quantity)) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/checkout") {
    const user = await currentUser(req);
    if (user.role !== "member") throw new HttpError(403, "FORBIDDEN", "Only a buyer can check out.");
    const orders = await checkout(user);
    const linked = [];
    for (const order of orders) {
      if (!nexconnConfigured()) {
        linked.push(order);
        continue;
      }
      try {
        linked.push(await openOrderNexconnRoom(order.id));
      } catch {
        linked.push(order);
      }
    }
    sendJson(res, 201, {
      orders: linked,
      nexconn: nexconnConfigured(),
      roomsReady: linked.every((order) => Boolean(order.channelId)),
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/orders") {
    const user = await currentUser(req);
    sendJson(res, 200, { orders: await listOrders(user) });
    return;
  }

  if (req.method === "GET" && pathname === "/api/conversations") {
    const user = await currentUser(req);
    sendJson(res, 200, { conversations: await listConversations(user) });
    return;
  }

  const orderMatch = pathname.match(/^\/api\/orders\/([a-z0-9]+)$/);
  if (req.method === "GET" && orderMatch) {
    const user = await currentUser(req);
    sendJson(res, 200, { order: await getOrder(user, parseId(orderMatch[1])) });
    return;
  }

  const orderRoomMatch = pathname.match(/^\/api\/orders\/([a-z0-9]+)\/room$/);
  if (req.method === "POST" && orderRoomMatch) {
    const user = await currentUser(req);
    const orderId = parseId(orderRoomMatch[1]);
    await assertOrderRoomAccess(user, orderId);
    const order = await openOrderNexconnRoom(orderId);
    sendJson(res, 200, { order, nexconn: true });
    return;
  }

  const orderSupportMatch = pathname.match(/^\/api\/orders\/([a-z0-9]+)\/support$/);
  if (req.method === "POST" && orderSupportMatch) {
    const user = await currentUser(req);
    if (user.role !== "member") throw new HttpError(403, "FORBIDDEN", "Only a buyer can request order support.");
    const orderId = parseId(orderSupportMatch[1]);
    const body = requireObject(await readJson(req));
    const note = parseNote(body.note);
    let order = await getOrder(user, orderId);
    if (!order.channelId) {
      order = await openOrderNexconnRoom(orderId);
    }
    const request = await createOrderSupport(user, order.id, note);
    await announce(order.channelId, "Update · Support requested for this order.");
    sendJson(res, 201, { request, order });
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/api\/requests\/([a-z0-9]+)\/claim$/)) {
    const claimMatch = pathname.match(/^\/api\/requests\/([a-z0-9]+)\/claim$/);
    const user = await currentUser(req);
    if (user.role !== "coordinator") {
      throw new HttpError(403, "FORBIDDEN", "Only a support agent can claim order support.");
    }
    const requestId = parseId(claimMatch![1]);
    const claimed = await claimOrderSupport(user, requestId);
    if (!nexconnConfigured()) {
      sendJson(res, 200, { request: claimed.view, nexconn: false });
      return;
    }
    await issueAccessToken(user.id, user.name);
    await joinGroupMembers(claimed.channelId, [user.id]);
    await announce(claimed.channelId, `Update · Support joined. ${user.name} is on this order with the buyer and seller.`);
    sendJson(res, 200, { request: claimed.view, nexconn: true });
    return;
  }

  const orderStatusMatch = pathname.match(/^\/api\/orders\/([a-z0-9]+)\/status$/);
  if (req.method === "POST" && orderStatusMatch) {
    const user = await currentUser(req);
    if (user.role !== "volunteer") throw new HttpError(403, "FORBIDDEN", "Only the seller can update an order.");
    const body = requireObject(await readJson(req));
    const status = parseOrderStatus(body.status);
    const shipment =
      status === "shipped" && typeof body.courier === "string" && body.courier.trim() && typeof body.awb === "string" && body.awb.trim()
        ? {
            courier: parseShortText(body.courier, "courier"),
            awb: parseShortText(body.awb, "tracking number"),
            eta: typeof body.eta === "string" && body.eta.trim() ? parseShortText(body.eta, "delivery estimate") : null,
          }
        : null;
    const orderId = parseId(orderStatusMatch[1]);
    const { order } = await advanceOrder(user, orderId, status, shipment);
    await announce(order.channelId, orderEventText(order.status, user.name));
    if (shipment && order.channelId && nexconnConfigured()) {
      const participants = await orderParticipants(orderId);
      await sendCustomMessage(user.id, order.channelId, MESSAGE_TYPES.track, cardContent("track", participants.order)).catch(
        () => undefined,
      );
    }
    sendJson(res, 200, { order });
    return;
  }

  const offerMatch = pathname.match(/^\/api\/orders\/([a-z0-9]+)\/offers$/);
  if (req.method === "POST" && offerMatch) {
    const user = await currentUser(req);
    if (user.role !== "volunteer") throw new HttpError(403, "FORBIDDEN", "Only the seller can make an offer.");
    const body = requireObject(await readJson(req));
    const amount = parsePrice(body.amount);
    const note = parseResolutionNote(body.note);
    const orderId = parseId(offerMatch[1]);
    const order = await makeOffer(user, orderId, amount, note);
    if (order.channelId && nexconnConfigured()) {
      const participants = await orderParticipants(orderId);
      await sendCustomMessage(user.id, order.channelId, MESSAGE_TYPES.offer, cardContent("offer", participants.order));
    }
    sendJson(res, 201, { order });
    return;
  }

  const offerReplyMatch = pathname.match(/^\/api\/orders\/([a-z0-9]+)\/offers\/([a-z0-9]+)$/);
  if (req.method === "POST" && offerReplyMatch) {
    const user = await currentUser(req);
    if (user.role !== "member") throw new HttpError(403, "FORBIDDEN", "Only the buyer can answer an offer.");
    const body = requireObject(await readJson(req));
    if (typeof body.accept !== "boolean") throw new HttpError(422, "VALIDATION_ERROR", "Accept or decline the offer.");
    const order = await respondToOffer(user, parseId(offerReplyMatch[1]), parseId(offerReplyMatch[2]), body.accept);
    await announce(
      order.channelId,
      body.accept
        ? `Update · Offer accepted. Order total updated to ${formatInr(order.total)}.`
        : "Update · The buyer declined the offer.",
    );
    sendJson(res, 200, { order });
    return;
  }

  const resolutionMatch = pathname.match(/^\/api\/requests\/([a-z0-9]+)\/resolution$/);
  if (req.method === "POST" && resolutionMatch) {
    const user = await currentUser(req);
    if (user.role !== "coordinator") throw new HttpError(403, "FORBIDDEN", "Only a support agent can propose a resolution.");
    const body = requireObject(await readJson(req));
    const resolution = parseResolution(body.resolution);
    const note = parseResolutionNote(body.note);
    const request = await proposeResolution(user, parseId(resolutionMatch[1]), resolution, note);
    await announce(
      request.channelId,
      `Update · Resolution proposed: ${RESOLUTION_LABEL[resolution]}.${note ? ` ${note}` : ""}`,
    );
    sendJson(res, 200, { request });
    return;
  }

  const assistMatch = pathname.match(/^\/api\/requests\/([a-z0-9]+)\/assist$/);
  if (req.method === "POST" && assistMatch) {
    const user = await currentUser(req);
    if (user.role !== "coordinator") throw new HttpError(403, "FORBIDDEN", "Only a support agent can draft replies.");
    assertAuthRate(req, "assist");
    const record = await requestRecord(parseId(assistMatch[1]));
    if (!record || !record.orderId || record.coordinatorId !== user.id) {
      throw new HttpError(404, "NOT_FOUND", "That support case does not exist.");
    }
    if (record.status === "completed") throw new HttpError(409, "BAD_STATUS", "This case is already resolved.");
    const body = requireObject(await readJson(req, 64_000));
    const transcript = parseTranscript(body.transcript);
    const language = body.language === undefined ? user.language ?? "en" : parseLanguage(body.language);
    const order = await getOrder(user, record.orderId);
    const support = (await listRequests(user)).find((item) => item.id === record.id)!;
    sendJson(res, 200, await draftReply({ order, support, transcript, language }));
    return;
  }

  const responseMatch = pathname.match(/^\/api\/requests\/([a-z0-9]+)\/response$/);
  if (req.method === "POST" && responseMatch) {
    const user = await currentUser(req);
    if (user.role !== "member") throw new HttpError(403, "FORBIDDEN", "Only the buyer can answer a proposal.");
    const body = requireObject(await readJson(req));
    if (typeof body.accept !== "boolean") throw new HttpError(422, "VALIDATION_ERROR", "Accept or decline the proposal.");
    const request = await respondToResolution(user, parseId(responseMatch[1]), body.accept);
    await announce(
      request.channelId,
      body.accept
        ? "Update · Resolved. The buyer confirmed the resolution."
        : "Update · The buyer declined the proposal. Support will follow up.",
    );
    sendJson(res, 200, { request });
    return;
  }

  if (req.method === "GET" && pathname === "/api/seller/products") {
    const user = await currentUser(req);
    if (user.role !== "volunteer") throw new HttpError(403, "FORBIDDEN", "Only a seller can manage products.");
    sendJson(res, 200, { products: await listSellerProducts(user) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/seller/products") {
    const user = await currentUser(req);
    if (user.role !== "volunteer") throw new HttpError(403, "FORBIDDEN", "Only a seller can add products.");
    const body = requireObject(await readJson(req));
    const product = await createProduct(user, {
      name: parseProductName(body.name),
      description: parseDescription(body.description),
      category: parseCategory(body.category),
      price: parsePrice(body.price),
      stock: parseStock(body.stock),
      images: parseImages(body.images),
      published: body.published === undefined ? false : parsePublished(body.published),
    });
    sendJson(res, 201, { product });
    return;
  }

  const sellerProductMatch = pathname.match(/^\/api\/seller\/products\/([a-z0-9]+)$/);
  if (sellerProductMatch && (req.method === "PATCH" || req.method === "DELETE")) {
    const user = await currentUser(req);
    if (user.role !== "volunteer") throw new HttpError(403, "FORBIDDEN", "Only a seller can manage products.");
    const id = parseId(sellerProductMatch[1]);
    if (req.method === "DELETE") {
      await deleteProduct(user, id);
      sendJson(res, 200, { ok: true });
      return;
    }
    const body = requireObject(await readJson(req));
    const patch: Parameters<typeof updateProduct>[2] = {};
    if (body.name !== undefined) patch.name = parseProductName(body.name);
    if (body.description !== undefined) patch.description = parseDescription(body.description);
    if (body.category !== undefined) patch.category = parseCategory(body.category);
    if (body.price !== undefined) patch.price = parsePrice(body.price);
    if (body.stock !== undefined) patch.stock = parseStock(body.stock);
    if (body.images !== undefined) patch.images = parseImages(body.images);
    if (body.published !== undefined) patch.published = parsePublished(body.published);
    sendJson(res, 200, { product: await updateProduct(user, id, patch) });
    return;
  }

  const requestMatch = pathname.match(/^\/api\/requests\/([a-z0-9]+)$/);
  if (req.method === "GET" && requestMatch) {
    const user = await currentUser(req);
    const record = await requestRecord(parseId(requestMatch[1]));
    if (!record || !canReadRequest(user, record)) {
      throw new HttpError(404, "NOT_FOUND", "That request does not exist.");
    }
    const requests = await listRequests(user);
    const request: HelpRequestView | undefined = requests.find((item) => item.id === record.id);
    if (!request) throw new HttpError(404, "NOT_FOUND", "That request does not exist.");
    sendJson(res, 200, { request });
    return;
  }

  throw new HttpError(404, "NOT_FOUND", "That page does not exist.");
}

/**
 * Nexconn's web SDK talks to its own HTTPS/WSS endpoints and loads uploaded media from
 * its file CDN, so connect-src/img-src allow https:/wss: rather than a fixed host list.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https: wss:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

async function handleStatic(_req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const relative = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(webRoot, relative);
  if (!filePath.startsWith(webRoot)) {
    sendJson(res, 403, { error: { code: "FORBIDDEN", message: "Not allowed." } });
    return;
  }
  if (!(await fileExists(filePath))) {
    filePath = path.join(webRoot, "index.html");
  }
  if (!(await fileExists(filePath))) {
    sendJson(res, 404, { error: { code: "NOT_FOUND", message: "ShopBridge is not built yet. Run npm run build." } });
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, {
    "Content-Type": contentTypes[ext] ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    // Hashed build assets can be cached forever; the HTML shell must always revalidate.
    "Cache-Control": filePath.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
    ...(ext === ".html" ? { "Content-Security-Policy": CONTENT_SECURITY_POLICY } : {}),
  });
  const stream = createReadStream(filePath);
  stream.on("error", () => {
    if (!res.headersSent) {
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: "That file is missing." } });
    } else {
      res.end();
    }
  });
  stream.pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const task = url.pathname.startsWith("/api/")
    ? handleApi(req, res, url)
    : handleStatic(req, res, url);
  task.catch((error: unknown) => {
    if (!res.headersSent) sendError(res, error);
    else res.end();
  });
});

/** Schema check at boot: additive migrations can run automatically when explicitly enabled. */
async function prepareDatabase(): Promise<void> {
  if (process.env.SHOPBRIDGE_AUTO_MIGRATE === "1") {
    const result = await applyMigrations();
    if (result.applied.length) console.log(`Applied migrations: ${result.applied.join(", ")}`);
    return;
  }
  const missing = await withClient(async (client) => {
    const res = await client.query("SELECT id FROM schema_migrations");
    const applied = new Set(res.rows.map((row) => row.id as string));
    return ["001_init.sql", "002_lifecycle_language_demo.sql", "003_offers_shipment.sql"].filter((id) => !applied.has(id));
  });
  if (missing.length) {
    console.error(`WARNING: database migrations not applied: ${missing.join(", ")}. Run npm run db:migrate.`);
  }
}

function start(): void {
  loadEnvFile();
  if (process.env.NODE_ENV === "production" && !databaseUrlConfigured()) {
    console.error("FATAL: DATABASE_URL is required when NODE_ENV=production.");
    process.exit(1);
  }
  let backend: string;
  try {
    backend = persistenceBackend();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  if (backend === "postgres") {
    prepareDatabase()
      .catch((error: unknown) => {
        console.error("Database preparation failed:", error instanceof Error ? error.message : error);
      })
      .finally(startDemoEpochWatch);
  } else {
    startDemoEpochWatch();
  }
  server.listen(port, () => {
    console.log(`ShopBridge server listening on port ${port}`);
    console.log(`Persistence backend: ${backend}`);
    if (backend === "json") {
      const paths = storePaths();
      console.log(`Data directory: ${paths.dataDir}`);
      console.log(`Store file: ${paths.storeFile}${paths.storeExists ? "" : " (missing)"}`);
      console.log("JSON store is single-process only. Prefer PostgreSQL (DATABASE_URL) for hosted demos.");
    } else {
      console.log("PostgreSQL via DATABASE_URL (Neon-compatible pool).");
    }
  });
}

start();
