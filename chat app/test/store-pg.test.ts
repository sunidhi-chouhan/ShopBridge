import { PG_SKIP_REASON, postgresAvailable, resetTestSchema, safeTestDatabaseUrl, sql } from "./helpers";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

const url = safeTestDatabaseUrl();
const available = await postgresAvailable(url);
process.env.DATABASE_URL = url;

type Store = typeof import("../server/store-pg");
let store: Store;
let closePool: () => Promise<void>;

async function demoUser(party: "buyer" | "seller" | "support") {
  const session = await store.signInDemo(party);
  const user = await store.userBySession(session.sessionToken);
  assert.ok(user, `demo ${party} resolves from its session`);
  return { user, token: session.sessionToken };
}

/** Snapshot of row versions: any rewrite (UPDATE or DELETE+INSERT) changes xmin. */
async function rowVersions(): Promise<string> {
  const tables = ["users", "sessions", "products", "cart_items", "orders", "order_items", "requests"];
  const parts: string[] = [];
  for (const table of tables) {
    const res = await sql(url, `SELECT xmin::text AS v FROM ${table} ORDER BY xmin::text`);
    parts.push(`${table}:${res.rows.map((row) => row.v).join(",")}`);
  }
  return parts.join("|");
}

describe("PostgreSQL store", { skip: available ? false : PG_SKIP_REASON }, () => {
  before(async () => {
    await resetTestSchema(url);
    const { applyMigrations } = await import("../server/db/migrate");
    await applyMigrations();
    store = await import("../server/store-pg");
    ({ closePool } = await import("../server/db/pool"));
    await store.reseedDemo();
  });

  after(async () => {
    await closePool?.();
  });

  describe("sessions", () => {
    it("demo sign-in creates a session that resolves, and sign-out clears it", async () => {
      const { user, token } = await demoUser("buyer");
      assert.equal(user.role, "member");
      assert.equal(user.email, "buyer@shopbridge.demo");
      await store.clearSession(token);
      assert.equal(await store.userBySession(token), null);
    });

    it("shared demo accounts never evict earlier sessions (many judges at once)", async () => {
      const first = await store.signInDemo("seller");
      for (let i = 0; i < 20; i++) await store.signInDemo("seller");
      assert.ok(await store.userBySession(first.sessionToken), "first judge is still signed in");
    });

    it("ordinary accounts keep only their 8 most recent sessions", async () => {
      const first = await store.registerBuyer("Cap Tester", "cap@example.test", "password-123");
      for (let i = 0; i < 8; i++) await store.signInWithPassword("cap@example.test", "password-123");
      assert.equal(await store.userBySession(first.sessionToken), null);
    });

    it("rejects duplicate registration and wrong passwords", async () => {
      await assert.rejects(store.registerBuyer("Dup", "cap@example.test", "password-123"), { status: 409 });
      await assert.rejects(store.signInWithPassword("cap@example.test", "wrong-password"), { status: 401 });
      await assert.rejects(store.signInWithPassword("nobody@example.test", "whatever-1"), { status: 401 });
    });

    it("stores a reading language per user", async () => {
      const { user, token } = await demoUser("buyer");
      assert.equal(user.language, "hi", "demo buyer reads Hindi");
      assert.equal((await store.setUserLanguage(user, "en")).language, "en");
      assert.equal((await store.userBySession(token))!.language, "en");
      await store.setUserLanguage(user, "hi");
    });

    it("expired sessions do not authenticate", async () => {
      const { token } = await demoUser("buyer");
      await sql(url, "UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE token = $1", [token]);
      assert.equal(await store.userBySession(token), null);
    });
  });

  describe("catalogue", () => {
    it("lists, filters, searches and sorts published products", async () => {
      const all = await store.listCatalog({});
      assert.equal(all.length, 8);
      assert.equal(all[0].name, "Maheshwari cotton sari", "featured first for relevance");
      const cheapFirst = await store.listCatalog({ sort: "price-asc" });
      assert.deepEqual(
        cheapFirst.map((p) => p.price),
        [...cheapFirst.map((p) => p.price)].sort((a, b) => a - b),
      );
      const inStock = await store.listCatalog({ available: true });
      assert.ok(inStock.every((p) => p.stock > 0));
      assert.equal(inStock.length, 7);
      const brass = await store.listCatalog({ q: "BRASS" });
      assert.deepEqual(brass.map((p) => p.name).sort(), ["Hammered brass jhumkas", "Vegetable-tanned belt"]);
      const bySeller = await store.listCatalog({ q: "meera" });
      assert.equal(bySeller.length, 8, "search matches the seller name");
      const leather = await store.listCatalog({ category: "leather", min: 1500, max: 5000 });
      assert.deepEqual(leather.map((p) => p.name), ["Cane and hide tote"]);
      assert.ok(all.every((p) => p.images.length > 0 && p.seller.name === "Meera Joshi"));
    });

    it("hides unpublished products from buyers but not from their seller", async () => {
      const { user: seller } = await demoUser("seller");
      const { user: buyer } = await demoUser("buyer");
      const draft = await store.createProduct(seller, {
        name: "Draft shawl",
        description: "Not ready yet.",
        category: "textile",
        price: 999,
        stock: 2,
        images: [],
        published: false,
      });
      await assert.rejects(store.getProduct(draft.id, buyer), { status: 404 });
      assert.equal((await store.getProduct(draft.id, seller)).name, "Draft shawl");
      assert.ok((await store.listSellerProducts(seller)).some((p) => p.id === draft.id));
      const updated = await store.updateProduct(seller, draft.id, { published: true, price: 1099 });
      assert.equal(updated.price, 1099);
      assert.equal((await store.getProduct(draft.id, buyer)).price, 1099);
      await store.deleteProduct(seller, draft.id);
      await assert.rejects(store.getProduct(draft.id, seller), { status: 404 });
      await assert.rejects(store.deleteProduct(seller, draft.id), { status: 404 });
    });
  });

  describe("reads never write", () => {
    it("catalogue, cart, orders, conversations and requests leave every row untouched", async () => {
      const { user: buyer } = await demoUser("buyer");
      const { user: seller } = await demoUser("seller");
      const { user: support } = await demoUser("support");
      const before = await rowVersions();
      await store.listCatalog({ q: "sari" });
      await store.getProduct((await store.listCatalog({}))[0].id, buyer);
      await store.getCart(buyer);
      await store.listOrders(buyer);
      await store.listOrders(seller);
      await store.listConversations(buyer);
      await store.listConversations(support);
      await store.listRequests(support);
      await store.listVolunteers();
      await store.listSellerProducts(seller);
      assert.equal(await rowVersions(), before);
    });
  });

  describe("cart, checkout and orders", () => {
    let orderId = "";

    it("enforces stock, own-listing and empty-bag rules", async () => {
      const { user: buyer } = await demoUser("buyer");
      const products = await store.listCatalog({});
      const cup = products.find((p) => p.name.startsWith("Narmada clay cup"))!;
      await assert.rejects(store.setCartItem(buyer, cup.id, 1), { status: 409 });
      await assert.rejects(store.checkout(buyer), { status: 422 });
    });

    it("checks out: splits by seller, decrements stock, clears the bag", async () => {
      const { user: buyer } = await demoUser("buyer");
      const sari = (await store.listCatalog({ q: "sari" }))[0];
      const bowl = (await store.listCatalog({ q: "bowl" }))[0];
      await store.setCartItem(buyer, sari.id, 2);
      const cart = await store.setCartItem(buyer, bowl.id, 1);
      assert.equal(cart.items.length, 2);
      assert.equal(cart.subtotal, sari.price * 2 + bowl.price);
      const orders = await store.checkout(buyer);
      assert.equal(orders.length, 1, "one seller → one order");
      assert.equal(orders[0].total, cart.subtotal);
      assert.equal(orders[0].items.length, 2);
      assert.equal(orders[0].status, "placed");
      assert.equal(orders[0].channelId, null);
      assert.equal((await store.getProduct(sari.id, buyer)).stock, sari.stock - 2);
      assert.equal((await store.getCart(buyer)).items.length, 0);
      orderId = orders[0].id;
    });

    it("never oversells under concurrent checkouts", async () => {
      const a = await store.registerBuyer("Race A", "race-a@example.test", "password-123");
      const b = await store.registerBuyer("Race B", "race-b@example.test", "password-123");
      const buyerA = (await store.userBySession(a.sessionToken))!;
      const buyerB = (await store.userBySession(b.sessionToken))!;
      const tote = (await store.listCatalog({ q: "tote" }))[0];
      await store.setCartItem(buyerA, tote.id, tote.stock);
      await store.setCartItem(buyerB, tote.id, tote.stock);
      const results = await Promise.allSettled([store.checkout(buyerA), store.checkout(buyerB)]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      assert.equal(rejected.reason.status, 409);
      assert.equal((await store.getProduct(tote.id, buyerA)).stock, 0);
    });

    it("scopes orders to their buyer and seller", async () => {
      const { user: buyer } = await demoUser("buyer");
      const { user: seller } = await demoUser("seller");
      const { user: support } = await demoUser("support");
      const stranger = (await store.userBySession(
        (await store.registerBuyer("Stranger", "stranger@example.test", "password-123")).sessionToken,
      ))!;
      assert.equal((await store.getOrder(buyer, orderId)).id, orderId);
      assert.equal((await store.getOrder(seller, orderId)).id, orderId);
      await assert.rejects(store.getOrder(stranger, orderId), { status: 404 });
      await assert.rejects(store.getOrder(support, orderId), { status: 404 }, "no open case → support cannot see it");
      assert.ok((await store.listOrders(seller)).some((o) => o.id === orderId));
      assert.ok(!(await store.listOrders(stranger)).some((o) => o.id === orderId));
    });

    it("lets only the seller move the order one step at a time", async () => {
      const { user: seller } = await demoUser("seller");
      const { user: buyer } = await demoUser("buyer");
      await assert.rejects(store.advanceOrder(buyer, orderId, "packed"), { status: 404 });
      await assert.rejects(store.advanceOrder(seller, orderId, "shipped"), { status: 409 }, "cannot skip packed");
      assert.equal((await store.advanceOrder(seller, orderId, "packed")).order.status, "packed");
      assert.equal((await store.advanceOrder(seller, orderId, "shipped")).order.status, "shipped");
      const delivered = await store.advanceOrder(seller, orderId, "delivered");
      assert.equal(delivered.order.status, "delivered");
      assert.equal(delivered.previous, "shipped");
      await assert.rejects(store.advanceOrder(seller, orderId, "delivered"), { status: 409 });
    });

    it("seller offers a lower price; only the buyer accepts it and the total changes on the server", async () => {
      const { user: buyer } = await demoUser("buyer");
      const { user: seller } = await demoUser("seller");
      const fresh = (await store.listCatalog({ q: "belt" }))[0];
      await store.setCartItem(buyer, fresh.id, 1);
      const [order] = await store.checkout(buyer);
      await assert.rejects(store.makeOffer(buyer, order.id, 100, ""), { status: 404 });
      await assert.rejects(store.makeOffer(seller, order.id, order.total, ""), { status: 422 }, "must be lower");
      const offered = await store.makeOffer(seller, order.id, order.total - 150, "Festive price");
      assert.deepEqual([offered.offer?.state, offered.offer?.was, offered.total], ["open", order.total, order.total]);
      await assert.rejects(store.respondToOffer(seller, order.id, offered.offer!.id, true), { status: 404 });
      const accepted = await store.respondToOffer(buyer, order.id, offered.offer!.id, true);
      assert.equal(accepted.total, order.total - 150);
      assert.equal(accepted.offer?.state, "accepted");
      await assert.rejects(store.respondToOffer(buyer, order.id, offered.offer!.id, true), { status: 409 });
      await store.advanceOrder(seller, order.id, "packed");
      const shipped = await store.advanceOrder(seller, order.id, "shipped", { courier: "Delhivery", awb: "123", eta: null });
      assert.equal(shipped.order.shipment?.awb, "123");
      await assert.rejects(store.makeOffer(seller, order.id, 10, ""), { status: 409 }, "no offers after shipping");
    });

    it("stores the Nexconn channel id on the order", async () => {
      const order = await store.saveOrderChannel(orderId, `order${orderId}`);
      assert.equal(order.channelId, `order${orderId}`);
      const people = await store.orderParticipants(orderId);
      assert.equal(people.buyer.email, "buyer@shopbridge.demo");
      assert.equal(people.productLabel, order.items[0].name);
    });

    describe("order support", () => {
      it("buyer escalates; a second open case is refused", async () => {
        const { user: buyer } = await demoUser("buyer");
        const request = await store.createOrderSupport(buyer, orderId, "Border is frayed.");
        assert.equal(request.status, "requested");
        assert.equal(request.orderId, orderId);
        assert.equal(request.volunteer?.name, "Meera Joshi");
        await assert.rejects(store.createOrderSupport(buyer, orderId, "again"), { status: 409 });
      });

      it("any agent can see the unclaimed case; one agent claims it", async () => {
        const { user: support } = await demoUser("support");
        assert.equal((await store.getOrder(support, orderId)).id, orderId);
        const request = (await store.listRequests(support)).find((r) => r.orderId === orderId)!;
        const claimed = await store.claimOrderSupport(support, request.id);
        assert.equal(claimed.view.status, "assigned");
        assert.equal(claimed.channelId, `order${orderId}`);
        assert.ok((await store.listConversations(support)).some((c) => c.orderId === orderId));

        await sql(
          url,
          `INSERT INTO users (id, name, email, password_hash, role, sample, created_at)
           VALUES ('c-second', 'Second Agent', 'agent2@example.test', 'x', 'coordinator', false, now())`,
        );
        const second = (await sql(url, "SELECT * FROM users WHERE id = 'c-second'")).rows[0];
        const secondAgent = { ...second, passwordHash: "x", sessions: [], sessionToken: null, sessionExpiresAt: null };
        await assert.rejects(store.claimOrderSupport(secondAgent, request.id), { status: 409 });
      });

      it("the seller cannot advance or close the buyer's support case", async () => {
        const { user: seller } = await demoUser("seller");
        const request = (await store.listRequests(seller)).find((r) => r.orderId === orderId)!;
        await assert.rejects(store.proposeResolution(seller, request.id, "refund", ""), { status: 403 });
        await assert.rejects(store.changeStatus(seller, request.id, "in_progress"), { status: 409 });
      });

      it("order support uses the resolution flow: agent proposes, buyer answers", async () => {
        const { user: support } = await demoUser("support");
        const { user: buyer } = await demoUser("buyer");
        const { user: seller } = await demoUser("seller");
        const request = (await store.listRequests(support)).find((r) => r.orderId === orderId)!;
        await assert.rejects(store.changeStatus(support, request.id, "in_progress"), { status: 409 });
        await assert.rejects(store.respondToResolution(buyer, request.id, true), { status: 409 }, "nothing proposed yet");
        await assert.rejects(store.proposeResolution(seller, request.id, "refund", ""), { status: 403 });
        const proposed = await store.proposeResolution(support, request.id, "replacement", "New sari ships Friday.");
        assert.equal(proposed.status, "in_progress");
        assert.equal(proposed.resolution, "replacement");
        await assert.rejects(store.respondToResolution(seller, request.id, true), { status: 404 });
        const declined = await store.respondToResolution(buyer, request.id, false);
        assert.equal(declined.status, "assigned");
        assert.equal(declined.resolution, null);
        await store.proposeResolution(support, request.id, "refund", "Full refund today.");
        const accepted = await store.respondToResolution(buyer, request.id, true);
        assert.equal(accepted.status, "completed");
        assert.ok(accepted.resolvedAt);
        const conversations = await store.listConversations(buyer);
        assert.equal(conversations.find((c) => c.orderId === orderId)?.support?.status, "completed");
      });
    });
  });
});
