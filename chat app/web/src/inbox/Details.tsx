import { useEffect, useState } from "react";
import {
  RESOLUTIONS,
  nextOrderStatus,
  type HelpRequestView,
  type OrderView,
  type Resolution,
} from "../../../shared/types";
import {
  advanceOrder,
  answerResolution,
  claimOrderSupport,
  makeOffer,
  proposeResolution,
  requestOrderSupport,
} from "../api";
import { useSession } from "../app/session";
import type { ChatLine } from "../chat/nexconn";
import { usePresence } from "../chat/presence";
import { CaseBrief } from "../conversation/CaseBrief";
import { RESOLUTION_COPY, t } from "../i18n";
import { statusCopy } from "../ui/OrderCard";
import { setMuted, setPinned, type IxMessage } from "./engine";
import type { Party } from "./Chat";
import { Icon, fmtDay, fmtTime, money } from "./ui";

const STEPS = ["placed", "packed", "shipped", "delivered"] as const;
const REASONS = ["Wrong colour or item received", "Item damaged", "Not delivered yet", "Seller not responding", "Something else"];
const REASONS_HI = ["गलत रंग या सामान आया", "सामान ख़राब है", "अभी तक नहीं मिला", "विक्रेता जवाब नहीं दे रहे", "कुछ और"];

