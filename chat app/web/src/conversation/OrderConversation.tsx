import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ORDER_FLOW,
  RESOLUTIONS,
  SYSTEM_USER_ID,
  SYSTEM_USER_NAME,
  nextOrderStatus,
  type HelpRequestView,
  type Language,
  type OrderView,
  type PublicUser,
  type Resolution,
} from "../../../shared/types";
import {
  advanceOrder,
  answerResolution,
  claimOrderSupport,
  getOrder,
  listRequests,
  openOrderRoom,
  proposeResolution,
  requestOrderSupport,
} from "../api";
import { useSession } from "../app/session";
import type { ChatLine } from "../chat/nexconn";
import { usePresence } from "../chat/presence";
import { ChatRoom, type PreviewTarget } from "../components/ChatRoom";
import { copy, statusLabel } from "../copy";
import { RESOLUTION_COPY, t } from "../i18n";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { formatWaiting, requestTone } from "../ui/desk";
import { statusCopy, statusTone } from "../ui/OrderCard";
import { ErrorState, LoadingState } from "../ui/StateView";
import { TextArea } from "../ui/TextField";
import { useToast } from "../ui/Toast";
import { CaseBrief } from "./CaseBrief";
import { ConversationHeader } from "./ConversationHeader";

type Party = "buyer" | "seller" | "support";

function participants(order: OrderView, support: HelpRequestView | null) {
  const agent = support?.coordinator ?? null;
  return {
    names: {
      [order.buyer.id]: order.buyer.name,
      [order.seller.id]: order.seller.name,
      [SYSTEM_USER_ID]: SYSTEM_USER_NAME,
      ...(agent ? { [agent.id]: agent.name } : {}),
    },
    roles: {
      [order.buyer.id]: "Buyer",
      [order.seller.id]: "Seller",
      ...(agent ? { [agent.id]: "Support" } : {}),
    },
    languages: {
      [order.buyer.id]: order.buyer.language,
      [order.seller.id]: order.seller.language,
      ...(agent ? { [agent.id]: agent.language } : {}),
    } as Record<string, Language | null | undefined>,
  };
}

function previewFor(party: Party, order: OrderView): PreviewTarget | null {
  const other: PublicUser = party === "buyer" ? order.seller : order.buyer;
  return other.language ? { name: other.name.split(" ")[0], language: other.language } : null;
}

/** Placed → Packed → Shipped → Delivered, with the seller's next step. */
function OrderTrack({
  order,
  party,
  pending,
  onAdvance,
}: {
  order: OrderView;
  party: Party;
  pending: boolean;
  onAdvance: () => void;
}) {
  const current = (ORDER_FLOW as readonly string[]).indexOf(order.status);
  const next = nextOrderStatus(order.status);
  return (
    <div className="order-track">
      <ol className="order-track-steps" aria-label="Order progress">
        {ORDER_FLOW.map((step, index) => {
          const state = current === -1 || index <= current ? "done" : "upcoming";
          return (
            <li
              key={step}
              className={`order-track-step is-${state}`}
              aria-current={index === current ? "step" : undefined}
            >
              <span className="order-track-dot" aria-hidden="true" />
              {statusCopy(step)}
            </li>
          );
        })}
      </ol>
      {party === "seller" && next ? (
        <Button variant="secondary" pending={pending} onClick={onAdvance}>
          Mark {statusCopy(next).toLowerCase()}
        </Button>
      ) : null}
    </div>
  );
}

