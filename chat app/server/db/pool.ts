import dns from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import pg from "pg";
import { loadEnvFile } from "../env";
import { HttpError } from "../errors";

const { Pool } = pg;

// Prefer IPv4 first — intermittent EAI_AGAIN against Neon pooler is common when IPv6 is tried first.
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // Older Node builds may not support this; ignore.
}

let pool: pg.Pool | null = null;

function isTransientNetworkError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
  return code === "EAI_AGAIN" || code === "ENOTFOUND" || code === "ETIMEDOUT" || code === "ECONNRESET";
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Force IPv4 resolution for Neon hosts to reduce transient getaddrinfo failures. */
function neonIpv4Lookup(
  hostname: string,
  _options: unknown,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
): void {
  dnsLookup(hostname, { family: 4 })
    .then((result) => {
      const address = typeof result === "string" ? result : result.address;
      callback(null, address, 4);
    })
    .catch(() => {
      // Fall back to default lookup if IPv4-only fails.
      dns.lookup(hostname, { family: 0 }, callback);
    });
}

export function databaseUrlConfigured(): boolean {
  loadEnvFile();
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getPool(): pg.Pool {
  loadEnvFile();
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new HttpError(503, "DATABASE_REQUIRED", "DATABASE_URL is not configured.");
  }
  if (!pool) {
    const isNeon = /neon\.tech/i.test(connectionString) || process.env.PGSSLMODE === "require";
    pool = new Pool({
      connectionString,
      // Neon free / serverless: keep the pool small.
      max: Number(process.env.PG_POOL_MAX || 5),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 20_000,
      ssl: isNeon || process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
      ...(isNeon ? { lookup: neonIpv4Lookup } : {}),
    } as pg.PoolConfig);
    pool.on("error", (error) => {
      console.error("Unexpected PostgreSQL pool error:", error.message);
    });
  }
  return pool;
}

async function connectWithRetry(): Promise<pg.PoolClient> {
  const attempts = 5;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await getPool().connect();
    } catch (error) {
      last = error;
      if (!isTransientNetworkError(error) || i === attempts - 1) throw error;
      // Reset pool so the next attempt gets a fresh connection path.
      try {
        await closePool();
      } catch {
        /* ignore */
      }
      await sleep(300 * (i + 1));
    }
  }
  throw last;
}

export async function withClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await connectWithRetry();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failures
      }
      throw error;
    }
  });
}

export async function checkDatabaseReady(): Promise<{ ready: boolean; error?: string }> {
  if (!databaseUrlConfigured()) {
    return { ready: false, error: "DATABASE_URL is not set" };
  }
  try {
    await withClient(async (client) => {
      await client.query("SELECT 1");
    });
    return { ready: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database unreachable";
    return { ready: false, error: message };
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export function mapDbError(error: unknown): never {
  if (error instanceof HttpError) throw error;
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
  if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "57P01"
  ) {
    throw new HttpError(503, "DATABASE_UNAVAILABLE", "The database is temporarily unavailable. Try again.");
  }
  console.error("Database error:", error instanceof Error ? error.message : error);
  throw new HttpError(503, "DATABASE_UNAVAILABLE", "The database is temporarily unavailable. Try again.");
}
