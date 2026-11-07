import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const PATHS = {
  tick: ["m5 12 4 4 10-10", 2],
  dtick: ["m2 12 4 4 10-10M10 16l1 0 10-10", 2],
  clock: ['<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', 2],
  info: ['<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>', 2],
  life: ['<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m5.6 5.6 3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6"/>', 2],
  box: ['<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>', 1.8],
  x: ["M6 6l12 12M18 6 6 18", 2],
  reply: ['<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v4"/>', 1.8],
  smile: ['<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" stroke-width="2.2"/>', 1.8],
  more: ['<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>', 2.4],
  copy: ['<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>', 1.8],
  edit: ['<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>', 1.8],
  pin: ['<path d="M9 4h6l-1 6 4 4H6l4-4z"/><path d="M12 14v7"/>', 1.8],
  trash: ["M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3", 1.8],
  globe: ['<path d="M4 5h9M8.5 3v2M6 5c0 4 3 7 6 8M11 5c0 4-3 8-7 9"/><path d="m13 21 4-9 4 9M14.5 18h5"/>', 1.8],
  fwd: ['<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0-6 6v4"/>', 1.8],
  send: ["M4 12 20 4l-6 16-3-7z", 2],
  mic: ['<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>', 1.8],
  phone: ["M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2", 1.8],
  video: ['<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>', 1.8],
  videoOff: ["M3 3l18 18M16 16v.5A1.5 1.5 0 0 1 14.5 18H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1M10 6h4.5A1.5 1.5 0 0 1 16 7.5V10l5-3v10", 1.8],
  micOff: ["M3 3l18 18M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.9 5M19 11a7 7 0 0 1-.6 2.8M12 18v3", 1.8],
  hang: ["M3 15c5-5 13-5 18 0l-2 3-4-1v-3a10 10 0 0 0-6 0v3l-4 1z", 1.8],
  min: ["M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7", 1.8],
  img: ['<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>', 1.8],
  doc: ['<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>', 1.8],
  tag: ['<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>', 1.8],
  truck: ['<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>', 1.8],
  spark: ["M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18", 1.8],
  wifiOff: ["M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01M3 3l18 18", 2],
  search: ['<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', 1.8],
  plus: ["M12 5v14M5 12h14", 1.8],
  back: ["m15 18-6-6 6-6", 2],
  up: ["m6 15 6-6 6 6", 2],
  down: ["m6 9 6 6 6-6", 2],
  arrowDown: ["M12 5v14M6 13l6 6 6-6", 2],
  bellOff: ['<path d="M3 3l18 18"/><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>', 1.8],
  sliders: ['<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>', 1.8],
  alert: ['<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17v.5"/>', 1.8],
  speaker: ['<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>', 1.8],
  sun: ['<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', 1.8],
  moon: ["M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z", 1.8],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size }: { name: IconName; size?: number }) {
  const [d, width] = PATHS[name];
  const markup = d.startsWith("<") ? d : `<path d="${d}"/>`;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      width={size}
      height={size}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

export const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
);
export const PauseIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);

export const fmtTime = (t: number) => new Date(t).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
export const dayKey = (t: number) => new Date(t).toDateString();
export function fmtDay(t: number): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const x = new Date(t);
  x.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - x.getTime()) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return new Date(t).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}
export const listTime = (t: number) => (t ? (fmtDay(t) === "Today" ? fmtTime(t) : fmtDay(t)) : "");
export const dur = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
export const fileSize = (bytes: number) =>
  bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;

export function isEmojiOnly(text: string): boolean {
  if (!text) return false;
  const stripped = text.replace(/\s/g, "");
  return (
    /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️){1,12}$/u.test(stripped) &&
    [...stripped].length <= 6 &&
    /\p{Extended_Pictographic}/u.test(stripped)
  );
}

export const EMOJI: Record<string, string> = {
  "😀 Smileys": "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😋 😛 🤗 🤩 🤔 🤨 😐 😏 😒 🙄 😬 😌 😔 😴 🥺 😢 😭 😤 😠 😡 🤯 😳 😱 😨 😰 🥳 😎 🤓 🧐 😮 😲 🤐 🤫 🤭",
  "🙏 Hands": "👍 👎 👌 ✌️ 🤞 🤝 🙏 👏 🙌 👐 🤲 👋 ✋ 🖐️ 💪 👀 🫶 ☝️ 👇 👉 👈 ✍️",
  "❤️ Hearts": "❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 💔 💕 💖 💗 💝 ✨ ⭐ 🌟 🔥 💯 ✅ ❌ ❗ ❓",
  "🛍️ Shopping": "🛍️ 👗 👘 🥻 👚 👜 👛 🧵 🪡 🎁 📦 🚚 🏷️ 💳 💰 🧾 📸 📍 ⏰ 📅 🏠 🪔",
  "🎉 Celebrate": "🎉 🎊 🎈 🪅 🎂 🍬 🍫 🌸 🌺 🌼 🌻 🌷 🪷 🍃 ☀️ 🌙 🌈 🎶 🙌",
};
export const EMOJI_NAMES: Record<string, string> = {
  "😀": "grin smile happy", "😂": "laugh joy lol", "😍": "love heart eyes", "🙏": "thanks namaste please pray",
  "👍": "yes ok like thumbs", "❤️": "love heart red", "🔥": "fire hot", "🎉": "party celebrate", "😢": "sad cry",
  "😮": "wow surprised", "📦": "package parcel box", "🚚": "delivery truck shipping", "🥻": "sari saree",
  "👗": "dress", "🪔": "diya diwali lamp", "💯": "hundred perfect", "✅": "done check yes", "🤔": "think hmm",
  "😡": "angry", "🎁": "gift",
};
export const QUICK_RX = ["❤️", "👍", "😂", "😮", "🙏", "😢"];

