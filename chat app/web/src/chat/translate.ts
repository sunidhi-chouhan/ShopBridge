import {
  NCEngine,
  TranslateHandler,
  TranslateMessageParam,
  TranslateSourceType,
  TranslateTextParam,
  type TranslateResult,
} from "@nexconn/chat";
import type { ChatLine } from "./nexconn";

export type TranslationState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "ready"; text: string; targetLanguage: string }
  | { status: "error"; message: string };

type Waiter = (state: TranslationState) => void;

const cache = new Map<string, TranslationState>();
const waiters = new Map<string, Set<Waiter>>();
const inFlight = new Set<string>();
const cacheListeners = new Set<() => void>();
let handlerReady = false;

/** Short stable reason for UI — never shown as a send failure. */
export const TRANSLATION_CONSOLE_HINT = "Translation is unavailable right now. Retry, or read the original.";

function key(messageId: string, targetLanguage: string): string {
  return `${messageId}::${targetLanguage}`;
}

function bumpCacheListeners(): void {
  for (const listener of cacheListeners) listener();
}

function notify(cacheKey: string, state: TranslationState): void {
  cache.set(cacheKey, state);
  const set = waiters.get(cacheKey);
  if (set) {
    for (const waiter of set) waiter(state);
  }
  bumpCacheListeners();
}

/** Room-level subscription so banners can react without per-message noise. */
export function subscribeTranslationCache(listener: () => void): () => void {
  cacheListeners.add(listener);
  return () => {
    cacheListeners.delete(listener);
  };
}

export function countTranslationStates(
  messageIds: string[],
  targetLanguage: string,
): { pending: number; failed: number; ready: number } {
  let pending = 0;
  let failed = 0;
  let ready = 0;
  for (const id of messageIds) {
    const state = cache.get(key(id, targetLanguage));
    if (state?.status === "pending") pending += 1;
    else if (state?.status === "error") failed += 1;
    else if (state?.status === "ready") ready += 1;
  }
  return { pending, failed, ready };
}

function acceptResult(item: TranslateResult, fallbackTarget: string): void {
  const id = item.identifier;
  const info = item.translateInfo;
  const target = info?.targetLanguage || fallbackTarget;
  const cacheKey = key(id, target);
  // Also try matching any pending keys that start with this message id.
  const related = [...cache.keys()].filter((entry) => entry.startsWith(`${id}::`));
  const targets = related.length > 0 ? related : [cacheKey];

  const ok = item.code === 0 || item.code === 200;
  const translated = info?.translatedText?.trim();
  const state: TranslationState =
    ok && translated
      ? { status: "ready", text: translated, targetLanguage: target }
      : {
          status: "error",
          message: TRANSLATION_CONSOLE_HINT,
        };

  for (const entry of targets) {
    inFlight.delete(entry);
    notify(entry, state);
  }
  if (!targets.includes(cacheKey)) {
    inFlight.delete(cacheKey);
    notify(cacheKey, state);
  }
}

export function ensureTranslateHandler(): void {
  if (handlerReady) return;
  NCEngine.addTranslateHandler(
    "shopbridge-translate",
    new TranslateHandler({
      onTranslationCompleted({ results }) {
        for (const item of results) {
          if (item.sourceType === TranslateSourceType.CUSTOM_TEXT) acceptTextResult(item);
          else acceptResult(item, "en");
        }
      },
    }),
  );
  handlerReady = true;
}

/** Apply user-level Nexconn translation language after connect. */
export async function syncNexconnTranslationLanguage(targetLanguage: string): Promise<void> {
  ensureTranslateHandler();
  const result = await NCEngine.translateModule.setTranslationLanguage(targetLanguage);
  if (!result.isOk) {
    throw new Error("Could not set the Nexconn translation language. Check Console Translation enablement.");
  }
}

export function getCachedTranslation(messageId: string, targetLanguage: string): TranslationState {
  return cache.get(key(messageId, targetLanguage)) ?? { status: "idle" };
}

export function subscribeTranslation(
  messageId: string,
  targetLanguage: string,
  listener: Waiter,
): () => void {
  const cacheKey = key(messageId, targetLanguage);
  const set = waiters.get(cacheKey) ?? new Set<Waiter>();
  set.add(listener);
  waiters.set(cacheKey, set);
  listener(cache.get(cacheKey) ?? { status: "idle" });
  return () => {
    set.delete(listener);
    if (set.size === 0) waiters.delete(cacheKey);
  };
}

/**
 * Request Nexconn translation for peer text messages.
 * Batches of ≤10. Skips cache hits and in-flight keys. Never mutates originals.
 */
