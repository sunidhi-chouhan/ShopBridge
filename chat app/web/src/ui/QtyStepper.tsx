import { useEffect, useState, type KeyboardEvent } from "react";

export function QtyStepper({
  value,
  min = 1,
  max,
  onChange,
  disabled = false,
  label = "Quantity",
  editable = false,
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  label?: string;
  editable?: boolean;
}) {
  const ceiling = Math.max(min, max);
  const atMin = disabled || value <= min;
  const atMax = disabled || value >= ceiling;
  const [typed, setTyped] = useState(String(value));

  useEffect(() => {
    setTyped(String(value));
  }, [value]);

  function clamp(next: number) {
    if (!Number.isFinite(next)) return;
    onChange(Math.max(min, Math.min(ceiling, Math.trunc(next))));
  }

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      event.preventDefault();
      clamp(value + 1);
    } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      event.preventDefault();
      clamp(value - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      clamp(min);
    } else if (event.key === "End") {
      event.preventDefault();
      clamp(ceiling);
    }
  }

  return (
    <div className={`qty-stepper${editable ? " is-stock" : ""}`} role="group" aria-label={label} onKeyDown={onKey}>
      <button
        type="button"
        className="qty-btn"
        aria-label={`Decrease ${label.toLowerCase()}`}
        disabled={atMin}
        onClick={() => clamp(value - 1)}
      >
        <span aria-hidden="true">−</span>
      </button>
      {editable ? (
        <input
          className="qty-input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]*"
          aria-label={label}
          disabled={disabled}
          value={typed}
          onChange={(event) => {
            const raw = event.target.value.replace(/\D/g, "").slice(0, 4);
            setTyped(raw);
            if (raw === "") return;
            clamp(Number(raw));
          }}
          onBlur={() => {
            if (typed === "") clamp(min);
            else clamp(Number(typed));
          }}
        />
      ) : (
        <span className="qty-value" aria-live="polite" aria-atomic="true">
          {value}
        </span>
      )}
      <button
        type="button"
        className="qty-btn"
        aria-label={atMax ? `Increase ${label.toLowerCase()}, only ${ceiling} available` : `Increase ${label.toLowerCase()}`}
        title={atMax && !disabled ? `Only ${ceiling} on the shelf` : undefined}
        disabled={atMax}
        onClick={() => clamp(value + 1)}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
