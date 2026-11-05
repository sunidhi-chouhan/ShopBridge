import { useEffect, useMemo, useState } from "react";
import type { HelpRequestView, PublicUser } from "../../../shared/types";
import { listRequests, updateStatus } from "../api";
import { ChatRoom } from "../components/ChatRoom";
import { StatusTrail } from "../components/StatusTrail";
import { copy, kindLabel, statusLabel } from "../copy";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { formatDeskWhen, requestPreview, requestTone } from "../ui/desk";
import { PageTrail } from "../ui/PageTrail";
import { SearchField } from "../ui/SearchField";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateView";
import { useToast } from "../ui/Toast";

export function InboxDesk({
  user,
  party,
  onQueue,
}: {
  user: PublicUser;
  party: "seller" | "support";
  onQueue?: () => void;
}) {
  const [requests, setRequests] = useState<HelpRequestView[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const toast = useToast();

  async function refresh() {
    const result = await listRequests();
    setError(null);
    setRequests(result.requests);
    setSelectedId((current) => current ?? result.requests[0]?.id ?? null);
  }

  useEffect(() => {
    let alive = true;
    const load = () => {
      refresh().catch((caught: unknown) => {
        if (alive) setError(caught instanceof Error ? caught.message : "Could not load conversations.");
      });
    };
    load();
    const timer = window.setInterval(load, 4000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const filtered = useMemo(() => {
    const list = [...(requests ?? [])].sort((a, b) => {
      if (Boolean(a.channelId) !== Boolean(b.channelId)) return a.channelId ? -1 : 1;
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
    const needle = query.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((item) => {
      const hay = `${item.member.name} ${item.volunteer?.name ?? ""} ${kindLabel(item.kind)} ${item.note}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [query, requests]);

  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  async function move(status: "in_progress" | "completed") {
    if (!selected || pending) return;
    setPending(true);
    setError(null);
    try {
      await updateStatus(selected.id, status);
      await refresh();
      toast(status === "completed" ? "Request completed." : "Marked in progress.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not update the request.");
    } finally {
      setPending(false);
    }
  }

  if (requests === null && !error) return <LoadingState label="Opening Inbox" />;
  if (error && requests === null) return <ErrorState message={error} onRetry={() => void refresh()} />;

  return (
    <div className="inbox-page">
      {party === "support" && onQueue ? <PageTrail items={[{ label: "Queue", onClick: onQueue }, { label: "Inbox" }]} /> : null}
      <header className="desk-head">
        <div>
          <p className="kicker">Inbox</p>
          <h1 className="page-title">{party === "support" ? "Case conversations." : "Assigned conversations."}</h1>
          <p className="lede">
            {party === "support"
              ? "Rooms that a support agent has opened for a request. Status stays on Queue."
              : "Talk with the buyer once a support agent opens the room."}
          </p>
        </div>
      </header>
      {!requests || requests.length === 0 ? (
        <EmptyState
          compact
          title="No conversation yet."
          detail={
            party === "support"
              ? "Open a request in the queue and start a room when a seller is assigned."
              : "When a support agent assigns you and opens a room, it appears here."
          }
          scene="inbox"
          actionLabel={party === "support" && onQueue ? "Open Queue" : undefined}
          onAction={party === "support" ? onQueue : undefined}
        />
      ) : (
        <div className="desk inbox-desk">
          <section className="queue" aria-label="Conversations">
            <SearchField
              id="inbox-search"
              label="Search conversations"
              placeholder="Search by name or note"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {filtered.length === 0 ? (
              <p className="meta">No conversations match that search.</p>
            ) : (
              <ul className="queue-list">
                {filtered.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="queue-button"
                      aria-current={item.id === selected?.id ? "true" : undefined}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <Avatar name={item.member.name} />
                      <span className="queue-copy">
                        <strong>{item.member.name}</strong>
                        <span className="inbox-preview">{requestPreview(item.note, item.kind)}</span>
                        <span>
                          {kindLabel(item.kind)} · {formatDeskWhen(item.updatedAt)}
                        </span>
                      </span>
                      {item.channelId ? <span className="inbox-live" aria-label="Room open" /> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="desk-detail">
            {error ? <ErrorState message={error} /> : null}
            {!selected ? (
              <EmptyState compact inset title="Choose a conversation." detail="Select a request from the list." scene="inbox" />
            ) : (
              <Card variant="form" className="inbox-thread">
                <p className="hint">{kindLabel(selected.kind)}</p>
                <h2>{selected.member.name}</h2>
                <p className="meta">
                  <Badge tone={requestTone(selected.status)}>{statusLabel(selected.status)}</Badge>
                  {selected.volunteer ? ` · Seller: ${selected.volunteer.name}` : ""}
                  {selected.coordinator ? ` · Support: ${selected.coordinator.name}` : ""}
                </p>
                {selected.note ? <p>{selected.note}</p> : null}
                <StatusTrail status={selected.status} />
                {party === "seller" ? (
                  <div className="actions">
                    {selected.status === "assigned" ? (
                      <Button pending={pending} onClick={() => void move("in_progress")}>
                        {copy.markProgress}
                      </Button>
                    ) : null}
                    {selected.status === "in_progress" ? (
                      <Button pending={pending} onClick={() => void move("completed")}>
                        {copy.markDone}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {party === "support" && onQueue ? (
                  <Button variant="secondary" onClick={onQueue}>
                    Back to queue
                  </Button>
                ) : null}
                {selected.channelId ? (
                  <ChatRoom
                    channelId={selected.channelId}
                    selfId={user.id}
                    names={{
                      [selected.member.id]: selected.member.name,
                      ...(selected.volunteer ? { [selected.volunteer.id]: selected.volunteer.name } : {}),
                      ...(selected.coordinator ? { [selected.coordinator.id]: selected.coordinator.name } : {}),
                    }}
                  />
                ) : (
                  <EmptyState
                    compact
                    inset
                    title={selected.volunteer ? copy.roomWaiting : "A seller has not been assigned yet."}
                    scene="inbox"
                  />
                )}
              </Card>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