export async function requestTranslations(
  lines: ChatLine[],
  targetLanguage: string,
  options?: { force?: boolean },
): Promise<{ requested: number; skipped: number }> {
  ensureTranslateHandler();
  const force = options?.force === true;
  const eligible = lines.filter((line) => line.id && line.kind === "text" && line.text.trim());
  let skipped = 0;
  const pending: ChatLine[] = [];

  for (const line of eligible) {
    const cacheKey = key(line.id, targetLanguage);
    const existing = cache.get(cacheKey);
    // Never auto-retry errors — that caused a pending↔error UI loop. Retry only with force.
    if (
      !force &&
      (existing?.status === "ready" ||
        existing?.status === "pending" ||
        existing?.status === "error" ||
        inFlight.has(cacheKey))
    ) {
      skipped += 1;
      continue;
    }
    pending.push(line);
  }

  if (pending.length === 0) return { requested: 0, skipped };

  // Sync user-level target so omitted params still resolve correctly.
  await NCEngine.translateModule.setTranslationLanguage(targetLanguage).catch(() => undefined);

  let requested = 0;
  for (let i = 0; i < pending.length; i += 10) {
    const batch = pending.slice(i, i + 10);
    for (const line of batch) {
      const cacheKey = key(line.id, targetLanguage);
      inFlight.add(cacheKey);
      notify(cacheKey, { status: "pending" });
    }
    const list = batch.map(
      (line) => new TranslateMessageParam(line.id, "auto", targetLanguage, line.text),
    );
    try {
      const result = await NCEngine.translateModule.translateMessages({ list, force });
      if (!result.isOk) {
        for (const line of batch) {
          const cacheKey = key(line.id, targetLanguage);
          inFlight.delete(cacheKey);
          notify(cacheKey, {
            status: "error",
            message: TRANSLATION_CONSOLE_HINT,
          });
        }
      } else {
        requested += batch.length;
        // Safety timeout if handler never fires (e.g. Console off but API returns ok oddly).
        window.setTimeout(() => {
          for (const line of batch) {
            const cacheKey = key(line.id, targetLanguage);
            if (inFlight.has(cacheKey)) {
              inFlight.delete(cacheKey);
              const current = cache.get(cacheKey);
              if (current?.status === "pending") {
                notify(cacheKey, {
                  status: "error",
                  message: TRANSLATION_CONSOLE_HINT,
                });
              }
            }
          }
        }, 20000);
      }
    } catch {
      for (const line of batch) {
        const cacheKey = key(line.id, targetLanguage);
        inFlight.delete(cacheKey);
        notify(cacheKey, {
          status: "error",
          message: TRANSLATION_CONSOLE_HINT,
        });
      }
    }
  }

  return { requested, skipped };
}

// ---------------------------------------------------------------------------
// Free-text translation (composer preview: "how the other person will read this")
// ---------------------------------------------------------------------------

type TextWaiter = { text: string; target: string; resolve: (value: string | null) => void; timer: number };
const textWaiters: TextWaiter[] = [];
const textCache = new Map<string, string>();

function acceptTextResult(item: TranslateResult): void {
  const translated = item.translateInfo?.translatedText?.trim() ?? "";
  const ok = (item.code === 0 || item.code === 200) && translated;
  const target = item.translateInfo?.targetLanguage;
  // Results identify the request; fall back to the oldest pending request for that target.
  let index = textWaiters.findIndex((waiter) => waiter.text === item.identifier);
  if (index === -1) index = textWaiters.findIndex((waiter) => !target || waiter.target === target);
  if (index === -1) return;
  const [waiter] = textWaiters.splice(index, 1);
  window.clearTimeout(waiter.timer);
  if (ok) textCache.set(`${waiter.target}::${waiter.text}`, translated);
  waiter.resolve(ok ? translated : null);
}

/** Translate arbitrary text with Nexconn. Resolves null on failure or timeout. */
export async function translateText(text: string, targetLanguage: string): Promise<string | null> {
  const clean = text.trim();
  if (!clean) return null;
  const cached = textCache.get(`${targetLanguage}::${clean}`);
  if (cached) return cached;
  ensureTranslateHandler();
  return new Promise((resolve) => {
    const waiter: TextWaiter = {
      text: clean,
      target: targetLanguage,
      resolve,
      timer: window.setTimeout(() => {
        const index = textWaiters.indexOf(waiter);
        if (index !== -1) textWaiters.splice(index, 1);
        resolve(null);
      }, 10000),
    };
    textWaiters.push(waiter);
    NCEngine.translateModule
      .translateTexts({ list: [new TranslateTextParam(clean, "auto", targetLanguage)] })
      .then((result) => {
        if (!result.isOk) {
          const index = textWaiters.indexOf(waiter);
          if (index !== -1) textWaiters.splice(index, 1);
          window.clearTimeout(waiter.timer);
          resolve(null);
        }
      })
      .catch(() => {
        const index = textWaiters.indexOf(waiter);
        if (index !== -1) textWaiters.splice(index, 1);
        window.clearTimeout(waiter.timer);
        resolve(null);
      });
  });
}

/** Drop cached translations for a message whose text changed (edited), so it is translated again. */
export function forgetTranslation(messageId: string): void {
  for (const cacheKey of [...cache.keys()]) {
    if (cacheKey.startsWith(`${messageId}::`)) {
      cache.delete(cacheKey);
      inFlight.delete(cacheKey);
    }
  }
  bumpCacheListeners();
}

/**
 * True when a "translation" is effectively the original (message already in the reader's
 * language — the service may only tweak punctuation or drop words). Word overlap ≥ 60%.
 */
export function isSameAsOriginal(original: string, translated: string): boolean {
  const words = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .normalize("NFKC")
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean),
    );
  const a = words(original);
  const b = words(translated);
  if (a.size === 0 || b.size === 0) return original.trim() === translated.trim();
  let shared = 0;
  for (const word of b) if (a.has(word)) shared += 1;
  return shared / Math.max(1, Math.min(a.size, b.size)) >= 0.6 && shared / Math.max(a.size, b.size) >= 0.5;
}
