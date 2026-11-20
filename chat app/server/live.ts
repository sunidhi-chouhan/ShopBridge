/**
 * Live sale rooms ("Live from the loom").
 *
 * A seller goes live with a product on the stage. The room is a Nexconn **open channel**:
 * anyone signed in can enter, chat (translated per viewer) and send hearts, with no
 * persistent membership. Room state is mirrored into open channel metadata and announced
 * with server-sent SB:Live messages, so only the server can feature a product or post a sale.
 *
 * Sessions live in memory: they are short-lived, and Nexconn destroys an idle room on its
 * own. After a restart, sellers simply go live again.
 */
import { randomBytes } from "node:crypto";
import { MESSAGE_TYPES, type LiveEvent, type LiveProduct, type LiveView, type ProductView, type PublicUser } from "../shared/types";
import { HttpError } from "./errors";
import {
  createOpenChannel,
  destroyOpenChannel,
  nexconnConfigured,
  openChannelViewers,
  sendOpenChannelCustom,
  setOpenChannelMetadata,
} from "./nexconn";
import type { UserRecord } from "./store-types";

type LiveRecord = {
  id: string;
  channelId: string;
  title: string;
  seller: PublicUser;
  startedAt: string;
  featured: LiveProduct | null;
  sold: number;
  viewers: number | null;
  viewersAt: number;
};

const sessions = new Map<string, LiveRecord>();
const VIEWER_CACHE_MS = 5000;
const MAX_LIVE = 20;

export function liveProduct(product: ProductView): LiveProduct {
  return { id: product.id, name: product.name, price: product.price, image: product.images[0] ?? "", stock: product.stock };
}

function view(record: LiveRecord): LiveView {
  return {
    id: record.id,
    channelId: record.channelId,
    title: record.title,
    seller: record.seller,
    startedAt: record.startedAt,
    featured: record.featured,
    sold: record.sold,
    viewers: record.viewers,
  };
}

function publicSeller(user: UserRecord): PublicUser {
  return { id: user.id, name: user.name, role: user.role, sample: user.sample };
}

/** Best effort: a metadata or announcement hiccup never fails the seller's action. */
async function broadcast(record: LiveRecord, event: LiveEvent): Promise<void> {
  const state: Record<string, string> = { sold: String(record.sold), title: record.title };
  if (record.featured) state.featured = JSON.stringify(record.featured);
  await Promise.allSettled([
    setOpenChannelMetadata(record.channelId, state),
    sendOpenChannelCustom(record.channelId, MESSAGE_TYPES.live, event as unknown as Record<string, unknown>),
  ]).then((results) => {
    for (const result of results) {
      if (result.status === "rejected") console.warn(`Live room ${record.channelId}: ${String(result.reason)}`);
    }
  });
}

function requireConfigured(): void {
  if (!nexconnConfigured()) {
    throw new HttpError(503, "NEXCONN_NOT_CONFIGURED", "Add the Nexconn App Key and App Secret to .env, then try again.");
  }
}

function ownSession(seller: UserRecord, id: string): LiveRecord {
  const record = sessions.get(id);
  if (!record) throw new HttpError(404, "NOT_FOUND", "This live session has ended.");
  if (record.seller.id !== seller.id) throw new HttpError(403, "FORBIDDEN", "Only the host can change this live session.");
  return record;
}

function requireSellerProduct(seller: UserRecord, product: ProductView): LiveProduct {
  if (product.seller.id !== seller.id) throw new HttpError(403, "FORBIDDEN", "You can only feature your own products.");
  if (!product.published) throw new HttpError(409, "UNPUBLISHED", "Publish this product before featuring it live.");
  return liveProduct(product);
}

