import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConversationView, HelpRequestView, OrderView, PublicUser } from "../../../shared/types";
import { getOrder, listRequests } from "../api";
import { usePresence } from "../chat/presence";
import { subscribeChatEvents } from "../chat/nexconn";
import { useRoute } from "../ui/route";
import { statusCopy } from "../ui/OrderCard";
import { Chat, type Party } from "./Chat";
import { Details } from "./Details";
import type { IxMessage } from "./engine";
import { Icon, initials, listTime, useIxToast } from "./ui";
import "./inbox.css";

type Filter = "all" | "unread" | "support";

function useIsNarrow(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatch(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return match;
}

/** Order + its latest support case, refreshed when an order event arrives in the chat. */
function useOrderContext(orderId: string | null) {
  const [order, setOrder] = useState<OrderView | null>(null);
  const [support, setSupport] = useState<HelpRequestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!orderId) return;
    const [orderResult, requests] = await Promise.all([getOrder(orderId), listRequests()]);
    setOrder(orderResult.order);
    setSupport(
      requests.requests.filter((item) => item.orderId === orderId).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null,
    );
    setError(null);
  }, [orderId]);
  useEffect(() => {
    setOrder(null);
    setSupport(null);
    setError(null);
    load().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not open this order."));
  }, [load]);
  return { order, support, error, reload: load };
}

