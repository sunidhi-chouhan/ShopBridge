# ShopBridge — Render deployment (single instance)

Use this checklist when creating the Render service. **Do not paste secrets into git or tickets.**

## Architecture

- **Service type:** Web Service
- **Runtime:** Node
- **Shape:** One process serves Vite `dist/web` and `/api/*`
- **Persistence:** JSON file via Persistent Disk (not PostgreSQL yet)
- **Instances:** **1 only** — the in-process write queue does not protect multiple Node processes sharing one `store.json`

## Why single-instance JSON is temporary

Atomic temp+rename and a promise queue are safe for **one** writer process. Two instances race on `store.json` and can lose updates. PostgreSQL (or similar) is the correct next step for multi-instance durability; until then keep instance count at **1** and attach a disk.

## Build & start

| Setting | Value |
| --- | --- |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

`tsx` is a **production** dependency so `npm start` (`tsx server/index.ts`) works when Render installs production deps only. Build still needs Vite (devDependency) — `npm ci` during **build** installs all deps before prune/start; if your Render plan prunes between build and start, ensure the start image still has production deps including `tsx` (default Render flow keeps `node_modules` from build).

## Persistent Disk

| Setting | Value |
| --- | --- |
| Mount path | `/var/data` |
| Env | `SHOPBRIDGE_DATA_DIR=/var/data` |

The app reads/writes `/var/data/store.json` and writes backups under `/var/data/backups/` (never under static assets).

**First deploy:** follow `HOSTED_DEMO_INIT.md` — copy a known-good `store.json` onto the disk via a private, one-time transfer. With `NODE_ENV=production`, a **missing** store makes `/api/health` return **503** and will **not** auto-create or overwrite. Never run `npm run seed` on the hosted service.

## Environment variable names

Set in the Render dashboard (values never committed):

| Name | Purpose |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | Provided by Render |
| `SHOPBRIDGE_DATA_DIR` | `/var/data` |
| `NEXCONN_APP_KEY` | Nexconn app key |
| `NEXCONN_APP_SECRET` | Server-only secret |
| `NEXCONN_API_BASE` | Optional; defaults to Singapore light API |
| `SHOPBRIDGE_DEMO_PASSWORD` | Optional hackathon demo login only |
| `SHOPBRIDGE_ALLOW_RESEED` | **Leave unset** |

## Ops rules

- Never put `npm run seed`, `demo:prepare`, or reseed in the Start Command.
- Do not enable autoscaling / multiple instances.
- Keep Nexconn Console Translation + Group pre-join history enabled for the live demo App Key.
- Confirm `/api/health` is HTTP 200 with `"ok": true` and `"store": { "exists": true }` after disk is provisioned.
- See `HOSTED_DEMO_INIT.md` for the safe import and verification steps.
