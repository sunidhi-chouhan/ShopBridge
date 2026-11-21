# ShopBridge — screen-recording script (click by click)

Record the screen first; add the voiceover afterwards. Every click below was tested on 2026-11-21.
The **Voiceover** lines are for later. While recording, just follow **Do** and wait for **You should see**.

The story: Meera (seller, writes English) goes live → Asha (buyer, reads Hindi) buys the sari live →
they chat in two languages → offer → video call → shipping → support resolves a problem.

Raw recording ≈ 6–7 minutes. Trim the waiting time when you edit.

---

## 0. Setup (do this before you press Record)

**Three separate browser sessions** (a normal and an incognito window in the same browser share nothing, so that's two; use a second browser or a second Chrome profile for the third):

| Window | Browser | Sign in as |
|---|---|---|
| **W1 – Buyer** | Chrome (normal) | **Buyer** (Asha Rao) |
| **W2 – Seller** | Chrome **Incognito** | **Seller** (Meera Joshi) |
| **W3 – Support** | Edge / Firefox / 2nd Chrome profile | **Support agent** (Kabir Shah) |

1. Open your live app URL in all three. Wait for it to load (Render may take ~30 s to wake up).
2. In each window click the matching **Explore demo** button: **BUYER**, **SELLER**, **SUPPORT AGENT**.
3. If the account menu (your name, top right) shows **Reset demo data…**, click it in any window and confirm. The story then starts clean. If you don't see it, skip this; the script works anyway because you'll place a new order.
4. **W1 (Buyer) only:** click **Demo controls** (bottom left) → turn on **Call buttons place demo calls** → press `Esc`.
   Then do a practice video call once (Inbox → any chat → camera icon → **Call Meera** → **End**) so the browser asks for camera/mic permission **now**, not on camera. Click **Allow**.
5. Copy this Hindi line to your clipboard; you'll paste it in step 7.3:
   `साड़ी का ज़री बॉर्डर उधड़ा हुआ है।`
6. Each window maximised. You'll switch between them with `Alt+Tab`.
7. Do one full dry run, reset again (step 3), then record the final take.

Recording tool on Ubuntu: **OBS Studio** or **SimpleScreenRecorder**, full screen, 1080p. Upload to YouTube (unlisted) / Loom / Google Drive with "anyone with the link".

---

## Scene 1 — Opening (≈15 s)

Open a 4th, private window (or sign out anywhere) so the **landing page** shows.

| # | Do | You should see |
|---|---|---|
| 1.1 | Just let it play for ~10 s. Move the mouse a little. | Headline "Every order is a *conversation.* in हिन्दी / English / Español…" rotating, the order chat board playing Hindi ↔ English, cursors "Asha · buyer", "Meera · seller", "Kabir · support", feature strip scrolling at the bottom. |

> **Voiceover:** "Indian buyers often read Hindi; sellers write English. ShopBridge gives every order its own conversation — in every language — built on the Nexconn Chat SDK."

---

## Scene 2 — Seller goes live (≈20 s) · **W2 Seller**

| # | Do | You should see |
|---|---|---|
| 2.1 | Left menu → **Orders**. Pause 2 s. | Dashboard numbers count up; dark card "Sell live, in every language." |
| 2.2 | Click **Go live →** on that card. | "Sell live, in every language." page with a form. |
| 2.3 | Leave the title **Live from the loom**. Under **Put on stage first**, click **Maheshwari cotton sari**. | Sari tile highlighted. |
| 2.4 | Click **● Go live**. | Live room: big sari photo, red **● LIVE**, 👁 viewers, timer, chat on the right, **Put on stage** product strip, **End live**. |

> **Voiceover:** "Meera goes live from her loom. The room is a Nexconn open channel: anyone can drop in, no membership needed."

---

## Scene 3 — Buyer joins the live room and buys (≈45 s) · **W1 Buyer**

| # | Do | You should see |
|---|---|---|
| 3.1 | Left menu → **Shop**. | Black **● LIVE NOW** banner: "Meera Joshi is showing *Maheshwari cotton sari*". |
| 3.2 | Click the banner (**Join →**). | Same live room. Chat header says "Reading in Hindi · translated by Nexconn". |
| 3.3 | Click the first Hindi chip **क्या यह शुद्ध कॉटन है?** | Message appears in the chat. |
| 3.4 | Click the **♥** button 5–6 times quickly. | Hearts float up over the photo. |

Switch to **W2 Seller**:

| # | Do | You should see |
|---|---|---|
| 3.5 | Look at the chat. | "Asha Rao: **Is this pure cotton?**" with **Original** under it. Hearts count went up. 👁 shows 2. |
| 3.6 | Type `Yes! Pure handloom cotton with real zari on the border.` and press `Enter`. | Your message with a **Host** badge. |

Switch to **W1 Buyer**:

| # | Do | You should see |
|---|---|---|
| 3.7 | Look at the chat (wait 2–3 s). | Meera's reply **in Hindi**, **Host** badge, **Original** link. Click **Original** once, then click it back. |
| 3.8 | Click **Buy now · ₹4,800**. | Toast "Order placed…", the button turns into **Message the maker →**. "🎉 Asha just bought Maheshwari cotton sari" in the chat. |

Switch to **W2 Seller**:

| # | Do | You should see |
|---|---|---|
| 3.9 | Watch the stage. | Pop-up "**Asha just bought it!**", 🛍 **1 sold**. |
| 3.10 | Click **End live** → **OK**. | Back to the Live page. |

> **Voiceover:** "Asha asks in Hindi; Meera reads English and answers in English; Asha reads it in Hindi. One tap buys the piece on stage — and the sale is announced to everyone in the room."

---

## Scene 4 — Order chat, two languages, price offer (≈50 s)

**W1 Buyer**:

| # | Do | You should see |
|---|---|---|
| 4.1 | Left menu → **Inbox** → top conversation **Meera Joshi · Maheshwari cotton sari · Placed**. (The live room now says the session ended. That's expected.) | The order conversation. Right panel: **Order details** with Placed → Packed → Shipped → Delivered. |
| 4.2 | Click the Hindi chip **मेरा ऑर्डर कब भेजेंगी?** then press `Enter`. | Your blue bubble in Hindi. |
| 4.3 | Click **+** (Attach, left of the message box) → **Ask for a better price**, then press `Enter`. | "क्या आप थोड़ा कम दाम दे सकती हैं? मैं दीवाली के लिए ख़रीद रही हूँ 🪔" sent. |

**W2 Seller**:

| # | Do | You should see |
|---|---|---|
| 4.4 | Left menu → **Inbox** → top conversation **Asha Rao · Maheshwari cotton sari · Placed**. | Asha's messages **in English**: "When will you ship my order?", "Can you give me a slightly lower price? I am shopping for Diwali 🪔", each with "Translated from Hindi · **Show original**". |
| 4.5 | Click **Show original** on one message, wait 2 s, click it again. | Toggles Hindi ↔ English. |
| 4.6 | Click the chip **Thank you for your order! 🙏** then `Enter`. | Sent. |
| 4.7 | Right panel → **Send a price offer**. In **New total**, type `4500`. Leave the note "Festive price · free shipping". Click **Send offer**. | A **PRICE OFFER** card: ₹4,500 (₹4,800 struck through). |

**W1 Buyer**:

| # | Do | You should see |
|---|---|---|
| 4.8 | Look at the chat. | Meera's "Thank you…" **in Hindi**, and the **PRICE OFFER** card ₹4,500 with **Decline** / **Accept**. |
| 4.9 | Click **Accept**. | "Offer accepted. Order total updated." Total in the right panel becomes ₹4,500. |

> **Voiceover:** "Every order gets its own Nexconn group channel. Nexconn translates both ways, and the original is one tap away. The price offer is a custom message sent by our server, so the price can't be faked — Asha accepts it in the chat."

---

## Scene 5 — Video call from the order (≈30 s) · **W1 Buyer**

| # | Do | You should see |
|---|---|---|
| 5.1 | Top of the chat → **camera icon** (Video call). | "Ready to see Meera?" with your camera preview. |
| 5.2 | Click **Call Meera**. | "Ringing Meera…", then after ~3 s **Connected**, a timer, badge **DEMO CALL · SIMULATED**. |
| 5.3 | Click **Mute**, then click it again. Click **Camera** off and on. | Buttons toggle. |
| 5.4 | Click the **minimise** icon (top right, two arrows). | Back in the chat with a small floating call. |
| 5.5 | Click any suggested Hindi chip, press `Enter`. | Message sends while the call keeps running. |
| 5.6 | Click the floating call to return → **End**. | Call closes. |

> **Voiceover:** "Asha can video-call Meera right from the order and keep chatting during the call. This uses the Nexconn Call SDK screens; Audio & Video is a paid Nexconn service, so here the other side is simulated."

*(Say "simulated" in the voiceover — the screen shows it too. Honesty here protects you with judges.)*

---

## Scene 6 — Seller ships, buyer tracks (≈35 s)

**W2 Seller** (same conversation, right panel):

| # | Do | You should see |
|---|---|---|
| 6.1 | Click **Mark packed**. | "Packed by Meera Joshi." event in chat; progress moves to Packed. |
| 6.2 | Click **Mark shipped**. A small form opens. Courier is **Delhivery**. **Tracking number (AWB):** `DL4471209IN`. **Arrives:** `Tue, 24 Nov`. Click **Mark shipped**. | "Shipped" event and a **SHIPPED · DELHIVERY** tracking card. |
| 6.3 | Click **Mark delivered**. | "Delivered." event; progress all green. |

**W1 Buyer**:

| # | Do | You should see |
|---|---|---|
| 6.4 | Scroll the chat slowly. | The same events **in Hindi** (पैक किया गया… / भेज दिया गया… / डिलीवर…), the tracking card with **Copy tracking number**, right panel progress all green. |

> **Voiceover:** "When Meera packs and ships, each step is posted into the order conversation by our server — and Asha reads every update in Hindi."

---

## Scene 7 — Problem → support joins → resolved (≈70 s)

**W1 Buyer** (right panel, scroll down):

| # | Do | You should see |
|---|---|---|
| 7.1 | Find the box **इस ऑर्डर के लिए मदद लें**. | Dropdown **क्या समस्या है?** set to "गलत रंग या सामान आया". |
| 7.2 | Leave the dropdown as it is. | — |
| 7.3 | Click the text box under it and paste (`Ctrl+V`) `साड़ी का ज़री बॉर्डर उधड़ा हुआ है।` | Text in the box. |
| 7.4 | Click **सहायता को बुलाएँ**. | Panel shows **सहायता एजेंट का इंतज़ार** (waiting for support). |

**W3 Support**:

| # | Do | You should see |
|---|---|---|
| 7.5 | Left menu → **Queue** (refresh the page if the new case isn't there). | Top case: **Asha Rao with Meera Joshi · waiting 0 min · Waiting for agent**, with the Hindi note. |
| 7.6 | Click that case if it isn't selected → **Claim and join conversation**. | The order conversation opens. "Support joined. Kabir Shah is on this order…" |
| 7.7 | **Scroll up slowly** to the top of the chat. | Everything from **before** Kabir joined: the Hindi questions (in English), the offer, shipping, delivery. |
| 7.8 | Click **Show original** on one of Asha's messages, then again. | Hindi ↔ English. |
| 7.9 | Point the mouse at the **Case brief** on the right for 3 s. | Order facts, buyer's issue in her words + translation, waiting time. |
| 7.10 | *(Optional — only if AI drafts work on your live site; try in the dry run.)* Click **Draft a reply with AI**. | A draft appears in the message box. Delete it or send it. |
| 7.11 | Click the chip **Thanks for waiting, I'm looking into it.** then `Enter`. | Sent. |
| 7.12 | Right panel → **Resolution** dropdown → **Replacement**. In the note type `We will send a new sari on Friday. Please keep the damaged one until pickup.` Click **Propose**. | "Proposed resolution: Replacement…" in the chat. |

Use exactly that note. The demo's sample note "New sari ships Friday" mistranslated into Hindi in testing ("ships" read as boats).

**W1 Buyer**:

| # | Do | You should see |
|---|---|---|
| 7.13 | Look at the chat. | Kabir's message and the proposal **in Hindi**, with **हाँ, इससे हल हो गया** / **नहीं, हल नहीं हुआ**. |
| 7.14 | Click **हाँ, इससे हल हो गया**. | "Resolved. The buyer confirmed the proposal" (in Hindi); panel shows **समाधान हो गया**. |

> **Voiceover:** "The border is frayed, so Asha asks for help in Hindi. Kabir from support joins the same Nexconn channel and — thanks to pre-join history — sees everything that happened before he arrived. He proposes a replacement in English; Asha confirms in Hindi. Resolved, without anyone leaving the conversation."

---

## Scene 8 — Close (≈15 s)

| # | Do | You should see |
|---|---|---|
| 8.1 | **W2 Seller** → left menu **Orders**. | Numbers count up; the new order at the top. |
| 8.2 | **W3 Support** → your name (top right) → **Sign out** → confirm **Sign out**. | Landing page with the rotating languages and feature strip. Hold for 5 s. Stop recording. |

> **Voiceover:** "Live selling, order chat, translation, calls and support — one conversation per order, in every language. That's ShopBridge, built on Nexconn."

---

## If something goes wrong

| Problem | Fix |
|---|---|
| A message doesn't show in the other window | Wait 3 s. Still nothing: refresh that window (`F5`). |
| "Translation unavailable" | Click **Retry translation** on the message. Check Translation is enabled in the Nexconn Console. |
| "This account opened chat in another window" | You signed in as the same role twice. Close the extra window and click **Use chat here**. |
| Live room says "This live session has ended" | The seller ended it or the server restarted. Seller: **Live → Go live** again. |
| The **Buy now** button says the host moved on | The seller changed the product on stage. Buy whatever is on stage, or ask the seller to put the sari back. |
| Video call shows "not enabled for this App Key" | Demo calls are off in this window: **Demo controls → Call buttons place demo calls**. |
| Price offer button missing | Offers only exist before the order ships. Do Scene 4 before Scene 6. |
