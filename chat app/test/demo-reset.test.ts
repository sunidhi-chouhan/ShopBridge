import { PG_SKIP_REASON, postgresAvailable, resetTestSchema, safeTestDatabaseUrl, sql } from "./helpers";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

const url = safeTestDatabaseUrl();
const available = await postgresAvailable(url);
process.env.DATABASE_URL = url;
process.env.SHOPBRIDGE_DEMO_RESET = "1";

type Store = typeof import("../server/store-pg");
type Reset = typeof import("../server/demo-reset");
type Seed = typeof import("../server/demo-seed");
let store: Store;
let reset: Reset;
let seed: Seed;
let closePool: () => Promise<void>;

async function as(party: "buyer" | "seller" | "support") {
  const session = await store.signInDemo(party);
  return { user: (await store.userBySession(session.sessionToken))!, token: session.sessionToken };
}

async function counts() {
  const tables = ["users", "products", "orders", "order_items", "requests", "cart_items"];
  const out: Record<string, number> = {};
  for (const table of tables) out[table] = Number((await sql(url, `SELECT count(*)::int n FROM ${table}`)).rows[0].n);
  return out;
}

const meta = { actorId: null, actorRole: "test", client: "test" };

describe("Shared demo reset (PostgreSQL)", { skip: available ? false : PG_SKIP_REASON }, () => {
  before(async () => {
    await resetTestSchema(url);
    const { applyMigrations } = await import("../server/db/migrate");
    await applyMigrations();
    store = await import("../server/store-pg");
    reset = await import("../server/demo-reset");
    seed = await import("../server/demo-seed");
    ({ closePool } = await import("../server/db/pool"));
    await store.reseedDemo();
  });

  beforeEach(() => reset.resetDemoCooldown());

  after(async () => {
    await closePool?.();
  });

  it("starts from the canonical showcase", async () => {
    const { user: seller } = await as("seller");
    const orders = await store.listOrders(seller);
    assert.equal(orders.length, seed.DEMO_ORDERS.length);
    assert.deepEqual(orders.map((o) => o.status).sort(), ["delivered", "delivered", "placed", "shipped"]);
    assert.equal(orders.find((o) => o.status === "shipped")?.shipment?.courier, "Delhivery");
    const offer = orders.find((o) => o.offer)?.offer;
    assert.deepEqual([offer?.state, offer?.amount, offer?.was], ["open", 1490, 1650]);
    const { user: support } = await as("support");
    const queue = await store.listRequests(support);
    assert.equal(queue.filter((r) => r.status === "requested").length, 1, "one case waits in the queue");
    assert.equal(queue.filter((r) => r.status === "completed" && r.resolution === "replacement").length, 1);
  });

  it("1–5: restores catalogue, orders, products and the support queue after buyer, seller and agent changes", async () => {
    const { user: buyer, token: buyerToken } = await as("buyer");
    const { user: seller } = await as("seller");
    const { user: support } = await as("support");
    const baseline = await counts();
    const sari = (await store.listCatalog({ q: "sari" }))[0];

    // Buyer: bag + order + escalation on the new order.
    await store.setCartItem(buyer, sari.id, 2);
    const [order] = await store.checkout(buyer);
    await store.saveOrderChannel(order.id, `order${order.id}`);
    await store.createOrderSupport(buyer, order.id, "test case");
    await store.setCartItem(buyer, (await store.listCatalog({ q: "bowl" }))[0].id, 1);
    // Seller: edits and new product.
    await store.updateProduct(seller, "pdemotote", { price: 1, stock: 0, name: "Edited tote" });
    await store.createProduct(seller, {
      name: "Judge's test product",
      description: "temporary",
      category: "home",
      price: 10,
      stock: 1,
      images: [],
      published: true,
    });
    await store.advanceOrder(seller, order.id, "packed");
    // Agent: claims the showcase case.
    const waiting = (await store.listRequests(support)).find((r) => r.status === "requested" && r.note.includes("ज़री"))!;
    await store.claimOrderSupport(support, waiting.id);
    // A registered (non-demo) buyer with their own bag.
    const outsider = (await store.userBySession(
      (await store.registerBuyer("Outside Buyer", "outside@example.test", "password-123")).sessionToken,
    ))!;
    await store.setCartItem(outsider, (await store.listCatalog({ q: "attar" }))[0].id, 1);

    const epochBefore = await store.getDemoEpoch();
    const result = await reset.performDemoReset(meta);
    assert.notEqual(result.epoch, epochBefore);
    assert.equal(await store.getDemoEpoch(), result.epoch);

    // Catalogue back to canonical values; the judge's product is gone.
    const catalogue = await store.listCatalog({});
    assert.equal(catalogue.length, seed.DEMO_PRODUCTS.length);
    for (const canonical of seed.DEMO_PRODUCTS) {
      const product = catalogue.find((p) => p.id === canonical.id)!;
      assert.ok(product, canonical.name);
      assert.equal(product.name, canonical.name);
      assert.equal(product.price, canonical.price);
      assert.equal(product.stock, canonical.stock);
    }
    // Orders: only the showcase orders, with fresh ids.
    const orders = await store.listOrders(seller);
    assert.equal(orders.length, seed.DEMO_ORDERS.length);
    assert.ok(!orders.some((o) => o.id === order.id));
    // Support queue: the showcase case is unclaimed again.
    const queue = await store.listRequests(support);
    const again = queue.find((r) => r.status === "requested")!;
    assert.equal(again.coordinator, null);
    assert.ok(!queue.some((r) => r.note === "test case"));
    // No stale carts or orphans.
    assert.equal((await store.getCart(buyer)).items.length, 0);
    assert.equal((await store.getCart(outsider)).items.length, 0, "cart lines for demo products are cleared");
    const orphans = await sql(
      url,
      `SELECT
         (SELECT count(*) FROM order_items i LEFT JOIN orders o ON o.id = i.order_id WHERE o.id IS NULL)::int AS items,
         (SELECT count(*) FROM requests r LEFT JOIN orders o ON o.id = r.order_id WHERE r.order_id IS NOT NULL AND o.id IS NULL)::int AS requests`,
    );
    assert.deepEqual(orphans.rows[0], { items: 0, requests: 0 });
    // Same table sizes as the canonical baseline (+1 user: the outsider is kept).
    const after = await counts();
    assert.deepEqual({ ...after, users: after.users - 1 }, baseline);
    // Accounts: same ids, still signed in, can sign in again.
    assert.equal((await store.userBySession(buyerToken))?.id, buyer.id);
    for (const party of ["buyer", "seller", "support"] as const) {
      const again = await as(party);
      assert.equal(again.user.role, seed.DEMO_ACCOUNTS[party].role);
      assert.equal(again.user.language, seed.DEMO_ACCOUNTS[party].language);
    }
    const password = await store.signInWithPassword("buyer@shopbridge.demo", "test-demo-password");
    assert.ok(password.sessionToken, "documented demo password still works");
    // Non-demo account survives.
    assert.ok(await store.userBySession((await store.signInWithPassword("outside@example.test", "password-123")).sessionToken));
  });

  it("6/9: a reset right after another is refused; concurrent resets never both run", async () => {
    const { user: buyer } = await as("buyer");
    await reset.resetDemoForUser(buyer, "test");
    await assert.rejects(reset.resetDemoForUser(buyer, "test"), { status: 429 }, "cooldown");
    reset.resetDemoCooldown();
    const results = await Promise.allSettled([reset.performDemoReset(meta), reset.performDemoReset(meta)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.status, 409);
  });

  it("9: the database lock also stops a second process from resetting at the same time", async () => {
    const ids = await store.demoUserIds();
    const results = await Promise.allSettled([
      store.applyDemoReset(seed.buildDemoPlan({ ...ids }), { ...ids }, null, meta),
      store.applyDemoReset(seed.buildDemoPlan({ ...ids }), { ...ids }, null, meta),
    ]);
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    // Either they serialise cleanly or the loser gets a clear 409 — never a half-applied mix.
    for (const failure of rejected) assert.equal(failure.reason.status, 409);
    const { user: seller } = await as("seller");
    assert.equal((await store.listOrders(seller)).length, seed.DEMO_ORDERS.length);
  });

  it("7: only shared demo accounts may reset, and only when the deployment enables it", async () => {
    const outsider = (await store.userBySession((await store.signInWithPassword("outside@example.test", "password-123")).sessionToken))!;
    await assert.rejects(reset.resetDemoForUser(outsider, "test"), { status: 403 });
    const { user: buyer } = await as("buyer");
    process.env.SHOPBRIDGE_DEMO_RESET = "0";
    try {
      await assert.rejects(reset.resetDemoForUser(buyer, "test"), { status: 404 });
    } finally {
      process.env.SHOPBRIDGE_DEMO_RESET = "1";
    }
  });

  it("8: a failed reset leaves the data exactly as it was", async () => {
    const { user: seller } = await as("seller");
    await store.updateProduct(seller, "pdemobelt", { price: 999 });
    const before = await sql(url, "SELECT id, price, stock FROM products ORDER BY id");
    const ordersBefore = await sql(url, "SELECT id FROM orders ORDER BY id");
    const ids = await store.demoUserIds();
    const broken = seed.buildDemoPlan(ids);
    broken.products.push({ ...broken.products[0] }); // duplicate primary key → insert fails mid-transaction
    await assert.rejects(store.applyDemoReset(broken, ids, null, meta));
    assert.deepEqual((await sql(url, "SELECT id, price, stock FROM products ORDER BY id")).rows, before.rows);
    assert.deepEqual((await sql(url, "SELECT id FROM orders ORDER BY id")).rows, ordersBefore.rows);
    const audit = await sql(url, "SELECT outcome FROM demo_resets ORDER BY id DESC LIMIT 1");
    assert.equal(audit.rows[0].outcome, "success", "failed transaction left no success row");
  });

  it("never touches products of other sellers", async () => {
    await sql(
      url,
      `INSERT INTO users (id, name, email, password_hash, role, sample, created_at)
       VALUES ('votherseller1', 'Other Seller', 'other-seller@example.test', 'x', 'volunteer', false, now())`,
    );
    await sql(
      url,
      `INSERT INTO products (id, seller_id, name, description, category, price, stock, published, featured, sample, images, created_at, updated_at)
       VALUES ('potherproduct1', 'votherseller1', 'Other product', 'x', 'home', 100, 3, true, false, false, '[]', now(), now())`,
    );
    await reset.performDemoReset(meta);
    const kept = await sql(url, "SELECT name FROM products WHERE id = 'potherproduct1'");
    assert.equal(kept.rows[0]?.name, "Other product");
  });

  it("records an audit row for each successful reset", async () => {
    const rows = await sql(url, "SELECT outcome, actor_role FROM demo_resets WHERE outcome = 'success'");
    assert.ok(rows.rows.length >= 3);
  });
});
