import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { formatInr } from "../../../shared/catalog";
import type { Language, LiveProduct, LiveView, ProductView, PublicUser } from "../../../shared/types";
import { ApiError, buyLive, endLive, featureLive, getLive, listLive, listSellerProducts, startLive } from "../api";
import { useSession } from "../app/session";
import { enterLive, exitLive, sendHeart, sendLiveText, subscribeLive, type LiveChat, type LiveSignal } from "../chat/live";
import type { ChatLine } from "../chat/nexconn";
import {
  getCachedTranslation,
  isSameAsOriginal,
  requestTranslations,
  subscribeTranslation,
  type TranslationState,
} from "../chat/translate";
import { languageLabel } from "../chat/languagePrefs";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { ProductPhoto } from "../ui/ProductPhoto";
import { navigate, useRoute } from "../ui/route";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateView";
import { useToast } from "../ui/Toast";
import "./live.css";

const LOBBY_REFRESH_MS = 10_000;

function elapsed(since: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** Quick questions in the viewer's own language: Nexconn translates them for the host. */
const QUICK: Partial<Record<Language, string[]>> = {
  en: ["Is it pure cotton?", "Show the border up close", "Any other colours?"],
  hi: ["क्या यह शुद्ध कॉटन है?", "बॉर्डर पास से दिखाइए", "और कौन से रंग हैं?"],
  es: ["¿Es algodón puro?", "¿Puede mostrar el borde?", "¿Hay otros colores?"],
  fr: ["Est-ce du coton pur ?", "Montrez la bordure de près", "D’autres couleurs ?"],
  ar: ["هل هو قطن خالص؟", "أرني الحافة عن قرب", "هل توجد ألوان أخرى؟"],
  zh: ["是纯棉的吗？", "能近看一下边吗？", "还有别的颜色吗？"],
};

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

export function LivePage({ user }: { user: PublicUser }) {
  const [route] = useRoute();
  if (route.liveId) return <LiveRoom key={route.liveId} id={route.liveId} user={user} />;
  return <LiveLobby user={user} />;
}

function LiveLobby({ user }: { user: PublicUser }) {
  const [sessions, setSessions] = useState<LiveView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seller = user.role === "volunteer";

  const load = useCallback(async () => {
    try {
      const result = await listLive();
      setSessions(result.sessions);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load live sessions.");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), LOBBY_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const mine = sessions?.find((session) => session.seller.id === user.id) ?? null;
  const others = (sessions ?? []).filter((session) => session.seller.id !== user.id);

  return (
    <div className="studio-stack desk-page live-lobby">
      <header className="page-mast">
        <p className="kicker">Live from the loom</p>
        <h1 className="page-title">{seller ? "Sell live, in every language." : "Shop live with the makers."}</h1>
        <p className="lede">
          {seller
            ? "Put a piece on stage and answer questions as they come in. Every viewer reads the chat in their own language."
            : "Ask the maker anything in your language, watch others react, and buy the piece on stage in one tap."}
        </p>
      </header>

      {seller && mine ? (
        <div className="live-resume">
          <span className="live-pill">● Live</span>
          <p>
            You are live: <strong>{mine.title}</strong>
          </p>
          <Button onClick={() => navigate("live", mine.id)}>Return to your room →</Button>
        </div>
      ) : null}
      {seller && sessions && !mine ? <GoLiveForm onStarted={(session) => navigate("live", session.id)} /> : null}

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {!sessions && !error ? <LoadingState label="Finding live sessions" /> : null}

      {sessions && (others.length > 0 || !seller) ? (
        <section className="live-grid-wrap" aria-labelledby="live-now">
          <h2 id="live-now" className="live-section-title">
            Live now
          </h2>
          {others.length === 0 ? (
            <EmptyState
              compact
              scene="shop"
              title="No one is live right now."
              detail="Makers go live to show new pieces. Check back soon, or sign in as the demo seller and go live yourself."
            />
          ) : (
            <ul className="live-grid">
              {others.map((session) => (
                <li key={session.id}>
                  <button type="button" className="live-card" onClick={() => navigate("live", session.id)}>
                    <span className="live-card-photo">
                      <ProductPhoto src={session.featured?.image} alt={session.featured?.name ?? session.title} />
                      <span className="live-pill">● Live</span>
                      <span className="live-viewers">{session.viewers ?? 0} watching</span>
                    </span>
                    <span className="live-card-body">
                      <strong>{session.title}</strong>
                      <span>
                        {session.seller.name}
                        {session.featured ? ` · ${session.featured.name}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function GoLiveForm({ onStarted }: { onStarted: (session: LiveView) => void }) {
  const [products, setProducts] = useState<ProductView[] | null>(null);
  const [title, setTitle] = useState("Live from the loom");
  const [productId, setProductId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSellerProducts()
      .then((result) => {
        const published = result.products.filter((product) => product.published && product.stock > 0);
        setProducts(published);
        setProductId((current) => current || published[0]?.id || "");
      })
      .catch(() => setProducts([]));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await startLive(title, productId || null);
      onStarted(result.session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not go live.");
      setPending(false);
    }
  }

  return (
    <form className="live-golive" onSubmit={(event) => void submit(event)}>
      <label className="live-field">
        <span>Session title</span>
        <input value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} required />
      </label>
      <fieldset className="live-field">
        <legend>Put on stage first</legend>
        {products === null ? <LoadingState label="Loading your pieces" /> : null}
        {products && products.length === 0 ? <p className="lede">Publish a product with stock to feature it live.</p> : null}
        <div className="live-pick">
          {(products ?? []).map((product) => (
            <label key={product.id} className={`live-pick-item${productId === product.id ? " is-on" : ""}`}>
              <input
                type="radio"
                name="live-product"
                value={product.id}
                checked={productId === product.id}
                onChange={() => setProductId(product.id)}
              />
              <ProductPhoto src={product.images[0]} alt="" />
              <span>{product.name}</span>
              <small>{formatInr(product.price)}</small>
            </label>
          ))}
        </div>
      </fieldset>
      {error ? <p className="live-error" role="alert">{error}</p> : null}
      <Button type="submit" pending={pending} disabled={!title.trim()}>
        <span className="live-dot" aria-hidden="true" /> Go live
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

type FeedItem =
  | { kind: "chat"; id: string; line: LiveChat }
  | { kind: "event"; id: string; text: string; tone: "sale" | "info" };

type Heart = { id: number; x: number; hue: number };

function eventText(signal: Extract<LiveSignal, { type: "event" }>, sellerName: string): { text: string; tone: "sale" | "info" } | null {
  const event = signal.event;
  if (event.kind === "start") return { text: `${firstName(sellerName)} went live`, tone: "info" };
  if (event.kind === "feature") return { text: `Now on stage: ${event.product.name}`, tone: "info" };
  if (event.kind === "sale") return { text: `🎉 ${event.buyer} just bought ${event.product.name}`, tone: "sale" };
  if (event.kind === "end") return { text: "The live session has ended", tone: "info" };
  return null;
}

function LiveRoom({ id, user }: { id: string; user: PublicUser }) {
  const { language } = useSession();
  const toast = useToast();
  const [session, setSession] = useState<LiveView | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "ended" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [viewers, setViewers] = useState(0);
  const [featured, setFeatured] = useState<LiveProduct | null>(null);
  const [sold, setSold] = useState(0);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [hearts, setHearts] = useState<Heart[]>([]);
  const [heartTotal, setHeartTotal] = useState(0);
  const [joined, setJoined] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const heartId = useRef(0);
  const seen = useRef(new Set<string>());
  const host = session?.seller.id === user.id;

  const addFeed = useCallback((item: FeedItem) => {
    if (seen.current.has(item.id)) return;
    seen.current.add(item.id);
    setFeed((current) => [...current, item].slice(-120));
  }, []);

  const floatHearts = useCallback((count: number) => {
    setHeartTotal((value) => value + count);
    const burst: Heart[] = Array.from({ length: Math.min(count, 6) }, () => ({
      id: ++heartId.current,
      x: 10 + Math.random() * 70,
      hue: Math.floor(Math.random() * 40),
    }));
    setHearts((current) => [...current, ...burst].slice(-30));
    window.setTimeout(() => {
      setHearts((current) => current.filter((heart) => !burst.includes(heart)));
    }, 2600);
  }, []);

  const handle = useCallback(
    (signal: LiveSignal, sellerName: string, live: boolean) => {
      if (signal.type === "chat") addFeed({ kind: "chat", id: signal.line.id, line: signal.line });
      else if (signal.type === "heart" && live) floatHearts(signal.count);
      else if (signal.type === "viewers") setViewers(signal.count);
      else if (signal.type === "joined" && live) {
        setJoined(signal.name);
        window.setTimeout(() => setJoined((current) => (current === signal.name ? null : current)), 3000);
      } else if (signal.type === "state") {
        if (signal.featured !== undefined) setFeatured(signal.featured);
        if (signal.sold !== undefined) setSold(signal.sold);
      } else if (signal.type === "destroyed") setStatus("ended");
      else if (signal.type === "event") {
        const event = signal.event;
        if (event.kind === "feature") setFeatured(event.product);
        if (event.kind === "sale") {
          setSold(event.sold);
          setFeatured(event.product);
          if (live) {
            setCelebrate(`${event.buyer} just bought it!`);
            window.setTimeout(() => setCelebrate(null), 3200);
          }
        }
        if (event.kind === "end" && live) setStatus("ended");
        const line = eventText(signal, sellerName);
        if (line) addFeed({ kind: "event", id: signal.id, ...line });
      }
    },
    [addFeed, floatHearts],
  );

  useEffect(() => {
    let alive = true;
    let channelId = "";
    let unsubscribe: (() => void) | null = null;
    (async () => {
      try {
        const { session: loaded } = await getLive(id);
        if (!alive) return;
        setSession(loaded);
        setFeatured(loaded.featured);
        setSold(loaded.sold);
        channelId = loaded.channelId;
        unsubscribe = subscribeLive(channelId, (signal) => handle(signal, loaded.seller.name, true));
        const room = await enterLive(channelId, { name: user.name });
        if (!alive) return;
        setViewers(room.viewers);
        for (const signal of room.history) handle(signal, loaded.seller.name, false);
        if (room.featured !== undefined) setFeatured(room.featured);
        if (room.sold !== undefined) setSold(room.sold);
        setStatus("live");
      } catch (caught) {
        if (!alive) return;
        const message = caught instanceof Error ? caught.message : "Could not open this live session.";
        if (/ended/i.test(message)) setStatus("ended");
        else {
          setError(message);
          setStatus("error");
        }
      }
    })();
    return () => {
      alive = false;
      unsubscribe?.();
      if (channelId) void exitLive(channelId);
    };
  }, [id, user.name, handle]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Participant events can be off for an App Key, so confirm the count with the server
  // (Nexconn open-channel info) now and then. A 404 means the host ended the session.
  useEffect(() => {
    if (status !== "live") return;
    const timer = window.setInterval(() => {
      getLive(id)
        .then((result) => {
          if (result.session.viewers !== null) setViewers(result.session.viewers);
        })
        .catch((caught: unknown) => {
          if (caught instanceof ApiError && caught.status === 404) setStatus("ended");
        });
    }, 8000);
    return () => window.clearInterval(timer);
  }, [id, status]);

  // Translate other people's messages into this viewer's language (Nexconn translation).
  const peerLines = useMemo(
    () =>
      feed
        .filter((item): item is Extract<FeedItem, { kind: "chat" }> => item.kind === "chat" && item.line.senderId !== user.id)
        .map<ChatLine>((item) => ({
          id: item.line.id,
          channelId: session?.channelId ?? "",
          senderId: item.line.senderId,
          text: item.line.text,
          sentTime: item.line.sentTime,
          kind: "text",
          system: false,
        })),
    [feed, session?.channelId, user.id],
  );
  useEffect(() => {
    if (status === "live" && peerLines.length) void requestTranslations(peerLines.slice(-20), language);
  }, [peerLines, language, status]);

  if (status === "loading") return <LoadingState label="Joining the live room" />;
  if (status === "error") return <ErrorState message={error ?? "Could not open this live session."} onRetry={() => window.location.reload()} />;
  if (status === "ended" || !session) {
    return (
      <EmptyState
        title="This live session has ended."
        detail={sold > 0 ? `${sold} sold during the session.` : "Thanks for watching. Catch the next one from the Live tab."}
        scene="shop"
        actionLabel="Back to Live"
        onAction={() => navigate("live")}
      />
    );
  }

  return (
    <div className="live-room">
      <section className="live-stage" aria-label="Live stage">
        <div className="live-stage-photo">
          {featured ? <ProductPhoto key={featured.id} src={featured.image} alt={featured.name} loading="eager" /> : <div className="live-stage-blank" />}
          <div className="live-stage-top">
            <span className="live-pill">● Live</span>
            <span className="live-chip" aria-label={`${viewers} watching`}>
              👁 {viewers}
            </span>
            <span className="live-chip">{elapsed(session.startedAt, now)}</span>
            {sold > 0 ? <span className="live-chip">🛍 {sold} sold</span> : null}
          </div>
          <div className="live-hearts" aria-hidden="true">
            {hearts.map((heart) => (
              <span key={heart.id} className="live-heart" style={{ left: `${heart.x}%`, filter: `hue-rotate(${heart.hue}deg)` }}>
                ♥
              </span>
            ))}
          </div>
          {celebrate ? (
            <div className="live-celebrate" role="status">
              {celebrate}
            </div>
          ) : null}
          {joined ? <div className="live-joined">{joined} joined</div> : null}
        </div>
        <div className="live-stage-info">
          <div className="live-host">
            <Avatar name={session.seller.name} />
            <div>
              <strong>{session.title}</strong>
              <span>
                Hosted by {session.seller.name} · {heartTotal} ♥
              </span>
            </div>
          </div>
          {featured ? (
            <div className="live-product">
              <div>
                <p className="live-product-name">{featured.name}</p>
                <p className="live-product-meta">
                  {formatInr(featured.price)}
                  {featured.stock <= 3 ? <span className="live-scarce"> · only {featured.stock} left</span> : null}
                </p>
              </div>
              {host ? null : <BuyButton sessionId={session.id} product={featured} onBought={setSession} toast={toast} />}
            </div>
          ) : (
            <p className="lede">The host will put a piece on stage shortly.</p>
          )}
          {host ? <HostControls session={session} featured={featured} toast={toast} /> : null}
        </div>
      </section>

      <LiveChatPanel
        channelId={session.channelId}
        user={user}
        language={language}
        hostId={session.seller.id}
        feed={feed}
        onSent={(line) => addFeed({ kind: "chat", id: line.id, line })}
        onHeart={() => {
          sendHeart(session.channelId);
          floatHearts(1);
        }}
      />
    </div>
  );
}

function BuyButton({
  sessionId,
  product,
  onBought,
  toast,
}: {
  sessionId: string;
  product: LiveProduct;
  onBought: (session: LiveView) => void;
  toast: (message: string, tone?: "success" | "error") => void;
}) {
  const [pending, setPending] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);

  async function buy() {
    setPending(true);
    try {
      const result = await buyLive(sessionId, product.id);
      onBought(result.session);
      setOrderId(result.order.id);
      toast("Order placed. Your conversation with the maker is open in Inbox.", "success");
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "Could not place the order.", "error");
    } finally {
      setPending(false);
    }
  }

  if (orderId) {
    return (
      <Button variant="secondary" onClick={() => navigate("inbox", orderId)}>
        Message the maker →
      </Button>
    );
  }
  return (
    <Button onClick={() => void buy()} pending={pending} disabled={product.stock < 1} magnetic>
      {product.stock < 1 ? "Sold out" : `Buy now · ${formatInr(product.price)}`}
    </Button>
  );
}

function HostControls({
  session,
  featured,
  toast,
}: {
  session: LiveView;
  featured: LiveProduct | null;
  toast: (message: string, tone?: "success" | "error") => void;
}) {
  const [products, setProducts] = useState<ProductView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    listSellerProducts()
      .then((result) => setProducts(result.products.filter((product) => product.published)))
      .catch(() => setProducts([]));
  }, []);

  async function feature(productId: string) {
    setBusy(productId);
    try {
      await featureLive(session.id, productId);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "Could not change the product.", "error");
    } finally {
      setBusy(null);
    }
  }

  async function end() {
    if (!window.confirm("End this live session for everyone?")) return;
    setBusy("end");
    try {
      await endLive(session.id);
      navigate("live");
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "Could not end the session.", "error");
      setBusy(null);
    }
  }

  return (
    <div className="live-host-controls">
      <p className="live-section-title">Put on stage</p>
      <div className="live-switch">
        {products.map((product) => (
          <button
            key={product.id}
            type="button"
            className={`live-switch-item${featured?.id === product.id ? " is-on" : ""}`}
            aria-pressed={featured?.id === product.id}
            disabled={busy !== null || product.stock < 1}
            onClick={() => void feature(product.id)}
          >
            <ProductPhoto src={product.images[0]} alt="" />
            <span>{product.name}</span>
          </button>
        ))}
      </div>
      <Button variant="danger" onClick={() => void end()} pending={busy === "end"}>
        End live
      </Button>
    </div>
  );
}

function LiveChatPanel({
  channelId,
  user,
  language,
  hostId,
  feed,
  onSent,
  onHeart,
}: {
  channelId: string;
  user: PublicUser;
  language: Language;
  hostId: string;
  feed: FeedItem[];
  onSent: (line: LiveChat) => void;
  onHeart: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const node = listRef.current;
    if (node && stick.current) node.scrollTop = node.scrollHeight;
  }, [feed.length]);

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || sending) return;
    setSending(true);
    setError(null);
    try {
      const line = await sendLiveText(channelId, clean.slice(0, 500), user);
      onSent(line);
      setDraft("");
      stick.current = true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Message not sent.");
    } finally {
      setSending(false);
    }
  }

  const quick = user.role === "member" ? QUICK[language] ?? QUICK.en ?? [] : [];

  return (
    <section className="live-chat" aria-label="Live chat">
      <header className="live-chat-head">
        <strong>Live chat</strong>
        <span>Reading in {languageLabel(language)} · translated by Nexconn</span>
      </header>
      <ol
        className="live-feed"
        ref={listRef}
        role="log"
        aria-live="polite"
        onScroll={(event) => {
          const node = event.currentTarget;
          stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
        }}
      >
        {feed.length === 0 ? <li className="live-feed-empty">Say hello. The maker reads every message in their language.</li> : null}
        {feed.map((item) =>
          item.kind === "event" ? (
            <li key={item.id} className={`live-event is-${item.tone}`}>
              {item.text}
            </li>
          ) : (
            <LiveChatRow key={item.id} line={item.line} mine={item.line.senderId === user.id} host={item.line.senderId === hostId} language={language} />
          ),
        )}
      </ol>
      {quick.length ? (
        <div className="live-quick">
          {quick.map((text) => (
            <button key={text} type="button" onClick={() => void send(text)} disabled={sending}>
              {text}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="live-error" role="alert">{error}</p> : null}
      <form
        className="live-compose"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <input
          value={draft}
          maxLength={500}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask the maker…"
          aria-label="Message the live room"
        />
        <button type="button" className="live-heart-btn" onClick={onHeart} aria-label="Send a heart">
          ♥
        </button>
        <Button type="submit" pending={sending} disabled={!draft.trim()}>
          Send
        </Button>
      </form>
    </section>
  );
}

function LiveChatRow({ line, mine, host, language }: { line: LiveChat; mine: boolean; host: boolean; language: Language }) {
  const [state, setState] = useState<TranslationState>(() => getCachedTranslation(line.id, language));
  const [showOriginal, setShowOriginal] = useState(false);
  useEffect(() => (mine ? undefined : subscribeTranslation(line.id, language, setState)), [line.id, language, mine]);

  const translated = state.status === "ready" && !isSameAsOriginal(line.text, state.text) ? state.text : null;
  return (
    <li className={`live-msg${mine ? " is-mine" : ""}${host ? " is-host" : ""}`}>
      <span className="live-msg-name">
        {mine ? "You" : line.name}
        {host ? <em>Host</em> : null}
      </span>
      {translated && !showOriginal ? (
        <span className="live-msg-text" lang={language}>
          {translated}
        </span>
      ) : (
        <span className="live-msg-text" dir="auto">
          {line.text}
        </span>
      )}
      {translated ? (
        <button type="button" className="live-msg-toggle" onClick={() => setShowOriginal((value) => !value)}>
          {showOriginal ? `Show ${languageLabel(language)}` : "Original"}
        </button>
      ) : null}
    </li>
  );
}