function SupportPanel({
  order,
  support,
  party,
  language,
  lines,
  onChanged,
  onError,
}: {
  order: OrderView;
  support: HelpRequestView | null;
  party: Party;
  language: Language;
  lines: ChatLine[];
  onChanged: (next: { order?: OrderView; support?: HelpRequestView | null }) => void;
  onError: (message: string | null) => void;
}) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState<Resolution>("replacement");
  const [resolutionNote, setResolutionNote] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  async function run(label: string, task: () => Promise<void>) {
    if (pending) return;
    setPending(label);
    onError(null);
    try {
      await task();
    } catch (caught: unknown) {
      onError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
    } finally {
      setPending(null);
    }
  }

  const open = support && support.status !== "completed" ? support : null;
  const resolutionText = (value: Resolution) => RESOLUTION_COPY[language]?.[value] ?? RESOLUTION_COPY.en[value];

  // Buyer: no open case → offer help.
  if (!open && party === "buyer") {
    if (!asking) {
      return (
        <div className="support-strip">
          {support?.status === "completed" ? (
            <p className="meta">
              {t(language, "supportResolved")}
              {support.resolution ? ` · ${resolutionText(support.resolution)}` : ""}
            </p>
          ) : null}
          <Button variant="secondary" onClick={() => setAsking(true)} disabled={!order.channelId}>
            {t(language, "getHelp")}
          </Button>
        </div>
      );
    }
    return (
      <Card variant="compact" className="support-form">
        <p className="help-dialog-lede">{t(language, "helpLede")}</p>
        <TextArea
          id="support-note"
          label={t(language, "helpLabel")}
          hint={t(language, "helpHint")}
          value={note}
          rows={2}
          maxLength={280}
          onChange={(event) => setNote(event.target.value)}
        />
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setAsking(false)}>
            {t(language, "cancel")}
          </Button>
          <Button
            pending={pending === "ask"}
            onClick={() =>
              void run("ask", async () => {
                const result = await requestOrderSupport(order.id, note.trim());
                onChanged({ order: result.order, support: result.request });
                setAsking(false);
                setNote("");
                toast(copy.orderSupportToast);
              })
            }
          >
            {t(language, "requestHelp")}
          </Button>
        </div>
      </Card>
    );
  }

  if (!support) return null;

  const agentName = support.coordinator?.name.split(" ")[0] ?? "";
  const statusLine =
    support.status === "requested"
      ? t(language, "supportWaiting")
      : support.status === "assigned"
        ? t(language, "supportWith", { name: agentName })
        : support.status === "in_progress"
          ? t(language, "supportProposed")
          : t(language, "supportResolved");

  const isAgent = party === "support" && support.coordinator !== null;

  return (
    <section className="support-panel" aria-label="Order support">
      <div className="support-panel-head">
        <p className="kicker">Order support</p>
        <Badge tone={requestTone(support.status)}>{statusLabel(support.status)}</Badge>
        <span className="meta">
          {statusLine} · {formatWaiting(support.createdAt)}
        </span>
      </div>
      {support.note ? <p className="support-panel-note">“{support.note}”</p> : null}

      {support.status === "in_progress" && support.resolution ? (
        <div className="support-proposal">
          <p className="kicker">{t(language, "proposalTitle")}</p>
          <p className="support-proposal-what">{resolutionText(support.resolution)}</p>
          {support.resolutionNote ? <p className="meta">{support.resolutionNote}</p> : null}
          {party === "buyer" ? (
            <div className="dialog-actions">
              <Button
                variant="secondary"
                pending={pending === "decline"}
                onClick={() =>
                  void run("decline", async () => {
                    onChanged({ support: (await answerResolution(support.id, false)).request });
                  })
                }
              >
                {t(language, "decline")}
              </Button>
              <Button
                pending={pending === "accept"}
                onClick={() =>
                  void run("accept", async () => {
                    onChanged({ support: (await answerResolution(support.id, true)).request });
                    toast(t(language, "supportResolved"));
                  })
                }
              >
                {t(language, "accept")}
              </Button>
            </div>
          ) : (
            <p className="meta">Waiting for {order.buyer.name.split(" ")[0]} to confirm.</p>
          )}
        </div>
      ) : null}

      {support.status === "completed" && support.resolution ? (
        <p className="support-proposal-what">
          {resolutionText(support.resolution)}
          {support.resolutionNote ? <span className="meta"> · {support.resolutionNote}</span> : null}
        </p>
      ) : null}

      {isAgent && (support.status === "assigned" || support.status === "in_progress") ? (
        <>
          <CaseBrief order={order} support={support} lines={lines} />
          <form
            className="resolution-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run("propose", async () => {
                onChanged({ support: (await proposeResolution(support.id, resolution, resolutionNote.trim())).request });
                setResolutionNote("");
                toast("Resolution proposed. The buyer can accept or decline it in the chat.");
              });
            }}
          >
            <label className="language-bar-field" htmlFor="resolution-kind">
              <span className="language-bar-label">Propose</span>
              <select
                id="resolution-kind"
                className="language-bar-select"
                value={resolution}
                onChange={(event) => setResolution(event.target.value as Resolution)}
              >
                {RESOLUTIONS.map((item) => (
                  <option key={item} value={item}>
                    {RESOLUTION_COPY.en[item]}
                  </option>
                ))}
              </select>
            </label>
            <label className="resolution-note" htmlFor="resolution-note">
              <span className="language-bar-label">Details for buyer and seller</span>
              <input
                id="resolution-note"
                className="text-input"
                value={resolutionNote}
                maxLength={240}
                placeholder="e.g. New sari ships Friday; keep the damaged one until pickup."
                onChange={(event) => setResolutionNote(event.target.value)}
              />
            </label>
            <Button type="submit" pending={pending === "propose"}>
              {support.status === "in_progress" ? "Update proposal" : "Propose resolution"}
            </Button>
          </form>
        </>
      ) : null}
    </section>
  );
}

