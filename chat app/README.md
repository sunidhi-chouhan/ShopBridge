# ShopBridge

Marketplace chat for buyers, sellers, and support agents — powered by Nexconn Chat SDK 26.2.1.

ShopBridge is a single Node.js process that serves the Vite React app (`dist/web`) and the `/api` backend.

- **Local default:** JSON file `data/store.json` (when `DATABASE_URL` is unset).
- **Hosted / production:** PostgreSQL via `DATABASE_URL` (Neon Free + Render Free — see `RENDER.md`).

## Local run

```bash
cp .env.example .env
# Set NEXCONN_APP_KEY and NEXCONN_APP_SECRET (server-only). Never commit .env.
# Optional: DATABASE_URL for local Postgres; omit to use JSON.
npm install
npm run seed          # local JSON only — never against hosted Postgres
npm run dev
```

Open the Vite URL (default http://127.0.0.1:5173). Use Explore Demo buttons, or email sign-in. Demo account emails and password setup are in `DEMO.md`.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | API + Vite with proxy |
| `npm run build` | Production frontend → `dist/web` |
| `npm start` | Serve API + built SPA (`tsx server/index.ts`) |
| `npm run seed` | **Local wipe/rebuild** of `data/store.json` |
| `npm run demo:prepare` | Soft-clean local demo clutter |
| `npm run demo:accept` | Local API smoke (needs running server) |
| `npm run db:migrate` | Apply Postgres schema migrations |
| `npm run db:import:dry` | Dry-run JSON → Postgres import |
| `npm run db:import` | Import curated `data/store.json` into Postgres |
| `npm run db:verify` | Compare JSON vs Postgres (safe fields only) |

`POST /api/dev/reseed` is refused when `NODE_ENV=production`.

## Deploy

See `RENDER.md` (Render Free + Neon Free) and `HOSTED_DEMO_INIT.md` (one-time Postgres import). Do not put secrets in git.

## Safety

- Never commit `.env`, `data/`, or `backups/`.
- The Nexconn App Secret stays on the server.
- Chat tokens are issued only to authenticated sessions.
