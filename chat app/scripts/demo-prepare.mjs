#!/usr/bin/env node
/**
 * Phase 4.1 — clean accidental audit clutter while keeping a believable demo store.
 * Always copies data/store.json to backups/phase41/ before mutating.
 *
 * Keeps:
 * - Demo buyer / seller / support accounts
 * - Catalogue products
 * - One showcase order with order-support (oebc83bbdc10d when present) OR none if missing
 *
 * Removes:
 * - Accidental "Other Buyer" audit account + their orders
 * - Phase audit community get-help requests with P37 markers
 * - Extra phase audit orders beyond the showcase set
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dataDir = process.env.SHOPBRIDGE_DATA_DIR?.trim()
  ? process.env.SHOPBRIDGE_DATA_DIR.trim()
  : join(root, "data");
const storePath = join(dataDir, "store.json");
const outDir = join(root, "backups/phase41");
mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = join(outDir, `store-before-demo-prepare-${stamp}.json`);
copyFileSync(storePath, backupPath);

const db = JSON.parse(readFileSync(storePath, "utf8"));
const DEMO_EMAILS = new Set([
  "buyer@shopbridge.demo",
  "seller@shopbridge.demo",
  "support@shopbridge.demo",
]);

const before = {
  users: db.users.length,
  orders: db.orders.length,
  requests: db.requests.length,
};

const demoUsers = db.users.filter((u) => DEMO_EMAILS.has(u.email));
if (demoUsers.length !== 3) {
  throw new Error(`Expected 3 demo accounts, found ${demoUsers.length}. Run npm run seed first.`);
}
const buyer = demoUsers.find((u) => u.email.startsWith("buyer@"));
const seller = demoUsers.find((u) => u.email.startsWith("seller@"));
const support = demoUsers.find((u) => u.email.startsWith("support@"));

// Prefer the Phase 3.9.3 multilingual showcase order when present.
const SHOWCASE = "oebc83bbdc10d";
const showcase = db.orders.find((o) => o.id === SHOWCASE && o.buyerId === buyer.id);
const keptOrders = showcase ? [showcase] : [];

// Keep only support tied to kept orders (order-specific), drop community P37 audit noise.
const keptOrderIds = new Set(keptOrders.map((o) => o.id));
const keptRequests = db.requests.filter(
  (r) => r.orderId && keptOrderIds.has(r.orderId) && !/P37-audit.*community/i.test(r.note || ""),
);

// Restore a small believable stock for the showcase product if depleted.
for (const product of db.products) {
  if (product.sellerId !== seller.id) continue;
  if (product.name.includes("Maheshwari") && (product.stock ?? 0) < 2) {
    product.stock = 3;
    product.published = true;
  }
  if (product.name.includes("Narmada") && (product.stock ?? 0) === 0) {
    // leave one out-of-stock sample for seller UX
  }
}

db.users = demoUsers;
db.orders = keptOrders;
db.requests = keptRequests;
db.carts = { [buyer.id]: [] };

writeFileSync(storePath, `${JSON.stringify(db, null, 2)}\n`);

const summary = {
  backupPath,
  before,
  after: {
    users: db.users.map((u) => ({ email: u.email, name: u.name, role: u.role })),
    orders: db.orders.map((o) => ({ id: o.id, channelId: o.channelId })),
    requests: db.requests.map((r) => ({ id: r.id, orderId: r.orderId, status: r.status, note: (r.note || "").slice(0, 60) })),
    productCount: db.products.length,
    supportId: support.id,
  },
  removedUsers: before.users - db.users.length,
  removedOrders: before.orders - db.orders.length,
  removedRequests: before.requests - db.requests.length,
};

writeFileSync(join(outDir, "demo-prepare-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
