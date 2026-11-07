# ShopBridge

**Every order has a conversation — in every language.** A Hindi-reading buyer and an English-writing
seller talk about an order in one Nexconn channel, each reading in their own language. When something
goes wrong, a support agent joins the *same* conversation with its full history and resolves it.

Built on the **Nexconn Chat SDK** (`@nexconn/chat` 26.2.1) and **Call SDK** (`@nexconn/call` 26.2.1).

## Nexconn features used

| Feature | Nexconn API |
| --- | --- |
| One group channel per order; server-only membership | Server API `group-channel/create` (`joinPerm: 3`), `group-channel/join` |
| Live translation of the whole conversation | `translateModule.translateMessages`, `translateTexts`, `TranslateHandler` |
| Support agent sees history from before joining | Console "pre-join history" + `createMessagesQuery` |
| Photos, files, voice notes | `Helper.createSend{Image,GIF,File,HDVoice}MessageParams` + `sendMediaMessage` |
| Voice transcript | `message.requestSpeechToText()` / `onSpeechToTextCompleted` |
| Reply, edit, delete | `SendReferenceMessageParams`, `BaseChannel.updateMessage`, `deleteMessageForAll` / `deleteMessagesForMe` |
| Reactions | message metadata (`setMetadata` / `onMessageMetadataUpdated`) |
| Read receipts, unread | `needReceipt`, `sendReadReceiptResponse`, `getMessageReadReceiptInfo`, `clearUnreadCount` |
| Drafts, pin, mute | `saveDraft`, `pin`/`unpin`, `setNoDisturbLevel` |
| Order events, offers, tracking, order & call cards, typing | `registerCustomMessages` (`SB:*`), server-sent where trust matters |
| Voice & video calls | `NCCallEngine` `startCall` / `acceptCall` / `endCall`, `setLocal/RemoteVideoView`, media switch |
| Connection state | `addConnectionStatusHandler` |

> `.npmrc` sets `legacy-peer-deps=true`: `@nexconn/call` 26.2.1 pins its peers to chat/engine 26.2.0
> while the app uses 26.2.1. `npm ci` on Render uses it automatically.

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
| `npm test` | Store, auth and HTTP API tests (Node test runner) |
| `npm run test:pg:up` / `test:pg:down` | Start / stop the disposable local Postgres 18 used by tests |

## Tests

```bash
npm run test:pg:up   # local Docker Postgres on 127.0.0.1:55432 (RAM only)
npm test
npm run test:pg:down
```

Tests never read `.env` and refuse any database that is not on localhost with a name ending in `_test`, so they cannot touch Neon. Without the container, the Postgres suites are skipped and the rest still run.

`POST /api/dev/reseed` is refused when `NODE_ENV=production`.

## Nexconn Console prerequisites (production App Key)

- Translation: **Enabled**
- Pre-join history access by new member: **Allowed**
- Audio & video calling: **Enabled** (otherwise calls show "not enabled for this App Key", SDK code 80006)
- Speech-to-text (optional, for voice transcripts)

## Deploy

See `RENDER.md` (Render Free + Neon Free) and `HOSTED_DEMO_INIT.md` (one-time Postgres import). Do not put secrets in git.

## Safety

- Never commit `.env`, `data/`, or `backups/`.
- The Nexconn App Secret stays on the server.
- Chat tokens are issued only to authenticated sessions.
