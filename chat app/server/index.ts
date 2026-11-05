import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { loadEnvFile } from "./env";
import { HttpError } from "./errors";
import {
  NexconnError,
  createHelpRoom,
  createOrderRoom,
  issueAccessToken,
  joinGroupMembers,
  nexconnAppKey,
  nexconnConfigured,
  sendRoomText,
} from "./nexconn";
import { SESSION_MS, assertAuthRate, parseDemoParty, reseedAllowed } from "./auth";
import {
  assertOrderRoomAccess,
  canReadRequest,
  changeStatus,
  checkout,
  claimOrderSupport,
  clearSession,
  createOrderSupport,
  createProduct,
  createRequest,
  deleteProduct,
  getCart,
  getOrder,
  getProduct,
  listCatalog,
  listConversations,
  listOrders,
  listRequests,
  listSellerProducts,
  listVolunteers,
  orderParticipants,
  prepareAssignment,
  prepareRoom,
  registerBuyer,
  reseedDemo,
  requestRecord,
  saveAssignment,
  saveChannel,
  saveOrderChannel,
  setCartItem,
  signInDemo,
  signInWithPassword,
  storePaths,
  toSessionUser,
  updateProduct,
  userBySession,
  type RoomParticipants,
} from "./store";

loadEnvFile();
import {
  parseCategory,
  parseDescription,
  parseEmail,
  parseId,
  parseImages,
  parseKind,
  parseName,
  parseNote,
  parsePassword,
  parsePrice,
  parseProductName,
  parsePublished,
  parseQuantity,
  parseStatus,
  parseStock,
  requireObject,
} from "./validate";
import { CATEGORIES, type Category, type HelpKind, type HelpRequestView, type PublicUser } from "../shared/types";

const port = Number(process.env.PORT || 8787);
const COOKIE = "saathi_session";
const webRoot = path.resolve("dist/web");

function kindLabel(kind: HelpKind): string {
  if (kind === "groceries") return "groceries";
  if (kind === "transport") return "medical transport";
  return "a companion visit";
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

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > 16_384) throw new HttpError(413, "BODY_TOO_LARGE", "Request body is too large.");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be JSON.");
  }
}

async function currentUser(req: IncomingMessage) {
  const token = cookies(req)[COOKIE];
  if (!token) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const user = await userBySession(token);
  if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
  return user;
}

async function openNexconnRoom(people: RoomParticipants): Promise<string | null> {
  if (!nexconnConfigured()) return null;
  const channelId = people.request.channelId ?? `room${people.request.id}`;
  await issueAccessToken(people.member.id, people.member.name);
  await issueAccessToken(people.volunteer.id, people.volunteer.name);
  await issueAccessToken(people.coordinator.id, people.coordinator.name);
  if (!people.request.channelId) {
    await createHelpRoom({
      channelId,
      kind: people.request.kind,
      ownerId: people.coordinator.id,
      memberId: people.member.id,
      volunteerId: people.volunteer.id,
    });
  }
  return channelId;
}

