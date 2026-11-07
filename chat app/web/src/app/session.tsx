import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Language, PublicUser } from "../../../shared/types";
import { demoStatus, setLanguagePreference, type DemoStatus } from "../api";
import { loadLanguagePrefs, saveLanguagePrefs } from "../chat/languagePrefs";
import { syncNexconnTranslationLanguage } from "../chat/translate";

type Session = {
  user: PublicUser;
  /** Reading language: stored on the server per user (English until chosen). */
  language: Language;
  /** Whether others' messages translate automatically (per device). */
  autoTranslate: boolean;
  setLanguage: (language: Language) => Promise<void>;
  setAutoTranslate: (value: boolean) => void;
  demo: DemoStatus | null;
};

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside SessionProvider");
  return session;
}

export function SessionProvider({
  user: initialUser,
  children,
}: {
  user: PublicUser;
  children: ReactNode;
}) {
  const [user, setUser] = useState(initialUser);
  const [autoTranslate, setAutoState] = useState(() => loadLanguagePrefs(initialUser.id).autoTranslate);
  const [demo, setDemo] = useState<DemoStatus | null>(null);

  useEffect(() => setUser(initialUser), [initialUser]);

  useEffect(() => {
    demoStatus()
      .then(setDemo)
      .catch(() => setDemo(null));
  }, [user.id]);

  const language: Language = user.language ?? "en";

  const setLanguage = useCallback(async (next: Language) => {
    setUser((current) => ({ ...current, language: next }));
    const result = await setLanguagePreference(next);
    setUser(result.user);
    await syncNexconnTranslationLanguage(next).catch(() => undefined);
  }, []);

  const setAutoTranslate = useCallback(
    (value: boolean) => {
      setAutoState(value);
      saveLanguagePrefs(user.id, { targetLanguage: language, autoTranslate: value });
    },
    [language, user.id],
  );

  const value = useMemo(
    () => ({ user, language, autoTranslate, setLanguage, setAutoTranslate, demo }),
    [user, language, autoTranslate, setLanguage, setAutoTranslate, demo],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
