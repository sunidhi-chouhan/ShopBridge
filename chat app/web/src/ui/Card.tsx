import type { HTMLAttributes, ReactNode } from "react";

export type CardVariant = "feature" | "form" | "profile" | "product" | "compact";

export function cardClass(variant: CardVariant = "form", extra?: string): string {
  return ["sb-card", `is-${variant}`, extra].filter(Boolean).join(" ");
}

export function Card({
  variant = "form",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: CardVariant; children: ReactNode }) {
  return (
    <div className={cardClass(variant, className)} {...props}>
      {children}
    </div>
  );
}
