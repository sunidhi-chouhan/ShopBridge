import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { imagesForProductName, isAllowedProductImage, PRODUCT_IMAGES, type CatalogSort } from "../shared/catalog";
import type {
  CartView,
  Category,
  ConversationView,
  HelpKind,
  HelpRequestView,
  OrderView,
  ProductView,
  PublicUser,
  RequestStatus,
} from "../shared/types";
import { DEMO_ACCOUNTS, SESSION_MS, demoPassword, hashPassword, verifyPassword, type DemoParty } from "./auth";
import { loadEnvFile } from "./env";
import { HttpError } from "./errors";
import type {
  Database,
  OrderRecord,
  ProductRecord,
  RequestRecord,
  UserRecord,
} from "./store-types";

export type { UserRecord, RequestRecord, OrderRecord, ProductRecord } from "./store-types";

/** Resolved data directory. Default `data/` for local; Render uses e.g. `/var/data`. */
export function dataDirectory(): string {
  loadEnvFile();
  const raw = process.env.SHOPBRIDGE_DATA_DIR?.trim();
  if (raw) return path.resolve(raw);
  return path.resolve("data");
}

function storeFilePath(): string {
  return path.join(dataDirectory(), "store.json");
}

/** Backups stay under the data dir (never under dist/web). */
function backupDirectory(): string {
  return path.join(dataDirectory(), "backups");
}

export function storePaths(): { dataDir: string; storeFile: string; backupDir: string; storeExists: boolean } {
  const dataDir = dataDirectory();
  const storeFile = storeFilePath();
  return {
    dataDir,
    storeFile,
    backupDir: backupDirectory(),
    storeExists: existsSync(storeFile),
  };
}

/** Production must never auto-create or replace a store (protects persistent disk). */
function allowAutoCreateStore(): boolean {
  return process.env.NODE_ENV !== "production";
}

function idFor(prefix: string): string {
  return `${prefix}${randomBytes(6).toString("hex")}`;
}

function sessionToken(): string {
  return randomBytes(24).toString("hex");
}

function seedProducts(seller: UserRecord, now: string): ProductRecord[] {
  const img = (name: string) => imagesForProductName(name) ?? [PRODUCT_IMAGES[0].src];
  const sellerId = seller.id;
  const rows: Array<Omit<ProductRecord, "id" | "createdAt" | "updatedAt" | "sample">> = [
    {
      sellerId,
      name: "Maheshwari cotton sari",
      description: "Handwoven cotton with a narrow zari border. Drapes light, made for everyday wear in warm weather.",
      category: "textile",
      price: 4800,
      stock: 6,
      published: true,
      featured: true,
      images: img("Maheshwari cotton sari"),
    },
    {
      sellerId,
      name: "Cane and hide tote",
      description: "Woven cane body with a vegetable-tanned hide collar and short handles. Unlined, meant to soften with use.",
      category: "leather",
      price: 3700,
      stock: 4,
      published: true,
      featured: false,
      images: img("Cane and hide tote"),
    },
    {
      sellerId,
      name: "Stoneware serving bowl",
      description: "Wheel-thrown bowl in a sand glaze. Holds a family dal or a pile of fruit. Dishwasher safe.",
      category: "tableware",
      price: 1850,
      stock: 9,
      published: true,
      featured: false,
      images: img("Stoneware serving bowl"),
    },
    {
      sellerId,
      name: "Hammered brass jhumkas",
      description: "Bell earrings in unlacquered brass. Light enough for all-day wear. Wipe with a dry cloth.",
      category: "jewelry",
      price: 2200,
      stock: 11,
      published: true,
      featured: false,
      images: img("Hammered brass jhumkas"),
    },
    {
      sellerId,
      name: "Chandan attar, 10 ml",
      description: "Sandalwood distilled in Kannauj and bottled in Indore. Alcohol-free. A drop on cloth lasts the evening.",
      category: "fragrance",
      price: 1650,
      stock: 14,
      published: true,
      featured: false,
      images: img("Chandan attar, 10 ml"),
    },
    {
      sellerId,
      name: "Block-print kantha throw",
      description: "Cotton throw with running kantha stitch and a faded indigo print. 150 by 220 cm.",
      category: "home",
      price: 3200,
      stock: 5,
      published: true,
      featured: false,
      images: img("Block-print kantha throw"),
    },
    {
      sellerId,
      name: "Vegetable-tanned belt",
      description: "Thirty-millimetre strap with a plain brass buckle. Cut from a single hide. Choose your hole; it will mark with wear.",
      category: "leather",
      price: 1450,
      stock: 8,
      published: true,
      featured: false,
      images: img("Vegetable-tanned belt"),
    },
    {
      sellerId,
      name: "Narmada clay cup, set of two",
      description: "Unglazed sipping cups. The clay keeps water cool. Not for the dishwasher.",
      category: "tableware",
      price: 780,
      stock: 0,
      published: true,
      featured: false,
      images: img("Narmada clay cup, set of two"),
    },
  ];
  const origin = Date.parse(now);
  return rows.map((row, index) => {
    const createdAt = new Date(origin - (rows.length - 1 - index) * 36e5).toISOString();
    return {
      ...row,
      id: idFor("p"),
      sample: true,
      createdAt,
      updatedAt: createdAt,
    };
  });
}

