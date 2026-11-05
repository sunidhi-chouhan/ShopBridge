import { Button } from "../ui/Button";

/** Shared room-level notice — one explanation for many failed peer translations. */
export function TranslationNotice({
  pending,
  onRetry,
  retrying,
}: {
  pending: boolean;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <aside className="translation-notice" aria-live="polite">
      <div className="translation-notice-copy">
        <p className="translation-notice-title">Translation unavailable</p>
        <p className="translation-notice-detail meta">
          Enable Translation in Nexconn Console to translate this message.
        </p>
      </div>
      <Button variant="secondary" pending={retrying || pending} disabled={retrying || pending} onClick={onRetry}>
        {retrying || pending ? "Retrying" : "Retry translation"}
      </Button>
    </aside>
  );
}
