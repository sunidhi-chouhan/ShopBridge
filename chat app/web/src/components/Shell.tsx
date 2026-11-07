import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode, type SVGProps } from "react";
import { setTheme, useTheme, type ThemeChoice } from "../app/theme";
import { AnimatePresence, motion } from "motion/react";
import type { Language, PublicUser } from "../../../shared/types";
import { useSession } from "../app/session";
import { LANGUAGE_OPTIONS } from "../chat/languagePrefs";
import { usePresence } from "../chat/presence";
import { copy } from "../copy";
import { t } from "../i18n";
import { navigate, useRoute } from "../ui/route";
import { ResetDemoDialog } from "./DemoControls";
import { CallLayer } from "../inbox/CallLayer";
import { DemoPanel } from "./DemoPanel";
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

function AccountMenu({
  user,
  onSignOut,
  onResetDemo,
}: {
  user: PublicUser;
  onSignOut: () => void;
  onResetDemo?: () => void;
}) {
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
          {onResetDemo ? (
            <div className="account-demo" role="group" aria-label="Demo controls">
              <p className="account-demo-kicker">Shared demo</p>
              <button
                type="button"
                role="menuitem"
                className="account-signout account-reset"
                onClick={() => {
                  setOpen(false);
                  onResetDemo();
                }}
              >
                Reset demo data…
              </button>
              <p className="account-demo-hint">Restores products, orders and support cases for everyone.</p>
            </div>
          ) : null}
          <ThemePicker />
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

/** Appearance: follow the device, or force light / dark. Saved on this device only. */
function ThemePicker() {
  const { choice } = useTheme();
  const options: { value: ThemeChoice; label: string }[] = [
    { value: "system", label: "Auto" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];
  return (
    <div className="account-theme" role="group" aria-label="Appearance">
      <p className="account-demo-kicker">Appearance</p>
      <div className="theme-seg">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="menuitemradio"
            aria-checked={choice === option.value}
            className={choice === option.value ? "on" : undefined}
            onClick={() => setTheme(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** In-app notifications for new messages in conversations that are not on screen. */
function NotificationStack() {
  const { notices, dismiss } = usePresence();
  const { language } = useSession();
  const motionOn = useMotionOn();
  return (
    <div className="notices" aria-live="polite" aria-label="New messages">
      <AnimatePresence>
        {notices.map((notice) => (
          <motion.div
            key={notice.id}
            className="notice"
            role="status"
            initial={motionOn ? { opacity: 0, y: 12 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={motionOn ? { opacity: 0, y: 8 } : undefined}
            transition={{ duration: 0.25, ease: easeOut }}
          >
            <button
              type="button"
              className="notice-open"
              onClick={() => {
                dismiss(notice.id);
                navigate("inbox", notice.orderId);
              }}
            >
              <span className="notice-who">
                {notice.sender || t(language, "newMessage")} <span className="meta">· {notice.title}</span>
              </span>
              <span className="notice-text">{notice.preview}</span>
            </button>
            <button type="button" className="notice-close" aria-label="Dismiss" onClick={() => dismiss(notice.id)}>
              ×
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Reading-language prompt — only when opening Inbox, and only until a language is chosen or skipped. */
function LanguageOnboarding() {
  const { user, setLanguage } = useSession();
  const [route] = useRoute();
  const [saving, setSaving] = useState<Language | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const inInbox = (route.section ?? defaultSection(user.role)) === "inbox";
  const open = inInbox && !user.language && !dismissed;

  function skip() {
    setDismissed(true);
  }

  return (
    <Dialog
      open={open}
      className="language-dialog"
      closable
      title="Which language do you read?"
      onClose={skip}
    >
      <p className="language-dialog-sub" lang="hi">
        आप कौन-सी भाषा पढ़ते हैं?
      </p>
      <p>Messages from sellers and support will be translated into this language. You can change it any time in the conversation.</p>
      <div className="language-choices" role="list">
        {LANGUAGE_OPTIONS.map((item) => (
          <button
            key={item.code}
            type="button"
            role="listitem"
            className="language-choice"
            lang={item.code}
            disabled={saving !== null}
            aria-busy={saving === item.code || undefined}
            onClick={() => {
              setSaving(item.code);
              void setLanguage(item.code)
                .catch(() => undefined)
                .finally(() => {
                  setSaving(null);
                  setDismissed(true);
                });
            }}
          >
            <span className="language-choice-native">{item.native}</span>
            <span className="language-choice-code">{item.code.toUpperCase()}</span>
          </button>
        ))}
      </div>
      <div className="dialog-actions">
        <Button variant="quiet" onClick={skip}>
          Not now
        </Button>
      </div>
    </Dialog>
  );
}

export function Shell({
  user,
  onSignOut,
  onDemoReset,
  children,
}: {
  user: PublicUser;
  onSignOut: () => void;
  /** Called after this browser successfully reset the shared demo. */
  onDemoReset: () => void;
  children: (section: Section, go: (section: Section) => void) => ReactNode;
}) {
  const motionOn = useMotionOn();
  const items = navItems(user.role);
  const [route] = useRoute();
  const { demo } = useSession();
  const { totalUnread } = usePresence();
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const section = route.section ?? defaultSection(user.role);
  const active = items.some((item) => item.id === section) ? section : defaultSection(user.role);
  const setSection = (next: Section) => navigate(next);
  const badge = (id: Section) =>
    id === "inbox" && totalUnread > 0 ? (
      <span className="nav-badge" aria-label={`${totalUnread} unread`}>
        {totalUnread > 99 ? "99+" : totalUnread}
      </span>
    ) : null;

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
                      {badge(item.id)}
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
            <AccountMenu
              user={user}
              onSignOut={requestSignOut}
              onResetDemo={demo?.canReset ? () => setResetting(true) : undefined}
            />
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
                    {badge(item.id)}
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <NotificationStack />
        <CallLayer selfId={user.id} />
        <DemoPanel />
        <LanguageOnboarding />
        <ResetDemoDialog
          open={resetting}
          onClose={() => setResetting(false)}
          onDone={() => {
            setResetting(false);
            onDemoReset();
          }}
        />
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
