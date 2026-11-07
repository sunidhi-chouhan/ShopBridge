# ShopBridge — Render Free + Neon Free deployment

Zero-cost demo hosting: **Render Web Service (free)** + **Neon PostgreSQL (free)**.  
Nexconn Chat remains external (App Key / App Secret in env). **No persistent disk required.**

**Do not paste secrets into git or tickets.**

## Architecture

- **Service type:** Web Service (single instance)
- **Runtime:** Node
- **Shape:** One process serves Vite `dist/web` and `/api/*`
- **Persistence:** PostgreSQL via `DATABASE_URL` (Neon)
- **Chat:** Nexconn SDK (messages not stored in Postgres — only `channel_id` links)

## Build & start

The GitHub repo is a monorepo. Set **Root Directory** to `chat app` (exact path, including the space).

| Setting | Value |
| --- | --- |
| Root Directory | `chat app` |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

`--include=dev` is required because Render sets `NODE_ENV=production` during install and Vite lives in `devDependencies`.

Production **requires** `DATABASE_URL`. The process exits on boot if it is missing when `NODE_ENV=production`. JSON file fallback is **local-only**.

**Do not** set `SHOPBRIDGE_AUTO_MIGRATE=1` on the live service. Neon already has migrations `001`–`003`. Leave auto-migrate unset so boot never applies SQL.

## Neon setup

1. Create a free Neon project and copy the connection string (`DATABASE_URL`).
2. Prefer the pooled connection string if Neon provides one.
3. SSL is enabled automatically for Neon hosts in the app pool.

### First-time schema + demo data (from your machine)

Never run destructive seed against production. Import the curated local store once:

```bash
export DATABASE_URL='postgresql://…'   # Neon URL — keep private
npm run db:migrate
npm run db:import:dry                  # review counts/ids (no hashes printed)
npm run db:import                      # apply once
npm run db:verify
```

If the database already has rows, import aborts unless you pass `--force` intentionally:

```bash
npx tsx server/db/import-store.ts --apply --force
```

Details: `HOSTED_DEMO_INIT.md`.

## Environment variable names

| Name | Purpose |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | Provided by Render |
| `DATABASE_URL` | Neon Postgres URL (**required**) |
| `NEXCONN_APP_KEY` | Nexconn app key |
| `NEXCONN_APP_SECRET` | Server-only secret |
| `NEXCONN_API_BASE` | Optional |
| `SHOPBRIDGE_DEMO_PASSWORD` | Optional hackathon password login |
| `SHOPBRIDGE_ALLOW_RESEED` | **Leave unset** |
| `SHOPBRIDGE_AUTO_MIGRATE` | **Leave unset** (schema already on Neon) |
| `SHOPBRIDGE_DEMO_RESET` | Optional `1` to show “Reset demo data” for demo accounts |
| `SHOPBRIDGE_DATA_DIR` | Not used on Render when Postgres is configured |

## Health

`GET /api/health` returns:

- `200` + `{ ok: true, backend: "postgres", database: { ready: true }, nexconn }` when DB is reachable
- `503` when the database is down or `DATABASE_URL` is missing in production

No connection strings or internal DB errors are exposed in the response body.

## Ops rules

- Instance count **1** (free tier); scale-out needs careful connection limits on Neon free.
- Do not put `npm run seed` or `demo:prepare` in Start Command.
- Keep Nexconn Console Translation + pre-join history enabled for the demo App Key.
