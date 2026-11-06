# Hosted demo data — Neon PostgreSQL import

ShopBridge production uses **PostgreSQL** (`DATABASE_URL`). The curated demo lives in local `data/store.json` for development and as the **import source**. That file is **never** committed to GitHub.

With `NODE_ENV=production`, the app **requires** `DATABASE_URL` and will not fall back to JSON.

## Target demo shape

| Asset | Expectation |
| --- | --- |
| Users | Three demo roles (`buyer@` / `seller@` / `support@` `@shopbridge.demo`) |
| Products | Eight catalogue items |
| Orders | Two orders, including multilingual showcase + channel ids `order{orderId}` |
| Support | Order-linked requests for those orders |

Nexconn message history stays in Nexconn Cloud; import preserves `channel_id` linkage.

## Safe procedure (from your laptop)

1. Confirm local JSON is correct:

```bash
node scripts/verify-store-shape.mjs data/store.json
```

2. Set Neon URL privately (shell only — not git):

```bash
export DATABASE_URL='postgresql://…'
```

3. Migrate schema, dry-run, import, verify:

```bash
npm run db:migrate
npm run db:import:dry
npm run db:import
npm run db:verify
```

4. On Render, set the same `DATABASE_URL` (and Nexconn vars). Deploy. Confirm `GET /api/health` → `backend: "postgres"`, `ok: true`.

5. Sign in with Explore Demo; confirm 8 products, 2 orders, support queue, chat token.

## What not to do

- Commit `data/store.json`
- Run `npm run seed` / `demo:prepare` against Neon/Render
- Enable `SHOPBRIDGE_ALLOW_RESEED` in production
- Print or paste password hashes, session tokens, or `DATABASE_URL` into tickets
- Re-import with `--force` unless you intentionally replace the database

## Verification without secrets

`npm run db:verify` and `verify-store-shape.mjs` print ids, emails, roles, channel ids, and counts only — never password hashes.
