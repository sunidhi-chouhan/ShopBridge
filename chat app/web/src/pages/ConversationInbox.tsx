import { useEffect, useMemo, useState } from "react";
import type { ConversationView, HelpRequestView, PublicUser } from "../../../shared/types";
import { chatCredentials, listConversations, listRequests } from "../api";
import { ChatRoom } from "../components/ChatRoom";
import { StatusTrail } from "../components/StatusTrail";
import { channelSnapshot, connectSaathi } from "../chat/nexconn";
import { BuyerHelpDialog } from "../conversation/BuyerHelpDialog";
import { ConversationLayout } from "../conversation/ConversationLayout";
import { ConversationList, type ConversationFilter } from "../conversation/ConversationList";
import { OrderConversation } from "../conversation/OrderConversation";
import { kindLabel, statusLabel } from "../copy";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { formatDeskWhen, requestPreview, requestTone } from "../ui/desk";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateView";

function useIsMobileThread() {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 899px)").matches : false,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 899px)");
    const onChange = () => setMobile(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return mobile;
}

export function ConversationInbox({
  user,
  party,
}: {
  user: PublicUser;
  party: "buyer" | "seller" | "support";
}) {
  const [items, setItems] = useState<ConversationView[] | null>(null);
  const [helpRooms, setHelpRooms] = useState<HelpRequestView[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedHelpId, setSelectedHelpId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [helpOpen, setHelpOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mobile = useIsMobileThread();

  async function refresh(options?: { preserveSelection?: boolean }) {
    const [result, requests] = await Promise.all([listConversations(), listRequests()]);
    setError(null);
    setItems(result.conversations);
    const help = requests.requests.filter((item) => item.channelId && !item.orderId);
    setHelpRooms(help);
    setSelectedId((current) => {
      if (current && result.conversations.some((item) => item.id === current)) return current;
      if (options?.preserveSelection === false) return null;
      if (!mobile && !current && result.conversations[0]) return result.conversations[0].id;
      return null;
    });
    setSelectedHelpId((current) =>
      current && help.some((item) => item.id === current) ? current : null,
    );
    try {
      const credentials = await chatCredentials();
      await connectSaathi(credentials.appKey, credentials.token, credentials.userId);
      const nextUnread: Record<string, number> = {};
      const nextPreview: Record<string, string> = {};
      await Promise.all(
        result.conversations
          .filter((item) => item.channelId)
          .map(async (item) => {
            const snap = await channelSnapshot(item.channelId!);
            nextUnread[item.id] = snap.unread;
            nextPreview[item.id] = snap.preview;
          }),
      );
      setUnread(nextUnread);
      setPreviews(nextPreview);
    } catch {
      // Previews and unread are optional; the list still works.
    }
  }

  useEffect(() => {
    let alive = true;
    refresh().catch((caught: unknown) => {
      if (alive) setError(caught instanceof Error ? caught.message : "Could not load conversations.");
    });
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 10000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [mobile]);

  const filtered = useMemo(() => {
    const list = items ?? [];
    const needle = query.trim().toLowerCase();
    return list.filter((item) => {
      if (filter === "unread" && !(unread[item.id] > 0)) return false;
      if (filter === "support" && !(item.support && item.support.status !== "completed")) return false;
      if (!needle) return true;
      const hay = `${item.title} ${item.orderId} ${item.counterpart.name} ${previews[item.id] ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [items, query, previews, filter, unread]);

  const selectedHelp = helpRooms.find((item) => item.id === selectedHelpId) ?? null;
  const title =
    party === "support" ? "Support conversations." : "Order conversations.";
  const lede =
    party === "support"
      ? "Claimed order rooms stay on one Nexconn channel with the buyer and seller."
      : "Every order keeps one Nexconn conversation. Open a row to read and reply.";
  const totalCount = items?.length ?? 0;

  if (!items && !error) return <LoadingState label="Opening conversations" />;
  if (error && !items) return <ErrorState message={error} onRetry={() => void refresh()} />;

  if (!items || (items.length === 0 && helpRooms.length === 0)) {
    return (
      <div className="inbox-page is-workspace is-empty">
        <header className="conv-workspace-mast">
          <div className="conv-workspace-mast-row">
            <div className="conv-workspace-mast-copy">
              <p className="kicker">Inbox</p>
              <h1 className="conv-workspace-title">{title}</h1>
              <p className="lede">{lede}</p>
            </div>
            {party === "buyer" ? (
              <div className="conv-workspace-actions">
                <Button variant="secondary" onClick={() => setHelpOpen(true)}>
                  Contact general support
                </Button>
              </div>
            ) : null}
          </div>
        </header>
        <EmptyState
          compact
          title="No conversations yet."
          detail={
            party === "buyer"
              ? "Place an order from the shop. Its conversation appears here."
              : party === "seller"
                ? "When a buyer checks out your work, the order room appears here."
                : "When a buyer requests support on an order, claim it from the queue."
          }
          scene="inbox"
        />
        {party === "buyer" ? (
          <BuyerHelpDialog open={helpOpen} user={user} onClose={() => setHelpOpen(false)} />
        ) : null}
      </div>
    );
  }

  const listPane = (
    <div className="conv-pane-stack">
      <ConversationList
        items={filtered}
        selectedId={selectedId}
        query={query}
        unread={unread}
        previews={previews}
        filter={filter}
        totalCount={totalCount}
        onQueryChange={setQuery}
        onFilterChange={setFilter}
        onSelect={(id) => {
          setSelectedHelpId(null);
          setSelectedId(id);
          setUnread((current) => ({ ...current, [id]: 0 }));
        }}
      />
      {helpRooms.length > 0 ? (
        <section className="conv-help-list" aria-label="Community help rooms">
          <p className="kicker">Community help</p>
          <ul className="conv-list-ul">
            {helpRooms.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={item.id === selectedHelpId ? "conv-list-item is-selected" : "conv-list-item"}
                  onClick={() => {
                    setSelectedId(null);
                    setSelectedHelpId(item.id);
                  }}
                >
                  <Avatar name={item.member.name} />
                  <span className="conv-list-copy">
                    <span className="conv-list-top">
                      <strong className="conv-list-name">{item.member.name}</strong>
                      <time dateTime={item.updatedAt}>{formatDeskWhen(item.updatedAt)}</time>
                    </span>
                    <span className="conv-list-title">{requestPreview(item.note, item.kind)}</span>
                    <span className="conv-list-bottom">
                      <span className="conv-list-preview">{kindLabel(item.kind)}</span>
                      <span className="conv-list-end">
                        <Badge tone={requestTone(item.status)}>{statusLabel(item.status)}</Badge>
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );

  let threadPane = (
    <div className="conv-thread-empty">
      <EmptyState compact title="Select a conversation" detail="Choose an order room from the list to read and reply." scene="inbox" />
    </div>
  );

  if (selectedId) {
    threadPane = (
      <OrderConversation
        orderId={selectedId}
        user={user}
        party={party}
        embedded
        onBack={
          mobile
            ? () => {
                setSelectedId(null);
                void refresh({ preserveSelection: false });
              }
            : undefined
        }
      />
    );
  } else if (selectedHelp?.channelId) {
    threadPane = (
      <div className="order-conversation is-embedded">
        {mobile ? (
          <button type="button" className="text-back conv-back" onClick={() => setSelectedHelpId(null)}>
            ← Back
          </button>
        ) : null}
        <header className="conv-header">
          <Avatar name={selectedHelp.member.name} />
          <div className="conv-header-copy">
            <p className="conv-header-name">{selectedHelp.member.name}</p>
            <p className="conv-header-meta">{kindLabel(selectedHelp.kind)}</p>
          </div>
        </header>
        <StatusTrail status={selectedHelp.status} />
        <ChatRoom
          channelId={selectedHelp.channelId}
          selfId={user.id}
          names={{
            [selectedHelp.member.id]: selectedHelp.member.name,
            ...(selectedHelp.volunteer ? { [selectedHelp.volunteer.id]: selectedHelp.volunteer.name } : {}),
            ...(selectedHelp.coordinator ? { [selectedHelp.coordinator.id]: selectedHelp.coordinator.name } : {}),
          }}
          compact
        />
      </div>
    );
  }

  return (
    <div className="inbox-page is-workspace">
      <ConversationLayout
        title={title}
        lede={lede}
        list={listPane}
        thread={threadPane}
        mobileThread={mobile && Boolean(selectedId || selectedHelpId)}
        actions={
          party === "buyer" ? (
            <Button variant="secondary" onClick={() => setHelpOpen(true)}>
              Contact general support
            </Button>
          ) : undefined
        }
      />
      {error ? <p className="field-error">{error}</p> : null}
      {party === "buyer" ? (
        <BuyerHelpDialog open={helpOpen} user={user} onClose={() => setHelpOpen(false)} />
      ) : null}
    </div>
  );
}
