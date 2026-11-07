import { useEffect, useMemo, useState } from "react";
import type { HelpRequestView, RequestStatus } from "../../../shared/types";
import { STATUSES } from "../../../shared/types";
import { claimOrderSupport, listRequests } from "../api";
import { usePresence } from "../chat/presence";
import { StatusTrail } from "../components/StatusTrail";
import { copy, statusLabel } from "../copy";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { formatDeskWhen, formatWaiting, requestTone } from "../ui/desk";
import { FilterBar } from "../ui/FilterBar";
import { Metric, MetricGrid } from "../ui/Metric";
import { useRoute } from "../ui/route";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateView";
import { useToast } from "../ui/Toast";

/** Support queue: order-linked cases only. Claiming joins the buyer–seller order conversation. */
export function CoordinatorDesk() {
  const [requests, setRequests] = useState<HelpRequestView[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RequestStatus | "">("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [, go] = useRoute();
  const presence = usePresence();
  const toast = useToast();

  async function refresh() {
    const result = await listRequests();
    setError(null);
    const cases = result.requests.filter((item) => item.orderId);
    setRequests(cases);
    setSelectedId((current) => current ?? cases.find((item) => item.status === "requested")?.id ?? cases[0]?.id ?? null);
  }

  useEffect(() => {
    let alive = true;
    const load = () => {
      refresh().catch((caught: unknown) => {
        if (alive) setError(caught instanceof Error ? caught.message : "Could not load the queue.");
      });
    };
    load();
    const timer = window.setInterval(load, 8000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const all = requests ?? [];
  const filtered = useMemo(
    () => all.filter((item) => !statusFilter || item.status === statusFilter),
    [all, statusFilter],
  );
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  async function onClaim() {
    if (!selected || pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await claimOrderSupport(selected.id);
      if (!result.nexconn) setNotice(copy.keysMissing);
      else toast("Joined the order conversation.");
      await refresh();
      await presence.refresh();
      go("inbox", selected.orderId);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not claim this case.");
    } finally {
      setPending(false);
    }
  }

  if (requests === null && !error) return <LoadingState label="Loading the queue" />;
  if (error && requests === null) return <ErrorState message={error} onRetry={() => void refresh()} />;

  const count = (status: RequestStatus) => all.filter((item) => item.status === status).length;

  return (
    <div className="desk-page">
      <header className="page-mast">
        <p className="kicker">Support</p>
        <h1 className="page-title">Queue.</h1>
        <p className="lede">
          Buyers escalate from inside an order conversation. Claim a case to join that same conversation with its full
          history, then propose a resolution the buyer confirms.
        </p>
      </header>
      <MetricGrid>
        <Metric label="Waiting" value={String(count("requested"))} />
        <Metric label="With support" value={String(count("assigned"))} />
        <Metric label="Proposed" value={String(count("in_progress"))} />
        <Metric label="Resolved" value={String(count("completed"))} />
      </MetricGrid>
      {all.length === 0 ? (
        <EmptyState compact title={copy.noCases} detail="When a buyer asks for help on an order, the case appears here." scene="orders" />
      ) : (
        <>
          <div className="filter-row">
            <FilterBar
              legend="Status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[{ value: "", label: "All cases" }, ...STATUSES.map((item) => ({ value: item, label: statusLabel(item) }))]}
            />
          </div>
          <div className="desk">
            <section className="queue" aria-label="Support queue">
              {filtered.length === 0 ? <p className="meta">No cases match that filter.</p> : null}
              {filtered.length > 0 ? (
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
                          <span>
                            {item.volunteer ? `with ${item.volunteer.name} · ` : ""}
                            {item.status === "completed" ? formatDeskWhen(item.updatedAt) : `waiting ${formatWaiting(item.createdAt)}`}
                          </span>
                        </span>
                        <Badge tone={requestTone(item.status)}>{statusLabel(item.status)}</Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
            <section className="desk-detail">
              {error ? <ErrorState message={error} /> : null}
              {notice ? (
                <p className="note" role="status">
                  {notice}
                </p>
              ) : null}
              {!selected ? (
                <p className="lede">Choose a case from the list.</p>
              ) : (
                <Card variant="form" className="case-card">
                  <p className="hint">
                    Order <span className="cell-id">{selected.orderId}</span> · opened {formatDeskWhen(selected.createdAt)}
                  </p>
                  <h2>{selected.member.name}</h2>
                  {selected.note ? <p lang={selected.member.language ?? undefined}>“{selected.note}”</p> : null}
                  <StatusTrail status={selected.status} />
                  {selected.volunteer ? <p className="meta">Seller: {selected.volunteer.name}</p> : null}
                  {selected.coordinator ? <p className="meta">Agent: {selected.coordinator.name}</p> : null}
                  <div className="actions">
                    {!selected.coordinator && selected.status === "requested" ? (
                      <Button pending={pending} onClick={() => void onClaim()}>
                        Claim and join conversation
                      </Button>
                    ) : null}
                    {selected.coordinator ? (
                      <Button variant="secondary" onClick={() => go("inbox", selected.orderId)}>
                        Open conversation
                      </Button>
                    ) : null}
                  </div>
                </Card>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
