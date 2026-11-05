import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";

export function ActionMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="action-menu" ref={wrap}>
      <Button
        variant="quiet"
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="menu"
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
      >
        Actions
      </Button>
      {open ? (
        <div id={menuId} className="action-menu-list" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
