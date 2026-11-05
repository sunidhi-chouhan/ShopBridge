import type { FormEvent } from "react";
import { copy } from "../copy";
import { Button } from "../ui/Button";
import { TextArea } from "../ui/TextField";

export function MessageComposer({
  draft,
  sending,
  sendError,
  onDraftChange,
  onSubmit,
}: {
  draft: string;
  sending: boolean;
  sendError: string | null;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form className="composer" onSubmit={onSubmit}>
      <TextArea
        id="chat-draft"
        label={copy.messageLabel}
        value={draft}
        rows={2}
        maxLength={1000}
        error={sendError}
        onChange={(event) => onDraftChange(event.target.value)}
      />
      <Button type="submit" pending={sending} disabled={draft.trim().length === 0}>
        {sending ? "Sending" : copy.send}
      </Button>
    </form>
  );
}
