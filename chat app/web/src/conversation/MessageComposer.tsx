import { useId, useRef, type FormEvent, type KeyboardEvent } from "react";
import type { Language } from "../../../shared/types";
import { t } from "../i18n";
import { Button } from "../ui/Button";

export function MessageComposer({
  language,
  draft,
  sending,
  upload,
  sendError,
  preview,
  disabled = false,
  onDraftChange,
  onSubmit,
  onSend,
  onAttach,
}: {
  language: Language;
  draft: string;
  sending: boolean;
  /** Upload progress 0–100 while a photo is sending; null otherwise. */
  upload: number | null;
  sendError: string | null;
  preview: { name: string; language: Language; text: string | null; pending: boolean } | null;
  disabled?: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onSend: () => void;
  onAttach: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const errorId = useId();

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (draft.trim() && !sending) onSend();
    }
  }

  return (
    <form className="composer" onSubmit={onSubmit}>
      <label className="composer-label" htmlFor="chat-draft">
        {t(language, "message")}
      </label>
      {preview && (preview.pending || preview.text) ? (
        <p className="composer-preview" aria-live="polite">
          <span className="composer-preview-kicker">{t(language, "willRead", { name: preview.name })}</span>{" "}
          {preview.text ? <span lang={preview.language}>{preview.text}</span> : <span className="meta">…</span>}
        </p>
      ) : null}
      <div className="composer-row">
        <button
          type="button"
          className="composer-attach"
          aria-label={t(language, "attachPhoto")}
          title={t(language, "attachPhoto")}
          disabled={disabled || upload !== null}
          onClick={() => fileRef.current?.click()}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="9" cy="10" r="1.75" />
            <path d="M21 16l-5-5-9 8" />
          </svg>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onAttach(file);
          }}
        />
        <textarea
          id="chat-draft"
          className="composer-input"
          value={draft}
          rows={2}
          maxLength={1000}
          aria-describedby={`${hintId}${sendError ? ` ${errorId}` : ""}`}
          aria-invalid={sendError ? true : undefined}
          onKeyDown={onKeyDown}
          onChange={(event) => onDraftChange(event.target.value)}
        />
        <Button type="submit" pending={sending} disabled={disabled || draft.trim().length === 0}>
          {sending ? t(language, "sending") : t(language, "send")}
        </Button>
      </div>
      <p className="meta composer-hint" id={hintId}>
        {upload !== null ? `${t(language, "photoSending")} · ${Math.round(upload)}%` : t(language, "messageHint")}
      </p>
      {sendError ? (
        <p className="field-error" id={errorId} role="alert">
          {sendError}
        </p>
      ) : null}
    </form>
  );
}
