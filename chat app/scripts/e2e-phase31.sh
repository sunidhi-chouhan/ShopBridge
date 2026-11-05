#!/usr/bin/env bash
set -euo pipefail
BASE=http://127.0.0.1:8787
PASS="${SHOPBRIDGE_DEMO_PASSWORD:?Set SHOPBRIDGE_DEMO_PASSWORD in the environment}"
COOKIE_BUYER=$(mktemp)
COOKIE_SELLER=$(mktemp)
COOKIE_SUPPORT=$(mktemp)
COOKIE_OTHER=$(mktemp)

login() {
  curl -sS -c "$1" -b "$1" -X POST "$BASE/api/session" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$2\",\"password\":\"$PASS\"}" >/dev/null
}

json() {
  local code=$1
  shift
  node -e "$code" "$@"
}

echo "1. health"
curl -sS "$BASE/api/health" | json 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); if(!j.ok||!j.nexconn) process.exit(1); console.log("PASS health", j)})'

echo "2. buyer login + checkout with room"
login "$COOKIE_BUYER" buyer@shopbridge.demo
PROD=$(curl -sS -b "$COOKIE_BUYER" "$BASE/api/products" | json 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); const p=j.products.find(x=>x.stock>0); if(!p) process.exit(1); console.log(p.id)})')
curl -sS -b "$COOKIE_BUYER" -X PUT "$BASE/api/cart" -H 'Content-Type: application/json' \
  -d "{\"productId\":\"$PROD\",\"quantity\":1}" >/dev/null
CHECKOUT=$(curl -sS -b "$COOKIE_BUYER" -X POST "$BASE/api/checkout" -H 'Content-Type: application/json' -d '{}')
echo "$CHECKOUT" | json 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); const o=j.orders?.[0]; if(!o) {console.error(j); process.exit(1)} if(!j.roomsReady || !o.channelId) {console.error("room missing", j); process.exit(1)} console.log("PASS checkout", o.id, o.channelId); require("fs").writeFileSync("/tmp/p31.json", JSON.stringify({orderId:o.id,channelId:o.channelId,buyerId:o.buyer.id,sellerId:o.seller.id}))})'
ORDER=$(json 'console.log(JSON.parse(require("fs").readFileSync("/tmp/p31.json","utf8")).orderId)')
CHANNEL=$(json 'console.log(JSON.parse(require("fs").readFileSync("/tmp/p31.json","utf8")).channelId)')

echo "3. idempotent room retry"
CH2=$(curl -sS -b "$COOKIE_BUYER" -X POST "$BASE/api/orders/$ORDER/room" -H 'Content-Type: application/json' -d '{}' \
  | json 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); console.log(j.order.channelId)})')
test "$CH2" = "$CHANNEL"
echo "PASS retry same channel $CH2"

echo "4. seller access"
login "$COOKIE_SELLER" seller@shopbridge.demo
curl -sS -b "$COOKIE_SELLER" "$BASE/api/orders/$ORDER" \
  | json 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); if(j.order?.channelId!==process.argv[1]) process.exit(1); console.log("PASS seller order")})' "$CHANNEL"
curl -sS -b "$COOKIE_SELLER" "$BASE/api/conversations" \
  | json 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); if(!j.conversations?.some(c=>c.id===process.argv[1])) process.exit(1); console.log("PASS seller inbox")})' "$ORDER"

echo "5. server messages on shared channel"
set -a; # shellcheck disable=SC1091
source .env
set +a
BUYER_ID=$(json 'console.log(JSON.parse(require("fs").readFileSync("/tmp/p31.json","utf8")).buyerId)')
SELLER_ID=$(json 'console.log(JSON.parse(require("fs").readFileSync("/tmp/p31.json","utf8")).sellerId)')
STAMP=$(date +%s)
npx tsx <<EOF
import { readFileSync } from "fs";
import path from "path";
for (const line of readFileSync(path.resolve(".env"),"utf8").split("\n")) {
  const t=line.trim(); if(!t||t.startsWith("#")) continue; const i=t.indexOf("="); if(i<0) continue;
  const k=t.slice(0,i).trim(); const v=t.slice(i+1).trim().replace(/^["']|["']$/g,"");
  if (process.env[k]===undefined) process.env[k]=v;
}
const { sendRoomText } = await import("./server/nexconn.ts");
await sendRoomText("$SELLER_ID", "$CHANNEL", "Seller UI $STAMP");
await sendRoomText("$BUYER_ID", "$CHANNEL", "Buyer UI $STAMP");
console.log("PASS nexconn sendRoomText both parties");
EOF

echo "6. support escalate + claim join same channel"
curl -sS -b "$COOKIE_BUYER" -X POST "$BASE/api/orders/$ORDER/support" -H 'Content-Type: application/json' \
  -d '{"note":"Need help with this order"}' \
  | json 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); if(j.request?.channelId!==process.argv[1]||j.request?.orderId!==process.argv[2]) process.exit(1); require("fs").writeFileSync("/tmp/p31-req.txt", j.request.id); console.log("PASS support request", j.request.id)})' "$CHANNEL" "$ORDER"
