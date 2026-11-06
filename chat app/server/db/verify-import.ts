/**
 * Compare curated JSON store to PostgreSQL using safe identifiers only.
 *
 * Usage: npx tsx server/db/verify-import.ts [--file data/store.json]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvFile } from "../env";
import type { Database } from "../store-types";
import { closePool, withClient } from "./pool";
import { loadDatabase } from "./snapshot";

loadEnvFile();

function fileArg(): string {
  const idx = process.argv.indexOf("--file");
  return idx >= 0 ? process.argv[idx + 1] : path.resolve("data/store.json");
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  const raw = JSON.parse(await readFile(fileArg(), "utf8")) as Database;
  const db = await withClient((client) => loadDatabase(client));

  const cmp = (label: string, a: string[], b: string[]) => {
    const as = [...a].sort();
    const bs = [...b].sort();
    const ok = as.length === bs.length && as.every((v, i) => v === bs[i]);
    return { label, ok, json: as.length, postgres: bs.length, missingInPg: as.filter((x) => !bs.includes(x)), extraInPg: bs.filter((x) => !as.includes(x)) };
  };

  const checks = [
    cmp(
      "users",
      raw.users.map((u) => `${u.id}|${u.email}|${u.role}`),
      db.users.map((u) => `${u.id}|${u.email}|${u.role}`),
    ),
    cmp(
      "products",
      raw.products.map((p) => `${p.id}|${p.sellerId}|${p.name}|${p.stock}`),
      db.products.map((p) => `${p.id}|${p.sellerId}|${p.name}|${p.stock}`),
    ),
    cmp(
      "orders",
      raw.orders.map((o) => `${o.id}|${o.buyerId}|${o.sellerId}|${o.channelId ?? ""}|${o.total}`),
      db.orders.map((o) => `${o.id}|${o.buyerId}|${o.sellerId}|${o.channelId ?? ""}|${o.total}`),
    ),
    cmp(
      "requests",
      raw.requests.map((r) => `${r.id}|${r.orderId ?? ""}|${r.channelId ?? ""}|${r.status}`),
      db.requests.map((r) => `${r.id}|${r.orderId ?? ""}|${r.channelId ?? ""}|${r.status}`),
    ),
  ];

  const hashMatch = raw.users.every((u) => {
    const other = db.users.find((x) => x.id === u.id);
    return other && other.passwordHash === u.passwordHash;
  });

  const report = {
    ok: checks.every((c) => c.ok) && hashMatch,
    passwordHashesPreserved: hashMatch,
    // do not print hashes
    checks,
  };
  console.log(JSON.stringify(report, null, 2));
  await closePool();
  process.exit(report.ok ? 0 : 1);
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
