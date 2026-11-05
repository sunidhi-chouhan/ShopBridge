import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode, type SVGProps } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { PublicUser } from "../../../shared/types";
import { copy } from "../copy";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { easeOut, useMotionOn } from "../ui/motion";
import { defaultSection, navItems, roleLabel, type Section } from "../ui/nav";
import { Tooltip } from "../ui/Tooltip";

const SignOutRequest = createContext<() => void>(() => {});

export function useRequestSignOut(): () => void {
  return useContext(SignOutRequest);
}

function Icon({ name }: { name: Section }) {
  const props: SVGProps<SVGSVGElement> = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    "aria-hidden": true,
  };
  if (name === "shop") {
    return (
      <svg {...props}>
        <path d="M4 9h16v11H4zM3 9l2-5h14l2 5M9 20v-6h6v6" />
      </svg>
    );
  }
  if (name === "orders") {
    return (
      <svg {...props}>
        <path d="M7 3h10v18l-2-1.5L13 21l-2-1.5L9 21l-2-1.5L5 21V7" />
        <path d="M9 8h6M9 12h6" />
      </svg>
    );
  }
  if (name === "inbox") {
    return (
      <svg {...props}>
        <path d="M3 13l2-8h14l2 8v6H3zM3 13h5l1 3h6l1-3h5" />
      </svg>
    );
  }
  if (name === "products") {
    return (
      <svg {...props}>
        <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
        <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
      </svg>
    );
  }
  if (name === "queue") {
    return (
      <svg {...props}>
        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <circle cx="12" cy="8" r="3" />
      <path d="M5 19c1.5-3 3.5-4.5 7-4.5S17.5 16 19 19" />
    </svg>
  );
}

function AccountMenu({ user, onSignOut }: { user: PublicUser; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
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
    <div className={`account-menu${open ? " is-open" : ""}`} ref={wrap}>
      <button
        type="button"
        className="account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
      >
        <Avatar name={user.name} />
        <span className="whoami-copy">
          <span>{user.name}</span>
          <span>{roleLabel(user.role)}</span>
        </span>
        <span className="account-caret" aria-hidden="true" />
      </button>
      {open ? (
        <div className="account-panel" id={menuId} role="menu">
          <p className="account-identity">
            <span>{user.name}</span>
            <span>{roleLabel(user.role)}</span>
          </p>
          <button
            type="button"
            role="menuitem"
            className="account-signout"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            {copy.signOut}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Shell({
  user,
  onSignOut,
  children,
}: {
  user: PublicUser;
  onSignOut: () => void;
  children: (section: Section, go: (section: Section) => void) => ReactNode;
}) {
  const motionOn = useMotionOn();
  const items = navItems(user.role);
  const [section, setSection] = useState<Section>(defaultSection(user.role));
  const [confirming, setConfirming] = useState(false);
  const active = items.some((item) => item.id === section) ? section : defaultSection(user.role);

  useEffect(() => {
    const canvas = document.querySelector(".canvas");
    if (canvas) canvas.scrollTop = 0;
  }, [active]);

  function requestSignOut() {
    setConfirming(true);
  }

  function confirmSignOut() {
    setConfirming(false);
    onSignOut();
  }

  return (
    <SignOutRequest.Provider value={requestSignOut}>
      <div className="app-shell">
        <a className="skip" href="#main">
          Skip to content
        </a>
        <aside className="rail">
          <p className="rail-mark" aria-hidden="true">
            Sb
          </p>
          <div className="rail-brand">
            <p className="wordmark">{copy.name}</p>
            <p className="tagline">{copy.tagline}</p>
            <p className="role-chip">{roleLabel(user.role)}</p>
          </div>
          <nav aria-label="Primary">
            <ul className="nav-list">
              {items.map((item) => (
                <li key={item.id}>
                  <Tooltip label={item.label}>
                    <button
                      type="button"
                      className="nav-button"
                      aria-current={item.id === active ? "page" : undefined}
                      onClick={() => setSection(item.id)}
                    >
                      {item.id === active && motionOn ? <motion.span className="nav-pill" layoutId="nav-pill" transition={{ duration: 0.45, ease: easeOut }} /> : null}
                      {!motionOn && item.id === active ? <span className="nav-pill" /> : null}
                      <Icon name={item.id} />
                      <span className="nav-label">{item.label}</span>
                    </button>
                  </Tooltip>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <p className="top-mark">{copy.name}</p>
            <AccountMenu user={user} onSignOut={requestSignOut} />
          </header>
          <main id="main" className="canvas" data-role={user.role}>
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                className="canvas-inner"
                initial={motionOn ? { opacity: 0, y: 10 } : false}
                animate={{ opacity: 1, y: 0 }}
                exit={motionOn ? { opacity: 0, y: -8 } : undefined}
                transition={{ duration: 0.35, ease: easeOut }}
              >
                {children(active, setSection)}
              </motion.div>
            </AnimatePresence>
          </main>
          <nav className="tabbar" aria-label="Primary">
            <ul className="nav-list">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="tab-button"
                    aria-current={item.id === active ? "page" : undefined}
                    onClick={() => setSection(item.id)}
                  >
                    <Icon name={item.id} />
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <Dialog open={confirming} title="Sign out?" onClose={() => setConfirming(false)}>
          <p>You will leave this desk. The conversation stays available when you sign in again.</p>
          <div className="dialog-actions">
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Stay
            </Button>
            <Button variant="danger" onClick={confirmSignOut}>
              {copy.signOut}
            </Button>
          </div>
        </Dialog>
      </div>
    </SignOutRequest.Provider>
  );
}
