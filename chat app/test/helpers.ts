/**
 * Test environment guards. Import this module FIRST in every test file (before any
 * server module) so the real .env — which may hold a production DATABASE_URL — is never read.
 */
import pg from "pg";

process.env.SHOPBRIDGE_SKIP_DOTENV = "1";
process.env.NODE_ENV = "test";
process.env.SHOPBRIDGE_DEMO_PASSWORD = "test-demo-password";
delete process.env.NEXCONN_APP_KEY;
delete process.env.NEXCONN_APP_SECRET;

export const DEFAULT_TEST_DATABASE_URL = "postgresql://postgres:test@127.0.0.1:55432/shopbridge_test";

/**
 * Returns a Postgres URL only if it is safe to wipe: a local host AND a database whose
 * name ends in `_test`. Anything else throws, so a Neon URL can never be used by tests.
 */
export function safeTestDatabaseUrl(): string {
  const raw = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
  const url = new URL(raw);
  const host = url.hostname;
  const database = url.pathname.replace(/^\//, "");
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`Refusing to run tests against non-local database host "${host}".`);
  }
  if (!database.endsWith("_test")) {
    throw new Error(`Refusing to run tests against database "${database}" (name must end with _test).`);
  }
  return raw;
}

/** Reachability probe so Postgres suites can skip cleanly when the container is not running. */
export async function postgresAvailable(url: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Drop and recreate the public schema of the (verified local) test database. */
export async function resetTestSchema(url: string): Promise<void> {
  safeTestDatabaseUrl();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }
}

export async function sql<T extends pg.QueryResultRow = any>(url: string, text: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await client.query<T>(text, params);
  } finally {
    await client.end();
  }
}

export const PG_SKIP_REASON =
  "Postgres test container not reachable. Start it with: npm run test:pg:up";