function isAuthDatabase(value: unknown): value is Database {
  if (!value || typeof value !== "object") return false;
  const db = value as Database;
  if (!Array.isArray(db.users) || !Array.isArray(db.requests)) return false;
  return (
    db.users.length > 0 &&
    db.users.every(
      (user) =>
        typeof user?.email === "string" &&
        typeof user?.passwordHash === "string" &&
        (user.sessionToken === null || typeof user.sessionToken === "string"),
    )
  );
}

function sessionExpiry(): string {
  return new Date(Date.now() + SESSION_MS).toISOString();
}

async function buildDemoDatabase(): Promise<Database> {
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(demoPassword());
  const buyer: UserRecord = {
    id: idFor("m"),
    ...DEMO_ACCOUNTS.buyer,
    passwordHash,
    sample: true,
    sessionToken: null,
    sessionExpiresAt: null,
    sessions: [],
    createdAt: now,
  };
  const seller: UserRecord = {
    id: idFor("v"),
    ...DEMO_ACCOUNTS.seller,
    passwordHash,
    sample: true,
    sessionToken: null,
    sessionExpiresAt: null,
    sessions: [],
    createdAt: now,
  };
  const support: UserRecord = {
    id: idFor("c"),
    ...DEMO_ACCOUNTS.support,
    passwordHash,
    sample: true,
    sessionToken: null,
    sessionExpiresAt: null,
    sessions: [],
    createdAt: now,
  };
  return {
    users: [buyer, seller, support],
    requests: [],
    products: seedProducts(seller, now),
    orders: [],
    carts: {},
  };
}

async function backupStore(): Promise<string | null> {
  try {
    const filePath = storeFilePath();
    const backupDir = backupDirectory();
    await mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(backupDir, `store-${stamp}.json`);
    await copyFile(filePath, dest);
    return dest;
  } catch {
    return null;
  }
}

export async function reseedDemo(): Promise<{ backup: string | null }> {
  const backup = await backupStore();
  const db = await buildDemoDatabase();
  await writeDb(db);
  return { backup };
}

function remapCatalogImages(db: Database): void {
  const samples = db.products.filter((product) => product.sample);
  const sharedStamp = samples.length > 1 && new Set(samples.map((product) => product.createdAt)).size === 1;
  if (sharedStamp) {
    const origin = Date.parse(samples[0].createdAt);
    samples.forEach((product, index) => {
      const createdAt = new Date(origin - (samples.length - 1 - index) * 36e5).toISOString();
      product.createdAt = createdAt;
      product.updatedAt = createdAt;
    });
  }
  for (const product of db.products) {
    const mapped = imagesForProductName(product.name);
    if (product.sample) {
      if (mapped) product.images = mapped;
      continue;
    }
    const allowed = (product.images ?? []).filter((src) => isAllowedProductImage(src));
    if (mapped && (!allowed[0] || !mapped.includes(allowed[0]))) {
      product.images = mapped;
    } else {
      product.images = allowed;
    }
  }
}

function ensureSessions(user: UserRecord): void {
  if (!Array.isArray(user.sessions)) user.sessions = [];
  if (user.sessionToken && user.sessionExpiresAt) {
    const exists = user.sessions.some((session) => session.token === user.sessionToken);
    if (!exists) {
      user.sessions.push({ token: user.sessionToken, expiresAt: user.sessionExpiresAt });
    }
  }
  const now = Date.now();
  user.sessions = user.sessions.filter((session) => Date.parse(session.expiresAt) > now);
  const latest = user.sessions[user.sessions.length - 1];
  user.sessionToken = latest?.token ?? null;
  user.sessionExpiresAt = latest?.expiresAt ?? null;
}

