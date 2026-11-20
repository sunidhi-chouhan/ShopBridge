# ShopBridge — script for the judges

Two versions: a **3-minute demo video** (the required submission video) and a **2-minute live pitch**.
Then short answers for likely questions. Judging weights: Completeness & UX 50%, Innovation 30%, Business 20%.

**Before recording**
- Three browser windows (or profiles): **Buyer** (Asha), **Seller** (Meera), **Support** (Kabir). Use the Explore Demo buttons; never show a password.
- Buyer's reading language set to **Hindi** (Account → Conversation language). Seller and support read English.
- Account menu → **Reset demo data…**, so the story starts clean.
- Open the app once a minute before recording so the free Render server is awake.
- Nexconn Console for the App Key: Translation on, pre-join history allowed, Audio & Video on (only if you show a call).

---

## A. 3-minute demo video

| Time | On screen | Say |
|---|---|---|
| 0:00–0:15 | Landing page. The headline rotates through languages; the live board plays a Hindi ↔ English exchange; name-tagged cursors roam. | "In India, the buyer often reads Hindi and the seller writes English. When an order goes wrong, the conversation breaks. ShopBridge gives **every order its own conversation, in every language**, built on Nexconn." |
| 0:15–0:35 | Click **Buyer**. Shop → Maheshwari cotton sari → **Add to bag** → open the bag → place the (simulated) order. | "Asha buys a hand-woven sari. Checkout opens a **Nexconn group channel just for this order**, created on our server, so only the buyer, the seller and later support can ever be in it." |
| 0:35–1:05 | Inbox → the order. Asha sends a Hindi message and a photo of the frayed border. Switch to **Seller** window: Meera sees it in English, taps **Original** once. | "Asha writes in Hindi and attaches a photo. Meera reads it in English, with the original one tap away. This is **Nexconn's translation module**, not a copy-paste into a translator." |
| 1:05–1:25 | Meera replies in English, makes an **offer**, marks the order **Packed → Shipped**. Back to the buyer: everything in Hindi, with order cards in the chat. | "Meera answers in English; Asha reads it in Hindi. Offers, tracking and status changes are **custom Nexconn messages sent by our server**, so nobody can fake a price or a 'refund approved' message." |
| 1:25–1:55 | Buyer taps **Get help with this order** → **Ask support to join**. **Support** window: Kabir claims the case and joins. He scrolls up through messages from before he joined; the **Case brief** is on the right; **Draft a reply with AI** fills the composer (needs `GEMINI_API_KEY` on the server; skip this beat if it is not set). | "Asha asks for help. Kabir joins **the same channel** and, thanks to Nexconn's pre-join history, sees everything from before he arrived. The case brief comes from real order data; the AI draft is only a suggestion he edits and sends himself." |
| 1:55–2:15 | Kabir uses **Propose resolution** → **Replacement**. Asha accepts in Hindi. The case closes with a resolved card. | "He proposes a replacement, Asha accepts in her language, and the case closes inside the same conversation. Buyer, seller and support never left one thread." |
| 2:15–2:50 | **Seller** → Orders dashboard (numbers count up) → **Go live**. **Buyer** → Shop shows the **Live now** banner → join. Asha taps a Hindi quick question; Meera answers in English; hearts float; Asha taps **Buy now**; "🎉 Asha just bought it!" appears for everyone. | "And before the sale even happens: **Live from the loom**. Meera goes live on a **Nexconn open channel**. Viewers ask in their language and hear back in theirs. One tap buys the piece on stage, and that purchase opens its own order conversation. Live commerce and support, on one chat platform." |
| 2:50–3:00 | Back to the landing page or the feature marquee. | "ShopBridge: every order is a conversation, in every language. Built on the Nexconn Chat SDK, Call SDK and open channels." |

If calls are enabled, swap 1:25–1:55 for a short **video call** from the order header ("Show me the border") and mention that the call log is posted into the order chat.

---

## B. 2-minute live pitch

**Problem (20 s).**
"Small sellers on Indian marketplaces lose sales and get bad reviews because buyer and seller don't share a language, and support arrives with no context. Every order turns into scattered WhatsApp messages."

**What we built (60 s), while showing the app.**
"ShopBridge puts one Nexconn conversation behind every order.
- The buyer reads Hindi; the seller writes English. **Nexconn translates the whole thread live**, original always one tap away.
- Order events, offers and tracking are **server-sent custom messages**, so they can't be spoofed.
- Photos, voice notes with **speech-to-text**, replies, reactions, read receipts: all Nexconn.
- When a case needs help, support **joins the same channel with full history** and closes it there.
- And sellers can go **live** on Nexconn **open channels**: the audience chats in their own languages and buys in one tap."

**Why it matters (25 s).**
"It's built for the long tail: artisans, small shops, buyers who are more comfortable in Hindi than English. They don't install anything new. They get a better marketplace conversation."

**Business (15 s).**
"Two ways to make money: a per-seller subscription for live selling and multilingual support, or a per-resolved-conversation fee for marketplaces that embed ShopBridge as their order-chat layer."

---

## C. Nexconn features to name (and where they are)

| Feature | Where in the demo |
|---|---|
| Group channels created by the server, members only (`joinPerm: 3`) | Checkout → order chat |
| Translation (`translateMessages`, `translateTexts`) | Every message, live room, "how they'll read it" preview |
| Pre-join history | Support agent joins a case |
| Image, file, GIF, HD voice messages + speech-to-text | Photo evidence, voice notes |
| Custom messages (`SB:Offer`, `SB:Track`, `SB:Order`, `SB:Live`…) | Offers, tracking, order events, live sales |
| Reply, edit, delete, reactions (message metadata), read receipts, drafts, pin, mute | Inbox |
| **Open channels**: create, enter/exit, metadata, participant events, destroy | Live from the loom |
| Call SDK (voice / video) | Order header call button |
| Connection status handling | "Reconnecting…" banner |

---

## D. Likely questions

- **Is payment real?** "No. Payment is simulated and labelled so. The work is in the conversation layer."
- **Can a buyer fake a 'refund approved' message?** "No. Order events and offers come only from a server-side system user, and the client only renders them from that sender."
- **How does support see old messages?** "Nexconn's pre-join history setting. The agent is added to the existing channel by our server."
- **Why open channels for live?** "No persistent membership, no member limit, and room state (the featured product and sold count) lives in open-channel metadata, so every viewer is in sync."
- **Does the AI act on its own?** "Never. It drafts a reply from the order record and conversation; the agent edits and sends it."
- **What's next?** "More Indian languages, voice-first buying for low-literacy users, and a marketplace integration."

---

## E. Traction (worth a significant bonus)

Judges count **active users on the Nexconn App Key**. Before submitting:
1. Share the live link with 20–50 real people. Each creates their own buyer account (**Create account**) and sends at least one message.
2. Screenshot the Nexconn Console's active-user analytics and add it to the PDF write-up.
3. Quote two or three lines of user feedback.
