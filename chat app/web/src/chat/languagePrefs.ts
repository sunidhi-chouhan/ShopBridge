/** Preferred reading language for Nexconn translation. Persisted per ShopBridge user. */

export type LangOption = { code: string; label: string };

/** Curated subset for demo — codes match Nexconn supported language codes. */
export const LANGUAGE_OPTIONS: LangOption[] = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "ar", label: "Arabic" },
  { code: "zh", label: "Chinese" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
];

export type LanguagePrefs = {
  /** Target language for incoming message translation */
  targetLanguage: string;
  /** When true, peer messages are translated automatically after load/receive */
  autoTranslate: boolean;
};

const DEFAULTS: LanguagePrefs = {
  targetLanguage: "en",
  autoTranslate: true,
};

function storageKey(userId: string): string {
  return `shopbridge.langPrefs.${userId}`;
}

export function loadLanguagePrefs(userId: string): LanguagePrefs {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<LanguagePrefs>;
    const code = typeof parsed.targetLanguage === "string" ? parsed.targetLanguage : DEFAULTS.targetLanguage;
    const known = LANGUAGE_OPTIONS.some((item) => item.code === code);
    return {
      targetLanguage: known ? code : DEFAULTS.targetLanguage,
      autoTranslate: typeof parsed.autoTranslate === "boolean" ? parsed.autoTranslate : DEFAULTS.autoTranslate,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveLanguagePrefs(userId: string, prefs: LanguagePrefs): void {
  localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
}

export function languageLabel(code: string): string {
  return LANGUAGE_OPTIONS.find((item) => item.code === code)?.label ?? code;
}
