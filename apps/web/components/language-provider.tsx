"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Locale, translationMap } from "@/lib/translations";

const STORAGE_KEY = "vultstrike_lang";
const VALID_LOCALES: Locale[] = ["en", "tr", "es", "fr", "ru", "de"];

function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const raw of langs) {
    const code = raw.split("-")[0].toLowerCase() as Locale;
    if (VALID_LOCALES.includes(code)) return code;
  }
  return "en";
}

function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (stored && VALID_LOCALES.includes(stored)) return stored;
  } catch {
    // ignore
  }
  return null;
}

type LanguageContextValue = {
  lang: Locale;
  setLang: (locale: Locale) => void;
  t: (key: string, replacements?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Locale>("en");

  // Hydrate from localStorage or detect browser language after mount
  useEffect(() => {
    const stored = readStoredLocale();
    const resolved = stored ?? detectBrowserLocale();
    if (resolved !== "en") setLangState(resolved);
  }, []);

  const setLang = useCallback((locale: Locale) => {
    setLangState(locale);
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<LanguageContextValue>(() => {
    const translator = (key: string, replacements?: Record<string, string | number>) => {
      const fallback = translationMap.en[key] ?? key;
      const phrase = translationMap[lang][key] ?? fallback;
      if (!replacements) return phrase;
      return Object.entries(replacements).reduce((acc, [token, val]) => acc.replace(`{${token}}`, String(val)), phrase);
    };

    return {
      lang,
      setLang,
      t: translator
    };
  }, [lang, setLang]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return ctx;
}
