import { loadEnvFile } from "../env";
import { applyMigrations } from "./migrate";
import { closePool } from "./pool";

loadEnvFile();

const result = await applyMigrations();
console.log(JSON.stringify({ ok: true, ...result }, null, 2));
await closePool();
