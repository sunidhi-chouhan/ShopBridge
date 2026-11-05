type LoaderTone = "page" | "inline" | "catalogue" | "button";

export function SbLoader({
  tone = "inline",
  label = "Loading",
}: {
  tone?: LoaderTone;
  label?: string;
}) {
  return (
    <span className={`sb-loader is-${tone}`} role="status" aria-live="polite" aria-label={label}>
      <span className="sb-ring" aria-hidden="true" />
      <span className="sb-mono" aria-hidden="true">
        <span className="sb-letter">S</span>
        <span className="sb-letter">B</span>
      </span>
      {tone === "page" || tone === "inline" ? <span className="sb-caption">{label}</span> : null}
    </span>
  );
}
