import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { HelpKind, HelpRequestView, PublicUser, RequestStatus } from "../../../shared/types";
import { KINDS, STATUSES } from "../../../shared/types";
import { assignVolunteer, claimOrderSupport, listRequests, listVolunteers, openRoom, updateStatus } from "../api";
import { copy, kindLabel, statusLabel } from "../copy";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { formatDeskWhen, requestTone } from "../ui/desk";
import { FilterBar } from "../ui/FilterBar";
import { Metric, MetricGrid } from "../ui/Metric";
import { SelectField } from "../ui/SelectField";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateView";
import { useToast } from "../ui/Toast";
import { StatusTrail } from "../components/StatusTrail";

export function CoordinatorDesk({ onInbox }: { onInbox: () => void }) {
  const [requests, setRequests] = useState<HelpRequestView[] | null>(null);
  const [volunteers, setVolunteers] = useState<PublicUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [volunteerId, setVolunteerId] = useState("");
  const [statusFilter, setStatusFilter] = useState<RequestStatus | "">("");
  const [kindFilter, setKindFilter] = useState<HelpKind | "">("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const toast = useToast();

  async function refresh() {
    const [requestResult, volunteerResult] = await Promise.all([listRequests(), listVolunteers()]);
    setError(null);
    setRequests(requestResult.requests);
    setVolunteers(volunteerResult.volunteers);
    setSelectedId((current) => current ?? requestResult.requests[0]?.id ?? null);
    setVolunteerId((current) => current || volunteerResult.volunteers[0]?.id || "");
  }

  useEffect(() => {
    let alive = true;
    const load = () => {
      refresh().catch((caught: unknown) => {
        if (alive) setError(caught instanceof Error ? caught.message : "Could not load the queue.");
      });
    };
    load();
    const timer = window.setInterval(load, 4000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const all = requests ?? [];
  const filtered = useMemo(
    () =>
      all.filter((item) => {
        if (statusFilter && item.status !== statusFilter) return false;
        if (kindFilter && item.kind !== kindFilter) return false;
        return true;
      }),
    [all, kindFilter, statusFilter],
  );
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  async function onAssign(event: FormEvent) {
    event.preventDefault();
    if (!selected || pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await assignVolunteer(selected.id, volunteerId);
      if (!result.nexconn) setNotice(copy.keysMissing);
      else toast("Seller assigned.");
      await refresh();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not assign a seller.");
    } finally {
      setPending(false);
    }
  }

  async function onOpenRoom() {
    if (!selected || pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await openRoom(selected.id);
      await refresh();
      toast("Room opened.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not open the room.");
    } finally {
      setPending(false);
    }
  }

  async function onClaimOrder() {
    if (!selected || pending || !selected.orderId) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await claimOrderSupport(selected.id);
      if (!result.nexconn) setNotice(copy.keysMissing);
      else toast("Joined the order conversation.");
      await refresh();
      onInbox();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not claim order support.");
    } finally {
      setPending(false);
    }
  }

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

  if (requests === null && !error) return <LoadingState label="Loading the queue" />;
  if (error && requests === null) return <ErrorState message={error} onRetry={() => void refresh()} />;

  const counts = {
    requested: all.filter((item) => item.status === "requested").length,
    assigned: all.filter((item) => item.status === "assigned").length,
    in_progress: all.filter((item) => item.status === "in_progress").length,
    completed: all.filter((item) => item.status === "completed").length,
  };

  return (
    <div className="desk-page">
      <header className="page-mast">
        <p className="kicker">Support</p>
        <h1 className="page-title">Queue.</h1>
        <p className="lede">
          Order support reuses the buyer–seller Nexconn channel — claim to join it. General community help needs a
          seller assignment and a separate help room.
        </p>
      </header>
      <MetricGrid>
        <Metric label="New" value={String(counts.requested)} />
        <Metric label="Assigned" value={String(counts.assigned)} />
        <Metric label="In progress" value={String(counts.in_progress)} />
        <Metric label="Completed" value={String(counts.completed)} />
      </MetricGrid>
      {all.length === 0 ? (
        <EmptyState compact title={copy.noRequests} detail="New requests from buyers appear here." scene="orders" />
      ) : (
        <>
          <div className="filter-row">
            <FilterBar
              legend="Status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[{ value: "", label: "All status" }, ...STATUSES.map((item) => ({ value: item, label: statusLabel(item) }))]}
            />
            <FilterBar
              legend="Kind"
              value={kindFilter}
              onChange={setKindFilter}
              options={[{ value: "", label: "All kinds" }, ...KINDS.map((item) => ({ value: item, label: kindLabel(item) }))]}
            />
          </div>
          <div className="desk">
            <section className="queue" aria-label={copy.queue}>
              {filtered.length === 0 ? <p className="meta">No requests match those filters.</p> : null}
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
                            {item.orderId ? `Order ${item.orderId}` : kindLabel(item.kind)} · {formatDeskWhen(item.createdAt)}
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
                <p className="lede">Choose a request from the list.</p>
              ) : (
                <>
                  <Card variant="form" className="case-card">
                    <p className="hint">
                      {selected.orderId
                        ? `Order support · ${selected.orderId} · same order channel`
                        : `General help · ${kindLabel(selected.kind)}`}
                    </p>
                    <h2>{selected.member.name}</h2>
                    {selected.note ? <p>{selected.note}</p> : null}
                    <p className="meta">Opened {formatDeskWhen(selected.createdAt)}</p>
                    <StatusTrail status={selected.status} />
                    {selected.volunteer ? <p className="meta">Seller: {selected.volunteer.name}</p> : null}
                    {selected.coordinator ? <p className="meta">Support: {selected.coordinator.name}</p> : null}
                    <div className="actions">
                      {selected.orderId && !selected.coordinator && selected.status === "requested" ? (
                        <Button pending={pending} onClick={() => void onClaimOrder()}>
                          Claim & join order conversation
                        </Button>
                      ) : null}
                      {selected.orderId && selected.channelId && selected.coordinator ? (
                        <Button variant="secondary" onClick={onInbox}>
                          Open order inbox
                        </Button>
                      ) : null}
                      {!selected.orderId && selected.volunteer && !selected.channelId ? (
                        <Button pending={pending} onClick={() => void onOpenRoom()}>
                          {copy.openRoom}
                        </Button>
                      ) : null}
                      {selected.status === "assigned" ? (
                        <Button variant={selected.channelId ? "primary" : "secondary"} pending={pending} onClick={() => void move("in_progress")}>
                          {copy.markProgress}
                        </Button>
                      ) : null}
                      {selected.status === "in_progress" ? (
                        <Button pending={pending} onClick={() => void move("completed")}>
                          {copy.markDone}
                        </Button>
                      ) : null}
                      {!selected.orderId && selected.channelId ? (
                        <Button variant="secondary" onClick={onInbox}>
                          Open Inbox
                        </Button>
                      ) : null}
                    </div>
                  </Card>
                  {selected.status === "requested" && !selected.orderId ? (
                    <Card variant="compact" className="assign-panel">
                      <p className="kicker">Assignment</p>
                      <h3>Assign a seller</h3>
                      <form className="assign" onSubmit={onAssign}>
                        <SelectField
                          id="volunteer"
                          label={copy.volunteerLabel}
                          value={volunteerId}
                          hint="Sample sellers can be assigned from this desk. To talk in the room, sign in as a seller in another window and assign that person."
                          onChange={(event) => setVolunteerId(event.target.value)}
                        >
                          {volunteers.map((volunteer) => (
                            <option key={volunteer.id} value={volunteer.id}>
                              {volunteer.name}
                              {volunteer.sample ? " · sample" : ""}
                            </option>
                          ))}
                        </SelectField>
                        <Button type="submit" pending={pending} disabled={!volunteerId}>
                          {pending ? "Assigning" : copy.assign}
                        </Button>
                      </form>
                    </Card>
                  ) : null}
                </>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
