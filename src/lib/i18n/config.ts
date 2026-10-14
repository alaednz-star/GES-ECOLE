export const LOCALES = ["fr", "ar", "en"] as const;

export type Locale = (typeof LOCALES)[number];

export type Direction = "ltr" | "rtl";

export const LOCALE_META: Record<Locale, { label: string; dir: Direction; htmlLang: string }> = {
  fr: { label: "Français", dir: "ltr", htmlLang: "fr" },
  ar: { label: "العربية", dir: "rtl", htmlLang: "ar" },
  en: { label: "English", dir: "ltr", htmlLang: "en" },
};

export const DEFAULT_LOCALE: Locale = "fr";

/** Where the chosen language is saved in the browser. */
export const LOCALE_STORAGE_KEY = "gestion-ecole.locale";
/** The key earlier versions used. Read once so nobody loses their language, then removed. */
export const LEGACY_LOCALE_STORAGE_KEY = "madrasti.locale";

export function isLocale(value: string | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

type LocaleStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The saved language, moved from the legacy key on first read. Null when none is saved. */
export function readStoredLocale(storage: LocaleStorage): Locale | null {
  const current = storage.getItem(LOCALE_STORAGE_KEY);
  if (isLocale(current)) return current;
  const legacy = storage.getItem(LEGACY_LOCALE_STORAGE_KEY);
  if (legacy === null) return null;
  storage.removeItem(LEGACY_LOCALE_STORAGE_KEY);
  if (!isLocale(legacy)) return null;
  storage.setItem(LOCALE_STORAGE_KEY, legacy);
  return legacy;
}
