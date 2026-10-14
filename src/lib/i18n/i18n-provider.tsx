import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_META,
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  type Direction,
  type Locale,
} from "./config";
import type { Dictionary } from "./types";
import { initialDictionaries, loadDictionary } from "./runtime";

export interface I18nContextValue {
  locale: Locale;
  dir: Direction;
  setLocale: (locale: Locale) => void;
  /** Translate a key, with optional {placeholder} interpolation. */
  t: (key: string, vars?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  // In the production browser bundle only the default locale is present at first; the others
  // load on demand (see runtime.ts). A switch commits once its dictionary is here, so a page is
  // never half in one language and half in another.
  const [dicts, setDicts] = useState<Partial<Record<Locale, Dictionary>>>(initialDictionaries);

  const applyLocale = useCallback((next: Locale) => {
    void loadDictionary(next).then((dict) => {
      setDicts((prev) => (prev[next] ? prev : { ...prev, [next]: dict }));
      setLocaleState(next);
    });
  }, []);

  useEffect(() => {
    const stored = readStoredLocale(window.localStorage);
    if (stored) applyLocale(stored);
  }, [applyLocale]);

  useEffect(() => {
    const meta = LOCALE_META[locale];
    document.documentElement.lang = meta.htmlLang;
    document.documentElement.dir = meta.dir;
  }, [locale]);

  const setLocale = useCallback(
    (next: Locale) => {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
      applyLocale(next);
    },
    [applyLocale],
  );

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const raw = dicts[locale]?.[key] ?? dicts[DEFAULT_LOCALE]?.[key] ?? key;
      if (!vars) return raw;
      return Object.entries(vars).reduce(
        (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
        raw,
      );
    },
    [locale, dicts],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, dir: LOCALE_META[locale].dir, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
