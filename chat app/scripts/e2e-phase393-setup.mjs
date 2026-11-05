#!/usr/bin/env node
/**
 * Phase 3.9.3 — fresh order + pre-join markers via Server API, then support claim.
 */
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.API_BASE || "http://127.0.0.1:8787";
const OUT = join(process.cwd(), "backups/phase393");
mkdirSync(OUT, { recursive: true });

const APP_KEY = process.env.NEXCONN_APP_KEY;
const APP_SECRET = process.env.NEXCONN_APP_SECRET;
const API_BASE = (process.env.NEXCONN_API_BASE || "https://api.sg-light-api.com").replace(/\/$/, "");

const MARKER_A = `P393-prejoin-A-${Date.now()}`;
const MARKER_B = `P393-prejoin-B-${Date.now()}`;
const MARKER_SELLER = `P393-seller-before-support-${Date.now()}`;

async function jar() {
  const path = join(tmpdir(), `p393-${Math.random().toString(16).slice(2)}.txt`);
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
  if (res.status >= 400 || !res.json?.user) {
    throw new Error(`login ${account}: ${res.status} ${JSON.stringify(res.json)}`);
  }
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
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
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

if (!APP_KEY || !APP_SECRET) throw new Error("NEXCONN_APP_KEY/SECRET required in env");

const buyer = await login("buyer");
const seller = await login("seller");
const support = await login("support");

const products = await api(buyer.cookie, "GET", "/api/products");
const list = products.json?.products || products.json || [];
const product = (Array.isArray(list) ? list : []).find((p) => (p.stock ?? 0) > 0);
if (!product) throw new Error(`no in-stock product: ${JSON.stringify(products.json).slice(0, 300)}`);

await api(buyer.cookie, "PUT", "/api/cart", { productId: product.id, quantity: 1 });
const checked = await api(buyer.cookie, "POST", "/api/checkout", {});
const order = checked.json?.orders?.[0];
if (!order?.id) throw new Error(`checkout failed: ${checked.status} ${JSON.stringify(checked.json)}`);

const open = await api(buyer.cookie, "POST", `/api/orders/${order.id}/room`, {});
const orderAfter = await api(buyer.cookie, "GET", `/api/orders/${order.id}`);
const channelId = orderAfter.json?.order?.channelId || open.json?.channelId || `order${order.id}`;

const sendA = await sendRoomText(buyer.user.id, channelId, MARKER_A);
const sendB = await sendRoomText(buyer.user.id, channelId, MARKER_B);
const sendS = await sendRoomText(seller.user.id, channelId, MARKER_SELLER);

const supportReq = await api(buyer.cookie, "POST", `/api/orders/${order.id}/support`, {
  note: `P393-order-support-${Date.now()}`,
});
const requestId = supportReq.json?.request?.id || supportReq.json?.id;

const queue = await api(support.cookie, "GET", "/api/requests");
const requests = queue.json?.requests || [];
const pending =
  requests.find((r) => r.id === requestId) ||
  requests.find((r) => r.orderId === order.id);

const claim = pending?.id
  ? await api(support.cookie, "POST", `/api/requests/${pending.id}/claim`, {})
  : { status: 0, json: { error: "no pending request" } };

const evidence = {
  appKey: APP_KEY,
  orderId: order.id,
  channelId,
  markers: { MARKER_A, MARKER_B, MARKER_SELLER },
  productId: product.id,
  productName: product.name,
  openStatus: open.status,
  nexconnSends: {
    A: { status: sendA.status, code: sendA.json?.code },
    B: { status: sendB.status, code: sendB.json?.code },
    S: { status: sendS.status, code: sendS.json?.code },
  },
  supportRequestStatus: supportReq.status,
  requestId: pending?.id || requestId || null,
  claimStatus: claim.status,
  claimedChannel: claim.json?.request?.channelId || claim.json?.channelId || channelId,
};

writeFileSync(join(OUT, "setup-evidence.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