function ConvList({
  items,
  selectedId,
  onSelect,
}: {
  items: ConversationView[];
  selectedId: string | null;
  onSelect: (orderId: string) => void;
}) {
  const presence = usePresence();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? "").toUpperCase();
      if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(tag)) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const meta = (id: string) => presence.meta[id] ?? { pinned: false, muted: false, draft: "", lastAt: 0 };
  const lastAt = (item: ConversationView) => meta(item.orderId).lastAt || Date.parse(item.updatedAt);
  const supportOpen = (item: ConversationView) => Boolean(item.support && item.support.status !== "completed");
  const counts = {
    all: items.length,
    unread: items.filter((item) => (presence.unread[item.orderId] ?? 0) > 0).length,
    support: items.filter(supportOpen).length,
  };
  const q = query.trim().toLowerCase();
  const list = items
    .filter((item) => (filter === "unread" ? (presence.unread[item.orderId] ?? 0) > 0 : filter === "support" ? supportOpen(item) : true))
    .filter((item) => !q || `${item.counterpart.name} ${item.title} ${item.orderId} ${presence.previews[item.orderId] ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => Number(meta(b.orderId).pinned) - Number(meta(a.orderId).pinned) || lastAt(b) - lastAt(a));

  return (
    <section className="ix-list" aria-label="Conversations">
      <div className="ix-list-head">
        <h1>
          Inbox <small>{q || filter !== "all" ? `${list.length} of ${items.length}` : `${items.length} orders`}</small>
        </h1>
        <div className="ix-search">
          <Icon name="search" />
          <label className="ix-sr" htmlFor="ix-q">
            Search conversations
          </label>
          <input
            id="ix-q"
            ref={searchRef}
            type="search"
            placeholder="Search order, product or name"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>/</kbd>
        </div>
        <div className="ix-tabs" role="tablist" aria-label="Filter conversations">
          {(["all", "unread", "support"] as const).map((key) => (
            <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? "on" : ""} onClick={() => setFilter(key)}>
              {key === "all" ? "All" : key === "unread" ? "Unread" : "Support"} <span className="n">{counts[key]}</span>
            </button>
          ))}
        </div>
      </div>
      <ul className="ix-convs">
        {list.length === 0 ? (
          <li className="ix-empty">
            No conversations match{q ? ` “${query}”` : ""}.
            <br />
            <button
              type="button"
              className="ix-link"
              style={{ marginTop: 8 }}
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              Clear search and filters
            </button>
          </li>
        ) : (
          list.map((item) => {
            const unread = presence.unread[item.orderId] ?? 0;
            const m = meta(item.orderId);
            return (
              <li key={item.orderId}>
                <button
                  type="button"
                  className={`ix-conv${item.orderId === selectedId ? " on" : ""}${unread ? " unread" : ""}`}
                  aria-current={item.orderId === selectedId ? "true" : undefined}
                  onClick={() => onSelect(item.orderId)}
                >
                  <div className="ix-thumb">
                    {item.image ? <img src={item.image} alt="" /> : null}
                    <span className="av">{initials(item.counterpart.name)}</span>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="ix-conv-top">
                      <span className="ix-conv-name">
                        {item.counterpart.name}
                        {m.pinned ? <Icon name="pin" /> : null}
                        {m.muted ? <Icon name="bellOff" /> : null}
                      </span>
                      <span className="ix-conv-time">{listTime(lastAt(item))}</span>
                    </div>
                    <span className="ix-conv-sub">
                      {item.title} · <span className="ix-mono">{item.orderId}</span>
                    </span>
                    <div className="ix-conv-last">
                      <span className="p">
                        {m.draft && item.orderId !== selectedId ? <em>Draft: </em> : null}
                        {m.draft && item.orderId !== selectedId ? m.draft : presence.previews[item.orderId] || "No messages yet"}
                      </span>
                      {unread ? <b className={`ix-badge-n${m.muted ? " muted" : ""}`} aria-label={`${unread} unread`}>{unread}</b> : null}
                    </div>
                    <div className="ix-conv-last" style={{ marginTop: 6 }}>
                      <span className={`ix-chip ${item.status}`}>
                        <i />
                        {statusCopy(item.status)}
                      </span>
                      {supportOpen(item) ? (
                        <span className="ix-chip support">
                          <i />
                          Support open
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}

/** Shown beside the list until a conversation is chosen (desktop). */
function Welcome({ items, party }: { items: ConversationView[]; party: Party }) {
  const presence = usePresence();
  const unread = items.filter((item) => (presence.unread[item.orderId] ?? 0) > 0).length;
  const open = items.filter((item) => item.support && item.support.status !== "completed").length;
  const line =
    party === "buyer"
      ? "Talk to the maker of every piece you order. Your messages are translated between Hindi and English as they are read."
      : party === "seller"
        ? "Every checkout opens a thread with the buyer. Send offers, shipping updates and photos without leaving the order."
        : "Each case keeps its full order history. Read what happened, then propose a fair resolution.";
  return (
    <div className="ix-welcome-in">
      <p className="ix-eyebrow">ShopBridge inbox</p>
      <h2>
        Every order has <em>a conversation.</em>
      </h2>
      <p className="lede">{line}</p>
      <dl className="ix-stats">
        <div>
          <dt>Conversations</dt>
          <dd>{items.length}</dd>
        </div>
        <div>
          <dt>Unread</dt>
          <dd>{unread}</dd>
        </div>
        <div>
          <dt>Open support</dt>
          <dd>{open}</dd>
        </div>
      </dl>
      <p className="ix-small">
        Press <kbd>/</kbd> to search · choose a conversation to start
      </p>
    </div>
  );
}

export function InboxPage({ user, party }: { user: PublicUser; party: Party }) {
  const presence = usePresence();
  const [route, go] = useRoute();
  const mobile = useIsNarrow("(max-width: 899px)");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [messages, setMessages] = useState<IxMessage[]>([]);
  const [prefill, setPrefill] = useState<string | null>(null);
  const [toastNode, toast] = useIxToast();
  const items = presence.conversations;

  const selectedId =
    route.orderId && items?.some((item) => item.orderId === route.orderId)
      ? route.orderId
      : !mobile && items && items.length > 0
        ? [...items].sort((a, b) => (presence.meta[b.orderId]?.lastAt ?? 0) - (presence.meta[a.orderId]?.lastAt ?? 0))[0].orderId
        : null;
  const ctx = useOrderContext(selectedId);
  const unreadAtOpen = useMemo(() => (selectedId ? presence.unread[selectedId] ?? 0 : 0), [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the visible conversation marked active (no notifications, unread cleared).
  useEffect(() => {
    if (!selectedId) return;
    presence.setActive(selectedId);
    presence.markOpened(selectedId);
    return () => presence.setActive(null);
  }, [selectedId, presence.setActive, presence.markOpened]);

  // Order events posted into this channel (shipped, offer accepted, support joined…) refresh the panel.
  const reloadTimer = useRef<number | null>(null);
  useEffect(() => {
    const channelId = ctx.order?.channelId;
    if (!channelId) return;
    return subscribeChatEvents((event) => {
      if (event.type !== "message" || event.raw.channelIdentifier?.channelId !== channelId) return;
      const text = String((event.raw.content as { content?: string; text?: string })?.content ?? (event.raw.content as { text?: string })?.text ?? "");
      if (!text.startsWith("Update ·") && !event.raw.messageType.startsWith("SB:Offer") && !event.raw.messageType.startsWith("SB:Track")) return;
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(() => {
        void ctx.reload().catch(() => undefined);
        void presence.refresh().catch(() => undefined);
      }, 400);
    });
  }, [ctx.order?.channelId, ctx.reload, presence.refresh]);

  const refreshAll = () => {
    void ctx.reload().catch(() => undefined);
    void presence.refresh().catch(() => undefined);
  };

  const inChat = Boolean(mobile && selectedId);

  if (!items) {
    return (
      <div className="ix">
        {presence.error ? (
          <div className="ix-empty" role="alert">
            {presence.error}
          </div>
        ) : (
          <div className="ix-app ix-loading" aria-busy="true">
            <section className="ix-list" aria-label="Loading conversations">
              <div className="ix-list-head">
                <h1>Inbox</h1>
              </div>
              <ul className="ix-convs" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <li key={i} className="ix-skel">
                    <i />
                    <span>
                      <b />
                      <b />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="ix-chat">
              <p className="ix-sr">Opening your inbox…</p>
            </section>
          </div>
        )}
      </div>
    );
  }

  const agentNeedsClaim = party === "support" && ctx.support && !ctx.support.coordinator && ctx.support.status === "requested";

  return (
    <div className={`ix${inChat ? " in-chat" : ""}`}>
      <div className={`ix-app${detailsOpen ? " show-details" : ""}`}>
        {items.length === 0 ? (
          <section className="ix-list">
            <div className="ix-list-head">
              <h1>Inbox</h1>
            </div>
            <div className="ix-empty">
              {party === "buyer"
                ? "Place an order from the shop. Its conversation with the seller appears here."
                : party === "seller"
                  ? "When a buyer checks out your work, the order conversation appears here."
                  : "Claim a case from the queue to join its order conversation."}
            </div>
          </section>
        ) : (
          <ConvList items={items} selectedId={selectedId} onSelect={(id) => go("inbox", id)} />
        )}

        {selectedId && ctx.order && ctx.order.channelId && !agentNeedsClaim ? (
          <Chat
            key={selectedId}
            user={user}
            party={party}
            order={ctx.order}
            support={ctx.support}
            unreadAtOpen={unreadAtOpen}
            detailsOpen={detailsOpen}
            onBack={() => go("inbox")}
            onToggleDetails={() => setDetailsOpen((v) => !v)}
            onOrderChanged={refreshAll}
            onAskSupport={(text) => {
              setDetailsOpen(true);
              setPrefill(text);
            }}
            onMessages={setMessages}
            toast={toast}
          />
        ) : (
          <section className={`ix-chat${!selectedId && !ctx.error ? " ix-welcome" : ""}`}>
            {!selectedId && !ctx.error ? (
              <Welcome items={items} party={party} />
            ) : (
            <div className="ix-empty" style={{ margin: "auto" }}>
              {ctx.error
                ? ctx.error
                : !selectedId
                  ? "Select a conversation"
                  : agentNeedsClaim
                    ? "Claim this case from the order panel to join the conversation with its full history."
                    : ctx.order && !ctx.order.channelId
                      ? "The conversation for this order is not open yet."
                      : "Opening the conversation…"}
              {agentNeedsClaim && !detailsOpen ? (
                <>
                  <br />
                  <button type="button" className="ix-btn primary" style={{ margin: "12px auto 0" }} onClick={() => setDetailsOpen(true)}>
                    Open order panel
                  </button>
                </>
              ) : null}
            </div>
            )}
          </section>
        )}

        {selectedId && ctx.order ? (
          <Details
            user={user}
            party={party}
            order={ctx.order}
            support={ctx.support}
            messages={messages}
            prefillNote={prefill}
            onClose={() => setDetailsOpen(false)}
            onChanged={refreshAll}
            onClaimed={refreshAll}
            toast={toast}
          />
        ) : null}
      </div>
      {toastNode}
    </div>
  );
}
