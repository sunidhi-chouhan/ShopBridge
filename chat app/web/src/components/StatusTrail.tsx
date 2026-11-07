import type { RequestStatus } from "../../../shared/types";
import { statusLabel } from "../copy";
import { Badge } from "../ui/Badge";

const steps: RequestStatus[] = ["requested", "assigned", "in_progress", "completed"];

function tone(status: RequestStatus): "neutral" | "accent" | "warning" | "success" {
  if (status === "assigned") return "accent";
  if (status === "in_progress") return "warning";
  if (status === "completed") return "success";
  return "neutral";
}

/** Support case progress: waiting → with support → resolution proposed → resolved. */
export function StatusTrail({ status }: { status: RequestStatus }) {
  const current = steps.indexOf(status);
  return (
    <ol className="trail" aria-label="Support case progress">
      {steps.map((step, index) => {
        const state = index < current ? "done" : index === current ? "current" : "upcoming";
        return (
          <li key={step} className="trail-step" aria-current={state === "current" ? "step" : undefined}>
            <Badge tone={state === "upcoming" ? "neutral" : tone(step)}>{statusLabel(step)}</Badge>
          </li>
        );
      })}
    </ol>
  );
}
