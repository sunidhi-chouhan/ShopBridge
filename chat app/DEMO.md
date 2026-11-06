# ShopBridge demo accounts

These accounts exist only in the local JSON store (`data/store.json`). They are created by `npm run seed` and by first boot when the store is missing **and** `NODE_ENV` is not `production`.

Roles are assigned on the server. The sign-in page never sends a role, and demo buttons never embed passwords.

| Desk | Email | Role |
| --- | --- | --- |
| Demo Buyer | `buyer@shopbridge.demo` | Buyer (`member`) |
| Demo Seller | `seller@shopbridge.demo` | Seller (`volunteer`) |
| Demo Support Agent | `support@shopbridge.demo` | Support (`coordinator`) |

Set the shared demo password with `SHOPBRIDGE_DEMO_PASSWORD` in your **local** `.env` before seeding (see `.env.example`). Do not publish that value in screenshots, tickets, or public docs. Prefer the on-page **Explore Demo** buttons, which never need a typed password.

## Reset the demo store (local only)

Full wipe (empty orders/requests, fresh catalogue):

```bash
npm run seed
```

That writes a backup under `backups/` (gitignored), then replaces `data/store.json` with:

- the three demo accounts above
- eight catalogue products owned by Meera Joshi (demo seller)
- empty carts, orders, and support requests

Soft clean (keep demo accounts + catalogue + showcase multilingual order when present; drop accidental audit users/orders):

```bash
npm run demo:prepare
```

Acceptance API smoke (requires `npm run dev` and `.env` Nexconn keys):

```bash
npm run demo:accept
```

**Do not** run seed/reseed/`demo:prepare` against a hosted production instance. `POST /api/dev/reseed` is refused when `NODE_ENV=production`, and otherwise requires `SHOPBRIDGE_ALLOW_RESEED=1`. For Neon/Render Postgres import, see `HOSTED_DEMO_INIT.md`.

## Hackathon demonstration sequence

Prerequisite: Nexconn Console for the App Key in `.env` has **Translation** enabled and **Enable pre-join history access by new member** set to Allowed.

1. Start `npm run dev` → open the Vite URL.
2. **Buyer** demo button → Shop → open Maheshwari cotton sari → Add to bag → Checkout.
3. Orders / Inbox → open the new order room → set **Read messages in** to Hindi → enable **Auto-translate peers**.
4. Send a Hindi message (example: `नमस्ते, मुझे इस साड़ी को बदलना है।`).
5. Sign out → **Seller** → Inbox → same order → English + Auto-translate → confirm original Hindi + **Translated · English**.
6. Seller replies in English.
7. Buyer inbox → confirm Hindi translation of the seller reply; original English remains available.
8. Buyer → **Get order support** on that conversation (not Contact general support).
9. Sign out → **Support agent** → Queue → claim the order support case → Inbox.
10. Confirm the agent sees buyer/seller messages from **before** joining, then send a reply visible to buyer and seller.

App Secrets and demo passwords must never appear in screenshots or public docs.
