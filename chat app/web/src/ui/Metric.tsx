import type { ReactNode } from "react";
import { Card } from "./Card";

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="metric-grid">{children}</div>;
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card variant="compact" className="metric">
      <p className="kicker">{label}</p>
      <p className="metric-value">{value}</p>
    </Card>
  );
}
