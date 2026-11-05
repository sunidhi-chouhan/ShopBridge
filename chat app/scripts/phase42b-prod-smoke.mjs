#!/usr/bin/env node
/**
 * Phase 4.2B — non-destructive production smoke.
 * Never touches the live data/store.json (works on a copy under a temp dir).
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const liveStore = join(root, "data/store.json");

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function wait(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  return { res, body };
}

function cookieFrom(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  if (raw.length) return raw.map((c) => c.split(";")[0]).join("; ");
  const single = res.headers.get("set-cookie");
  return single ? single.split(";")[0] : "";
}

async function withServer(env, fn) {
  const child = spawn("npm", ["start"], {
    cwd: env.cwd,
    env: { ...process.env, ...env.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  child.stdout.on("data", (d) => {
    output += d.toString();
  });
  child.stderr.on("data", (d) => {
    output += d.toString();
  });
  const port = Number(env.env.PORT);
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await wait(250);
    try {
      const { res } = await fetchJson(`${base}/api/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // still starting
    }
    if (child.exitCode !== null) break;
  }
  try {
    if (!ready) {
      throw new Error(`Server failed to become ready.\n${output.slice(-2000)}`);
    }
    return await fn(base, output);
  } finally {
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    await wait(500);
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch {
      /* already exited */
    }
  }
}

