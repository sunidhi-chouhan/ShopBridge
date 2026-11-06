#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

function loadEnvFile() {
  const text = readFileSync(resolve(".env"), "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

loadEnvFile();
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const expectedTables = [
  "schema_migrations",
  "users",
  "sessions",
  "products",
  "cart_items",
  "orders",
  "order_items",
  "requests",
];

const pool = new pg.Pool({
  connectionString,
  max: 1,
  ssl: /neon\.tech/i.test(connectionString) ? { rejectUnauthorized: false } : undefined,
});

const client = await pool.connect();
try {
  const ident = await client.query(`SELECT current_database() AS db, current_user AS db_user`);
  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE'
    ORDER BY table_name`);
  const names = tables.rows.map((r) => r.table_name);
  const missing = expectedTables.filter((t) => !names.includes(t));
  const extra = names.filter((t) => !expectedTables.includes(t));

  const pks = await client.query(`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema='public' AND tc.constraint_type='PRIMARY KEY'
    ORDER BY tc.table_name, kcu.ordinal_position`);

  const fks = await client.query(`
    SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.table_schema='public' AND tc.constraint_type='FOREIGN KEY'
    ORDER BY tc.table_name, kcu.column_name`);

  const uniques = await client.query(`
    SELECT tc.table_name, kcu.column_name, tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema='public' AND tc.constraint_type='UNIQUE'
    ORDER BY tc.table_name`);

  const indexes = await client.query(`
    SELECT tablename, indexname FROM pg_indexes
    WHERE schemaname='public'
    ORDER BY tablename, indexname`);

  const counts = {};
  for (const t of names) {
    // fixed identifiers from catalog only
    const r = await client.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    counts[t] = r.rows[0].n;
  }

  const mig = await client.query(`SELECT id, applied_at FROM schema_migrations ORDER BY id`);

  console.log(
    JSON.stringify(
      {
        identity: { database: ident.rows[0].db, user: ident.rows[0].db_user },
        tables: { present: names, missing, extra, allExpectedPresent: missing.length === 0 },
        rowCounts: counts,
        migrationsRecorded: mig.rows,
        primaryKeys: pks.rows,
        foreignKeys: fks.rows,
        uniqueConstraints: uniques.rows,
        indexes: indexes.rows.map((r) => `${r.tablename}.${r.indexname}`),
      },
      null,
      2,
    ),
  );
} finally {
  client.release();
  await pool.end();
}