export function OrderConversation({
  orderId,
  user,
  party,
  onBack,
  embedded = false,
}: {
  orderId: string;
  user: PublicUser;
  party: Party;
  onBack?: () => void;
  /** When true, omit the outer page chrome used on Order Detail. */
  embedded?: boolean;
}) {
  const { language } = useSession();
  const presence = usePresence();
  const toast = useToast();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [support, setSupport] = useState<HelpRequestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const reloadTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const [orderResult, requestResult] = await Promise.all([getOrder(orderId), listRequests()]);
    setOrder(orderResult.order);
    const linked = requestResult.requests
      .filter((item) => item.orderId === orderId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
    setSupport(linked ?? null);
  }, [orderId]);

  useEffect(() => {
    setOrder(null);
    setLoadError(null);
    load().catch((caught: unknown) => setLoadError(caught instanceof Error ? caught.message : "Could not open that order."));
  }, [load]);

  // Order events posted into the chat (shipped, support joined, proposal…) refresh the panels.
  const onSystemEvent = useCallback(() => {
    if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => {
      void load().catch(() => undefined);
      void presence.refresh().catch(() => undefined);
    }, 500);
  }, [load, presence.refresh]);

  useEffect(() => () => {
    if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
  }, []);

  const people = useMemo(() => (order ? participants(order, support) : null), [order, support]);
  const previewTarget = useMemo(() => (order ? previewFor(party, order) : null), [order, party]);

  if (loadError) return <ErrorState message={loadError} onRetry={onBack} />;
  if (!order || !people) return <LoadingState label="Opening the conversation" />;

  const first = order.items[0];
  const extra = order.items.length - 1;
  const title = first ? `${first.name}${extra > 0 ? ` + ${extra}` : ""}` : "Order";
  const counterpart = party === "buyer" ? order.seller : order.buyer;
  const agentNeedsClaim = party === "support" && support && !support.coordinator && support.status === "requested";

  async function act(label: string, task: () => Promise<void>) {
    if (pending) return;
    setPending(label);
    setError(null);
    try {
      await task();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className={embedded ? "order-conversation is-embedded" : "order-conversation"}>
      <ConversationHeader
        counterpart={counterpart}
        title={title}
        orderId={order.id}
        statusLabel={statusCopy(order.status)}
        statusTone={statusTone(order.status)}
        subtitle={party === "support" ? `Buyer ${order.buyer.name} · Seller ${order.seller.name}` : undefined}
        onBack={onBack}
      />
      <div className="order-conversation-panels">
        <OrderTrack
          order={order}
          party={party}
          pending={pending === "advance"}
          onAdvance={() =>
            void act("advance", async () => {
              const next = nextOrderStatus(order.status);
              if (!next) return;
              setOrder((await advanceOrder(order.id, next)).order);
              toast(`Marked ${statusCopy(next).toLowerCase()}. The buyer sees it in the chat.`);
            })
          }
        />
        <SupportPanel
          order={order}
          support={support}
          party={party}
          language={language}
          lines={lines}
          onChanged={(next) => {
            if (next.order) setOrder(next.order);
            if (next.support !== undefined) setSupport(next.support);
            void presence.refresh().catch(() => undefined);
          }}
          onError={setError}
        />
      </div>
      {error ? (
        <p className="field-error order-conversation-error" role="alert">
          {error}
        </p>
      ) : null}
      {agentNeedsClaim ? (
        <Card variant="compact" className="order-conversation-open">
          <p className="lede">
            Claim this case to join the order conversation. You will see everything the buyer and seller wrote before
            you joined.
          </p>
          <Button
            pending={pending === "claim"}
            onClick={() =>
              void act("claim", async () => {
                const result = await claimOrderSupport(support.id);
                setSupport(result.request);
                if (!result.nexconn) setError(copy.keysMissing);
                else toast("Joined the order conversation.");
                void presence.refresh().catch(() => undefined);
              })
            }
          >
            Claim and join conversation
          </Button>
        </Card>
      ) : !order.channelId ? (
        <Card variant="compact" className="order-conversation-open">
          <p className="lede">The conversation for this order is not open yet.</p>
          <Button
            pending={pending === "room"}
            onClick={() =>
              void act("room", async () => {
                setOrder((await openOrderRoom(order.id)).order);
                toast("Order conversation is ready.");
                void presence.refresh().catch(() => undefined);
              })
            }
          >
            Open conversation
          </Button>
        </Card>
      ) : (
        <ChatRoom
          key={`${order.channelId}:${support?.coordinator?.id ?? "-"}`}
          channelId={order.channelId}
          orderId={order.id}
          selfId={user.id}
          names={people.names}
          roles={people.roles}
          languages={people.languages}
          previewTarget={previewTarget}
          onSystemEvent={onSystemEvent}
          onLines={setLines}
        />
      )}
    </div>
  );
}
