import type { Locale } from "./config";

/** Flat key dictionary keeps lookups cheap and keys greppable. */
export type Dictionary = Record<string, string>;

/** A dictionary module contributes the same keys for every supported locale. */
export type DictionaryModule = Record<Locale, Dictionary>;
