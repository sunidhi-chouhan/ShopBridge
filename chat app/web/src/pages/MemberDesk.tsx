import { useEffect, useState, type FormEvent } from "react";
import type { HelpKind, HelpRequestView, PublicUser } from "../../../shared/types";
import { KINDS } from "../../../shared/types";
import { createHelpRequest, listRequests } from "../api";
import { ChatRoom } from "../components/ChatRoom";
import { StatusTrail } from "../components/StatusTrail";
import { copy, kindDetail, kindLabel } from "../copy";
import { Button } from "../ui/Button";
import { cardClass } from "../ui/Card";
import { EmptyState, ErrorState, LoadingState, SuccessState } from "../ui/StateView";
import { TextArea } from "../ui/TextField";
import { useToast } from "../ui/Toast";

export function MemberDesk({ user }: { user: PublicUser }) {
  const [requests, setRequests] = useState<HelpRequestView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<HelpKind>("groceries");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const toast = useToast();

  async function refresh() {
    const result = await listRequests();
    setError(null);
    // Order-linked support lives in ConversationInbox / OrderDetail, not community help.
    setRequests(result.requests.filter((item) => !item.orderId));
  }

  useEffect(() => {
    let alive = true;
    const load = () => {
      refresh().catch((caught: unknown) => {
        if (alive) setError(caught instanceof Error ? caught.message : "Could not load your request.");
      });
    };
    load();
    const timer = window.setInterval(load, 4000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const open = requests?.find((item) => item.status !== "completed") ?? null;
  const latest = requests?.[0] ?? null;
  const shown = open ?? latest;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await createHelpRequest(kind, note);
      setNote("");
      await refresh();
      toast("Request sent.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not send the request.");
    } finally {
      setPending(false);
    }
  }

  if (requests === null && !error) return <LoadingState label="Loading your desk" />;

  return (
    <>
      {error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setError(null);
            void refresh().catch((caught: unknown) =>
              setError(caught instanceof Error ? caught.message : "Could not load your request."),
            );
          }}
        />
      ) : null}

      {shown ? (
        <article className={cardClass("form", "request-card")}>
          <p className="kicker">{kindLabel(shown.kind)}</p>
          <h1 className="page-title">{shown.note || kindDetail(shown.kind)}</h1>
          {shown.status === "completed" ? (
            <SuccessState title="Request completed" detail="You can send another request below." />
          ) : (
            <StatusTrail status={shown.status} />
          )}
          {shown.volunteer ? <p className="meta">Seller: {shown.volunteer.name}</p> : <p className="meta">{copy.waiting}</p>}
          {shown.channelId ? (
            <ChatRoom
              channelId={shown.channelId}
              selfId={user.id}
              names={{
                [shown.member.id]: shown.member.name,
                ...(shown.volunteer ? { [shown.volunteer.id]: shown.volunteer.name } : {}),
                ...(shown.coordinator ? { [shown.coordinator.id]: shown.coordinator.name } : {}),
              }}
            />
          ) : (
            <EmptyState title={copy.roomWaiting} scene="inbox" inset />
          )}
        </article>
      ) : null}

      {!open ? (
        <form className={cardClass("form", "request-form")} onSubmit={onSubmit}>
          <p className="kicker">Inbox</p>
          <h1 className="page-title">{shown ? copy.another : copy.requestTitle}</h1>
          <p className="lede">Choose the kind of help. A support agent will assign a seller and open a room when the desk is ready.</p>
          <fieldset>
            <legend>Kind of help</legend>
            <div className="choices">
              {KINDS.map((item) => (
                <label key={item} className={kind === item ? "choice is-selected" : "choice"}>
                  <input type="radio" name="kind" value={item} checked={kind === item} onChange={() => setKind(item)} />
                  <span>
                    <strong>{kindLabel(item)}</strong>
                    <small>{kindDetail(item)}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <TextArea id="note" label={copy.noteLabel} hint={copy.noteHint} value={note} maxLength={280} rows={3} onChange={(event) => setNote(event.target.value)} />
          <Button type="submit" pending={pending}>
            {pending ? "Sending" : copy.sendRequest}
            {pending ? null : <span aria-hidden="true">→</span>}
          </Button>
        </form>
      ) : null}
    </>
  );
}
