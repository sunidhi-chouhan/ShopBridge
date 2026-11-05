#!/usr/bin/env node
/**
 * Phase 4.1 — ShopBridge final acceptance (API + Nexconn server sends).
 * Evidence written to backups/phase41/acceptance-api.json
 * Does not mock translations; UI translation is verified separately in REPORT screenshots.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.API_BASE || "http://127.0.0.1:8787";
const OUT = join(process.cwd(), "backups/phase41");
mkdirSync(OUT, { recursive: true });

const APP_KEY = process.env.NEXCONN_APP_KEY;
const APP_SECRET = process.env.NEXCONN_APP_SECRET;
const API_BASE = (process.env.NEXCONN_API_BASE || "https://api.sg-light-api.com").replace(/\/$/, "");

const results = [];
function record(id, status, detail) {
  results.push({ id, status, detail });
  console.log(`${String(status).padEnd(10)} ${id} — ${detail}`);
}

async function jar() {
  const path = join(tmpdir(), `p41-${Math.random().toString(16).slice(2)}.txt`);
  writeFileSync(path, "");
  return path;
}

async function api(cookiePath, method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (cookiePath) {
    const raw = readFileSync(cookiePath, "utf8").trim();
    if (raw) headers.Cookie = raw;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const single = res.headers.get("set-cookie");
  const all = setCookies.length ? setCookies : single ? [single] : [];
  if (cookiePath && all.length) {
    for (const line of all) {
      const m = line.match(/^([^=]+)=([^;]*)/);
      if (!m) continue;
      if (m[2] === "" || /Max-Age=0/i.test(line)) writeFileSync(cookiePath, "");
      else writeFileSync(cookiePath, `${m[1]}=${m[2]}`);
    }
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function login(account) {
  const cookie = await jar();
  const res = await api(cookie, "POST", "/api/demo", { account });
  if (res.status >= 400 || !res.json?.user) throw new Error(`login ${account}: ${JSON.stringify(res.json)}`);
  return { cookie, user: res.json.user };
}

async function signedPost(path, body) {
  const nonce = randomBytes(9).toString("hex").slice(0, 18);
  const timestamp = Date.now().toString();
  const signature = createHash("sha1").update(`${APP_SECRET}${nonce}${timestamp}`).digest("hex");
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "App-Key": APP_KEY,
      Nonce: nonce,
      Timestamp: timestamp,
      Signature: signature,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

async function sendRoomText(fromUserId, channelId, text) {
  return signedPost("/v4/group-channel/message/send", {
    fromUserId,
    toChannelIds: [channelId],
    messageType: "RC:TxtMsg",
    content: JSON.stringify({ content: text }),
    shouldPersist: 1,
    isEchoToSender: 1,
  });
}

const health = await api(null, "GET", "/api/health");
record("health", health.json?.ok && health.json?.nexconn ? "PASS" : "FAIL", JSON.stringify(health.json));

const buyer = await login("buyer");
const seller = await login("seller");
const support = await login("support");
record("login.buyer", buyer.user.role === "member" ? "PASS" : "FAIL", buyer.user.name);
record("login.seller", seller.user.role === "volunteer" ? "PASS" : "FAIL", seller.user.name);
record("login.support", support.user.role === "coordinator" ? "PASS" : "FAIL", support.user.name);

const products = await api(buyer.cookie, "GET", "/api/products");
const list = products.json?.products || products.json || [];
const product = (Array.isArray(list) ? list : []).find((p) => (p.stock ?? 0) > 0);
record("buyer.products", product ? "PASS" : "FAIL", product ? `${product.name} stock=${product.stock}` : "no stock");

const detail = product ? await api(buyer.cookie, "GET", `/api/products/${product.id}`) : { status: 0 };
record("buyer.productDetail", detail.status === 200 ? "PASS" : "FAIL", String(detail.status));

const cartPut = await api(buyer.cookie, "PUT", "/api/cart", { productId: product.id, quantity: 1 });
record("buyer.addToBag", cartPut.status < 300 ? "PASS" : "FAIL", String(cartPut.status));

const checkout = await api(buyer.cookie, "POST", "/api/checkout", {});
const order = checkout.json?.orders?.[0];
record("buyer.checkout", order?.id ? "PASS" : "FAIL", order?.id || JSON.stringify(checkout.json).slice(0, 120));

const orders = await api(buyer.cookie, "GET", "/api/orders");
record("buyer.orderHistory", (orders.json?.orders || []).length > 0 ? "PASS" : "FAIL", `count=${(orders.json?.orders || []).length}`);

const room = await api(buyer.cookie, "POST", `/api/orders/${order.id}/room`, {});
const orderGet = await api(buyer.cookie, "GET", `/api/orders/${order.id}`);
const channelId = orderGet.json?.order?.channelId || room.json?.channelId;
record("nexconn.channelCreate", channelId === `order${order.id}` ? "PASS" : "FAIL", String(channelId));

const room2 = await api(buyer.cookie, "POST", `/api/orders/${order.id}/room`, {});
const orderGet2 = await api(buyer.cookie, "GET", `/api/orders/${order.id}`);
record(
  "nexconn.channelReuse",
  orderGet2.json?.order?.channelId === channelId ? "PASS" : "FAIL",
  `${channelId} / room2=${room2.status}`,
);

const marker = `P41-accept-${Date.now()}`;
const send = await sendRoomText(buyer.user.id, channelId, marker);
record("nexconn.send", send.json?.code === 0 ? "PASS" : "FAIL", JSON.stringify(send.json?.code));

const sellerOrders = await api(seller.cookie, "GET", "/api/orders");
record("seller.orders", (sellerOrders.json?.orders || []).some((o) => o.id === order.id) ? "PASS" : "FAIL", `count=${(sellerOrders.json?.orders || []).length}`);

const sellerProducts = await api(seller.cookie, "GET", "/api/seller/products");
record("seller.products", (sellerProducts.json?.products || []).length > 0 ? "PASS" : "FAIL", `count=${(sellerProducts.json?.products || []).length}`);

const sellerReply = await sendRoomText(seller.user.id, channelId, `P41-seller-reply-${Date.now()}`);
record("seller.reply", sellerReply.json?.code === 0 ? "PASS" : "FAIL", String(sellerReply.json?.code));

const supportEsc = await api(buyer.cookie, "POST", `/api/orders/${order.id}/support`, {
  note: `P41-demo-order-support-${Date.now()}`,
});
const requestId = supportEsc.json?.request?.id || supportEsc.json?.id;
record("buyer.orderSupport", supportEsc.status < 300 && requestId ? "PASS" : "FAIL", String(requestId));

const queue = await api(support.cookie, "GET", "/api/requests");
const pending = (queue.json?.requests || []).find((r) => r.id === requestId);
record("support.queue", pending ? "PASS" : "FAIL", pending?.status || "missing");

const claim = await api(support.cookie, "POST", `/api/requests/${requestId}/claim`, {});
const claimedChannel = claim.json?.request?.channelId || claim.json?.channelId || pending?.channelId;
record(
  "support.claimSameChannel",
  claim.status < 300 && claimedChannel === channelId ? "PASS" : "FAIL",
  `${claimedChannel} status=${claim.status}`,
);

const supportMsg = await sendRoomText(support.user.id, channelId, `P41-support-on-channel-${Date.now()}`);
record("support.message", supportMsg.json?.code === 0 ? "PASS" : "FAIL", String(supportMsg.json?.code));

const tok = await api(buyer.cookie, "POST", "/api/chat/token", {});
const keys = Object.keys(tok.json || {}).sort().join(",");
const secretLeak = JSON.stringify(tok.json || {}).includes(APP_SECRET || "___");
record(
  "nexconn.tokenShape",
  tok.status === 200 && keys === "appKey,token,userId" && !secretLeak && tok.json?.appKey === APP_KEY ? "PASS" : "FAIL",
  keys,
);

const anonTok = await api(null, "POST", "/api/chat/token", {});
record("nexconn.tokenRequiresSession", anonTok.status === 401 || anonTok.status === 403 ? "PASS" : "FAIL", String(anonTok.status));

const foreign = await api(buyer.cookie, "GET", "/api/orders/oxxxnotreal");
record("authz.foreignOrder", foreign.status === 404 ? "PASS" : "FAIL", String(foreign.status));

const buyerClaim = await api(buyer.cookie, "POST", `/api/requests/${requestId}/claim`, {});
record("authz.buyerCannotClaim", buyerClaim.status === 403 ? "PASS" : "FAIL", String(buyerClaim.status));

const general = await api(buyer.cookie, "POST", "/api/requests", { kind: "groceries", note: "P41 general help should stay separate" });
record(
  "support.generalVsOrder",
  general.status < 300 && !general.json?.request?.orderId && !general.json?.orderId ? "PASS" : "FAIL",
  JSON.stringify({ orderId: general.json?.request?.orderId ?? general.json?.orderId, status: general.status }),
);

const convBuyer = await api(buyer.cookie, "GET", "/api/conversations");
const convSeller = await api(seller.cookie, "GET", "/api/conversations");
const convSupport = await api(support.cookie, "GET", "/api/conversations");
const inBuyer = (convBuyer.json?.conversations || []).some((c) => c.orderId === order.id || c.channelId === channelId);
const inSeller = (convSeller.json?.conversations || []).some((c) => c.orderId === order.id || c.channelId === channelId);
const inSupport = (convSupport.json?.conversations || []).some((c) => c.orderId === order.id || c.channelId === channelId);
record("inbox.allRolesSeeOrder", inBuyer && inSeller && inSupport ? "PASS" : "FAIL", JSON.stringify({ inBuyer, inSeller, inSupport }));

const pass = results.filter((r) => r.status === "PASS").length;
const fail = results.filter((r) => r.status === "FAIL").length;
const evidence = {
  generatedAt: new Date().toISOString(),
  appKey: APP_KEY,
  orderId: order?.id || null,
  channelId: channelId || null,
  marker,
  summary: { pass, fail, total: results.length },
  results,
};
writeFileSync(join(OUT, "acceptance-api.json"), JSON.stringify(evidence, null, 2));
console.log(`\nSummary PASS=${pass} FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
