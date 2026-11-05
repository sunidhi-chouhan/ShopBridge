import { useRef, type ButtonHTMLAttributes, type MouseEvent } from "react";
import { useMotionOn } from "./motion";
import { SbLoader } from "./SbLoader";

type Variant = "primary" | "secondary" | "quiet" | "danger";

export function Button({
  variant = "primary",
  pending = false,
  added = false,
  magnetic = false,
  children,
  disabled,
  type = "button",
  className,
  onMouseMove,
  onMouseLeave,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; pending?: boolean; added?: boolean; magnetic?: boolean }) {
  const motionOn = useMotionOn();
  const ref = useRef<HTMLButtonElement>(null);

  function move(event: MouseEvent<HTMLButtonElement>) {
    onMouseMove?.(event);
    if (!magnetic || !motionOn || disabled || pending) return;
    const node = ref.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    const x = event.clientX - box.left - box.width / 2;
    const y = event.clientY - box.top - box.height / 2;
    node.style.transform = `translate(${x * 0.12}px, ${y * 0.18}px)`;
  }

  function leave(event: MouseEvent<HTMLButtonElement>) {
    onMouseLeave?.(event);
    if (ref.current) ref.current.style.transform = "";
  }

  return (
    <button
      ref={ref}
      type={type}
      className={["btn", `btn-${variant}`, magnetic ? "is-magnetic" : "", pending ? "is-pending" : "", added ? "is-added" : "", className]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      onMouseMove={move}
      onMouseLeave={leave}
      {...props}
    >
      <span className="btn-label">{children}</span>
      {pending ? <SbLoader tone="button" label="Working" /> : null}
    </button>
  );
}
