import { useEffect, useId, useRef, type ReactNode } from "react";

export function Dialog({
  open,
  title,
  onClose,
  children,
  closable = false,
  className,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Show an × control and allow backdrop click to dismiss. */
  closable?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={["dialog", className].filter(Boolean).join(" ")}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (closable && event.target === ref.current) onClose();
      }}
    >
      <header className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        {closable ? (
          <button type="button" className="dialog-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        ) : null}
      </header>
      {children}
    </dialog>
  );
}
