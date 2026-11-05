import bcrypt from "bcrypt";
import type { IncomingMessage } from "node:http";
import type { Role } from "../shared/types";
import { HttpError } from "./errors";

export const SESSION_MS = 60 * 60 * 24 * 7 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 20;
const HASH_ROUNDS = 10;

export const DEMO_PARTIES = ["buyer", "seller", "support"] as const;
export type DemoParty = (typeof DEMO_PARTIES)[number];

export const DEMO_ACCOUNTS: Record<DemoParty, { email: string; name: string; role: Role }> = {
  buyer: { email: "buyer@shopbridge.demo", name: "Asha Rao", role: "member" },
  seller: { email: "seller@shopbridge.demo", name: "Meera Joshi", role: "volunteer" },
  support: { email: "support@shopbridge.demo", name: "Kabir Shah", role: "coordinator" },
};

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

export function clientKey(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

export function assertAuthRate(req: IncomingMessage): void {
  const key = clientKey(req);
  const now = Date.now();
  const slot = attempts.get(key);
  if (!slot || slot.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  slot.count += 1;
  if (slot.count > LOGIN_MAX_ATTEMPTS) {
    throw new HttpError(429, "RATE_LIMITED", "Too many attempts. Wait a few minutes and try again.");
  }
}

export function reseedAllowed(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.SHOPBRIDGE_ALLOW_RESEED === "1";
}