export function Details({
  user,
  party,
  order,
  support,
  messages,
  prefillNote,
  onClose,
  onChanged,
  onClaimed,
  toast,
}: {
  user: { id: string };
  party: Party;
  order: OrderView;
  support: HelpRequestView | null;
  messages: IxMessage[];
  prefillNote: string | null;
  onClose: () => void;
  onChanged: () => void;
  onClaimed?: () => void;
  toast: (text: string) => void;
}) {
  const { language } = useSession();
  const presence = usePresence();
  const meta = presence.meta[order.id] ?? { pinned: false, muted: false, draft: "", lastAt: 0 };
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<null | "support" | "ship" | "offer">(null);
  const [reason, setReason] = useState(0);
  const [note, setNote] = useState("");
  const [ship, setShip] = useState({ courier: "Delhivery", awb: "", eta: "" });
  const [offer, setOffer] = useState({ amount: "", note: "Festive price · free shipping" });
  const [resolution, setResolution] = useState<Resolution>("replacement");
  const [resolutionNote, setResolutionNote] = useState("");

  useEffect(() => {
    if (prefillNote !== null && party === "buyer") {
      setForm("support");
      setNote(prefillNote);
    }
  }, [prefillNote, party]);

  async function run(label: string, task: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    try {
      await task();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const item = order.items[0];
  const current = Math.max(0, STEPS.indexOf(order.status as (typeof STEPS)[number]));
  const delivered = order.status === "delivered" || order.status === "completed";
  const stepIndex = delivered ? 4 : current;
  const photos = messages.filter((m) => (m.kind === "image" || m.kind === "gif") && !m.recalled && (m.url || m.thumb));
  const next = nextOrderStatus(order.status);
  const open = support && support.status !== "completed" ? support : null;
  const resolutionText = (value: Resolution) => RESOLUTION_COPY[language]?.[value] ?? RESOLUTION_COPY.en[value];
  const lines: ChatLine[] = messages.map((m) => ({
    id: m.id,
    channelId: m.channelId,
    senderId: m.senderId,
    text: m.kind === "sys" ? `Update · ${m.text}` : m.text,
    sentTime: m.at,
    kind: m.kind === "image" || m.kind === "gif" ? "image" : "text",
    system: m.kind === "sys",
  }));
  const stepSub = [
    `${fmtDay(Date.parse(order.createdAt))}, ${fmtTime(Date.parse(order.createdAt))}`,
    order.status === "placed" ? "Seller packs within a day" : "Packed by the seller",
    order.shipment ? `${order.shipment.courier} · ${order.shipment.awb}` : stepIndex >= 2 ? "On its way" : "Seller dispatches in 1–2 days",
    delivered ? "Delivered" : order.shipment?.eta ? `Est. ${order.shipment.eta}` : "After shipping",
  ];

  return (
    <aside className="ix-details" aria-label="Order details">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Order details</h2>
        <button type="button" className="ix-ib" aria-label="Close details" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>

      <div className="ix-prod">
        <div className="swatch">{item?.image ? <img src={item.image} alt={item.name} /> : null}</div>
        <div className="body">
          <b>{item?.name ?? "Order"}</b>
          <span className="ix-small">
            {order.items.length > 1 ? `${order.items.length} items` : `Qty ${item?.quantity ?? 1}`} · {statusCopy(order.status)}
          </span>
          <dl className="ix-kv">
            <dt>Order</dt>
            <dd>
              <span className="ix-mono">{order.id}</span>{" "}
              <button
                type="button"
                className="ix-link"
                onClick={() =>
                  void navigator.clipboard?.writeText(order.id).then(
                    () => toast("Order ID copied"),
                    () => toast(`Order ID: ${order.id}`),
                  )
                }
              >
                Copy
              </button>
            </dd>
            <dt>Total</dt>
            <dd>
              <b>{money(order.total)}</b>
              {order.offer?.state === "accepted" ? (
                <s className="ix-small" style={{ marginLeft: 6 }}>
                  {money(order.offer.was)}
                </s>
              ) : null}
            </dd>
            <dt>{party === "buyer" ? "Seller" : "Buyer"}</dt>
            <dd>{party === "buyer" ? order.seller.name : order.buyer.name}</dd>
            {party === "support" ? (
              <>
                <dt>Seller</dt>
                <dd>{order.seller.name}</dd>
              </>
            ) : null}
          </dl>
        </div>
      </div>

      <div>
        <div className="ix-eyebrow" style={{ marginBottom: 10 }}>
          Progress
        </div>
        <ol className="ix-steps">
          {STEPS.map((step, index) => (
            <li key={step} className={index < stepIndex || (delivered && index === 3) ? "done" : index === stepIndex ? "now" : ""}>
              <span>
                {statusCopy(step)}
                <small>{stepSub[index]}</small>
              </span>
            </li>
          ))}
        </ol>
      </div>

      {party === "seller" && next ? (
        form === "ship" && next === "shipped" ? (
          <form
            className="ix-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run("ship", async () => {
                await advanceOrder(order.id, "shipped", ship.awb.trim() ? { courier: ship.courier, awb: ship.awb, eta: ship.eta } : undefined);
                setForm(null);
                onChanged();
                toast("Marked shipped. The buyer sees the tracking card in the chat.");
              });
            }}
          >
            <b>Ship this order</b>
            <label className="ix-eyebrow" htmlFor="ix-courier">Courier</label>
            <input id="ix-courier" value={ship.courier} maxLength={60} onChange={(e) => setShip({ ...ship, courier: e.target.value })} />
            <label className="ix-eyebrow" htmlFor="ix-awb">Tracking number (AWB)</label>
            <input id="ix-awb" value={ship.awb} maxLength={60} placeholder="Optional" onChange={(e) => setShip({ ...ship, awb: e.target.value })} />
            <label className="ix-eyebrow" htmlFor="ix-eta">Arrives</label>
            <input id="ix-eta" value={ship.eta} maxLength={60} placeholder="e.g. Mon, 9 Nov" onChange={(e) => setShip({ ...ship, eta: e.target.value })} />
            <div className="row">
              <button type="button" className="ix-btn" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button className="ix-btn primary" disabled={busy === "ship"}>
                Mark shipped
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="ix-btn primary"
            disabled={busy === "advance"}
            onClick={() =>
              next === "shipped"
                ? setForm("ship")
                : void run("advance", async () => {
                    await advanceOrder(order.id, next);
                    onChanged();
                    toast(`Marked ${statusCopy(next).toLowerCase()}. The buyer sees it in the chat.`);
                  })
            }
          >
            <Icon name="truck" />
            Mark {statusCopy(next).toLowerCase()}
          </button>
        )
      ) : null}

      {photos.length ? (
        <div>
          <div className="ix-eyebrow" style={{ marginBottom: 8 }}>
            Shared photos · {photos.length}
          </div>
          <div className="ix-gallery">
            {photos.map((m) => (
              <a key={m.id} href={m.url ?? m.thumb} target="_blank" rel="noopener noreferrer">
                <img src={m.thumb ?? m.url} alt="Shared photo" />
              </a>
            ))}
          </div>
        </div>
      ) : null}

      <div className="ix-settings">
        <label className="ix-switch" htmlFor="ix-mute">
          Mute notifications
          <input
            id="ix-mute"
            type="checkbox"
            checked={meta.muted}
            onChange={(e) => {
              const muted = e.target.checked;
              presence.setMeta(order.id, { muted });
              void setMuted(order.channelId!, muted)
                .then(() => toast(muted ? "Notifications muted" : "Notifications on"))
                .catch((caught: Error) => (presence.setMeta(order.id, { muted: !muted }), toast(caught.message)));
            }}
          />
        </label>
        <label className="ix-switch" htmlFor="ix-pin">
          Pin to top of inbox
          <input
            id="ix-pin"
            type="checkbox"
            checked={meta.pinned}
            onChange={(e) => {
              const pinned = e.target.checked;
              presence.setMeta(order.id, { pinned });
              void setPinned(order.channelId!, pinned).catch((caught: Error) => (presence.setMeta(order.id, { pinned: !pinned }), toast(caught.message)));
            }}
          />
        </label>
      </div>

      <div className="ix-actions">
        {open ? (
          <div className="ix-sys alert" style={{ alignSelf: "stretch", justifyContent: "center", borderRadius: 10, margin: 0 }}>
            <Icon name="life" />
            <span>
              {open.status === "requested"
                ? t(language, "supportWaiting")
                : open.status === "assigned"
                  ? t(language, "supportWith", { name: open.coordinator?.name.split(" ")[0] ?? "" })
                  : t(language, "supportProposed")}
            </span>
          </div>
        ) : support?.status === "completed" ? (
          <div className="ix-sys good" style={{ alignSelf: "stretch", justifyContent: "center", borderRadius: 10, margin: 0 }}>
            <Icon name="tick" />
            <span>
              {t(language, "supportResolved")}
              {support.resolution ? ` · ${resolutionText(support.resolution)}` : ""}
            </span>
          </div>
        ) : null}

        {open?.status === "in_progress" && open.resolution ? (
          <div className="ix-form">
            <span className="ix-eyebrow">{t(language, "proposalTitle")}</span>
            <b>{resolutionText(open.resolution)}</b>
            {open.resolutionNote ? <p>{open.resolutionNote}</p> : null}
            {party === "buyer" ? (
              <div className="row">
                <button type="button" className="ix-btn" disabled={!!busy} onClick={() => void run("decline", async () => (await answerResolution(open.id, false), onChanged()))}>
                  {t(language, "decline")}
                </button>
                <button
                  type="button"
                  className="ix-btn primary"
                  disabled={!!busy}
                  onClick={() => void run("accept", async () => (await answerResolution(open.id, true), onChanged(), toast(t(language, "supportResolved"))))}
                >
                  {t(language, "accept")}
                </button>
              </div>
            ) : (
              <p>Waiting for {order.buyer.name.split(" ")[0]} to confirm.</p>
            )}
          </div>
        ) : null}

        {party === "buyer" && !open ? (
          form === "support" ? (
            <form
              className="ix-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run("support", async () => {
                  const list = language === "hi" ? REASONS_HI : REASONS;
                  await requestOrderSupport(order.id, `${list[reason]}${note.trim() ? ` · ${note.trim()}` : ""}`.slice(0, 280));
                  setForm(null);
                  setNote("");
                  onChanged();
                  toast(t(language, "supportWaiting"));
                });
              }}
            >
              <b>{t(language, "getHelp")}</b>
              <p>{t(language, "helpLede")}</p>
              <label className="ix-eyebrow" htmlFor="ix-reason">
                {t(language, "helpLabel")}
              </label>
              <select id="ix-reason" value={reason} onChange={(e) => setReason(Number(e.target.value))}>
                {(language === "hi" ? REASONS_HI : REASONS).map((text, index) => (
                  <option key={text} value={index}>
                    {text}
                  </option>
                ))}
              </select>
              <label className="ix-sr" htmlFor="ix-supnote">
                Details
              </label>
              <textarea id="ix-supnote" placeholder={t(language, "helpHint")} value={note} maxLength={240} onChange={(e) => setNote(e.target.value)} />
              <div className="row">
                <button type="button" className="ix-btn" onClick={() => setForm(null)}>
                  {t(language, "cancel")}
                </button>
                <button className="ix-btn red" disabled={busy === "support"}>
                  {t(language, "requestHelp")}
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="ix-btn danger" onClick={() => setForm("support")}>
              <Icon name="life" />
              {t(language, "getHelp")}
            </button>
          )
        ) : null}

        {party === "seller" && (order.status === "placed" || order.status === "packed") ? (
          form === "offer" ? (
            <form
              className="ix-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run("offer", async () => {
                  await makeOffer(order.id, Number(offer.amount), offer.note);
                  setForm(null);
                  onChanged();
                  toast("Offer sent. The buyer can accept it in the chat.");
                });
              }}
            >
              <b>Send a price offer</b>
              <label className="ix-eyebrow" htmlFor="ix-offer">
                New total (was {money(order.offer?.was ?? order.total)})
              </label>
              <input id="ix-offer" inputMode="numeric" value={offer.amount} onChange={(e) => setOffer({ ...offer, amount: e.target.value.replace(/\D/g, "") })} />
              <label className="ix-eyebrow" htmlFor="ix-offer-note">Note</label>
              <input id="ix-offer-note" maxLength={120} value={offer.note} onChange={(e) => setOffer({ ...offer, note: e.target.value })} />
              <div className="row">
                <button type="button" className="ix-btn" onClick={() => setForm(null)}>
                  Cancel
                </button>
                <button className="ix-btn primary" disabled={busy === "offer" || !offer.amount}>
                  Send offer
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="ix-btn" onClick={() => setForm("offer")}>
              <Icon name="tag" />
              Send a price offer
            </button>
          )
        ) : null}

        {party === "support" && support && !support.coordinator && support.status === "requested" ? (
          <button
            type="button"
            className="ix-btn primary"
            disabled={busy === "claim"}
            onClick={() =>
              void run("claim", async () => {
                await claimOrderSupport(support.id);
                onChanged();
                onClaimed?.();
                toast("Joined the order conversation.");
              })
            }
          >
            Claim and join conversation
          </button>
        ) : null}

        {party === "support" && open && open.coordinator?.id === user.id ? (
          <>
            <CaseBrief order={order} support={open} lines={lines} />
            <form
              className="ix-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run("propose", async () => {
                  await proposeResolution(open.id, resolution, resolutionNote.trim());
                  setResolutionNote("");
                  onChanged();
                  toast("Resolution proposed. The buyer can accept or decline it.");
                });
              }}
            >
              <b>{open.status === "in_progress" ? "Update proposal" : "Propose a resolution"}</b>
              <select aria-label="Resolution" value={resolution} onChange={(e) => setResolution(e.target.value as Resolution)}>
                {RESOLUTIONS.map((value) => (
                  <option key={value} value={value}>
                    {RESOLUTION_COPY.en[value]}
                  </option>
                ))}
              </select>
              <input
                aria-label="Details for buyer and seller"
                maxLength={240}
                placeholder="e.g. New sari ships Friday; keep the damaged one until pickup."
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
              />
              <button className="ix-btn primary" disabled={busy === "propose"}>
                Propose
              </button>
            </form>
          </>
        ) : null}

        {order.channelId ? (
          <button
            type="button"
            className="ix-btn"
            disabled={busy === "share"}
            onClick={() =>
              void run("share", async () => {
                // The open chat sends it so the card appears immediately in the conversation.
                window.dispatchEvent(new CustomEvent("ix:share-order", { detail: order.id }));
                toast("Order shared in the chat");
              })
            }
          >
            <Icon name="box" />
            Share this order in chat
          </button>
        ) : null}
      </div>
    </aside>
  );
}
