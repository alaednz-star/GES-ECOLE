/**
 * Where the provider gets its dictionaries.
 *
 * This file is what development, server rendering, tests and the type checker see: every
 * locale, loaded synchronously. The PRODUCTION BROWSER build replaces it (vite plugin
 * `i18nLocaleSplit`, `vite.i18n-split.ts`) with a version that ships only the default locale in
 * the main bundle and fetches the other locales when a visitor switches to one -- the three
 * locales together are the largest thing every page used to download.
 *
 * The contract both versions honour: `initialDictionaries` always holds DEFAULT_LOCALE (the
 * server renders it, and missing keys fall back to it); `loadDictionary` resolves any locale.
 */

import type { Locale } from "./config";
import type { Dictionary } from "./types";
import { dictionaries } from "./dictionaries";

export const initialDictionaries: Partial<Record<Locale, Dictionary>> = dictionaries;

export function loadDictionary(locale: Locale): Promise<Dictionary> {
  return Promise.resolve(dictionaries[locale]);
}
