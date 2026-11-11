/**
 * Shared demo reset.
 *
 * Order of operations (so a failure never leaves the database half-reset):
 *  1. Build the canonical plan (server/demo-seed.ts) with fresh order ids.
 *  2. If Nexconn is configured, create brand-new order channels and replay the scripted
 *     conversations. A failure here aborts before any database change.
 *  3. Apply the plan to the database in ONE transaction (PostgreSQL) or one atomic file
 *     write (local JSON). Scope is limited to demo accounts and their records.
 *  4. Bump the demo epoch; every API response carries it so open browsers refresh.
 */
import { DEMO_ACCOUNTS, DEMO_PARTIES, attachChannels, buildDemoPlan, type DemoUserIds } from "./demo-seed";
import { hashPassword } from "./auth";
import { HttpError } from "./errors";
import { MESSAGE_TYPES } from "../shared/types";
import { issueAccessToken, nexconnConfigured, orderChannelId, probeNexconn, provisionScriptedChannel } from "./nexconn";
import { cardContent } from "./cards";
import * as store from "./store";
import type { UserRecord } from "./store";

const COOLDOWN_MS = 30_000;
const EPOCH_REFRESH_MS = 15_000;

let running = false;
let lastResetAt = 0;
let cachedEpoch: string | null = null;
let epochTimer: NodeJS.Timeout | null = null;

/** The reset only exists on a deployment explicitly designated as the shared demo. */
export function demoResetEnabled(): boolean {
  return process.env.SHOPBRIDGE_DEMO_RESET === "1";
}

export function currentDemoEpoch(): string | null {
  return cachedEpoch;
}

async function refreshEpoch(): Promise<void> {
  try {
    cachedEpoch = await store.getDemoEpoch();
  } catch {
    // demo_state may not exist until migration 002 runs; keep the last known value.
  }
}

/** Keep the epoch header fresh (covers resets done by another instance or the seed script). */
export function startDemoEpochWatch(): void {
  if (epochTimer) return;
  void refreshEpoch();
  epochTimer = setInterval(() => void refreshEpoch(), EPOCH_REFRESH_MS);
  epochTimer.unref();
}

async function provisionNexconn(plan: ReturnType<typeof buildDemoPlan>, users: DemoUserIds): Promise<void> {
  // Fail fast with a clear signature/reachability error before creating channels.
  await probeNexconn();
  for (const party of DEMO_PARTIES) await issueAccessToken(users[party], DEMO_ACCOUNTS[party].name);
  for (const entry of plan.orders) {
    const channelId = entry.order.channelId;
    if (!channelId) throw new Error(`Demo order ${entry.order.id} is missing a channel id.`);
    const members = [users.buyer, users.seller, ...(entry.supportInChannel ? [users.support] : [])];
    await provisionScriptedChannel({
      channelId,
      name: `Order ${entry.order.items[0]?.name ?? entry.order.id}`,
      ownerId: users.buyer,
      memberIds: members,
      lines: entry.script.map((line) => ({
        fromUserId: line.from === "system" ? null : users[line.from],
        text: line.text,
        custom: line.card
          ? { type: line.card === "offer" ? MESSAGE_TYPES.offer : MESSAGE_TYPES.track, content: cardContent(line.card, entry.order) }
          : undefined,
      })),
    });
  }
}

/** Unguarded core used by the guarded HTTP path and by `npm run seed`. */
export async function performDemoReset(meta: store.DemoResetMeta): Promise<{ epoch: string; orders: number; nexconn: boolean }> {
  if (running) throw new HttpError(409, "RESET_IN_PROGRESS", "A demo reset is already running.");
  running = true;
  try {
    const users = await store.demoUserIds();
    // Channel ids always follow the app convention, so support flows work even without Nexconn keys.
    const plan = attachChannels(buildDemoPlan(users), orderChannelId);
    const password = process.env.SHOPBRIDGE_DEMO_PASSWORD?.trim();
    const passwordHash = password ? await hashPassword(password) : null;
    const nexconn = nexconnConfigured();
    if (nexconn) {
      try {
        await provisionNexconn(plan, users);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(`[demo-reset] nexconn provision failed: ${detail}`);
        throw new HttpError(
          502,
          "NEXCONN_ERROR",
          `Could not prepare the demo conversations in Nexconn. Nothing was changed. ${detail}`,
        );
      }
    }
    const result = await store.applyDemoReset(plan, users, passwordHash, meta);
    cachedEpoch = result.epoch;
    lastResetAt = Date.now();
    console.log(
      `[demo-reset] success actor=${meta.actorId ?? "-"} role=${meta.actorRole ?? "-"} orders=${plan.orders.length} nexconn=${nexconn}`,
    );
    return { epoch: result.epoch, orders: plan.orders.length, nexconn };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[demo-reset] failed actor=${meta.actorId ?? "-"}: ${detail}`);
    await store.recordDemoResetFailure(meta, detail);
    throw error;
  } finally {
    running = false;
  }
}

/** Authorization for the shared reset. Hiding the button is not relied on. */
export function assertCanResetDemo(user: UserRecord): void {
  if (!demoResetEnabled()) throw new HttpError(404, "NOT_FOUND", "That page does not exist.");
  if (!user.sample) {
    throw new HttpError(403, "FORBIDDEN", "Only the shared demo accounts can reset the demo.");
  }
}

export async function resetDemoForUser(user: UserRecord, client: string): Promise<{ epoch: string; orders: number; nexconn: boolean }> {
  assertCanResetDemo(user);
  const since = Date.now() - lastResetAt;
  if (since < COOLDOWN_MS) {
    throw new HttpError(
      429,
      "RESET_COOLDOWN",
      `The demo was reset ${Math.max(1, Math.round(since / 1000))} seconds ago. Wait a moment before resetting again.`,
    );
  }
  return performDemoReset({ actorId: user.id, actorRole: user.role, client });
}

/** Test helper. */
export function resetDemoCooldown(): void {
  lastResetAt = 0;
}