/** Anchored popover in a portal; closes on outside click, Escape, or resize. */
export function Popover({
  anchor,
  className,
  alignRight = false,
  above = false,
  onClose,
  children,
}: {
  anchor: HTMLElement;
  className: string;
  alignRight?: boolean;
  above?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    const pw = el.offsetWidth;
    const ph = el.offsetHeight;
    let left = alignRight ? r.right - pw : r.left;
    left = Math.max(12, Math.min(window.innerWidth - pw - 12, left));
    let top = above || r.bottom + ph + 8 > window.innerHeight ? r.top - ph - 8 : r.bottom + 8;
    top = Math.max(12, top);
    setPos({ left, top });
  }, [anchor, alignRight, above]);
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div
      ref={ref}
      className={`ix-pop ${className}`}
      role="dialog"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function EmojiPicker({ onPick, recent }: { onPick: (emoji: string) => void; recent: string[] }) {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const cats = Object.keys(EMOJI);
  const all = cats.flatMap((key) => EMOJI[key].split(" ").map((emoji) => ({ emoji, cat: key })));
  const q = query.trim().toLowerCase();
  const results = q
    ? all.filter(({ emoji, cat }) => (EMOJI_NAMES[emoji] ?? "").includes(q) || cat.toLowerCase().includes(q))
    : [];
  return (
    <>
      <div className="eh">
        <label className="ix-sr" htmlFor="ix-emoji-search">
          Search emoji
        </label>
        <input
          id="ix-emoji-search"
          placeholder="Search emoji (love, thanks, sari…)"
          autoComplete="off"
          value={query}
          autoFocus={window.matchMedia("(hover: hover)").matches}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="ix-emoji-cats">
        {cats.map((key, index) => (
          <button
            key={key}
            type="button"
            title={key.split(" ").slice(1).join(" ")}
            className={index === cat ? "on" : ""}
            onClick={() => {
              setCat(index);
              setQuery("");
              const heading = gridRef.current?.querySelector(`#ix-cat-${index}`) as HTMLElement | null;
              if (heading && gridRef.current) gridRef.current.scrollTop = heading.offsetTop - gridRef.current.offsetTop;
            }}
          >
            {key.split(" ")[0]}
          </button>
        ))}
      </div>
      <div className="ix-emoji-grid" ref={gridRef}>
        {q ? (
          results.length ? (
            results.map(({ emoji }) => (
              <button key={emoji} type="button" onClick={() => onPick(emoji)} aria-label={emoji}>
                {emoji}
              </button>
            ))
          ) : (
            <h5>No emoji found</h5>
          )
        ) : (
          <>
            {recent.length ? <h5>Recent</h5> : null}
            {recent.map((emoji) => (
              <button key={`r${emoji}`} type="button" onClick={() => onPick(emoji)} aria-label={emoji}>
                {emoji}
              </button>
            ))}
            {cats.map((key, index) => [
              <h5 key={`h${key}`} id={`ix-cat-${index}`}>
                {key.split(" ").slice(1).join(" ")}
              </h5>,
              ...EMOJI[key].split(" ").map((emoji) => (
                <button key={`${key}${emoji}`} type="button" onClick={() => onPick(emoji)} aria-label={emoji}>
                  {emoji}
                </button>
              )),
            ])}
          </>
        )}
      </div>
    </>
  );
}

/** Small transient toast with optional Undo, styled like the prototype. */
export function useIxToast(): [ReactNode, (text: string, undo?: () => void) => void] {
  const [toast, setToast] = useState<{ text: string; undo?: () => void; id: number } | null>(null);
  const timer = useRef<number | null>(null);
  const show = (text: string, undo?: () => void) => {
    if (timer.current) window.clearTimeout(timer.current);
    const id = Date.now();
    setToast({ text, undo, id });
    timer.current = window.setTimeout(() => setToast(null), undo ? 5000 : 2600);
  };
  const node = toast
    ? createPortal(
        <div className="ix-toast" role="status">
          {toast.text}
          {toast.undo ? (
            <button
              type="button"
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
            >
              Undo
            </button>
          ) : null}
        </div>,
        document.body,
      )
    : null;
  return [node, show];
}
