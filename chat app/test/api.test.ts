import { PG_SKIP_REASON, postgresAvailable, resetTestSchema, safeTestDatabaseUrl, sql } from "./helpers";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { after, before, describe, it } from "node:test";

const url = safeTestDatabaseUrl();
const available = await postgresAvailable(url);
const port = 18000 + (process.pid % 1000);
const base = `http://127.0.0.1:${port}`;
let server: ChildProcess | null = null;

class Client {
  cookie = "";
  constructor(readonly forwardedFor = "198.51.100.1") {}
  async call(method: string, path: string, body?: unknown) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": this.forwardedFor,
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const json = (await res.json().catch(() => null)) as any;
    return { status: res.status, json };
  }
  demo(account: "buyer" | "seller" | "support") {
    return this.call("POST", "/api/demo", { account });
  }
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.status === 200) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server did not start");
}

describe("HTTP API (Postgres backend)", { skip: available ? false : PG_SKIP_REASON }, () => {
  before(async () => {
    await resetTestSchema(url);
    process.env.DATABASE_URL = url;
    const { applyMigrations } = await import("../server/db/migrate");
    await applyMigrations();
    const { closePool } = await import("../server/db/pool");
    await closePool();
    server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
      env: {
        ...process.env,
        PORT: String(port),
        DATABASE_URL: url,
        SHOPBRIDGE_SKIP_DOTENV: "1",
        SHOPBRIDGE_ALLOW_RESEED: "1",
        SHOPBRIDGE_DEMO_RESET: "1",
        NODE_ENV: "test",
      },
      stdio: ["ignore", "ignore", "inherit"],
    });
    await waitForServer();
    const seeded = await new Client().call("POST", "/api/dev/reseed");
    assert.equal(seeded.status, 200);
  });

  after(() => {
    server?.kill();
  });

  it("health reports the postgres backend without leaking connection details", async () => {
    const res = await new Client().call("GET", "/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.json.backend, "postgres");
    assert.equal(res.json.nexconn, false);
    assert.ok(!JSON.stringify(res.json).includes("postgresql://"));
  });

  it("requires a session for protected routes", async () => {
    const anon = new Client();
    for (const path of ["/api/me", "/api/products", "/api/orders", "/api/conversations", "/api/requests"]) {
      assert.equal((await anon.call("GET", path)).status, 401, path);
    }
  });

  it("walks buyer → seller → support with role checks", async () => {
    const buyer = new Client();
    const seller = new Client();
    const support = new Client();
    assert.equal((await buyer.demo("buyer")).json.user.role, "member");
    assert.equal((await seller.demo("seller")).json.user.role, "volunteer");
    assert.equal((await support.demo("support")).json.user.role, "coordinator");
    assert.equal((await buyer.call("GET", "/api/me")).json.user.email, "buyer@shopbridge.demo");

    const products = (await buyer.call("GET", "/api/products?q=sari")).json.products;
    assert.equal(products.length, 1);
    const sari = products[0];
    assert.equal((await buyer.call("GET", `/api/products/${sari.id}`)).status, 200);
    assert.equal((await seller.call("PUT", "/api/cart", { productId: sari.id, quantity: 1 })).status, 403);
    assert.equal((await buyer.call("PUT", "/api/cart", { productId: sari.id, quantity: 1 })).status, 200);

    const checkout = await buyer.call("POST", "/api/checkout");
    assert.equal(checkout.status, 201);
    assert.equal(checkout.json.nexconn, false);
    const orderId = checkout.json.orders[0].id;
    assert.equal((await seller.call("GET", `/api/orders/${orderId}`)).status, 200);
    assert.equal((await support.call("GET", `/api/orders/${orderId}`)).status, 404);

    // Without Nexconn keys the room cannot open; simulate an existing channel for the support flow.
    assert.equal((await buyer.call("POST", `/api/orders/${orderId}/room`)).status, 503);
    await sql(url, "UPDATE orders SET channel_id = $2 WHERE id = $1", [orderId, `order${orderId}`]);

    assert.equal((await seller.call("POST", `/api/orders/${orderId}/support`, { note: "x" })).status, 403);
    const escalated = await buyer.call("POST", `/api/orders/${orderId}/support`, { note: "Border is frayed." });
    assert.equal(escalated.status, 201);
    const requestId = escalated.json.request.id;

    assert.equal((await support.call("GET", `/api/orders/${orderId}`)).status, 200, "agent can preview the case");
    assert.equal((await buyer.call("POST", `/api/requests/${requestId}/claim`)).status, 403);
    // Retired community endpoints are gone; the seller cannot propose or answer resolutions.
    assert.equal((await seller.call("POST", `/api/requests/${requestId}/status`, { status: "in_progress" })).status, 410);
    assert.equal((await seller.call("POST", `/api/requests/${requestId}/resolution`, { resolution: "refund" })).status, 403);
    assert.equal((await support.call("POST", `/api/requests/${requestId}/claim`)).status, 200);
    assert.equal(
      (await support.call("POST", `/api/requests/${requestId}/resolution`, { resolution: "replacement", note: "Ships Friday." }))
        .json.request.status,
      "in_progress",
    );
    assert.equal((await seller.call("POST", `/api/requests/${requestId}/response`, { accept: true })).status, 403);
    assert.equal((await buyer.call("POST", `/api/requests/${requestId}/response`, { accept: true })).json.request.status, "completed");

    // Seller drives the order lifecycle; buyer cannot.
    assert.equal((await buyer.call("POST", `/api/orders/${orderId}/status`, { status: "packed" })).status, 403);
    assert.equal((await seller.call("POST", `/api/orders/${orderId}/status`, { status: "packed" })).json.order.status, "packed");
    assert.equal((await seller.call("POST", `/api/orders/${orderId}/status`, { status: "delivered" })).status, 409);

    const stranger = new Client("198.51.100.99");
    await stranger.call("POST", "/api/register", {
      name: "Stranger",
      email: "stranger@example.test",
      password: "password-123",
    });
    assert.equal((await stranger.call("GET", `/api/orders/${orderId}`)).status, 404);
    assert.equal((await stranger.call("GET", `/api/requests/${requestId}`)).status, 404);

    const conversations = (await buyer.call("GET", "/api/conversations")).json.conversations;
    assert.equal(conversations.find((c: any) => c.orderId === orderId).support.status, "completed");

    // Language preference.
    assert.equal((await buyer.call("PATCH", "/api/me/preferences", { language: "xx" })).status, 422);
    assert.equal((await buyer.call("PATCH", "/api/me/preferences", { language: "en" })).json.user.language, "en");
    assert.equal((await buyer.call("GET", "/api/me")).json.user.language, "en");
  });

  it("guards the shared demo reset (header, origin, confirmation, demo-only, cooldown) and refreshes the epoch", async () => {
    const buyer = new Client("198.51.100.20");
    await buyer.demo("buyer");
    const status = await buyer.call("GET", "/api/demo/status");
    assert.deepEqual([status.json.resetEnabled, status.json.canReset], [true, true]);

    const bare = await fetch(`${base}/api/demo/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: buyer.cookie },
      body: JSON.stringify({ confirm: "RESET" }),
    });
    assert.equal(bare.status, 403, "missing intent header (CSRF guard)");
    const crossSite = await fetch(`${base}/api/demo/reset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: buyer.cookie,
        "X-ShopBridge-Intent": "reset-demo",
        Origin: "https://evil.example",
      },
      body: JSON.stringify({ confirm: "RESET" }),
    });
    assert.equal(crossSite.status, 403, "cross-origin request");

    const post = (client: Client, body: unknown) =>
      fetch(`${base}/api/demo/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: client.cookie, "X-ShopBridge-Intent": "reset-demo" },
        body: JSON.stringify(body),
      });
    assert.equal((await post(buyer, {})).status, 422, "explicit confirmation required");

    const anon = new Client("198.51.100.21");
    assert.equal((await post(anon, { confirm: "RESET" })).status, 401);
    const outsider = new Client("198.51.100.22");
    await outsider.call("POST", "/api/register", { name: "Out", email: "out@example.test", password: "password-123" });
    assert.equal((await post(outsider, { confirm: "RESET" })).status, 403, "registered accounts cannot reset");

    const before = (await buyer.call("GET", "/api/demo/status")).json.epoch;
    const ok = await post(buyer, { confirm: "RESET" });
    assert.equal(ok.status, 200);
    const epoch = ok.headers.get("x-demo-epoch");
    assert.ok(epoch && epoch !== before);
    const me = await fetch(`${base}/api/me`, { headers: { Cookie: buyer.cookie } });
    assert.equal(me.status, 200, "initiator stays signed in");
    assert.equal(me.headers.get("x-demo-epoch"), epoch, "every response now carries the new epoch");
    assert.equal((await post(buyer, { confirm: "RESET" })).status, 429, "cooldown blocks repeat resets");
    const orders = (await new Client().call("GET", "/api/orders")).status;
    assert.equal(orders, 401);
  });

  it("lets a judging panel on one network switch demo roles many times", async () => {
    const panel = new Client("203.0.113.50");
    for (let i = 0; i < 40; i++) {
      const res = await panel.demo((["buyer", "seller", "support"] as const)[i % 3]);
      assert.equal(res.status, 200, `switch ${i}`);
    }
  });

  it("keeps password sign-in strictly limited", async () => {
    const attacker = new Client("203.0.113.66");
    let limited = false;
    for (let i = 0; i < 25; i++) {
      const res = await attacker.call("POST", "/api/session", { email: "buyer@shopbridge.demo", password: "nope-nope" });
      if (res.status === 429) limited = true;
    }
    assert.ok(limited);
  });
});
