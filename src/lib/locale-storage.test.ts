import { strict as assert } from "node:assert";
import { test } from "node:test";
import { LEGACY_LOCALE_STORAGE_KEY, LOCALE_STORAGE_KEY, readStoredLocale } from "./i18n/config.ts";

/** An in-memory stand-in for `window.localStorage`. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

test("readStoredLocale: nothing saved means no preference", () => {
  assert.equal(readStoredLocale(memoryStorage()), null);
});

test("readStoredLocale: the current key wins", () => {
  const s = memoryStorage({ [LOCALE_STORAGE_KEY]: "en", [LEGACY_LOCALE_STORAGE_KEY]: "ar" });
  assert.equal(readStoredLocale(s), "en");
});

test("readStoredLocale: a language saved under the old key is kept and moved", () => {
  // Users of earlier versions must not lose their language on upgrade.
  const s = memoryStorage({ [LEGACY_LOCALE_STORAGE_KEY]: "ar" });
  assert.equal(readStoredLocale(s), "ar");
  assert.equal(s.data.get(LOCALE_STORAGE_KEY), "ar");
  assert.equal(s.data.has(LEGACY_LOCALE_STORAGE_KEY), false);
});

test("readStoredLocale: an unknown value under the old key is dropped, not adopted", () => {
  const s = memoryStorage({ [LEGACY_LOCALE_STORAGE_KEY]: "de" });
  assert.equal(readStoredLocale(s), null);
  assert.equal(s.data.size, 0);
});

test("readStoredLocale: the key no longer names the previous product", () => {
  assert.equal(LOCALE_STORAGE_KEY, "gestion-ecole.locale");
});
