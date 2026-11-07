import "./helpers";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

// Local JSON backend in a throwaway directory.
const dir = mkdtempSync(path.join(tmpdir(), "shopbridge-json-test-"));
process.env.SHOPBRIDGE_DATA_DIR = dir;
process.env.DATABASE_URL = "";

type Store = typeof import("../server/store-json");
let store: Store;

describe("JSON store parity (local backend)", () => {
  before(async () => {
    store = await import("../server/store-json");
    await store.reseedDemo();
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  it("seller cannot change order-support status; the claiming agent can", async () => {
    const buyer = (await store.userBySession((await store.signInDemo("buyer")).sessionToken))!;
    const seller = (await store.userBySession((await store.signInDemo("seller")).sessionToken))!;
    const support = (await store.userBySession((await store.signInDemo("support")).sessionToken))!;
    const sari = (await store.listCatalog({ q: "sari" }))[0];
    await store.setCartItem(buyer, sari.id, 1);
    const [order] = await store.checkout(buyer);
    await store.saveOrderChannel(order.id, `order${order.id}`);
    const request = await store.createOrderSupport(buyer, order.id, "Wrong colour.");
    await store.claimOrderSupport(support, request.id);
    await assert.rejects(store.proposeResolution(seller, request.id, "refund", ""), { status: 403 });
    await assert.rejects(store.changeStatus(seller, request.id, "in_progress"), { status: 409 });
    assert.equal((await store.proposeResolution(support, request.id, "replacement", "")).status, "in_progress");
    assert.equal((await store.respondToResolution(buyer, request.id, true)).status, "completed");
  });

  it("reset restores the canonical demo in the JSON backend", async () => {
    const { buildDemoPlan } = await import("../server/demo-seed");
    const seller = (await store.userBySession((await store.signInDemo("seller")).sessionToken))!;
    const sari = (await store.listCatalog({ q: "sari" }))[0];
    await store.updateProduct(seller, sari.id, { price: 1, stock: 0 });
    const ids = await store.demoUserIds();
    const { epoch } = await store.applyDemoReset(buildDemoPlan(ids), ids, null, { actorId: null, actorRole: null, client: null });
    assert.ok(epoch);
    assert.equal(await store.getDemoEpoch(), epoch);
    const restored = (await store.listCatalog({ q: "sari" }))[0];
    assert.equal(restored.price, 4800);
    assert.equal(restored.stock, 6);
    const { DEMO_ORDERS } = await import("../server/demo-seed");
    assert.equal((await store.listOrders(seller)).length, DEMO_ORDERS.length, "only the showcase orders remain");
  });

  it("shared demo accounts keep earlier sessions alive", async () => {
    const first = await store.signInDemo("buyer");
    for (let i = 0; i < 12; i++) await store.signInDemo("buyer");
    assert.ok(await store.userBySession(first.sessionToken));
  });
});
