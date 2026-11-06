import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, withClient } from "./pool";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export async function applyMigrations(): Promise<{ applied: string[]; skipped: string[] }> {
  const pool = getPool();
  await withClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  });

  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const id = file;
    const existing = await pool.query("SELECT 1 FROM schema_migrations WHERE id = $1", [id]);
    if (existing.rowCount && existing.rowCount > 0) {
      skipped.push(id);
      continue;
    }
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
    applied.push(id);
  }

  return { applied, skipped };
}
