/**
 * Import curated data/store.json into PostgreSQL.
 * Never modifies the source JSON. Never prints password hashes or tokens.
 *
 * Usage:
 *   npx tsx server/db/import-store.ts --dry-run
 *   npx tsx server/db/import-store.ts --apply
 *   npx tsx server/db/import-store.ts --apply --force   # allow replace when DB non-empty
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvFile } from "../env";
import type { Database } from "../store-types";
import { applyMigrations } from "./migrate";
import { closePool, getPool, withTransaction } from "./pool";
import { countRows, replaceDatabase } from "./snapshot";

loadEnvFile();

function args(): { dryRun: boolean; apply: boolean; force: boolean; file: string } {
  const argv = process.argv.slice(2);
  const fileIdx = argv.indexOf("--file");
  return {
    dryRun: argv.includes("--dry-run"),
    apply: argv.includes("--apply"),
    force: argv.includes("--force"),
    file: fileIdx >= 0 ? argv[fileIdx + 1] : path.resolve("data/store.json"),
  };
}

function assertShape(db: unknown): asserts db is Database {
  if (!db || typeof db !== "object") throw new Error("Store is not an object.");
  const row = db as Database;
  if (!Array.isArray(row.users) || !Array.isArray(row.products) || !Array.isArray(row.orders) || !Array.isArray(row.requests)) {
    throw new Error("Store missing users/products/orders/requests arrays.");
  }
  if (!row.carts || typeof row.carts !== "object") throw new Error("Store missing carts object.");
  for (const user of row.users) {
    if (!user.id || !user.email || !user.passwordHash || !user.role) {
      throw new Error("User record missing id/email/passwordHash/role.");
    }
  }
  const userIds = new Set(row.users.map((u) => u.id));
  for (const product of row.products) {
    if (!userIds.has(product.sellerId)) throw new Error(`Product ${product.id} references missing seller.`);
  }
  for (const order of row.orders) {
    if (!userIds.has(order.buyerId) || !userIds.has(order.sellerId)) {
      throw new Error(`Order ${order.id} references missing buyer/seller.`);
    }
    if (!Array.isArray(order.items)) throw new Error(`Order ${order.id} has no items.`);
  }
  for (const request of row.requests) {
    if (!userIds.has(request.memberId)) throw new Error(`Request ${request.id} references missing member.`);
    if (request.orderId && !row.orders.some((o) => o.id === request.orderId)) {
      throw new Error(`Request ${request.id} references missing order.`);
    }
  }
}

function safeSummary(db: Database) {
  return {
    users: db.users.map((u) => ({ id: u.id, email: u.email, role: u.role, sample: u.sample })),
    products: db.products.map((p) => ({ id: p.id, name: p.name, sellerId: p.sellerId, stock: p.stock })),
    orders: db.orders.map((o) => ({
      id: o.id,
      buyerId: o.buyerId,
      sellerId: o.sellerId,
      channelId: o.channelId,
      itemCount: o.items.length,
      total: o.total,
    })),
    requests: db.requests.map((r) => ({
      id: r.id,
      status: r.status,
      orderId: r.orderId,
      channelId: r.channelId,
    })),
    cartUsers: Object.keys(db.carts),
    counts: {
      users: db.users.length,
      products: db.products.length,
      orders: db.orders.length,
      requests: db.requests.length,
      cartKeys: Object.keys(db.carts).length,
    },
  };
}

async function main(): Promise<void> {
  const opts = args();
  if (!opts.dryRun && !opts.apply) {
    console.error("Specify --dry-run or --apply");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }

  const raw = await readFile(opts.file, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  assertShape(parsed);
  const summary = safeSummary(parsed);
  console.log(JSON.stringify({ mode: opts.dryRun ? "dry-run" : "apply", source: opts.file, summary }, null, 2));

  await applyMigrations();
  const pool = getPool();

  const before = await withTransaction(async (client) => countRows(client));
  console.log(JSON.stringify({ databaseBefore: before }, null, 2));

  const nonempty =
    before.users > 0 || before.products > 0 || before.orders > 0 || before.requests > 0;
  if (nonempty && !opts.force) {
    console.error("Database is not empty. Re-run with --force to replace, or use a fresh database.");
    await closePool();
    process.exit(1);
  }

  if (opts.dryRun) {
    console.log(JSON.stringify({ ok: true, dryRun: true, wouldImport: summary.counts }, null, 2));
    await closePool();
    return;
  }

  await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [742301]);
    await replaceDatabase(client, parsed);
  });

  const after = await withTransaction(async (client) => countRows(client));
  console.log(JSON.stringify({ ok: true, applied: true, databaseAfter: after }, null, 2));
  await closePool();
  // silence unused
  void pool;
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  try {
    await closePool();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
