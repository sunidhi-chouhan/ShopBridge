import type { ReactNode } from "react";

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="tooltip">
      {children}
      <span className="tooltip-bubble" role="tooltip" aria-hidden="true">
        {label}
      </span>
    </span>
  );
}