async function announce(fromUserId: string, channelId: string | null, text: string): Promise<void> {
  if (!channelId || !nexconnConfigured()) return;
  await sendRoomText(fromUserId, channelId, text);
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
  await announce(
    people.buyer.id,
    channelId,
    `Update · Order conversation opened for ${people.productLabel}.`,
  );
  return saveOrderChannel(orderId, channelId);
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/api/health") {
    const paths = storePaths();
    const body = {
      ok: true as boolean,
      nexconn: nexconnConfigured(),
      store: { dataDir: paths.dataDir, exists: paths.storeExists },
    };
    // Production: fail health until a valid store file is present on the data dir.
    if (process.env.NODE_ENV === "production" && !paths.storeExists) {
      body.ok = false;
      sendJson(res, 503, {
        ...body,
        error: {
          code: "STORE_MISSING",
          message: "Persistent store.json is missing. Complete hosted demo initialization before traffic.",
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
    assertAuthRate(req);
    const body = requireObject(await readJson(req));
    sendAuth(res, 200, await signInDemo(parseDemoParty(body.account)));
    return;
  }

  if (req.method === "POST" && pathname === "/api/logout") {
    const token = cookies(req)[COOKIE];
    if (token) await clearSession(token);
    sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
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

  if (req.method === "GET" && pathname === "/api/volunteers") {
    const user = await currentUser(req);
    if (user.role !== "coordinator") {
      throw new HttpError(403, "FORBIDDEN", "Only a coordinator can view volunteers.");
    }
    sendJson(res, 200, { volunteers: await listVolunteers() });
    return;
  }

  if (req.method === "GET" && pathname === "/api/requests") {
    const user = await currentUser(req);
    sendJson(res, 200, { requests: await listRequests(user) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/requests") {
    const user = await currentUser(req);
    if (user.role !== "member") {
      throw new HttpError(403, "FORBIDDEN", "Only a community member can request help.");
    }
    const body = requireObject(await readJson(req));
    const request = await createRequest(user, parseKind(body.kind), parseNote(body.note));
    sendJson(res, 201, { request });
    return;
  }

  const assignMatch = pathname.match(/^\/api\/requests\/([a-z0-9]+)\/assign$/);
  if (req.method === "POST" && assignMatch) {
    const user = await currentUser(req);
    if (user.role !== "coordinator") {
      throw new HttpError(403, "FORBIDDEN", "Only a coordinator can assign a volunteer.");
    }
    const requestId = parseId(assignMatch[1]);
    const body = requireObject(await readJson(req));
    const volunteerId = typeof body.volunteerId === "string" ? body.volunteerId : "";
    const people = await prepareAssignment(user, requestId, volunteerId);
    const channelId = await openNexconnRoom(people);
    const request = await saveAssignment(requestId, people.volunteer.id, user.id, channelId);
    if (channelId) {
      await announce(
        user.id,
        channelId,
        `Update · Assigned. ${people.volunteer.name} will help ${people.member.name} with ${kindLabel(people.request.kind)}.`,
      );
    }
    sendJson(res, 200, { request, nexconn: Boolean(channelId) });
    return;
  }

  const roomMatch = pathname.match(/^\/api\/requests\/([a-z0-9]+)\/room$/);
  if (req.method === "POST" && roomMatch) {
    const user = await currentUser(req);
    if (user.role !== "coordinator") {
      throw new HttpError(403, "FORBIDDEN", "Only a coordinator can open the help room.");
    }
    const requestId = parseId(roomMatch[1]);
    const people = await prepareRoom(user, requestId);
    if (people.request.channelId) {
      const requests = await listRequests(user);
      const request = requests.find((item) => item.id === requestId);
      sendJson(res, 200, { request, nexconn: true });
      return;
    }
    if (!nexconnConfigured()) {
      throw new HttpError(503, "NEXCONN_NOT_CONFIGURED", "Add the Nexconn App Key and App Secret to .env, then try again.");
    }
    const channelId = await openNexconnRoom(people);
    if (!channelId) {
      throw new HttpError(503, "NEXCONN_NOT_CONFIGURED", "Add the Nexconn App Key and App Secret to .env, then try again.");
    }
    const request = await saveChannel(requestId, channelId);
    await announce(
      user.id,
      channelId,
      `Update · The help room is open for ${people.member.name} and ${people.volunteer.name}.`,
    );
    sendJson(res, 200, { request, nexconn: true });
    return;
  }

  const statusMatch = pathname.match(/^\/api\/requests\/([a-z0-9]+)\/status$/);
  if (req.method === "POST" && statusMatch) {
    const user = await currentUser(req);
    const requestId = parseId(statusMatch[1]);
    const body = requireObject(await readJson(req));
    const status = parseStatus(body.status);
    const { view } = await changeStatus(user, requestId, status);
    const text =
      status === "in_progress"
        ? `Update · In progress. ${user.name} is handling this request.`
        : `Update · Completed. ${user.name} marked this request done.`;
    await announce(user.id, view.channelId, text);
    sendJson(res, 200, { request: view, nexconn: Boolean(view.channelId) });
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
    if (order.channelId) {
      await announce(user.id, order.channelId, `Update · Support requested for this order.`);
    }
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
    await issueAccessToken(user.id, user.name);
    await joinGroupMembers(claimed.channelId, [user.id]);
    await announce(
      user.id,
      claimed.channelId,
      `Update · Support joined. ${user.name} is on this order with the buyer and seller.`,
    );
    sendJson(res, 200, { request: claimed.view, nexconn: true });
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

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
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
    sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Saathi is not built yet. Use npm run dev." } });
    return;
  }
  res.writeHead(200, {
    "Content-Type": contentTypes[path.extname(filePath)] ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
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

server.listen(port, () => {
  const paths = storePaths();
  console.log(`ShopBridge server listening on port ${port}`);
  console.log(`Data directory: ${paths.dataDir}`);
  console.log(`Store file: ${paths.storeFile}${paths.storeExists ? "" : " (missing)"}`);
  console.log(
    "Single-instance only: JSON store is not safe for multiple Node processes. Do not enable horizontal scaling.",
  );
});
