import bcrypt from "bcrypt";
import type { IncomingMessage } from "node:http";
import { HttpError } from "./errors";

export const SESSION_MS = 60 * 60 * 24 * 7 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const HASH_ROUNDS = 10;

/**
 * Separate budgets so judges switching demo roles behind one office network never lock
 * out password sign-in, and vice versa. Password and registration attempts stay strict.
 */
export const RATE_LIMITS = {
  credentials: 20,
  demo: 200,
  reset: 6,
  assist: 30,
} as const;
export type RateBucket = keyof typeof RATE_LIMITS;

export { DEMO_ACCOUNTS, DEMO_PARTIES, type DemoParty } from "./demo-seed";
import { DEMO_PARTIES, type DemoParty } from "./demo-seed";

const attempts = new Map<string, { count: number; resetAt: number }>();

export function demoPassword(): string {
  const value = process.env.SHOPBRIDGE_DEMO_PASSWORD?.trim();
  if (!value) {
    throw new Error("SHOPBRIDGE_DEMO_PASSWORD is not set. Add it to local .env before seeding or password sign-in.");
  }
  return value;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, HASH_ROUNDS);
}

export async function verifyPassword(plain: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plain, passwordHash);
}

export function parseDemoParty(value: unknown): DemoParty {
  if (typeof value !== "string" || !DEMO_PARTIES.includes(value as DemoParty)) {
    throw new HttpError(422, "VALIDATION_ERROR", "Choose a demo buyer, seller, or support agent.");
  }
  return value as DemoParty;
}

/**
 * Client address for rate limiting: the left-most X-Forwarded-For entry (the original
 * client as reported through Render's proxy). A client can forge it to dodge the limit,
 * but using a proxy-side hop instead risks putting every visitor in one shared bucket,
 * which would lock judges out — availability wins for this deployment.
 */
export function clientKey(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const header = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof header === "string" && header.trim()) return header.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

export function assertAuthRate(req: IncomingMessage, bucket: RateBucket = "credentials", now = Date.now()): void {
  const key = `${bucket}:${clientKey(req)}`;
  const slot = attempts.get(key);
  if (!slot || slot.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    pruneAttempts(now);
    return;
  }
  slot.count += 1;
  if (slot.count > RATE_LIMITS[bucket]) {
    throw new HttpError(429, "RATE_LIMITED", "Too many attempts. Wait a few minutes and try again.");
  }
}

/** Keep the in-memory map bounded on a long-running instance. */
function pruneAttempts(now: number): void {
  if (attempts.size < 5000) return;
  for (const [key, slot] of attempts) {
    if (slot.resetAt <= now) attempts.delete(key);
  }
}

/** Test helper. */
export function resetAuthRate(): void {
  attempts.clear();
}

export function reseedAllowed(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.SHOPBRIDGE_ALLOW_RESEED === "1";
}
