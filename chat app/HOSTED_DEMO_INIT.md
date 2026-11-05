# Hosted demo data — one-time Persistent Disk initialization

ShopBridge **never** commits `data/store.json`. Production (`NODE_ENV=production`) **does not** auto-create or overwrite a store. Until `SHOPBRIDGE_DATA_DIR/store.json` exists, `/api/health` returns **503** and API writes fail closed.

Use this **offline → copy → verify** flow. Do **not** run `npm run seed`, `demo:prepare`, or `/api/dev/reseed` against the live Render service.

## Target demo shape

After import, the hosted store should include:

| Asset | Expectation |
| --- | --- |
| Users | Three demo roles: buyer / seller / support (`buyer@`, `seller@`, `support@` `@shopbridge.demo`) |
| Products | Eight catalogue items (seller-owned) |
| Orders | Two orders, including the multilingual **showcase** order and the acceptance/demo order |
| Support | Order-linked support requests for those orders (not community audit noise) |
| Channels | Order `channelId` values of the form `order{orderId}` preserved |

Nexconn message history lives in Nexconn Cloud (tied to those channel IDs) — copying `store.json` preserves app linkage; Console Translation / pre-join settings must remain enabled for the App Key.

## Procedure (controlled, one-time)

### 1. Prepare locally (private machine)

1. Confirm the local demo is correct (buyer/seller/support, 8 products, 2 orders). Prefer the already curated local store over a fresh seed if showcase chat history matters.
2. Copy the file to a **private** path (not under git):

```bash
mkdir -p "$HOME/shopbridge-private"
cp data/store.json "$HOME/shopbridge-private/store-$(date -u +%Y%m%dT%H%M%SZ).json"
```

3. Optional shape check **without** printing secrets or password hashes:

```bash
node scripts/verify-store-shape.mjs data/store.json
```

### 2. Place on the Render disk

With the Web Service created, disk mounted at `/var/data`, and `SHOPBRIDGE_DATA_DIR=/var/data`:

1. Use Render Shell / SSH / one-time secure upload (SCP, SFTP, or dashboard file copy) to write:

   `/var/data/store.json`

2. Permissions: readable/writable by the service user.
3. **Do not** paste store contents into tickets, chat, or git.

### 3. Restart and verify (no credential dumps)

1. Restart the Web Service (or wait for health recovery).
2. `GET /api/health` → HTTP **200**, `"ok": true`, `"store": { "exists": true }`.
3. Sign in with Explore Demo (or local-known demo password from your private env — never log it).
4. Confirm via UI or authenticated API:
   - Product count **8**
   - Order count **2** (showcase + second demo order)
   - Order conversations open; support queue shows order-linked cases
5. Re-run shape verification against a **downloaded private copy** if needed:

```bash
node scripts/verify-store-shape.mjs /path/to/private-copy.json
```

The verifier prints counts, emails, roles, order ids, and channel ids only — **never** `passwordHash`, session tokens, or env secrets.

## What not to do

- Commit `data/store.json` or any copy under the public repo
- Put `npm run seed` / `demo:prepare` in the Render Start Command
- Enable `SHOPBRIDGE_ALLOW_RESEED` on Render
- Run destructive seed against the hosted app “to fix” a bad disk
- Share password hashes, session tokens, or `.env` values when debugging

## If health stays 503

| Symptom | Action |
| --- | --- |
| `STORE_MISSING` | File not at `$SHOPBRIDGE_DATA_DIR/store.json` — fix mount/path/copy |
| `STORE_CORRUPT` / `STORE_INVALID` | Restore the private backup; do not let the app overwrite |
| `nexconn: false` | Set `NEXCONN_APP_KEY` / `NEXCONN_APP_SECRET` in the dashboard (separate from store init) |
