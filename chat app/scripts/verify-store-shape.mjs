#!/usr/bin/env node
/**
 * Print demo-store shape for verification without exposing secrets.
 * Usage: node scripts/verify-store-shape.mjs [path/to/store.json]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const storePath = resolve(process.argv[2] || "data/store.json");
const db = JSON.parse(readFileSync(storePath, "utf8"));

const DEMO = new Set([
  "buyer@shopbridge.demo",
  "seller@shopbridge.demo",
  "support@shopbridge.demo",
]);

const users = (db.users || []).map((u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  sample: Boolean(u.sample),
  sessionCount: Array.isArray(u.sessions) ? u.sessions.length : 0,
  // intentionally omit passwordHash and session tokens
}));

const products = (db.products || []).map((p) => ({
  id: p.id,
  name: p.name,
  published: p.published,
  stock: p.stock,
  sellerId: p.sellerId,
}));

const orders = (db.orders || []).map((o) => ({
  id: o.id,
  status: o.status,
  buyerId: o.buyerId,
  sellerId: o.sellerId,
  channelId: o.channelId,
  itemCount: Array.isArray(o.items) ? o.items.length : 0,
  total: o.total,
}));

const requests = (db.requests || []).map((r) => ({
  id: r.id,
  status: r.status,
  orderId: r.orderId,
  channelId: r.channelId,
  memberId: r.memberId,
  volunteerId: r.volunteerId,
  coordinatorId: r.coordinatorId,
}));

const demoUsers = users.filter((u) => DEMO.has(u.email));
const summary = {
  storePath,
  counts: {
    users: users.length,
    demoUsers: demoUsers.length,
    products: products.length,
    orders: orders.length,
    requests: requests.length,
    cartKeys: Object.keys(db.carts || {}).length,
  },
  demoEmailsPresent: [...DEMO].map((email) => ({
    email,
    present: demoUsers.some((u) => u.email === email),
  })),
  users,
  products,
  orders,
  requests,
  expectations: {
    demoUsers: demoUsers.length === 3,
    products: products.length === 8,
    orders: orders.length >= 1,
    orderChannels: orders.every((o) => !o.channelId || String(o.channelId).startsWith("order")),
  },
};

console.log(JSON.stringify(summary, null, 2));

const ok =
  summary.expectations.demoUsers &&
  summary.expectations.products &&
  summary.expectations.orders &&
  summary.expectations.orderChannels;

if (!ok) {
  console.error("\nShape check did not meet demo expectations (see expectations).");
  process.exit(1);
}
console.error("\nShape check OK (no secrets printed).");
