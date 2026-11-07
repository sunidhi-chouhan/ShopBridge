import type { Language } from "../../../shared/types";
import { LANGUAGE_OPTIONS, languageLabel } from "../chat/languagePrefs";
import { t } from "../i18n";

export function LanguageBar({
  uiLanguage,
  language,
  autoTranslate,
  onLanguage,
  onAutoTranslate,
  statusLabel,
  compact = false,
}: {
  uiLanguage: Language;
  language: Language;
  autoTranslate: boolean;
  onLanguage: (next: Language) => void;
  onAutoTranslate: (next: boolean) => void;
  /** Optional status chip, e.g. "Translating…" / "Translation unavailable" */
  statusLabel?: string | null;
  compact?: boolean;
}) {
  const id = compact ? "room-read-lang" : "account-read-lang";
  return (
    <div className={compact ? "language-bar is-compact" : "language-bar"} role="group" aria-label="Translation">
      <label className="language-bar-field" htmlFor={id}>
        <span className="language-bar-label">{t(uiLanguage, "readIn")}</span>
        <select
          id={id}
          className="language-bar-select"
          value={language}
          onChange={(event) => onLanguage(event.target.value as Language)}
        >
          {LANGUAGE_OPTIONS.map((item) => (
            <option key={item.code} value={item.code} lang={item.code}>
              {item.native}
            </option>
          ))}
        </select>
      </label>
      <label className={autoTranslate ? "language-bar-toggle is-on" : "language-bar-toggle"}>
        <input type="checkbox" checked={autoTranslate} onChange={(event) => onAutoTranslate(event.target.checked)} />
        <span className="language-bar-toggle-ui" aria-hidden="true" />
        <span>{t(uiLanguage, "autoTranslate")}</span>
      </label>
      {statusLabel ? (
        <p className="language-bar-status meta" role="status">
          {statusLabel}
        </p>
      ) : null}
      {!compact ? (
        <p className="meta language-bar-hint">
          Messages from others are translated into {languageLabel(language)} by Nexconn. The original stays one tap away.
        </p>
      ) : null}
    </div>
  );
}
