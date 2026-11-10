import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MESSAGE_TYPES, type HelpRequestView, type Language, type OrderView, type PublicUser } from "../../../shared/types";
import { respondToOffer } from "../api";
import { useSession } from "../app/session";
import { currentLinkState, subscribeLink, type LinkState } from "../chat/nexconn";
import { LANGUAGE_OPTIONS, languageLabel } from "../chat/languagePrefs";
import { usePresence } from "../chat/presence";
import { getCachedTranslation, isSameAsOriginal, requestTranslations, subscribeTranslationCache, translateText } from "../chat/translate";
import { callState, requestCall } from "../chat/calls";
import { requestTranscript, saveDraft, sendTyping, type IxMessage } from "./engine";
import { useConversation } from "./useConversation";
import {
  EmojiPicker,
  Icon,
  PauseIcon,
  PlayIcon,
  Popover,
  QUICK_RX,
  dayKey,
  dur,
  fileSize,
  fmtDay,
  fmtTime,
  initials,
  isEmojiOnly,
  money,
} from "./ui";

export type Party = "buyer" | "seller" | "support";

type Pop =
  | { type: "react"; id: string; anchor: HTMLElement }
  | { type: "menu"; id: string; anchor: HTMLElement }
  | { type: "emoji"; anchor: HTMLElement; target: "composer" | string }
  | { type: "attach"; anchor: HTMLElement }
  | { type: "lang"; anchor: HTMLElement }
  | { type: "call"; anchor: HTMLElement; video: boolean };

/** Render text with links and *bold*, highlighting search matches. */
function richText(text: string, query: string, current: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(/(https?:\/\/[^\s<]+|\*[^*\n]+\*)/g);
  parts.forEach((part, index) => {
    if (/^https?:\/\//.test(part)) {
      out.push(
        <a key={index} href={part} target="_blank" rel="noopener noreferrer">
          {part}
        </a>,
      );
      return;
    }
    const bold = /^\*[^*\n]+\*$/.test(part);
    const body = bold ? part.slice(1, -1) : part;
    let nodes: ReactNode[] = [body];
    if (query) {
      const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
      nodes = body.split(re).map((chunk, i) =>
        i % 2 === 1 ? (
          <mark key={i} className={current ? "cur" : undefined}>
            {chunk}
          </mark>
        ) : (
          chunk
        ),
      );
    }
    out.push(bold ? <b key={index}>{nodes}</b> : <Fragment key={index}>{nodes}</Fragment>);
  });
  return out;
}

function suggestions(party: Party, order: OrderView, support: HelpRequestView | null, language: Language): string[] {
  const hi = language === "hi";
  if (party === "buyer") {
    if (support && support.status !== "completed")
      return hi
        ? ["मैं रंग की फ़ोटो भेज सकती हूँ", "मुझे बदलकर नया चाहिए", "कृपया पैसे वापस करें"]
        : ["I can share photos of the issue", "I would like a replacement", "Please process a refund"];
    if (order.offer?.state === "open") return hi ? ["क्या ₹ और कम हो सकता है?", "ठीक है, मंज़ूर 👍", "क्या शिपिंग मुफ़्त है?"] : ["Can you do a little less?", "Accepting now 👍", "Is shipping free?"];
    if (order.status === "shipped") return hi ? ["धन्यवाद! 🙏", "ट्रैकिंग लिंक भेज सकती हैं?", "क्या दीवाली से पहले आएगा?"] : ["Thank you! 🙏", "Can you share the tracking link?", "Will it arrive before Diwali?"];
    if (order.status === "delivered") return hi ? ["मिल गया, धन्यवाद! 🙏", "इसमें एक समस्या है", "बहुत सुंदर है ✨"] : ["Received, thank you! 🙏", "There is a problem with it", "It's beautiful ✨"];
    return hi ? ["मेरा ऑर्डर कब भेजेंगी?", "क्या दिन की रोशनी में फ़ोटो दिखा सकती हैं?", "क्या ब्लाउज़ पीस साथ आता है?"] : ["When will my order ship?", "Can I see it in daylight?", "Is a blouse piece included?"];
  }
  if (party === "seller") {
    if (support && support.status !== "completed") return ["I'm sorry about this.", "Could you share a photo?", "I can send a replacement."];
    if (order.status === "placed") return ["Thank you for your order! 🙏", "I'll pack it today.", "It ships within 2 days."];
    if (order.status === "shipped") return ["It's on its way 🚚", "Here is the tracking number.", "Let me know when it arrives."];
    return ["Namaste! How can I help?", "Thank you 🙏", "Happy to help."];
  }
  return ["Thanks for waiting, I'm looking into it.", "Could you share a photo of the issue?", "I'll confirm the next step shortly."];
}

