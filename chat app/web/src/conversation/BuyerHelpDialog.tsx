import { useState, type FormEvent } from "react";
import type { HelpKind, PublicUser } from "../../../shared/types";
import { KINDS } from "../../../shared/types";
import { createHelpRequest } from "../api";
import { copy, kindDetail, kindLabel } from "../copy";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { TextArea } from "../ui/TextField";
import { useToast } from "../ui/Toast";

export function BuyerHelpDialog({
  open,
  onClose,
}: {
  open: boolean;
  user: PublicUser;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<HelpKind>("groceries");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await createHelpRequest(kind, note);
      setNote("");
      toast(copy.generalHelpToast);
      onClose();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not send the request.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} title={copy.requestTitle} onClose={onClose}>
      <p className="help-dialog-lede">{copy.requestLede}</p>
      <form className="help-dialog-form" onSubmit={onSubmit}>
        <fieldset>
          <legend>Kind of general help</legend>
          <div className="choices">
            {KINDS.map((item) => (
              <label key={item} className={kind === item ? "choice is-selected" : "choice"}>
                <input type="radio" name="help-kind" value={item} checked={kind === item} onChange={() => setKind(item)} />
                <span>
                  <strong>{kindLabel(item)}</strong>
                  <small>{kindDetail(item)}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <TextArea
          id="help-note"
          label={copy.noteLabel}
          hint={copy.noteHint}
          value={note}
          maxLength={280}
          rows={3}
          onChange={(event) => setNote(event.target.value)}
        />
        {error ? <p className="field-error">{error}</p> : null}
        <div className="dialog-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" pending={pending}>
            {pending ? "Sending" : copy.sendRequest}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