REQ=$(cat /tmp/p31-req.txt)
login "$COOKIE_SUPPORT" support@shopbridge.demo
curl -sS -b "$COOKIE_SUPPORT" -X POST "$BASE/api/requests/$REQ/claim" -H 'Content-Type: application/json' -d '{}' \
  | json 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); if(!j.nexconn||j.request?.channelId!==process.argv[1]||j.request?.status!=="assigned") process.exit(1); console.log("PASS claim join", j.request.coordinator.name); require("fs").writeFileSync("/tmp/p31-support.json", JSON.stringify({id:j.request.coordinator.id}))})' "$CHANNEL"
SUPPORT_ID=$(json 'console.log(JSON.parse(require("fs").readFileSync("/tmp/p31-support.json","utf8")).id)')
npx tsx <<EOF
import { readFileSync } from "fs";
import path from "path";
for (const line of readFileSync(path.resolve(".env"),"utf8").split("\n")) {
  const t=line.trim(); if(!t||t.startsWith("#")) continue; const i=t.indexOf("="); if(i<0) continue;
  const k=t.slice(0,i).trim(); const v=t.slice(i+1).trim().replace(/^["']|["']$/g,"");
  if (process.env[k]===undefined) process.env[k]=v;
}
const { sendRoomText } = await import("./server/nexconn.ts");
await sendRoomText("$SUPPORT_ID", "$CHANNEL", "Support agent $STAMP");
console.log("PASS support message on same channel");
EOF
curl -sS -b "$COOKIE_SUPPORT" "$BASE/api/conversations" \
  | json 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); if(!j.conversations?.some(c=>c.channelId===process.argv[1])) process.exit(1); console.log("PASS support inbox")})' "$CHANNEL"

echo "7. unauthorized checks"
curl -sS -b "$COOKIE_SELLER" -X POST "$BASE/api/requests/$REQ/claim" -H 'Content-Type: application/json' -d '{}' \
  | json 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); if(j.error?.code!=="FORBIDDEN") process.exit(1); console.log("PASS seller cannot claim")})'
# second order
PROD2=$(curl -sS -b "$COOKIE_BUYER" "$BASE/api/products" | json 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); const p=j.products.find(x=>x.stock>0&&x.id!==process.argv[1]); console.log(p.id)})' "$PROD")
curl -sS -b "$COOKIE_BUYER" -X PUT "$BASE/api/cart" -H 'Content-Type: application/json' \
  -d "{\"productId\":\"$PROD2\",\"quantity\":1}" >/dev/null
CHECK2=$(curl -sS -b "$COOKIE_BUYER" -X POST "$BASE/api/checkout" -H 'Content-Type: application/json' -d '{}')
echo "$CHECK2" | json 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); const o=j.orders?.[0]; if(!o?.channelId||o.channelId===process.argv[1]) {console.error(j); process.exit(1)} console.log("PASS second order distinct channel", o.id, o.channelId); require("fs").writeFileSync("/tmp/p31-o2.txt", o.id)})' "$CHANNEL"
O2=$(cat /tmp/p31-o2.txt)
curl -sS -b "$COOKIE_SUPPORT" "$BASE/api/orders/$O2" \
  | json 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); if(j.error?.code!=="NOT_FOUND") process.exit(1); console.log("PASS support cannot open unclaimed order2")})'

echo "ALL PHASE 3.1 API CHECKS PASSED"