function withCatalog(db: Database): Database {
  if (!Array.isArray(db.products)) db.products = [];
  if (!Array.isArray(db.orders)) db.orders = [];
  if (!db.carts || typeof db.carts !== "object") db.carts = {};
  for (const user of db.users) ensureSessions(user);
  for (const request of db.requests) {
    if (request.orderId === undefined) request.orderId = null;
  }
  for (const order of db.orders) {
    if (order.channelId === undefined) order.channelId = null;
  }
  if (db.products.length === 0) {
    const seller = db.users.find((user) => user.role === "volunteer");
    if (seller) db.products = seedProducts(seller, new Date().toISOString());
  }
  remapCatalogImages(db);
  return db;
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code: string }).code === "ENOENT");
}

async function parseStoreFile(): Promise<Database> {
  const filePath = storeFilePath();
  const raw = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(
      503,
      "STORE_CORRUPT",
      `Store JSON at ${filePath} is not valid JSON. Restore a backup; refusing to overwrite.`,
    );
  }
  if (!isAuthDatabase(parsed)) {
    if (!allowAutoCreateStore()) {
      throw new HttpError(
        503,
        "STORE_INVALID",
        `Store at ${filePath} has an unexpected shape. Restore a backup; refusing to overwrite in production.`,
      );
    }
    await backupStore();
    const db = await buildDemoDatabase();
    await writeDb(db);
    return db;
  }
  return withCatalog(parsed);
}

async function createDemoStoreIfAllowed(): Promise<Database> {
  const filePath = storeFilePath();
  if (!allowAutoCreateStore()) {
    throw new HttpError(
      503,
      "STORE_MISSING",
      `No store file at ${filePath}. Mount persistent storage with an existing store.json, or provision data once via a controlled seed. Refusing to auto-create in production.`,
    );
  }
  await mkdir(dataDirectory(), { recursive: true });
  const db = await buildDemoDatabase();
  await writeDb(db);
  return db;
}

async function readDb(): Promise<Database> {
  try {
    return await parseStoreFile();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (isEnoent(error)) {
      return createDemoStoreIfAllowed();
    }
    // Brief retry: a concurrent writer may have been mid-rename.
    await new Promise((resolve) => setTimeout(resolve, 40));
    try {
      return await parseStoreFile();
    } catch (retryError) {
      if (retryError instanceof HttpError) throw retryError;
      if (isEnoent(retryError)) {
        return createDemoStoreIfAllowed();
      }
      throw new HttpError(503, "STORE_UNAVAILABLE", "Could not read the data store. Try again.");
    }
  }
}

async function writeDb(db: Database): Promise<void> {
  const filePath = storeFilePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  const payload = JSON.stringify(db, null, 2);
  const tempPath = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tempPath, payload);
  await rename(tempPath, filePath);
}

let queue: Promise<unknown> = Promise.resolve();