async function main() {
  if (!existsSync(liveStore)) {
    throw new Error("Live data/store.json missing — aborting without creating one.");
  }
  const beforeHash = hashFile(liveStore);
  console.log(`Live store sha256 (before): ${beforeHash}`);

  // 1) Production build in repo (writes dist/ only)
  console.log("\n== Build ==");
  await new Promise((resolve, reject) => {
    const build = spawn("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
    build.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`build exit ${code}`))));
  });
  record("production build (vite → dist/web)", existsSync(join(root, "dist/web/index.html")));

  // 2) Isolated app copy + production-only install
  console.log("\n== Production-only install ==");
  const stage = mkdtempSync(join(tmpdir(), "sb-42b-stage-"));
  const dataCopy = mkdtempSync(join(tmpdir(), "sb-42b-data-"));
  copyFileSync(liveStore, join(dataCopy, "store.json"));

  for (const name of ["package.json", "package-lock.json", "tsconfig.json", ".env"]) {
    const src = join(root, name);
    if (existsSync(src)) copyFileSync(src, join(stage, name));
  }
  for (const dir of ["server", "shared", "dist", "web"]) {
    cpSync(join(root, dir), join(stage, dir), { recursive: true });
  }

  await new Promise((resolve, reject) => {
    const install = spawn("npm", ["ci", "--omit=dev"], { cwd: stage, stdio: "inherit" });
    install.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`npm ci --omit=dev exit ${code}`))));
  });
  const hasTsx = existsSync(join(stage, "node_modules/tsx/package.json"));
  const hasVite = existsSync(join(stage, "node_modules/vite/package.json"));
  record("tsx present after omit=dev install", hasTsx);
  record("vite absent after omit=dev install", !hasVite);

  // 3–6) Health, roles, catalog/orders, chat token
  console.log("\n== Runtime smoke ==");
  await withServer(
    {
      cwd: stage,
      env: {
        NODE_ENV: "production",
        PORT: "8791",
        SHOPBRIDGE_DATA_DIR: dataCopy,
      },
    },
    async (base) => {
      const health = await fetchJson(`${base}/api/health`);
      record(
        "GET /api/health",
        health.res.ok && health.body?.ok === true && health.body?.store?.exists === true,
        JSON.stringify({ ok: health.body?.ok, storeExists: health.body?.store?.exists, nexconn: health.body?.nexconn }),
      );

      const index = await fetch(`${base}/`);
      const html = await index.text();
      record("frontend assets served (/)", index.ok && html.includes("<div id=\"root\""));

      for (const account of ["buyer", "seller", "support"]) {
        const { res, body } = await fetchJson(`${base}/api/demo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account }),
        });
        record(`demo login ${account}`, res.ok && Boolean(body?.user?.id), body?.user?.role ?? res.status);
      }

      const buyerLogin = await fetchJson(`${base}/api/demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: "buyer" }),
      });
      const cookie = cookieFrom(buyerLogin.res);
      const products = await fetchJson(`${base}/api/products`, { headers: { Cookie: cookie } });
      record(
        "buyer product list",
        products.res.ok && Array.isArray(products.body?.products) && products.body.products.length > 0,
        `count=${products.body?.products?.length ?? 0}`,
      );
      const orders = await fetchJson(`${base}/api/orders`, { headers: { Cookie: cookie } });
      record(
        "buyer order list",
        orders.res.ok && Array.isArray(orders.body?.orders),
        `count=${orders.body?.orders?.length ?? 0}`,
      );

      const token = await fetchJson(`${base}/api/chat/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: "{}",
      });
      const tokenOk =
        token.res.ok &&
        typeof token.body?.appKey === "string" &&
        typeof token.body?.token === "string" &&
        typeof token.body?.userId === "string";
      record("POST /api/chat/token (session-bound)", tokenOk, `status=${token.res.status}`);

      const anon = await fetchJson(`${base}/api/chat/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      record("anon chat token rejected", anon.res.status === 401);
    },
  );

  // 7) Persistence across restart in a separate temp directory
  console.log("\n== Persistence (temp data dir) ==");
  const persistDir = mkdtempSync(join(tmpdir(), "sb-42b-persist-"));
  copyFileSync(liveStore, join(persistDir, "store.json"));
  const persistBefore = hashFile(join(persistDir, "store.json"));

  await withServer(
    {
      cwd: stage,
      env: { NODE_ENV: "production", PORT: "8792", SHOPBRIDGE_DATA_DIR: persistDir },
    },
    async (base) => {
      await fetchJson(`${base}/api/demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: "seller" }),
      });
    },
  );
  const persistAfterFirst = hashFile(join(persistDir, "store.json"));
  record("login wrote sessions to SHOPBRIDGE_DATA_DIR store", persistAfterFirst !== persistBefore);

  let survived = false;
  await withServer(
    {
      cwd: stage,
      env: { NODE_ENV: "production", PORT: "8792", SHOPBRIDGE_DATA_DIR: persistDir },
    },
    async (base) => {
      const health = await fetchJson(`${base}/api/health`);
      survived = health.res.ok && health.body?.store?.exists === true;
      const seller = await fetchJson(`${base}/api/demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: "seller" }),
      });
      const cookie = cookieFrom(seller.res);
      const me = await fetchJson(`${base}/api/me`, { headers: { Cookie: cookie } });
      survived = survived && me.res.ok;
    },
  );
  record("store survives process restart (same data dir)", survived);
  record(
    "no stray .tmp beside store after writes",
    readdirSync(persistDir).filter((n) => n.includes(".tmp")).length === 0,
    readdirSync(persistDir).join(", "),
  );

  // 8) Atomic write shape: rewrite via API then validate JSON parse + single store.json
  const parsed = JSON.parse(readFileSync(join(persistDir, "store.json"), "utf8"));
  record("persisted store remains valid JSON object with users[]", Array.isArray(parsed.users));

  // 9) Production missing store must not auto-create
  console.log("\n== Fail-closed missing store ==");
  const emptyDir = mkdtempSync(join(tmpdir(), "sb-42b-empty-"));
  await withServer(
    {
      cwd: stage,
      env: { NODE_ENV: "production", PORT: "8793", SHOPBRIDGE_DATA_DIR: emptyDir },
    },
    async (base) => {
      const health = await fetchJson(`${base}/api/health`);
      record(
        "health reports missing store without creating file",
        health.res.status === 503 &&
          health.body?.ok === false &&
          health.body?.store?.exists === false &&
          !existsSync(join(emptyDir, "store.json")),
      );
      const demo = await fetchJson(`${base}/api/demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: "buyer" }),
      });
      record(
        "demo login fails closed when store missing (production)",
        demo.res.status === 503 && demo.body?.error?.code === "STORE_MISSING",
        `status=${demo.res.status} code=${demo.body?.error?.code}`,
      );
      record("empty data dir still has no store.json", !existsSync(join(emptyDir, "store.json")));
    },
  );

  const afterHash = hashFile(liveStore);
  record("live data/store.json unchanged", afterHash === beforeHash, afterHash);

  const outDir = join(root, "backups/phase42b");
  mkdirSync(outDir, { recursive: true });
  const summary = {
    beforeHash,
    afterHash,
    results,
    pass: results.filter((r) => r.ok).length,
    fail: results.filter((r) => !r.ok).length,
  };
  writeFileSync(join(outDir, "smoke-results.json"), `${JSON.stringify(summary, null, 2)}\n`);

  rmSync(stage, { recursive: true, force: true });
  rmSync(dataCopy, { recursive: true, force: true });
  rmSync(persistDir, { recursive: true, force: true });
  rmSync(emptyDir, { recursive: true, force: true });

  console.log(`\nSummary: ${summary.pass} pass, ${summary.fail} fail`);
  if (summary.fail) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