export function Chat({
  user,
  party,
  order,
  support,
  unreadAtOpen,
  detailsOpen,
  onBack,
  onToggleDetails,
  onOrderChanged,
  onAskSupport,
  onMessages,
  toast,
}: {
  user: PublicUser;
  party: Party;
  order: OrderView;
  support: HelpRequestView | null;
  unreadAtOpen: number;
  detailsOpen: boolean;
  onBack: () => void;
  onToggleDetails: () => void;
  onOrderChanged: () => void;
  onAskSupport: (prefill: string) => void;
  onMessages?: (messages: IxMessage[]) => void;
  toast: (text: string, undo?: () => void) => void;
}) {
  const { language, autoTranslate, setLanguage, setAutoTranslate } = useSession();
  const presence = usePresence();
  const channelId = order.channelId!;
  const convo = useConversation(channelId, user.id);
  const { messages, typing, pinnedId, actions } = convo;

  const counterpart = party === "buyer" ? order.seller : order.buyer;
  const agent = support?.coordinator ?? null;
  const nameOf = useCallback(
    (id: string) =>
      id === user.id ? "You" : id === order.buyer.id ? order.buyer.name : id === order.seller.id ? order.seller.name : id === agent?.id ? agent.name : "ShopBridge",
    [user.id, order.buyer, order.seller, agent],
  );
  const roleOf = (id: string) => (id === order.buyer.id ? "Buyer" : id === order.seller.id ? "Seller" : id === agent?.id ? "Support" : "");
  const langOf = (id: string): Language | null => (id === order.buyer.id ? order.buyer.language ?? null : id === order.seller.id ? order.seller.language ?? null : agent?.language ?? null);

  const [draft, setDraft] = useState(() => presence.meta[order.id]?.draft ?? "");
  const [replyTo, setReplyTo] = useState<IxMessage | null>(null);
  const [editing, setEditing] = useState<IxMessage | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [showOrig, setShowOrig] = useState<Set<string>>(new Set());
  const [showTx, setShowTx] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState<{ open: boolean; q: string; i: number }>({ open: false, q: "", i: 0 });
  const [link, setLink] = useState<LinkState>(currentLinkState());
  const [, setTick] = useState(0);
  const [nearBottom, setNearBottom] = useState(true);
  const [dragging, setDragging] = useState(0);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [playing, setPlaying] = useState<{ id: string; pos: number } | null>(null);
  const [rec, setRec] = useState<{ start: number; levels: number[] } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recorder = useRef<{ media: MediaRecorder; chunks: Blob[]; stream: MediaStream; raf: number; send: boolean } | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const unreadMark = useRef<string | null>(null);
  const keepOffset = useRef<number | null>(null);

  useEffect(() => subscribeLink(setLink), []);

  // Hooks from the order panel: share-order card, and a reviewed AI draft for the composer.
  useEffect(() => {
    const onShare = (event: Event) => void actions.sendCard(MESSAGE_TYPES.order, { orderId: (event as CustomEvent<string>).detail });
    const onDraft = (event: Event) => {
      setDraft(String((event as CustomEvent<string>).detail ?? ""));
      textRef.current?.focus();
    };
    const onCallLog = (event: Event) => {
      const detail = (event as CustomEvent<{ channelId: string; content: Record<string, unknown>; handled: boolean }>).detail;
      if (detail.channelId !== channelId) return;
      detail.handled = true;
      void actions.sendCard(MESSAGE_TYPES.call, detail.content, "call");
    };
    window.addEventListener("ix:share-order", onShare);
    window.addEventListener("shopbridge:draft", onDraft);
    window.addEventListener("ix:call-log", onCallLog);
    return () => {
      window.removeEventListener("ix:share-order", onShare);
      window.removeEventListener("shopbridge:draft", onDraft);
      window.removeEventListener("ix:call-log", onCallLog);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  useEffect(() => onMessages?.(messages), [messages, onMessages]);
  useEffect(() => subscribeTranslationCache(() => setTick((v) => v + 1)), []);

  // Save the draft to the channel (Nexconn drafts) when leaving the conversation.
  useEffect(
    () => () => {
      void saveDraft(channelId, draftRef.current.trim());
      presence.setMeta(order.id, { draft: draftRef.current.trim() });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channelId],
  );

  // "New messages" divider at the first unread message when the conversation opened.
  useEffect(() => {
    if (convo.phase !== "ready" || unreadMark.current !== null) return;
    const others = messages.filter((m) => !m.mine);
    unreadMark.current = unreadAtOpen > 0 && others.length >= unreadAtOpen ? others[others.length - unreadAtOpen].id : "";
  }, [convo.phase, messages, unreadAtOpen]);

  // Translate the whole conversation (peer text) into the reading language.
  const translatable = useMemo(
    () =>
      messages
        .filter((m) => (m.kind === "text" || m.kind === "sys") && m.text && !m.recalled && !m.mine)
        .map((m) => ({ id: m.id, channelId, senderId: m.senderId, text: m.text, sentTime: m.at, kind: "text" as const, system: m.kind === "sys" })),
    [messages, channelId],
  );
  useEffect(() => {
    if (convo.phase === "ready" && autoTranslate && translatable.length) void requestTranslations(translatable, language);
  }, [translatable, convo.phase, autoTranslate, language]);

  const shown = (m: IxMessage): { text: string; translated: boolean } => {
    if (m.mine || !autoTranslate || showOrig.has(m.id)) return { text: m.text, translated: false };
    const state = getCachedTranslation(m.id, language);
    if (state.status === "ready" && !isSameAsOriginal(m.text, state.text)) return { text: state.text, translated: true };
    return { text: m.text, translated: false };
  };

  // Scroll behaviour: stick to bottom for new messages; hold position when loading older ones.
  useLayoutEffect(() => {
    const node = streamRef.current;
    if (!node) return;
    if (keepOffset.current !== null) {
      node.scrollTop = node.scrollHeight - keepOffset.current;
      keepOffset.current = null;
    } else if (nearBottom || messages[messages.length - 1]?.mine) {
      node.scrollTop = node.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, messages[messages.length - 1]?.id, typing, convo.phase]);

  useEffect(() => {
    if (convo.phase !== "ready") return;
    const node = streamRef.current;
    const first = unreadMark.current && node?.querySelector(`[data-id="${unreadMark.current}"]`);
    if (first instanceof HTMLElement) first.scrollIntoView({ block: "center" });
  }, [convo.phase]);

  // Live "how they'll read it" preview of the draft.
  const previewLang = counterpart.language && counterpart.language !== language ? counterpart.language : null;
  useEffect(() => {
    const text = draft.trim();
    if (!previewLang || text.length < 2 || editing) {
      setPreview(null);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      void translateText(text, previewLang).then((result) => alive && setPreview(result && !isSameAsOriginal(text, result) ? result : null));
    }, 650);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [draft, previewLang, editing]);

  // Search in conversation.
  const hits = useMemo(() => {
    const q = search.q.trim().toLowerCase();
    if (!q) return [] as string[];
    return messages
      .filter((m) => !m.recalled && m.kind !== "sys" && `${shown(m).text} ${m.transcript ?? ""} ${m.name ?? ""}`.toLowerCase().includes(q))
      .map((m) => m.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.q, messages, language, autoTranslate, showOrig]);
  const currentHit = hits.length ? hits[Math.min(search.i, hits.length - 1)] : null;
  const gotoMsg = (id: string) => {
    const el = streamRef.current?.querySelector(`[data-id="${id}"]`);
    if (!(el instanceof HTMLElement)) {
      toast("That message is no longer available");
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  };
  useEffect(() => {
    if (currentHit) gotoMsg(currentHit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHit]);

  // Keyboard: Ctrl/Cmd+F opens conversation search.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearch((s) => ({ ...s, open: true }));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Autosize composer.
  useLayoutEffect(() => {
    const t = textRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 140)}px`;
  }, [draft]);

  async function guard(task: () => Promise<unknown>, fallback: string) {
    try {
      await task();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : fallback);
    }
  }

  function submit() {
    const text = draft.trim();
    setSendError(null);
    if (editing) {
      if (text && text !== editing.text) void guard(() => actions.edit(editing, text), "Could not edit the message.");
      setEditing(null);
      setDraft("");
      return;
    }
    if (!text) {
      void startRecording();
      return;
    }
    const reply = replyTo;
    setDraft("");
    setReplyTo(null);
    setPreview(null);
    void actions.sendText(text, reply);
  }

  function sendFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) void actions.sendFile(file);
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast("Voice messages need microphone access in a secure (https) page.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      media.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const start = Date.now();
      const state = { media, chunks, stream, raf: 0, send: false };
      recorder.current = state;
      setRec({ start, levels: Array(40).fill(4) });
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const level = 4 + (data.reduce((a, b) => a + b, 0) / data.length / 255) * 60;
        setRec((r) => (r ? { ...r, levels: [...r.levels.slice(1), Math.min(26, level)] } : r));
        sendTyping(channelId, "voice", () => recorder.current !== null);
        if (Date.now() - start > 120_000) stopRecording(true);
        else state.raf = requestAnimationFrame(tick);
      };
      state.raf = requestAnimationFrame(tick);
      media.onstop = () => {
        cancelAnimationFrame(state.raf);
        stream.getTracks().forEach((track) => track.stop());
        void audioCtx.close();
        const seconds = Math.max(1, Math.round((Date.now() - start) / 1000));
        if (state.send && chunks.length) void actions.sendVoice(new Blob(chunks, { type: media.mimeType }), seconds);
      };
      media.start();
    } catch {
      toast("Microphone permission was denied.");
    }
  }

  function stopRecording(send: boolean) {
    const r = recorder.current;
    if (!r) return;
    r.send = send;
    r.media.stop();
    recorder.current = null;
    setRec(null);
  }

  function togglePlay(m: IxMessage) {
    if (!m.url) return;
    if (playing?.id === m.id) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(m.url);
    audioRef.current = audio;
    audio.ontimeupdate = () => setPlaying({ id: m.id, pos: audio.currentTime });
    audio.onended = () => setPlaying(null);
    void audio.play().catch(() => toast("This voice message could not be played."));
    setPlaying({ id: m.id, pos: 0 });
  }

  async function call(video: boolean, to?: string) {
    const current = callState();
    if (current && current.phase !== "ended" && current.phase !== "failed") {
      toast("You are already on a call");
      return;
    }
    const peer = to ?? (party === "buyer" ? order.seller.id : order.buyer.id);
    await guard(
      () => requestCall(peer, video, { orderId: order.id, channelId, title: order.items[0]?.name ?? order.id }),
      "The call could not start.",
    );
  }

  /** Support agents choose who to call; buyers and sellers call each other directly. */
  function onCallButton(video: boolean, anchor: HTMLElement) {
    if (party === "support") setPop({ type: "call", anchor, video });
    else void call(video);
  }

  const findMsg = (id: string) => messages.find((m) => m.id === id) ?? null;
  const summary = (m: IxMessage | null): string => {
    if (!m) return "Original message";
    if (m.recalled) return "Message deleted";
    if (m.kind === "image") return "📷 Photo";
    if (m.kind === "file") return `📄 ${m.name ?? "File"}`;
    if (m.kind === "voice") return `🎤 Voice message (${dur(m.duration ?? 0)})`;
    if (m.kind === "offer") return `🏷️ Offer · ${money(Number(m.payload?.amount))}`;
    if (m.kind === "track") return "🚚 Shipment update";
    if (m.kind === "order") return "📦 Order";
    return shown(m).text;
  };

  // ---- message cards ----
  function offerCard(m: IxMessage) {
    const p = m.payload ?? {};
    const live = order.offer && order.offer.id === p.offerId ? order.offer.state : "closed";
    const canAnswer = party === "buyer" && live === "open";
    return (
      <div className="ix-card offer">
        <div className="ch">
          <Icon name="tag" />
          Price offer
        </div>
        <div className="cb">
          <div className="price">
            {money(Number(p.amount))}
            <s>{money(Number(p.was))}</s>
          </div>
          {p.note ? <span className="ix-small">{String(p.note)}</span> : null}
          {canAnswer ? (
            <div className="row">
              <button
                type="button"
                className="ix-btn"
                onClick={() => void guard(async () => (await respondToOffer(order.id, String(p.offerId), false), onOrderChanged()), "Could not decline.")}
              >
                <span className="ix-btn-label">Decline</span>
              </button>
              <button
                type="button"
                className="ix-btn primary"
                onClick={() =>
                  void guard(async () => {
                    await respondToOffer(order.id, String(p.offerId), true);
                    onOrderChanged();
                    toast(`Offer accepted · total is now ${money(Number(p.amount))}`);
                  }, "Could not accept.")
                }
              >
                <span className="ix-btn-label">Accept</span>
              </button>
            </div>
          ) : (
            <span className={`ix-chip ${live === "accepted" ? "good" : live === "open" ? "shipped" : "support"}`} style={{ alignSelf: "flex-start" }}>
              <i />
              {live === "accepted" ? "Accepted" : live === "declined" ? "Declined" : live === "open" ? "Waiting for buyer" : "Replaced by a newer offer"}
            </span>
          )}
        </div>
      </div>
    );
  }

  function trackCard(m: IxMessage) {
    const p = m.payload ?? {};
    const pct = order.status === "delivered" || order.status === "completed" ? 100 : order.status === "shipped" ? 55 : 15;
    return (
      <div className="ix-card track">
        <div className="ch">
          <Icon name="truck" />
          Shipped · {String(p.courier ?? "Courier")}
        </div>
        <div className="cb">
          <b>{pct === 100 ? "Delivered" : p.eta ? `Arriving ${String(p.eta)}` : "In transit"}</b>
          <div className="ix-track-bar">
            <i style={{ width: `${pct}%` }} />
          </div>
          <span className="ix-small">
            AWB <span className="ix-mono">{String(p.awb ?? "")}</span>
          </span>
          <button
            type="button"
            className="ix-btn"
            onClick={() =>
              void navigator.clipboard?.writeText(String(p.awb ?? "")).then(
                () => toast("Tracking number copied"),
                () => toast(`AWB ${String(p.awb ?? "")}`),
              )
            }
          >
            <Icon name="copy" />
            Copy tracking number
          </button>
        </div>
      </div>
    );
  }

  function orderCard(m: IxMessage) {
    const id = String(m.payload?.orderId ?? order.id);
    const conv = presence.conversations?.find((c) => c.orderId === id);
    const title = conv?.title ?? (id === order.id ? order.items[0]?.name : "Order");
    const image = conv?.image ?? (id === order.id ? order.items[0]?.image : "");
    const total = conv?.total ?? (id === order.id ? order.total : 0);
    return (
      <div className="ix-card order">
        <div className="ch">
          <Icon name="box" />
          Order shared
        </div>
        <div className="cb">
          <div className="prodrow">
            <div className="ix-thumb">{image ? <img src={image} alt="" /> : null}</div>
            <div>
              <b>{title}</b>
              <div className="ix-small">
                <span className="ix-mono">{id}</span> · {money(total)}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function bubbleBody(m: IxMessage, isHit: boolean): { cls?: string; node: ReactNode } {
    if (m.recalled) return { cls: "recalled", node: m.mine ? "You deleted this message" : "This message was deleted" };
    const q = search.q.trim();
    if (m.kind === "image" || m.kind === "gif") {
      const src = m.thumb ?? m.url;
      return {
        cls: "media",
        node: src ? (
          <img src={src} alt="Photo" onClick={() => setLightbox(m.url ?? src)} />
        ) : (
          "Photo"
        ),
      };
    }
    if (m.kind === "file") {
      const uploading = m.status === "sending";
      const pct = Number(m.payload?.progress ?? 0);
      const ext = (m.name?.split(".").pop() ?? "FILE").slice(0, 4).toUpperCase();
      const body = (
        <>
          <span className="fi">{ext}</span>
          <div>
            <b>{m.name}</b>
            <small>
              {fileSize(m.size ?? 0)}
              {uploading ? ` · uploading ${Math.round(pct)}%` : ""}
            </small>
            {uploading ? (
              <div className="ix-prog">
                <i style={{ width: `${pct}%` }} />
              </div>
            ) : null}
          </div>
        </>
      );
      return {
        node: m.url ? (
          <a className="ix-filecard" href={m.url} target="_blank" rel="noopener noreferrer" download={m.name}>
            {body}
          </a>
        ) : (
          <div className="ix-filecard">{body}</div>
        ),
      };
    }
    if (m.kind === "voice") {
      const isPlaying = playing?.id === m.id;
      const length = m.duration ?? 0;
      const progress = isPlaying && length ? playing.pos / length : 0;
      const bars = Array.from({ length: 32 }, (_, i) => 6 + Math.round(Math.abs(Math.sin(i * 1.7 + length)) * 18));
      return {
        node: (
          <>
            <div className="ix-voice">
              <button type="button" className="play" aria-label={isPlaying ? "Pause voice message" : "Play voice message"} onClick={() => togglePlay(m)}>
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>
              <div className="ix-wave">
                {bars.map((h, i) => (
                  <i key={i} style={{ height: h }} className={progress > i / 32 ? "p" : undefined} />
                ))}
              </div>
              <small>{dur(isPlaying ? playing.pos : length)}</small>
            </div>
            {showTx.has(m.id) ? (
              <div className="ix-transcript">{m.transcript === undefined || m.transcript === null ? "Transcribing…" : m.transcript || "No speech detected."}</div>
            ) : null}
          </>
        ),
      };
    }
    if (m.kind === "offer") return { cls: "media", node: offerCard(m) };
    if (m.kind === "track") return { cls: "media", node: trackCard(m) };
    if (m.kind === "order") return { cls: "media", node: orderCard(m) };
    const text = shown(m).text;
    if (isEmojiOnly(text)) return { cls: "jumbo", node: text };
    return { node: <span lang={m.mine ? undefined : shown(m).translated ? language : langOf(m.senderId) ?? undefined}>{richText(text, q, isHit)}</span> };
  }

  // ---- stream ----
  const items: ReactNode[] = [];
  let lastDay = "";
  let prev: IxMessage | null = null;
  messages.forEach((m, index) => {
    const day = dayKey(m.at);
    if (day !== lastDay) {
      items.push(
        <div key={`d${day}`} className="ix-day">
          {fmtDay(m.at)}
        </div>,
      );
      lastDay = day;
      prev = null;
    }
    if (unreadMark.current === m.id) items.push(<div key="newdiv" className="ix-newdiv">New messages</div>);
    if (m.kind === "sys") {
      const s = shown(m);
      const alert = /support requested|declined/i.test(m.text);
      const good = /resolved|accepted|delivered/i.test(m.text);
      items.push(
        <div key={m.id} data-id={m.id} className={`ix-sys${alert ? " alert" : ""}${good ? " good" : ""}`}>
          <Icon name={alert ? "life" : "info"} />
          <span lang={s.translated ? language : "en"}>
            {s.text} · {fmtTime(m.at)}
          </span>
        </div>,
      );
      prev = null;
      return;
    }
    if (m.kind === "call") {
      const p = m.payload ?? {};
      const incoming = !m.mine;
      const missed = Boolean(p.missed);
      const label = `${missed ? (incoming ? "Missed " : "No answer · ") : ""}${p.media === "video" ? "Video call" : "Voice call"}`;
      items.push(
        <div key={m.id} data-id={m.id} className={`ix-calllog${missed ? " missed" : ""}`}>
          <span className="ci">
            <Icon name={p.media === "video" ? "video" : "phone"} />
          </span>
          <div>
            <b>{label}</b>
            <small>
              {incoming ? "Incoming" : "Outgoing"} · {fmtTime(m.at)}
              {Number(p.dur) ? ` · ${dur(Number(p.dur))}` : ""}
            </small>
          </div>
          <button type="button" className="ix-btn" style={{ height: 32 }} onClick={() => void call(p.media === "video")}>
            Call back
          </button>
        </div>,
      );
      prev = null;
      return;
    }
    const next = messages[index + 1];
    const groupable = (a: IxMessage | null, b: IxMessage | undefined) =>
      Boolean(a && b && a.senderId === b.senderId && !["sys", "call"].includes(b.kind) && Math.abs(b.at - a.at) < 300000 && dayKey(a.at) === dayKey(b.at) && unreadMark.current !== b.id);
    const first = !groupable(prev, m);
    const last = !groupable(m, next);
    const isHit = currentHit === m.id;
    const body = bubbleBody(m, isHit);
    const replied = m.reply ? findMsg(m.reply.id) : null;
    const s = shown(m);
    const side = m.mine ? "me" : "them";
    const reactions = Object.entries(m.reactions);
    items.push(
      <div key={m.id} data-id={m.id} className={`ix-msg ${side}${first ? " first" : ""}${last ? " last" : ""}`}>
        {first && !m.mine ? (
          <span className="ix-who">
            {nameOf(m.senderId)}
            {roleOf(m.senderId) && party === "support" ? <span className="role"> · {roleOf(m.senderId)}</span> : null}
          </span>
        ) : null}
        {m.recalled || m.status === "sending" ? null : (
          <div className="ix-hover-bar">
            <button type="button" title="React" aria-label="React" onClick={(e) => setPop({ type: "react", id: m.id, anchor: e.currentTarget })}>
              <Icon name="smile" />
            </button>
            <button type="button" title="Reply" aria-label="Reply" onClick={() => (setReplyTo(m), setEditing(null), textRef.current?.focus())}>
              <Icon name="reply" />
            </button>
            <button type="button" title="More" aria-label="More actions" onClick={(e) => setPop({ type: "menu", id: m.id, anchor: e.currentTarget })}>
              <Icon name="more" />
            </button>
          </div>
        )}
        <div
          className={`ix-bubble${body.cls ? ` ${body.cls}` : ""}`}
          onDoubleClick={() => !m.recalled && m.raw && void guard(() => actions.react(m, "❤️"), "Could not react.")}
          onContextMenu={(e) => {
            if (m.recalled || (e.target as HTMLElement).closest("a")) return;
            e.preventDefault();
            setPop({ type: "menu", id: m.id, anchor: e.currentTarget });
          }}
        >
          {m.reply && !m.recalled ? (
            <button type="button" className="ix-quote" onClick={() => gotoMsg(m.reply!.id)}>
              <b>{nameOf(m.reply.senderId)}</b>
              <span>{summary(replied ?? (m.reply.text ? ({ ...m, kind: "text", text: m.reply.text } as IxMessage) : null))}</span>
            </button>
          ) : null}
          {body.node}
        </div>
        {reactions.length ? (
          <div className="ix-reacts">
            {reactions.map(([emoji, users]) => (
              <button
                key={emoji}
                type="button"
                className={users.includes(user.id) ? "mine" : undefined}
                title={users.map(nameOf).join(", ")}
                onClick={() => void guard(() => actions.react(m, emoji), "Could not react.")}
              >
                {emoji}
                {users.length > 1 ? <b>{users.length}</b> : null}
              </button>
            ))}
          </div>
        ) : null}
        {s.translated || (showOrig.has(m.id) && !m.mine) ? (
          <div className="ix-tr">
            <Icon name="globe" size={12} />
            {showOrig.has(m.id) ? `Original${langOf(m.senderId) ? ` (${languageLabel(langOf(m.senderId)!)})` : ""}` : `Translated${langOf(m.senderId) ? ` from ${languageLabel(langOf(m.senderId)!)}` : ""}`} ·
            <button
              type="button"
              className="ix-link"
              onClick={() =>
                setShowOrig((set) => {
                  const next = new Set(set);
                  if (next.has(m.id)) next.delete(m.id);
                  else next.add(m.id);
                  return next;
                })
              }
            >
              {showOrig.has(m.id) ? `Show ${languageLabel(language)}` : "Show original"}
            </button>
          </div>
        ) : null}
        {m.kind === "voice" && !m.recalled && m.raw ? (
          <div className="ix-voice-act">
            <button
              type="button"
              className="ix-link"
              style={{ fontSize: 11 }}
              onClick={() => {
                const open = showTx.has(m.id);
                setShowTx((set) => {
                  const next = new Set(set);
                  if (open) next.delete(m.id);
                  else next.add(m.id);
                  return next;
                });
                if (!open && m.transcript === undefined) void guard(() => requestTranscript(m), "Transcripts are not available.");
              }}
            >
              {showTx.has(m.id) ? "Hide transcript" : "Show transcript"}
            </button>
          </div>
        ) : null}
        {m.status === "failed" ? (
          <div className="ix-meta fail">
            Not sent ·{" "}
            <button type="button" onClick={() => void actions.retry(m)}>
              Retry
            </button>
          </div>
        ) : last ? (
          <div className="ix-meta">
            {m.edited && !m.recalled ? "Edited · " : ""}
            {fmtTime(m.at)}
            {m.mine ? (
              m.status === "sending" ? (
                <span title="Sending">
                  <Icon name="clock" />
                </span>
              ) : m.status === "read" ? (
                <span className="read" title="Seen">
                  <Icon name="dtick" />
                </span>
              ) : (
                <span title="Sent">
                  <Icon name="tick" />
                </span>
              )
            ) : null}
          </div>
        ) : null}
      </div>,
    );
    prev = m;
  });

  const menuMsg = pop?.type === "menu" ? findMsg(pop.id) : null;
  const reactMsg = pop?.type === "react" ? findMsg(pop.id) : null;
  const ctx = replyTo ?? editing;
  const quick = suggestions(party, order, support, language);
  const sub = typing ? (typing.kind === "voice" ? "recording a voice message…" : "typing…") : null;
  const counterRole = party === "buyer" ? "Seller" : "Buyer";
  const supportOpen = support && support.status !== "completed";

  return (
    <section className="ix-chat" aria-label="Conversation">
      <header className="ix-chat-head">
        <button type="button" className="ix-ib ix-back" aria-label="Back to inbox" onClick={onBack}>
          <Icon name="back" />
        </button>
        <div className="ix-thumb">
          {order.items[0]?.image ? <img src={order.items[0].image} alt="" /> : null}
          <span className="av">{initials(counterpart.name)}</span>
        </div>
        <div className="ix-peer">
          <b>
            <span>{counterpart.name}</span>
            <span className="role ix-hide-sm">{counterRole}</span>
          </b>
          {sub ? (
            <small className="typing">
              {nameOf(typing!.userId).split(" ")[0]} is {sub}
            </small>
          ) : (
            <small>
              {order.items[0]?.name} · <span className="ix-mono">{order.id}</span>
              {party === "support" ? ` · Seller ${order.seller.name}` : ""}
            </small>
          )}
        </div>
        <div className="ix-head-actions">
          <button type="button" className="ix-ib" title="Voice call" aria-label="Voice call" onClick={(e) => onCallButton(false, e.currentTarget)}>
            <Icon name="phone" />
          </button>
          <button type="button" className="ix-ib" title="Video call" aria-label="Video call" onClick={(e) => onCallButton(true, e.currentTarget)}>
            <Icon name="video" />
          </button>
          <span className="ix-sep ix-hide-sm" />
          <button
            type="button"
            className={`ix-ib${search.open ? " on" : ""}`}
            title="Search in conversation"
            aria-label="Search in conversation"
            onClick={() => setSearch((s) => (s.open ? { open: false, q: "", i: 0 } : { ...s, open: true }))}
          >
            <Icon name="search" />
          </button>
          <button type="button" className="ix-ib" title="Translation" aria-label="Translation settings" onClick={(e) => setPop({ type: "lang", anchor: e.currentTarget })}>
            <Icon name="globe" />
          </button>
          <button type="button" className={`ix-ib${detailsOpen ? " on" : ""}`} title="Order details" aria-label="Order details" onClick={onToggleDetails}>
            <Icon name="info" />
          </button>
        </div>
      </header>

      {search.open ? (
        <div className="ix-searchbar">
          <label className="ix-sr" htmlFor="ix-find">
            Search messages
          </label>
          <input
            id="ix-find"
            autoFocus
            placeholder="Search in this conversation"
            autoComplete="off"
            value={search.q}
            onChange={(e) => setSearch({ open: true, q: e.target.value, i: Number.MAX_SAFE_INTEGER })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (hits.length) setSearch((s) => ({ ...s, i: (Math.min(s.i, hits.length - 1) + (e.shiftKey ? 1 : -1) + hits.length) % hits.length }));
              }
              if (e.key === "Escape") setSearch({ open: false, q: "", i: 0 });
            }}
          />
          <span>{search.q ? (hits.length ? `${Math.min(search.i, hits.length - 1) + 1} of ${hits.length}` : "No matches") : ""}</span>
          <button type="button" className="ix-ib" aria-label="Previous match" onClick={() => hits.length && setSearch((s) => ({ ...s, i: (Math.min(s.i, hits.length - 1) - 1 + hits.length) % hits.length }))}>
            <Icon name="up" />
          </button>
          <button type="button" className="ix-ib" aria-label="Next match" onClick={() => hits.length && setSearch((s) => ({ ...s, i: (Math.min(s.i, hits.length - 1) + 1) % hits.length }))}>
            <Icon name="down" />
          </button>
          <button type="button" className="ix-ib" aria-label="Close search" onClick={() => setSearch({ open: false, q: "", i: 0 })}>
            <Icon name="x" />
          </button>
        </div>
      ) : null}

      {link !== "connected" ? (
        <div className="ix-banner" role="status">
          <Icon name="wifiOff" />
          {link === "connecting"
            ? "Reconnecting… messages will send when you are back online."
            : link === "elsewhere"
              ? "This account opened chat in another window, so chat is paused here."
              : "You're offline. Messages will send when you reconnect."}
          {link !== "connecting" ? (
            <button type="button" className="ix-link" onClick={actions.reload}>
              {link === "elsewhere" ? "Use chat here" : "Reconnect"}
            </button>
          ) : null}
        </div>
      ) : null}

      {pinnedId && findMsg(pinnedId) && !findMsg(pinnedId)!.recalled ? (
        <div className="ix-pinbar" onClick={() => gotoMsg(pinnedId)}>
          <Icon name="pin" />
          <div>
            <b>Pinned message</b>
            <span>{summary(findMsg(pinnedId))}</span>
          </div>
          <button
            type="button"
            className="ix-ib"
            aria-label="Unpin"
            onClick={(e) => {
              e.stopPropagation();
              void guard(async () => (await actions.pin(null), toast("Unpinned")), "Could not unpin.");
            }}
          >
            <Icon name="x" />
          </button>
        </div>
      ) : null}

      <div
        className="ix-stream-wrap"
        onDragEnter={(e) => e.dataTransfer?.types?.includes("Files") && setDragging((n) => n + 1)}
        onDragLeave={() => setDragging((n) => Math.max(0, n - 1))}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(0);
          if (e.dataTransfer.files.length) sendFiles(e.dataTransfer.files);
        }}
      >
        <div
          className="ix-stream"
          ref={streamRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          onScroll={(e) => {
            const s = e.currentTarget;
            setNearBottom(s.scrollHeight - s.scrollTop - s.clientHeight < 120);
          }}
        >
          {convo.phase === "loading" ? <div className="ix-empty">Opening the conversation…</div> : null}
          {convo.phase === "error" ? (
            <div className="ix-empty">
              {convo.error}
              <br />
              <button type="button" className="ix-link" onClick={actions.reload}>
                Try again
              </button>
            </div>
          ) : null}
          {convo.phase === "ready" && convo.hasMore ? (
            <button
              type="button"
              className="ix-btn ix-older"
              onClick={() => {
                const s = streamRef.current;
                keepOffset.current = s ? s.scrollHeight - s.scrollTop : null;
                void actions.loadOlder();
              }}
            >
              Load earlier messages
            </button>
          ) : null}
          {convo.phase === "ready" && messages.length === 0 ? <div className="ix-empty">No messages yet. Say hello 👋</div> : null}
          {items}
          {typing ? (
            <div className="ix-typing" aria-label={`${nameOf(typing.userId)} is typing`}>
              <i />
              <i />
              <i />
            </div>
          ) : null}
        </div>
        {!nearBottom ? (
          <button type="button" className="ix-jump" onClick={() => streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" })}>
            <Icon name="arrowDown" />
            Latest
          </button>
        ) : null}
        {dragging > 0 ? <div className="ix-drop">Drop photos or files to send</div> : null}
      </div>

      <form
        className="ix-composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {!rec ? (
          <div className="ix-quick" aria-label="Suggested replies">
            <span className="ai">
              <Icon name="spark" />
              Suggested
            </span>
            {quick.map((text) => (
              <button key={text} type="button" onClick={() => (setDraft(text), textRef.current?.focus())}>
                {text}
              </button>
            ))}
          </div>
        ) : null}
        {preview && previewLang ? (
          <p className="ix-preview" aria-live="polite">
            <b>{counterpart.name.split(" ")[0]} reads ({languageLabel(previewLang)}):</b>
            <span lang={previewLang}>{preview}</span>
          </p>
        ) : null}
        {ctx ? (
          <div className="ix-ctx">
            <Icon name={editing ? "edit" : "reply"} />
            <div>
              <b>{editing ? "Editing message" : `Replying to ${replyTo!.mine ? "yourself" : nameOf(replyTo!.senderId)}`}</b>
              <span>{summary(ctx)}</span>
            </div>
            <button
              type="button"
              className="ix-ib"
              aria-label="Cancel"
              onClick={() => {
                if (editing) setDraft("");
                setEditing(null);
                setReplyTo(null);
              }}
            >
              <Icon name="x" />
            </button>
          </div>
        ) : null}
        {rec ? (
          <div className="ix-rec">
            <span className="dot" />
            <span className="t">{dur((Date.now() - rec.start) / 1000)}</span>
            <div className="ix-wave">
              {rec.levels.map((h, i) => (
                <i key={i} style={{ height: h }} />
              ))}
            </div>
            <button type="button" className="ix-ib" title="Discard" aria-label="Discard recording" onClick={() => stopRecording(false)}>
              <Icon name="trash" />
            </button>
            <button type="button" className="ix-send" aria-label="Send voice message" onClick={() => stopRecording(true)}>
              <Icon name="send" />
            </button>
          </div>
        ) : (
          <div className="ix-box">
            <button type="button" className="ix-ib" title="Attach" aria-label="Attach" onClick={(e) => setPop({ type: "attach", anchor: e.currentTarget })}>
              <Icon name="plus" />
            </button>
            <label className="ix-sr" htmlFor="ix-msg">
              Message
            </label>
            <textarea
              id="ix-msg"
              ref={textRef}
              rows={1}
              maxLength={2000}
              placeholder={language === "hi" ? "संदेश लिखें…" : "Write a message…"}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (e.target.value.trim()) sendTyping(channelId, "text", () => draftRef.current.trim().length > 0);
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData?.files ?? []);
                if (files.length) {
                  e.preventDefault();
                  sendFiles(files);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (draft.trim() || editing) submit();
                }
                if (e.key === "ArrowUp" && !draft) {
                  const lastMine = [...messages].reverse().find((m) => m.mine && m.kind === "text" && !m.recalled && m.raw);
                  if (lastMine) {
                    e.preventDefault();
                    setEditing(lastMine);
                    setReplyTo(null);
                    setDraft(lastMine.text);
                  }
                }
                if (e.key === "Escape" && (replyTo || editing)) {
                  if (editing) setDraft("");
                  setReplyTo(null);
                  setEditing(null);
                }
              }}
            />
            <button type="button" className="ix-ib" title="Emoji" aria-label="Emoji" onClick={(e) => setPop({ type: "emoji", anchor: e.currentTarget, target: "composer" })}>
              <Icon name="smile" />
            </button>
            <button
              type="submit"
              className={`ix-send${draft.trim() || editing ? "" : " is-mic"}`}
              disabled={link !== "connected" && !draft.trim()}
              aria-label={draft.trim() ? (editing ? "Save edit" : "Send") : "Record voice message"}
              title={draft.trim() ? (editing ? "Save edit" : "Send") : "Record voice message"}
            >
              <Icon name={draft.trim() || editing ? (editing ? "tick" : "send") : "mic"} />
            </button>
          </div>
        )}
        {sendError ? <p className="ix-error">{sendError}</p> : null}
        <div className="ix-hint">
          <span>
            <kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line · <kbd>↑</kbd> edit last · paste or drop images
          </span>
          <span>{draft.length > 1600 ? `${draft.length}/2000` : ""}</span>
        </div>
      </form>

      {pop?.type === "lang" ? (
        <Popover anchor={pop.anchor} className="ix-lang-pop" alignRight onClose={() => setPop(null)}>
          <label htmlFor="ix-lang">
            Read messages in
            <select id="ix-lang" value={language} onChange={(e) => void setLanguage(e.target.value as Language).then(() => toast(`Showing messages in ${languageLabel(e.target.value)}`))}>
              {LANGUAGE_OPTIONS.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.native}
                </option>
              ))}
            </select>
          </label>
          <label className="ix-switch" htmlFor="ix-auto">
            Auto-translate (Nexconn)
            <input id="ix-auto" type="checkbox" checked={autoTranslate} onChange={(e) => setAutoTranslate(e.target.checked)} />
          </label>
          <p className="ix-small" style={{ margin: 0 }}>
            Your messages are sent as you type them.
            {counterpart.language ? ` ${counterpart.name.split(" ")[0]} reads them in ${languageLabel(counterpart.language)}.` : ""}
          </p>
        </Popover>
      ) : null}

      {pop?.type === "react" && reactMsg ? (
        <Popover anchor={pop.anchor} className="ix-menu" alignRight={reactMsg.mine} onClose={() => setPop(null)}>
          <div className="rx" style={{ border: "none", margin: 0, padding: 4 }}>
            {QUICK_RX.map((emoji) => (
              <button key={emoji} type="button" onClick={() => (setPop(null), void guard(() => actions.react(reactMsg, emoji), "Could not react."))}>
                {emoji}
              </button>
            ))}
            <button type="button" aria-label="More reactions" onClick={() => setPop({ type: "emoji", anchor: pop.anchor, target: reactMsg.id })}>
              <Icon name="smile" />
            </button>
          </div>
        </Popover>
      ) : null}

      {pop?.type === "emoji" ? (
        <Popover anchor={pop.anchor} className="ix-emoji-pop" above={pop.target === "composer"} alignRight onClose={() => setPop(null)}>
          <EmojiPicker
            recent={recent}
            onPick={(emoji) => {
              setRecent((r) => [emoji, ...r.filter((x) => x !== emoji)].slice(0, 16));
              if (pop.target === "composer") {
                const t = textRef.current;
                const start = t?.selectionStart ?? draft.length;
                const end = t?.selectionEnd ?? start;
                setDraft(draft.slice(0, start) + emoji + draft.slice(end));
                requestAnimationFrame(() => t?.setSelectionRange(start + emoji.length, start + emoji.length));
              } else {
                const target = findMsg(pop.target);
                setPop(null);
                if (target) void guard(() => actions.react(target, emoji), "Could not react.");
              }
            }}
          />
        </Popover>
      ) : null}

      {pop?.type === "menu" && menuMsg ? (
        <Popover anchor={pop.anchor} className="ix-menu" alignRight={menuMsg.mine} onClose={() => setPop(null)}>
          <div className="rx">
            {QUICK_RX.map((emoji) => (
              <button key={emoji} type="button" aria-label={`React ${emoji}`} onClick={() => (setPop(null), void guard(() => actions.react(menuMsg, emoji), "Could not react."))}>
                {emoji}
              </button>
            ))}
            <button type="button" aria-label="More reactions" onClick={() => setPop({ type: "emoji", anchor: pop.anchor, target: menuMsg.id })}>
              <Icon name="smile" />
            </button>
          </div>
          <button type="button" onClick={() => (setPop(null), setReplyTo(menuMsg), setEditing(null), textRef.current?.focus())}>
            <Icon name="reply" />
            Reply
          </button>
          {menuMsg.text ? (
            <button
              type="button"
              onClick={() => {
                setPop(null);
                void navigator.clipboard?.writeText(shown(menuMsg).text).then(() => toast("Copied"), () => toast("Copy blocked by the browser"));
              }}
            >
              <Icon name="copy" />
              Copy text
            </button>
          ) : null}
          {!menuMsg.mine && menuMsg.text && getCachedTranslation(menuMsg.id, language).status === "ready" ? (
            <button
              type="button"
              onClick={() => {
                setPop(null);
                setShowOrig((set) => {
                  const next = new Set(set);
                  if (next.has(menuMsg.id)) next.delete(menuMsg.id);
                  else next.add(menuMsg.id);
                  return next;
                });
              }}
            >
              <Icon name="globe" />
              {showOrig.has(menuMsg.id) ? "Show translation" : "Show original"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setPop(null);
              const unpin = pinnedId === menuMsg.id;
              void guard(async () => (await actions.pin(unpin ? null : menuMsg.id), toast(unpin ? "Unpinned" : "Pinned for everyone in this conversation")), "Could not pin.");
            }}
          >
            <Icon name="pin" />
            {pinnedId === menuMsg.id ? "Unpin" : "Pin in chat"}
          </button>
          {party === "buyer" && !supportOpen ? (
            <button type="button" onClick={() => (setPop(null), onAskSupport(summary(menuMsg)))}>
              <Icon name="fwd" />
              Ask support about this
            </button>
          ) : null}
          {menuMsg.mine && menuMsg.kind === "text" && menuMsg.raw && Date.now() - menuMsg.at < 15 * 60_000 ? (
            <button type="button" onClick={() => (setPop(null), setEditing(menuMsg), setReplyTo(null), setDraft(menuMsg.text), textRef.current?.focus())}>
              <Icon name="edit" />
              Edit
            </button>
          ) : null}
          <button type="button" className="danger" onClick={() => (setPop(null), void guard(async () => (await actions.deleteForMe(menuMsg), toast("Deleted for you")), "Could not delete."))}>
            <Icon name="trash" />
            Delete for me
          </button>
          {menuMsg.mine && menuMsg.raw && Date.now() - menuMsg.at < 60 * 60_000 ? (
            <button type="button" className="danger" onClick={() => (setPop(null), void guard(async () => (await actions.deleteForAll(menuMsg), toast("Deleted for everyone")), "Could not delete."))}>
              <Icon name="trash" />
              Delete for everyone
            </button>
          ) : null}
        </Popover>
      ) : null}

      {pop?.type === "call" ? (
        <Popover anchor={pop.anchor} className="ix-menu" alignRight onClose={() => setPop(null)}>
          {[
            { user: order.buyer, role: "Buyer" },
            { user: order.seller, role: "Seller" },
          ].map(({ user: who, role }) => (
            <button
              key={who.id}
              type="button"
              onClick={() => {
                const video = pop.video;
                setPop(null);
                void call(video, who.id);
              }}
            >
              <Icon name={pop.video ? "video" : "phone"} />
              <span>
                {pop.video ? "Video" : "Voice"} call {who.name} <small className="ix-small">· {role}</small>
              </span>
            </button>
          ))}
        </Popover>
      ) : null}

      {pop?.type === "attach" ? (
        <Popover anchor={pop.anchor} className="ix-attach-pop" above onClose={() => setPop(null)}>
          <AttachMenu
            party={party}
            order={order}
            onPick={(kind) => {
              setPop(null);
              if (kind === "img" || kind === "doc") {
                const input = document.createElement("input");
                input.type = "file";
                if (kind === "img") {
                  input.accept = "image/*";
                  input.multiple = true;
                }
                input.onchange = () => input.files && sendFiles(input.files);
                input.click();
              }
              if (kind === "order") void actions.sendCard(MESSAGE_TYPES.order, { orderId: order.id });
              if (kind === "ask") {
                setDraft(language === "hi" ? "क्या आप थोड़ा कम दाम दे सकती हैं? मैं दीवाली के लिए ख़रीद रही हूँ 🪔" : "Could you offer a better price? I am buying for Diwali 🪔");
                textRef.current?.focus();
              }
              if (kind === "offer") {
                if (!detailsOpen) onToggleDetails();
                toast("Make an offer from the order panel.");
              }
            }}
          />
        </Popover>
      ) : null}

      {lightbox ? (
        <button type="button" className="ix-lightbox" aria-label="Close photo" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="Photo" />
        </button>
      ) : null}
    </section>
  );
}

function AttachMenu({ party, order, onPick }: { party: Party; order: OrderView; onPick: (kind: "img" | "doc" | "order" | "ask" | "offer") => void }) {
  const canOffer = party === "seller" && (order.status === "placed" || order.status === "packed");
  return (
    <>
      <button type="button" onClick={() => onPick("img")}>
        <i style={{ background: "var(--indigo-soft)", color: "var(--indigo)" }}>
          <Icon name="img" />
        </i>
        <span>
          <b>Photo</b>
          <small>Show the issue or ask about colour</small>
        </span>
      </button>
      <button type="button" onClick={() => onPick("doc")}>
        <i style={{ background: "var(--leaf-soft)", color: "var(--leaf)" }}>
          <Icon name="doc" />
        </i>
        <span>
          <b>Document</b>
          <small>Invoice, size chart, PDF</small>
        </span>
      </button>
      <button type="button" onClick={() => onPick("order")}>
        <i style={{ background: "var(--marigold-soft)", color: "var(--marigold-ink)" }}>
          <Icon name="box" />
        </i>
        <span>
          <b>Share an order</b>
          <small>Send an order card</small>
        </span>
      </button>
      {party === "buyer" ? (
        <button type="button" onClick={() => onPick("ask")}>
          <i style={{ background: "var(--madder-soft)", color: "var(--madder)" }}>
            <Icon name="tag" />
          </i>
          <span>
            <b>Ask for a better price</b>
            <small>Seller can reply with an offer</small>
          </span>
        </button>
      ) : null}
      {canOffer ? (
        <button type="button" onClick={() => onPick("offer")}>
          <i style={{ background: "var(--madder-soft)", color: "var(--madder)" }}>
            <Icon name="tag" />
          </i>
          <span>
            <b>Send a price offer</b>
            <small>Buyer can accept in the chat</small>
          </span>
        </button>
      ) : null}
    </>
  );
}
