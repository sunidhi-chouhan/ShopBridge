#!/usr/bin/env node
/**
 * Read-only DATABASE_URL / Postgres connectivity probe.
 * Does not migrate, import, or modify data/store.json.
 * Never prints DATABASE_URL or passwords.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

function loadEnvFile() {
  try {
    const text = readFileSync(resolve(".env"), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // missing .env
  }
}

function redact(message, connectionString) {
  let out = String(message);
  if (connectionString) out = out.split(connectionString).join("[DATABASE_URL]");
  out = out.replace(/:[^:@/]+@/g, ":***@");
  return out;
}

async function main() {
  const storePath = resolve("data/store.json");
  const storeHashBefore = createHash("sha256").update(readFileSync(storePath)).digest("hex");

  loadEnvFile();
  const url = process.env.DATABASE_URL;
  const envReport = {
    databaseUrlPresent: Boolean(url && url.trim()),
    databaseUrlLength: url?.trim().length ?? 0,
    startsWithPostgres: Boolean(url?.trim().match(/^postgres(ql)?:\/\//i)),
    sslModeQueryParam: null,
    hostname: null,
    port: null,
    databaseName: null,
    neonHost: false,
  };

  if (url?.trim()) {
    try {
      const parsed = new URL(url.trim());
      envReport.hostname = parsed.hostname;
      envReport.port = parsed.port || "5432";
      envReport.databaseName = parsed.pathname.replace(/^\//, "") || null;
      envReport.sslModeQueryParam = parsed.searchParams.get("sslmode");
      envReport.neonHost = /\.neon\.tech$/i.test(parsed.hostname);
    } catch {
      envReport.parseError = "DATABASE_URL is set but could not be parsed as a URL";
    }
  }

  console.log(JSON.stringify({ step: "env_load", ...envReport }, null, 2));

  if (!envReport.databaseUrlPresent) {
    console.log(JSON.stringify({ step: "connect", ok: false, error: "DATABASE_URL missing after .env load" }));
    process.exit(1);
  }

  const connectionString = url.trim();
  const isNeon = /neon\.tech/i.test(connectionString);
  // Mirror server/db/pool.ts Neon rule
  const ssl =
    isNeon || process.env.NODE_ENV === "production" || envReport.sslModeQueryParam === "require"
      ? { rejectUnauthorized: false }
      : undefined;

  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 20000,
    ssl,
  });

  try {
    const client = await pool.connect();
    try {
      const ping = await client.query(
        "SELECT 1 AS ok, current_database() AS db, current_user AS db_user, version() AS version",
      );
      let sslStatus = null;
      try {
        const sslRes = await client.query(
          "SELECT ssl, version AS ssl_version FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid()",
        );
        sslStatus = sslRes.rows[0] ?? { ssl: null, note: "no pg_stat_ssl row" };
      } catch (e) {
        sslStatus = { error: e instanceof Error ? e.message : "ssl probe failed" };
      }

      const tables = await client.query(`
        SELECT COUNT(*)::int AS n
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `);

      console.log(
        JSON.stringify(
          {
            step: "connect",
            ok: true,
            sslOptionUsedByClient: Boolean(ssl),
            matchesAppPoolNeonRule: isNeon,
            server: {
              ping: ping.rows[0].ok,
              database: ping.rows[0].db,
              user: ping.rows[0].db_user,
              version: String(ping.rows[0].version).split("\n")[0],
            },
            ssl: sslStatus,
            publicTableCount: tables.rows[0].n,
            note: "No migrations, imports, or writes performed.",
          },
          null,
          2,
        ),
      );
    } finally {
      client.release();
    }
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          step: "connect",
          ok: false,
          code: error && typeof error === "object" && "code" in error ? error.code : null,
          message: redact(error instanceof Error ? error.message : String(error), connectionString),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }

  const storeHashAfter = createHash("sha256").update(readFileSync(storePath)).digest("hex");
  console.log(
    JSON.stringify(
      {
        step: "json_store",
        unchanged: storeHashBefore === storeHashAfter,
        sha256: storeHashAfter,
      },
      null,
      2,
    ),
  );
}

main();
