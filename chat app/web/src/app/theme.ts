/**
 * Light / dark appearance. The choice is stored on this device only ("system" follows the OS).
 * Default is light. The resolved theme is written to <html data-theme>, which every stylesheet keys off.
 */
import { useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "shopbridge.theme";
const listeners = new Set<() => void>();
const media = typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined;

function read(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
    return "light";
  } catch {
    return "light";
  }
}

let choice: ThemeChoice = typeof window !== "undefined" ? read() : "light";

function resolved(): "light" | "dark" {
  if (choice !== "system") return choice;
  return media?.matches ? "dark" : "light";
}

function apply(): void {
  const root = document.documentElement;
  const theme = resolved();
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#100e0c" : "#f3eee6");
  for (const listener of listeners) listener();
}

export function initTheme(): void {
  apply();
  media?.addEventListener?.("change", () => {
    if (choice === "system") apply();
  });
  // Another tab changed the setting.
  window.addEventListener("storage", (event) => {
    if (event.key === KEY) {
      choice = read();
      apply();
    }
  });
}

export function setTheme(next: ThemeChoice): void {
  choice = next;
  try {
    // "system" is stored explicitly: removing the key would read back as the light default after a reload.
    localStorage.setItem(KEY, next);
  } catch {
    // Private mode: the choice still applies for this visit.
  }
  const swap = () => apply();
  // Cross-fade the change where the browser supports it (skipped for reduced motion).
  const doc = document as Document & { startViewTransition?: (callback: () => void) => unknown };
  if (doc.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) doc.startViewTransition(swap);
  else swap();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTheme(): { choice: ThemeChoice; theme: "light" | "dark" } {
  const theme = useSyncExternalStore(subscribe, resolved, () => "light" as const);
  const current = useSyncExternalStore(subscribe, () => choice, () => "light" as const);
  return { choice: current, theme };
}
