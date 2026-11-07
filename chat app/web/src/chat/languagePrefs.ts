/** Reading-language options and the per-device auto-translate preference. */
import type { Language } from "../../../shared/types";

export type LangOption = { code: Language; label: string; native: string };

/** Codes match Nexconn translation language codes. */
export const LANGUAGE_OPTIONS: LangOption[] = [
  { code: "en", label: "English", native: "English" },
  { code: "hi", label: "Hindi", native: "हिन्दी · Hindi" },
  { code: "ar", label: "Arabic", native: "العربية · Arabic" },
  { code: "zh", label: "Chinese", native: "中文 · Chinese" },
  { code: "es", label: "Spanish", native: "Español · Spanish" },
  { code: "fr", label: "French", native: "Français · French" },
];

export type LanguagePrefs = {
  /** Kept for older stored values; the reading language now lives on the server. */
  targetLanguage: string;
  /** When true, messages are translated automatically after load/receive */
  autoTranslate: boolean;
};

const DEFAULTS: LanguagePrefs = { targetLanguage: "en", autoTranslate: true };

function storageKey(userId: string): string {
  return `shopbridge.langPrefs.${userId}`;
}

export function loadLanguagePrefs(userId: string): LanguagePrefs {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<LanguagePrefs>;
    return {
      targetLanguage: typeof parsed.targetLanguage === "string" ? parsed.targetLanguage : DEFAULTS.targetLanguage,
      autoTranslate: typeof parsed.autoTranslate === "boolean" ? parsed.autoTranslate : DEFAULTS.autoTranslate,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveLanguagePrefs(userId: string, prefs: LanguagePrefs): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
  } catch {
    // Private mode / storage full: preference simply is not remembered on this device.
  }
}

export function languageLabel(code: string): string {
  return LANGUAGE_OPTIONS.find((item) => item.code === code)?.label ?? code;
}
