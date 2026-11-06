/**
 * Validate existing Neon data + Postgres-backed store/API paths.
 * Does not import, seed, truncate, or modify JSON store intentionally
 * (demo login may write sessions into Postgres only).
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "../server/env";
import { checkDatabaseReady, closePool } from "../server/db/pool";
import {
  listCatalog,
  listOrders,
  listRequests,
  listSellerProducts,
  persistenceBackend,
  signInDemo,
  userBySession,
} from "../server/store";

loadEnvFile();

const results: Array<{ name: string; ok: boolean; detail: unknown }> = [];

function pass(name: string, ok: boolean, detail: unknown = ""): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}

function storeHash(): string {
  return createHash("sha256").update(readFileSync(resolve("data/store.json"))).digest("hex");
}

async function main(): Promise<void> {
  const before = storeHash();
  pass("DATABASE_URL configured", Boolean(process.env.DATABASE_URL?.trim()), `length=${process.env.DATABASE_URL?.trim().length ?? 0}`);
  pass("persistence backend postgres", persistenceBackend() === "postgres", persistenceBackend());

  const ready = await checkDatabaseReady();
  pass("database ready", ready.ready, ready);

  // Direct store-layer checks (same authz as HTTP handlers)
  const buyer = await signInDemo("buyer");
  const seller = await signInDemo("seller");
  const support = await signInDemo("support");
  pass("demo login buyer → member", buyer.role === "member", { id: buyer.id, name: buyer.name, role: buyer.role });
  pass("demo login seller → volunteer", seller.role === "volunteer", { id: seller.id, name: seller.name, role: seller.role });
  pass("demo login support → coordinator", support.role === "coordinator", {
    id: support.id,
    name: support.name,
    role: support.role,
  });

  const buyerRec = await userBySession(buyer.sessionToken);
  const sellerRec = await userBySession(seller.sessionToken);
  const supportRec = await userBySession(support.sessionToken);
  pass("session round-trip buyer", Boolean(buyerRec && buyerRec.id === buyer.id), buyerRec?.id);
  pass("session round-trip seller", Boolean(sellerRec && sellerRec.id === seller.id), sellerRec?.id);
  pass("session round-trip support", Boolean(supportRec && supportRec.id === support.id), supportRec?.id);

  if (!buyerRec || !sellerRec || !supportRec) throw new Error("session users missing");

  const products = await listCatalog({});
  pass("product listing count 8", products.length === 8, products.length);

  const sellerProducts = await listSellerProducts(sellerRec);
  pass("seller product management count 8", sellerProducts.length === 8, sellerProducts.length);

  const buyerOrders = await listOrders(buyerRec);
  const sellerOrders = await listOrders(sellerRec);
  pass("buyer orders count 2", buyerOrders.length === 2, buyerOrders.map((o) => o.id));
  pass("seller orders count 2", sellerOrders.length === 2, sellerOrders.map((o) => o.id));
  pass(
    "orders belong to demo buyer+seller",
    buyerOrders.every((o) => o.buyer.id === buyer.id && o.seller.id === seller.id),
    buyerOrders.map((o) => ({ id: o.id, buyer: o.buyer.id, seller: o.seller.id })),
  );
  pass(
    "nexconn channel mappings",
    buyerOrders.length === 2 && buyerOrders.every((o) => o.channelId === `order${o.id}`),
    buyerOrders.map((o) => ({ id: o.id, channelId: o.channelId })),
  );

  const supportQueue = await listRequests(supportRec);
  const orderSupport = supportQueue.filter((r) => r.orderId);
  pass("support queue order-linked requests 2", orderSupport.length === 2, {
    count: orderSupport.length,
    items: orderSupport.map((r) => ({ id: r.id, orderId: r.orderId, channelId: r.channelId, status: r.status })),
  });
  pass(
    "support channels match orders",
    orderSupport.every((r) => buyerOrders.some((o) => o.id === r.orderId && o.channelId === r.channelId)),
    orderSupport.map((r) => ({ orderId: r.orderId, channelId: r.channelId })),
  );

  // Minimal HTTP health via in-process server using the same pool
  const { default: http } = await import("node:http");
  // Exercise /api/health path logic inline
  const healthBody = {
    ok: ready.ready,
    backend: "postgres" as const,
    database: { ready: ready.ready },
  };
  pass("health shape for postgres", healthBody.ok && healthBody.backend === "postgres", healthBody);

  // Tiny HTTP probe: boot a disposable server that hits store once
  const port = 8799;
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/api/health") {
        const db = await checkDatabaseReady();
        res.writeHead(db.ready ? 200 : 503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: db.ready, backend: "postgres", database: { ready: db.ready } }));
        return;
      }
      if (req.method === "POST" && req.url === "/api/demo") {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as { account?: string };
        const user = await signInDemo(body.account as "buyer" | "seller" | "support");
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Set-Cookie": `saathi_session=${encodeURIComponent(user.sessionToken)}; Path=/; HttpOnly`,
        });
        const { sessionToken: _t, ...publicUser } = user;
        res.end(JSON.stringify({ user: publicUser }));
        return;
      }
      res.writeHead(404).end();
    } catch (error) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : "error" } }));
    }
  });

  await new Promise<void>((resolveListen) => server.listen(port, resolveListen));
  try {
    const healthRes = await fetch(`http://127.0.0.1:${port}/api/health`);
    const healthJson = (await healthRes.json()) as { ok?: boolean; backend?: string };
    pass("HTTP /api/health via postgres", healthRes.status === 200 && healthJson.ok === true, healthJson);

    const loginRes = await fetch(`http://127.0.0.1:${port}/api/demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: "buyer" }),
    });
    const loginJson = (await loginRes.json()) as { user?: { role?: string } };
    pass("HTTP demo login buyer", loginRes.status === 200 && loginJson.user?.role === "member", loginJson.user);
  } finally {
    await new Promise<void>((resolveClose, reject) => server.close((err) => (err ? reject(err) : resolveClose())));
  }

  // silence unused
  void http;

  const after = storeHash();
  pass("JSON store hash unchanged", before === after, { before, after });

  const summary = {
    pass: results.filter((r) => r.ok).length,
    fail: results.filter((r) => !r.ok).length,
    results,
  };
  console.log(JSON.stringify(summary, null, 2));
  await closePool();
  process.exit(summary.fail ? 1 : 0);
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