function update<T>(fn: (db: Database) => { db: Database; result: T }): Promise<T> {
  const run = queue.then(async () => {
    const current = await readDb();
    const { db, result } = fn(current);
    await writeDb(db);
    return result;
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return { id: user.id, name: user.name, role: user.role, sample: user.sample };
}

export function toSessionUser(user: UserRecord): PublicUser {
  return { ...toPublicUser(user), email: user.email };
}

function attachSession(user: UserRecord): PublicUser & { sessionToken: string } {
  ensureSessions(user);
  const token = sessionToken();
  const expiresAt = sessionExpiry();
  user.sessions.push({ token, expiresAt });
  // Keep several live sessions so a second tab/demo login does not kick this browser out.
  user.sessions = user.sessions.slice(-8);
  user.sessionToken = token;
  user.sessionExpiresAt = expiresAt;
  return { ...toSessionUser(user), sessionToken: token };
}

function viewOf(db: Database, request: RequestRecord): HelpRequestView {
  const member = db.users.find((user) => user.id === request.memberId);
  const volunteer = db.users.find((user) => user.id === request.volunteerId);
  const coordinator = db.users.find((user) => user.id === request.coordinatorId);
  if (!member) {
    throw new HttpError(500, "STORE_ERROR", "The member on this request is missing.");
  }
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
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

function visibleTo(user: UserRecord, request: RequestRecord): boolean {
  if (user.role === "coordinator") return true;
  if (user.role === "member") return request.memberId === user.id;
  return request.volunteerId === user.id;
}

export async function registerBuyer(
  name: string,
  email: string,
  password: string,
): Promise<PublicUser & { sessionToken: string }> {
  const passwordHash = await hashPassword(password);
  return update((db) => {
    if (db.users.some((user) => user.email === email)) {
      throw new HttpError(409, "EMAIL_TAKEN", "That email already has an account.");
    }
    const now = new Date().toISOString();
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
      createdAt: now,
    };
    db.users.push(user);
    return { db, result: attachSession(user) };
  });
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
  const snapshot = await readDb();
  const match = snapshot.users.find((user) => user.email === email);
  if (!match) return rejectCredentials(password);
  if (!(await verifyPassword(password, match.passwordHash))) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Email or password is wrong.");
  }
  return update((db) => {
    const user = db.users.find((item) => item.id === match.id);
    if (!user) throw new HttpError(401, "INVALID_CREDENTIALS", "Email or password is wrong.");
    return { db, result: attachSession(user) };
  });
}

export function signInDemo(party: DemoParty): Promise<PublicUser & { sessionToken: string }> {
  const spec = DEMO_ACCOUNTS[party];
  return update((db) => {
    const user = db.users.find((item) => item.email === spec.email && item.sample);
    if (!user) {
      throw new HttpError(503, "DEMO_MISSING", "Demo accounts are missing. Run npm run seed.");
    }
    return { db, result: attachSession(user) };
  });
}

export function clearSession(token: string): Promise<void> {
  return update((db) => {
    for (const user of db.users) {
      ensureSessions(user);
      const before = user.sessions.length;
      user.sessions = user.sessions.filter((session) => session.token !== token);
      if (user.sessions.length !== before || user.sessionToken === token) {
        const latest = user.sessions[user.sessions.length - 1];
        user.sessionToken = latest?.token ?? null;
        user.sessionExpiresAt = latest?.expiresAt ?? null;
      }
    }
    return { db, result: undefined };
  });
}

export async function userBySession(token: string): Promise<UserRecord | null> {
  const db = await readDb();
  for (const user of db.users) {
    ensureSessions(user);
    const session = user.sessions.find((item) => item.token === token);
    if (!session) continue;
    if (Date.parse(session.expiresAt) <= Date.now()) return null;
    return user;
  }
  return null;
}

export function listVolunteers(): Promise<PublicUser[]> {
  return update((db) => ({
    db,
    result: db.users.filter((user) => user.role === "volunteer").map(toPublicUser),
  }));
}

export function listRequests(user: UserRecord): Promise<HelpRequestView[]> {
  return update((db) => ({
    db,
    result: db.requests
      .filter((request) => visibleTo(user, request))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((request) => viewOf(db, request)),
  }));
}

export function createRequest(member: UserRecord, kind: HelpKind, note: string): Promise<HelpRequestView> {
  return update((db) => {
    const open = db.requests.some(
      (request) => request.memberId === member.id && request.status !== "completed" && !request.orderId,
    );
    if (open) {
      throw new HttpError(409, "REQUEST_OPEN", "Finish the current request before starting another.");
    }
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
    db.requests.push(request);
    return { db, result: viewOf(db, request) };
  });
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
  return update((db) => {
    const request = db.requests.find((item) => item.id === requestId);
    const volunteer = db.users.find((user) => user.id === volunteerId);
    const member = db.users.find((user) => user.id === request?.memberId);
    if (!request || !member) {
      throw new HttpError(404, "NOT_FOUND", "That request does not exist.");
    }
    if (request.status !== "requested" || request.channelId) {
      throw new HttpError(409, "ALREADY_ASSIGNED", "This request already has a volunteer.");
    }
    if (!volunteer || volunteer.role !== "volunteer") {
      throw new HttpError(422, "VALIDATION_ERROR", "Choose a volunteer.");
    }
    if (volunteer.id === member.id) {
      throw new HttpError(422, "VALIDATION_ERROR", "The member cannot be their own volunteer.");
    }
    return {
      db,
      result: { request, member, volunteer, coordinator },
    };
  });
}

export function saveAssignment(
  requestId: string,
  volunteerId: string,
  coordinatorId: string,
  channelId: string | null,
): Promise<HelpRequestView> {
  return update((db) => {
    const request = db.requests.find((item) => item.id === requestId);
    if (!request) throw new HttpError(404, "NOT_FOUND", "That request does not exist.");
    if (request.status !== "requested") {
      throw new HttpError(409, "ALREADY_ASSIGNED", "This request already has a volunteer.");
    }
    request.volunteerId = volunteerId;
    request.coordinatorId = coordinatorId;
    request.channelId = channelId;
    request.status = "assigned";
    request.updatedAt = new Date().toISOString();
    return { db, result: viewOf(db, request) };
  });
}

export function prepareRoom(coordinator: UserRecord, requestId: string): Promise<RoomParticipants> {
  return update((db) => {
    const request = db.requests.find((item) => item.id === requestId);
    const member = db.users.find((user) => user.id === request?.memberId);
    const volunteer = db.users.find((user) => user.id === request?.volunteerId);
    if (!request || !member || !volunteer) {
      throw new HttpError(404, "NOT_FOUND", "Assign a volunteer before opening the room.");
    }
    if (request.coordinatorId && request.coordinatorId !== coordinator.id) {
      throw new HttpError(403, "FORBIDDEN", "Another coordinator is already on this request.");
    }
    return { db, result: { request, member, volunteer, coordinator } };
  });
}

export function saveChannel(requestId: string, channelId: string): Promise<HelpRequestView> {
  return update((db) => {
    const request = db.requests.find((item) => item.id === requestId);
    if (!request) throw new HttpError(404, "NOT_FOUND", "That request does not exist.");
    request.channelId = channelId;
    request.updatedAt = new Date().toISOString();
    return { db, result: viewOf(db, request) };
  });
}

export function changeStatus(
  actor: UserRecord,
  requestId: string,
  status: Extract<RequestStatus, "in_progress" | "completed">,
): Promise<{ view: HelpRequestView; previous: RequestStatus }> {
  return update((db) => {
    const request = db.requests.find((item) => item.id === requestId);
    if (!request) throw new HttpError(404, "NOT_FOUND", "That request does not exist.");
    const allowed =
      actor.role === "coordinator" ||
      (actor.role === "volunteer" && actor.id === request.volunteerId);
    if (!allowed) {
      throw new HttpError(403, "FORBIDDEN", "Only the assigned volunteer or a coordinator can update status.");
    }
    const expected = status === "in_progress" ? "assigned" : "in_progress";
    if (request.status !== expected) {
      throw new HttpError(409, "BAD_STATUS", "Update the request one step at a time.");
    }
    const previous = request.status;
    request.status = status;
    request.updatedAt = new Date().toISOString();
    return { db, result: { view: viewOf(db, request), previous } };
  });
}

export async function requestRecord(requestId: string): Promise<RequestRecord | null> {
  const db = await readDb();
  return db.requests.find((item) => item.id === requestId) ?? null;
}

export function canReadRequest(user: UserRecord, request: RequestRecord): boolean {
  return visibleTo(user, request);
}

function productView(db: Database, product: ProductRecord): ProductView {
  const seller = db.users.find((user) => user.id === product.sellerId);
  if (!seller) {
    throw new HttpError(500, "STORE_ERROR", "The seller on this product is missing.");
  }
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
    images: product.images,
    seller: toPublicUser(seller),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

function orderView(db: Database, order: OrderRecord): OrderView {
  const buyer = db.users.find((user) => user.id === order.buyerId);
  const seller = db.users.find((user) => user.id === order.sellerId);
  if (!buyer || !seller) {
    throw new HttpError(500, "STORE_ERROR", "A person on this order is missing.");
  }
  return {
    id: order.id,
    status: order.status,
    payment: "simulated",
    buyer: toPublicUser(buyer),
    seller: toPublicUser(seller),
    items: order.items.map((item) => {
      const itemSeller = db.users.find((user) => user.id === item.sellerId) ?? seller;
      return {
        productId: item.productId,
        name: item.name,
        image: item.image,
        quantity: item.quantity,
        price: item.price,
        lineTotal: item.price * item.quantity,
        seller: toPublicUser(itemSeller),
      };
    }),
    total: order.total,
    channelId: order.channelId,
    createdAt: order.createdAt,
  };
}

function cartView(db: Database, userId: string): CartView {
  const rows = db.carts[userId] ?? [];
  const items = [];
  for (const row of rows) {
    const product = db.products.find((item) => item.id === row.productId);
    if (!product || !product.published) continue;
    const view = productView(db, product);
    items.push({ product: view, quantity: row.quantity, lineTotal: view.price * row.quantity });
  }
  return { items, subtotal: items.reduce((sum, item) => sum + item.lineTotal, 0) };
}

export type ProductQuery = {
  q?: string;
  category?: Category;
  min?: number;
  max?: number;
  available?: boolean;
  sort?: CatalogSort;
};

export function listCatalog(query: ProductQuery): Promise<ProductView[]> {
  return update((db) => {
    const needle = query.q?.trim().toLowerCase() ?? "";
    let rows = db.products.filter((product) => product.published);
    if (query.category) rows = rows.filter((product) => product.category === query.category);
    if (query.min !== undefined) rows = rows.filter((product) => product.price >= query.min!);
    if (query.max !== undefined) rows = rows.filter((product) => product.price <= query.max!);
    if (query.available) rows = rows.filter((product) => product.stock > 0);
    if (needle) {
      rows = rows.filter((product) => {
        const seller = db.users.find((user) => user.id === product.sellerId);
        const hay = `${product.name} ${product.description} ${product.category} ${seller?.name ?? ""}`.toLowerCase();
        return hay.includes(needle);
      });
    }
    if (query.sort === "price-asc") rows.sort((a, b) => a.price - b.price);
    else if (query.sort === "price-desc") rows.sort((a, b) => b.price - a.price);
    else if (query.sort === "newest") rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    else {
      rows.sort((a, b) => {
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        return a.createdAt < b.createdAt ? 1 : -1;
      });
    }
    return { db, result: rows.map((product) => productView(db, product)) };
  });
}

export function getProduct(id: string, actor: UserRecord | null): Promise<ProductView> {
  return update((db) => {
    const product = db.products.find((item) => item.id === id);
    if (!product) throw new HttpError(404, "NOT_FOUND", "That product does not exist.");
    const owner = actor?.role === "volunteer" && actor.id === product.sellerId;
    if (!product.published && !owner) {
      throw new HttpError(404, "NOT_FOUND", "That product does not exist.");
    }
    return { db, result: productView(db, product) };
  });
}

export function listSellerProducts(seller: UserRecord): Promise<ProductView[]> {
  return update((db) => ({
    db,
    result: db.products
      .filter((product) => product.sellerId === seller.id)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map((product) => productView(db, product)),
  }));
}

export function createProduct(
  seller: UserRecord,
  input: {
    name: string;
    description: string;
    category: Category;
    price: number;
    stock: number;
    images: string[];
    published: boolean;
  },
): Promise<ProductView> {
  if (seller.role !== "volunteer") {
    throw new HttpError(403, "FORBIDDEN", "Only a seller can add products.");
  }
  return update((db) => {
    const now = new Date().toISOString();
    const product: ProductRecord = {
      id: idFor("p"),
      sellerId: seller.id,
      name: input.name,
      description: input.description,
      category: input.category,
      price: input.price,
      stock: input.stock,
      published: input.published,
      featured: false,
      sample: false,
      images: input.images,
      createdAt: now,
      updatedAt: now,
    };
    db.products.push(product);
    return { db, result: productView(db, product) };
  });
}

export function updateProduct(
  seller: UserRecord,
  id: string,
  input: Partial<{
    name: string;
    description: string;
    category: Category;
    price: number;
    stock: number;
    images: string[];
    published: boolean;
  }>,
): Promise<ProductView> {
  return update((db) => {
    const product = db.products.find((item) => item.id === id);
    if (!product || product.sellerId !== seller.id) {
      throw new HttpError(404, "NOT_FOUND", "That product does not exist.");
    }
    if (input.name !== undefined) product.name = input.name;
    if (input.description !== undefined) product.description = input.description;
    if (input.category !== undefined) product.category = input.category;
    if (input.price !== undefined) product.price = input.price;
    if (input.stock !== undefined) product.stock = input.stock;
    if (input.images !== undefined) product.images = input.images;
    if (input.published !== undefined) product.published = input.published;
    product.updatedAt = new Date().toISOString();
    return { db, result: productView(db, product) };
  });
}

export function deleteProduct(seller: UserRecord, id: string): Promise<void> {
  return update((db) => {
    const index = db.products.findIndex((item) => item.id === id && item.sellerId === seller.id);
    if (index === -1) throw new HttpError(404, "NOT_FOUND", "That product does not exist.");
    const productId = db.products[index].id;
    db.products.splice(index, 1);
    for (const userId of Object.keys(db.carts)) {
      db.carts[userId] = db.carts[userId].filter((item) => item.productId !== productId);
    }
    return { db, result: undefined };
  });
}

export function getCart(buyer: UserRecord): Promise<CartView> {
  return update((db) => ({ db, result: cartView(db, buyer.id) }));
}

export function setCartItem(buyer: UserRecord, productId: string, quantity: number): Promise<CartView> {
  if (buyer.role !== "member") {
    throw new HttpError(403, "FORBIDDEN", "Only a buyer can use the cart.");
  }
  return update((db) => {
    const product = db.products.find((item) => item.id === productId);
    if (!product || !product.published) {
      throw new HttpError(404, "NOT_FOUND", "That product does not exist.");
    }
    if (product.sellerId === buyer.id) {
      throw new HttpError(422, "VALIDATION_ERROR", "You cannot buy your own listing.");
    }
    const cart = db.carts[buyer.id] ?? [];
    const existing = cart.find((item) => item.productId === productId);
    if (quantity === 0) {
      db.carts[buyer.id] = cart.filter((item) => item.productId !== productId);
      return { db, result: cartView(db, buyer.id) };
    }
    if (product.stock < quantity) {
      throw new HttpError(409, "OUT_OF_STOCK", `Only ${product.stock} left of ${product.name}.`);
    }
    if (existing) existing.quantity = quantity;
    else cart.push({ productId, quantity });
    db.carts[buyer.id] = cart;
    return { db, result: cartView(db, buyer.id) };
  });
}

export function checkout(buyer: UserRecord): Promise<OrderView[]> {
  if (buyer.role !== "member") {
    throw new HttpError(403, "FORBIDDEN", "Only a buyer can check out.");
  }
  return update((db) => {
    const cart = cartView(db, buyer.id);
    if (cart.items.length === 0) {
      throw new HttpError(422, "CART_EMPTY", "Your bag is empty.");
    }
    for (const item of cart.items) {
      const product = db.products.find((row) => row.id === item.product.id);
      if (!product || !product.published) {
        throw new HttpError(409, "UNAVAILABLE", `${item.product.name} is no longer available.`);
      }
      if (product.stock < item.quantity) {
        throw new HttpError(409, "OUT_OF_STOCK", `Only ${product.stock} left of ${product.name}.`);
      }
    }
    const now = new Date().toISOString();
    const groups = new Map<string, typeof cart.items>();
    for (const item of cart.items) {
      const sellerId = item.product.seller.id;
      const list = groups.get(sellerId) ?? [];
      list.push(item);
      groups.set(sellerId, list);
    }
    const created: OrderRecord[] = [];
    for (const [sellerId, items] of groups) {
      for (const item of items) {
        const product = db.products.find((row) => row.id === item.product.id);
        if (product) product.stock -= item.quantity;
      }
      const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
      const order: OrderRecord = {
        id: idFor("o"),
        buyerId: buyer.id,
        sellerId,
        status: "placed",
        payment: "simulated",
        items: items.map((item) => ({
          productId: item.product.id,
          sellerId,
          name: item.product.name,
          image: item.product.images[0] ?? "",
          quantity: item.quantity,
          price: item.product.price,
        })),
        total,
        channelId: null,
        createdAt: now,
      };
      db.orders.push(order);
      created.push(order);
    }
    db.carts[buyer.id] = [];
    return { db, result: created.map((order) => orderView(db, order)) };
  });
}

export function listOrders(user: UserRecord): Promise<OrderView[]> {
  return update((db) => {
    const rows = db.orders.filter((order) => {
      if (user.role === "member") return order.buyerId === user.id;
      if (user.role === "volunteer") return order.sellerId === user.id;
      return false;
    });
    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { db, result: rows.map((order) => orderView(db, order)) };
  });
}

function canAccessOrder(db: Database, user: UserRecord, order: OrderRecord): boolean {
  if (user.role === "member" && order.buyerId === user.id) return true;
  if (user.role === "volunteer" && order.sellerId === user.id) return true;
  if (user.role === "coordinator") {
    return db.requests.some(
      (request) =>
        request.orderId === order.id &&
        (request.coordinatorId === user.id ||
          (request.status === "requested" && request.coordinatorId === null)),
    );
  }
  return false;
}

export function getOrder(user: UserRecord, id: string): Promise<OrderView> {
  return update((db) => {
    const order = db.orders.find((item) => item.id === id);
    if (!order) throw new HttpError(404, "NOT_FOUND", "That order does not exist.");
    if (!canAccessOrder(db, user, order)) throw new HttpError(404, "NOT_FOUND", "That order does not exist.");
    return { db, result: orderView(db, order) };
  });
}

export function saveOrderChannel(orderId: string, channelId: string): Promise<OrderView> {
  return update((db) => {
    const order = db.orders.find((item) => item.id === orderId);
    if (!order) throw new HttpError(404, "NOT_FOUND", "That order does not exist.");
    order.channelId = channelId;
    return { db, result: orderView(db, order) };
  });
}

export async function orderParticipants(orderId: string): Promise<{
  order: OrderRecord;
  buyer: UserRecord;
  seller: UserRecord;
  productLabel: string;
}> {
  const db = await readDb();
  const order = db.orders.find((item) => item.id === orderId);
  if (!order) throw new HttpError(404, "NOT_FOUND", "That order does not exist.");
  const buyer = db.users.find((user) => user.id === order.buyerId);
  const seller = db.users.find((user) => user.id === order.sellerId);
  if (!buyer || !seller) throw new HttpError(500, "STORE_ERROR", "The parties on this order are missing.");
  const productLabel = order.items[0]?.name ?? order.id;
  return { order, buyer, seller, productLabel };
}

export function assertOrderRoomAccess(user: UserRecord, orderId: string): Promise<OrderView> {
  return getOrder(user, orderId);
}

export function listConversations(user: UserRecord): Promise<ConversationView[]> {
  return update((db) => {
    const rows = db.orders.filter((order) => {
      if (user.role === "member") return order.buyerId === user.id;
      if (user.role === "volunteer") return order.sellerId === user.id;
      if (user.role === "coordinator") {
        return db.requests.some(
          (request) => request.orderId === order.id && request.coordinatorId === user.id,
        );
      }
      return false;
    });
    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const result = rows.map((order) => {
      const buyer = db.users.find((item) => item.id === order.buyerId);
      const seller = db.users.find((item) => item.id === order.sellerId);
      if (!buyer || !seller) throw new HttpError(500, "STORE_ERROR", "The parties on this order are missing.");
      const counterpart = user.role === "member" ? seller : user.role === "volunteer" ? buyer : seller;
      const support = db.requests
        .filter((request) => request.orderId === order.id)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
      return {
        id: order.id,
        orderId: order.id,
        channelId: order.channelId,
        title: order.items[0]?.name ?? `Order ${order.id}`,
        total: order.total,
        status: order.status,
        counterpart: toPublicUser(counterpart),
        support: support ? viewOf(db, support) : null,
        createdAt: order.createdAt,
        updatedAt: support?.updatedAt ?? order.createdAt,
      } satisfies ConversationView;
    });
    return { db, result };
  });
}

export function createOrderSupport(buyer: UserRecord, orderId: string, note: string): Promise<HelpRequestView> {
  if (buyer.role !== "member") {
    throw new HttpError(403, "FORBIDDEN", "Only a buyer can request order support.");
  }
  return update((db) => {
    const order = db.orders.find((item) => item.id === orderId);
    if (!order || order.buyerId !== buyer.id) {
      throw new HttpError(404, "NOT_FOUND", "That order does not exist.");
    }
    if (!order.channelId) {
      throw new HttpError(409, "ROOM_MISSING", "Open the order conversation before requesting support.");
    }
    const open = db.requests.some(
      (request) => request.orderId === orderId && request.status !== "completed",
    );
    if (open) {
      throw new HttpError(409, "REQUEST_OPEN", "Support is already open for this order.");
    }
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
      createdAt: now,
      updatedAt: now,
    };
    db.requests.push(request);
    return { db, result: viewOf(db, request) };
  });
}

export function claimOrderSupport(
  coordinator: UserRecord,
  requestId: string,
): Promise<{ view: HelpRequestView; channelId: string; sellerId: string; buyerId: string }> {
  if (coordinator.role !== "coordinator") {
    throw new HttpError(403, "FORBIDDEN", "Only a support agent can claim order support.");
  }
  return update((db) => {
    const request = db.requests.find((item) => item.id === requestId);
    if (!request || !request.orderId) {
      throw new HttpError(404, "NOT_FOUND", "That support request does not exist.");
    }
    const order = db.orders.find((item) => item.id === request.orderId);
    if (!order || !order.channelId) {
      throw new HttpError(409, "ROOM_MISSING", "The order conversation is not ready.");
    }
    if (request.coordinatorId && request.coordinatorId !== coordinator.id) {
      throw new HttpError(409, "ALREADY_ASSIGNED", "Another support agent is already on this order.");
    }
    request.coordinatorId = coordinator.id;
    request.channelId = order.channelId;
    if (!request.volunteerId) request.volunteerId = order.sellerId;
    if (request.status === "requested") request.status = "assigned";
    request.updatedAt = new Date().toISOString();
    return {
      db,
      result: {
        view: viewOf(db, request),
        channelId: order.channelId,
        sellerId: order.sellerId,
        buyerId: order.buyerId,
      },
    };
  });
}