/** Active sessions with fresh viewer counts. Rooms Nexconn has destroyed are dropped. */
export async function listLive(): Promise<LiveView[]> {
  const now = Date.now();
  const records = [...sessions.values()];
  await Promise.all(
    records.map(async (record) => {
      if (!nexconnConfigured() || now - record.viewersAt < VIEWER_CACHE_MS) return;
      try {
        const viewers = await openChannelViewers(record.channelId);
        if (viewers === null) {
          sessions.delete(record.id);
          return;
        }
        record.viewers = viewers;
        record.viewersAt = now;
      } catch {
        /* keep the last known count */
      }
    }),
  );
  return [...sessions.values()]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map(view);
}

/** One session, with its Nexconn participant count refreshed when stale. */
export async function getLive(id: string): Promise<LiveView> {
  const record = sessions.get(id);
  if (!record) throw new HttpError(404, "NOT_FOUND", "This live session has ended.");
  if (nexconnConfigured() && Date.now() - record.viewersAt >= VIEWER_CACHE_MS) {
    try {
      const viewers = await openChannelViewers(record.channelId);
      if (viewers === null) {
        sessions.delete(id);
        throw new HttpError(404, "NOT_FOUND", "This live session has ended.");
      }
      record.viewers = viewers;
      record.viewersAt = Date.now();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      /* keep the last known count */
    }
  }
  return view(record);
}

export async function startLive(seller: UserRecord, title: string, product: ProductView | null): Promise<LiveView> {
  if (seller.role !== "volunteer") throw new HttpError(403, "FORBIDDEN", "Only a seller can go live.");
  requireConfigured();
  const existing = [...sessions.values()].find((record) => record.seller.id === seller.id);
  if (existing) return view(existing);
  if (sessions.size >= MAX_LIVE) throw new HttpError(429, "LIVE_FULL", "Too many live sessions right now. Try again soon.");

  const featured = product ? requireSellerProduct(seller, product) : null;
  const id = randomBytes(8).toString("hex");
  const record: LiveRecord = {
    id,
    channelId: `live${id}`,
    title,
    seller: publicSeller(seller),
    startedAt: new Date().toISOString(),
    featured,
    sold: 0,
    viewers: 0,
    // Stale on purpose: the first listing asks Nexconn for the real count.
    viewersAt: 0,
  };
  await createOpenChannel(record.channelId);
  sessions.set(id, record);
  await broadcast(record, { kind: "start", title, product: featured });
  return view(record);
}

export async function featureLive(seller: UserRecord, id: string, product: ProductView): Promise<LiveView> {
  const record = ownSession(seller, id);
  record.featured = requireSellerProduct(seller, product);
  await broadcast(record, { kind: "feature", product: record.featured });
  return view(record);
}

export async function endLive(seller: UserRecord, id: string): Promise<void> {
  const record = ownSession(seller, id);
  sessions.delete(id);
  await sendOpenChannelCustom(record.channelId, MESSAGE_TYPES.live, { kind: "end", sold: record.sold }).catch(() => undefined);
  // Give viewers a moment to receive the "ended" event before the room is destroyed.
  setTimeout(() => void destroyOpenChannel(record.channelId).catch(() => undefined), 3000);
}

/** The product a buyer may buy now: only the one on stage. */
export function featuredFor(id: string, productId: string): LiveRecord {
  const record = sessions.get(id);
  if (!record) throw new HttpError(404, "NOT_FOUND", "This live session has ended.");
  if (record.featured?.id !== productId) {
    throw new HttpError(409, "NOT_FEATURED", "The host has moved on to another product.");
  }
  return record;
}

export async function recordLiveSale(id: string, buyerName: string, product: ProductView): Promise<LiveView> {
  const record = sessions.get(id);
  if (!record) throw new HttpError(404, "NOT_FOUND", "This live session has ended.");
  record.sold += 1;
  record.featured = liveProduct(product);
  const buyer = buyerName.trim().split(/\s+/)[0] || "A buyer";
  await broadcast(record, { kind: "sale", buyer, product: record.featured, sold: record.sold });
  return view(record);
}

/** Test hook. */
export function resetLiveForTests(): void {
  sessions.clear();
}
