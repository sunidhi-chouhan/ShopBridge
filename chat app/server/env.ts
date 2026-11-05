import { readFileSync } from "node:fs";
import path from "node:path";

let loaded = false;

/** Load CWD `.env` into `process.env` without overriding existing values (Render wins). */
export function loadEnvFile(): void {
  if (loaded) return;
  loaded = true;
  try {
    const text = readFileSync(path.resolve(".env"), "utf8");
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
    // Missing .env is fine when the host injects variables.
  }
}
