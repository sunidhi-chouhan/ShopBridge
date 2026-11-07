import { useEffect, useMemo, useState } from "react";
import { formatInr } from "../../../shared/catalog";
import type { HelpRequestView, OrderView } from "../../../shared/types";
import { draftSupportReply } from "../api";
import { useSession } from "../app/session";
import { languageLabel } from "../chat/languagePrefs";
import { systemText, type ChatLine } from "../chat/nexconn";
import { getCachedTranslation, translateText } from "../chat/translate";
import { Button } from "../ui/Button";
import { formatDeskWhen, formatWaiting } from "../ui/desk";
import { statusCopy } from "../ui/OrderCard";
import { formatMessageTime } from "./format";

/** Ask the open composer to take a draft (the agent still edits and sends it). */
export function offerDraft(text: string): void {
  window.dispatchEvent(new CustomEvent("shopbridge:draft", { detail: text }));
}

/**
 * Case brief for the support agent, built only from records: order facts, parties,
 * the buyer's own words, photo evidence and the event timeline. Nothing is inferred.
 * The optional AI draft is a suggestion the agent reviews; it is never sent automatically.
 */
export function CaseBrief({
  order,
  support,
  lines,
}: {
  order: OrderView;
  support: HelpRequestView;
  lines: ChatLine[];
}) {
  const { language } = useSession();
  const [noteTranslation, setNoteTranslation] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ text: string; model: string } | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let alive = true;
    setNoteTranslation(null);
    if (support.note && order.buyer.language && order.buyer.language !== language) {
      void translateText(support.note, language).then((text) => {
        if (alive && text && text !== support.note) setNoteTranslation(text);
      });
    }
    return () => {
      alive = false;
    };
  }, [support.note, order.buyer.language, language]);

  const facts = useMemo(() => {
    const photos = lines.filter((line) => line.kind === "image");
    const fromBuyer = lines.filter((line) => line.senderId === order.buyer.id && line.kind === "text");
    const fromSeller = lines.filter((line) => line.senderId === order.seller.id && line.kind === "text");
    const events = lines.filter((line) => line.system).slice(-6);
    const lastBuyer = fromBuyer[fromBuyer.length - 1] ?? null;
    return {
      photos: photos.length,
      photosFromBuyer: photos.filter((line) => line.senderId === order.buyer.id).length,
      buyerMessages: fromBuyer.length,
      sellerMessages: fromSeller.length,
      events,
      lastBuyer,
    };
  }, [lines, order.buyer.id, order.seller.id]);

  const lastBuyerTranslated = facts.lastBuyer ? getCachedTranslation(facts.lastBuyer.id, language) : null;
  const item = order.items[0];

  async function onDraft() {
    setDrafting(true);
    setDraftError(null);
    try {
      const transcript = lines
        .filter((line) => line.kind === "text")
        .slice(-30)
        .map((line) => {
          const role = line.system
            ? "event"
            : line.senderId === order.buyer.id
              ? "buyer"
              : line.senderId === order.seller.id
                ? "seller"
                : "support";
          const cached = getCachedTranslation(line.id, language);
          const text = line.system ? systemText(line.text) : line.text;
          const translated = cached.status === "ready" && cached.text !== line.text ? ` [${languageLabel(language)}: ${cached.text}]` : "";
          return { from: role, role, text: `${text}${translated}`.slice(0, 600) };
        });
      const result = await draftSupportReply(support.id, transcript, language);
      setDraft({ text: result.draft, model: result.model });
    } catch (caught: unknown) {
      setDraftError(caught instanceof Error ? caught.message : "Could not draft a reply.");
    } finally {
      setDrafting(false);
    }
  }

  return (
    <section className="case-brief" aria-label="Case brief">
      <button type="button" className="case-brief-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="kicker">Case brief</span>
        <span className="meta">from order records and this conversation</span>
        <span className="account-caret" aria-hidden="true" />
      </button>
      {open ? (
        <>
          <dl className="case-brief-facts">
            <div>
              <dt>Order</dt>
              <dd>
                {item ? `${item.name} × ${item.quantity}` : order.id} · {formatInr(order.total)} · {statusCopy(order.status)}
              </dd>
            </div>
            <div>
              <dt>Placed</dt>
              <dd>{formatDeskWhen(order.createdAt)}</dd>
            </div>
            <div>
              <dt>Buyer</dt>
              <dd>
                {order.buyer.name}
                {order.buyer.language ? ` · reads ${languageLabel(order.buyer.language)}` : ""}
              </dd>
            </div>
            <div>
              <dt>Seller</dt>
              <dd>
                {order.seller.name}
                {order.seller.language ? ` · reads ${languageLabel(order.seller.language)}` : ""}
              </dd>
            </div>
            <div>
              <dt>Waiting</dt>
              <dd>{formatWaiting(support.createdAt)} since escalation</dd>
            </div>
            <div>
              <dt>Evidence</dt>
              <dd>
                {facts.photos === 0
                  ? "No photos shared yet"
                  : `${facts.photos} photo${facts.photos === 1 ? "" : "s"} (${facts.photosFromBuyer} from buyer)`}
              </dd>
            </div>
            <div>
              <dt>Messages</dt>
              <dd>
                Buyer {facts.buyerMessages} · Seller {facts.sellerMessages}
              </dd>
            </div>
          </dl>
          {support.note ? (
            <div className="case-brief-quote">
              <p className="meta">Buyer’s issue, in their words</p>
              <p lang={order.buyer.language ?? undefined}>“{support.note}”</p>
              {noteTranslation ? <p lang={language}>{noteTranslation}</p> : null}
            </div>
          ) : null}
          {facts.lastBuyer && facts.lastBuyer.text !== support.note ? (
            <div className="case-brief-quote">
              <p className="meta">Latest from buyer · {formatMessageTime(facts.lastBuyer.sentTime)}</p>
              <p lang={order.buyer.language ?? undefined}>{facts.lastBuyer.text}</p>
              {lastBuyerTranslated?.status === "ready" && lastBuyerTranslated.text !== facts.lastBuyer.text ? (
                <p lang={language}>{lastBuyerTranslated.text}</p>
              ) : null}
            </div>
          ) : null}
          {facts.events.length > 0 ? (
            <ol className="case-brief-timeline" aria-label="Order events">
              {facts.events.map((line) => (
                <li key={line.id}>
                  <span className="meta">{formatMessageTime(line.sentTime)}</span> {systemText(line.text)}
                </li>
              ))}
            </ol>
          ) : null}
          <div className="case-brief-ai">
            <Button variant="secondary" pending={drafting} onClick={() => void onDraft()}>
              Draft a reply with AI
            </Button>
            <p className="meta">
              Suggestion only. Uses the order record and this conversation; you review, edit and send it yourself.
            </p>
            {draftError ? (
              <p className="field-error" role="alert">
                {draftError}
              </p>
            ) : null}
            {draft ? (
              <div className="case-brief-draft">
                <p className="kicker">Draft · AI ({draft.model}) · not sent</p>
                <p>{draft.text}</p>
                <div className="dialog-actions">
                  <Button variant="quiet" onClick={() => setDraft(null)}>
                    Discard
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      offerDraft(draft.text);
                      setDraft(null);
                    }}
                  >
                    Put in message box
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
