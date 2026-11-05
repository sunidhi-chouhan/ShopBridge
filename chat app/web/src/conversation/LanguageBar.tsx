import { LANGUAGE_OPTIONS, languageLabel, type LanguagePrefs } from "../chat/languagePrefs";

export function LanguageBar({
  prefs,
  onChange,
  statusLabel,
  compact = false,
}: {
  prefs: LanguagePrefs;
  onChange: (next: LanguagePrefs) => void;
  /** Optional status chip, e.g. "Translating…" / "Translation unavailable" */
  statusLabel?: string | null;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "language-bar is-compact" : "language-bar"} aria-label="Translation language">
      <label className="language-bar-field" htmlFor={compact ? "room-read-lang" : "account-read-lang"}>
        <span className="language-bar-label">Read messages in</span>
        <select
          id={compact ? "room-read-lang" : "account-read-lang"}
          className="language-bar-select"
          value={prefs.targetLanguage}
          onChange={(event) => onChange({ ...prefs, targetLanguage: event.target.value })}
          aria-label="Preferred reading language"
        >
          {LANGUAGE_OPTIONS.map((item) => (
            <option key={item.code} value={item.code}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className={prefs.autoTranslate ? "language-bar-toggle is-on" : "language-bar-toggle"}>
        <input
          type="checkbox"
          checked={prefs.autoTranslate}
          onChange={(event) => onChange({ ...prefs, autoTranslate: event.target.checked })}
        />
        <span className="language-bar-toggle-ui" aria-hidden="true" />
        <span>Auto-translate peers</span>
      </label>
      {statusLabel ? (
        <p className="language-bar-status meta" role="status">
          {statusLabel}
        </p>
      ) : null}
      {!compact ? (
        <p className="meta language-bar-hint">
          Uses Nexconn built-in translation into {languageLabel(prefs.targetLanguage)}. Original text always stays
          visible. Requires Console Translation to be enabled.
        </p>
      ) : null}
    </div>
  );
}
