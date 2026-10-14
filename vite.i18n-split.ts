/**
 * Per-locale dictionaries for the production browser bundle.
 *
 * The app's translations (fr, ar, en) used to ship together in the chunk every page loads,
 * although a visitor only ever reads one language. In a client production build this plugin:
 *
 *   - serves `virtual:i18n-locale/<locale>`: that locale's merged dictionary as JSON, computed at
 *     build time by loading `src/lib/i18n/dictionaries.ts` itself (the same merge the app does,
 *     so the output cannot drift from the source);
 *   - replaces `src/lib/i18n/runtime.ts` with: the default locale inline (the server renders it,
 *     and every missing key falls back to it), the others behind dynamic imports.
 *
 * Development and server rendering keep the original runtime.ts (all locales, synchronous).
 */

import path from "node:path";
import { runnerImport, type Plugin } from "vite";

const VIRTUAL = "virtual:i18n-locale/";
const RESOLVED = `\0${VIRTUAL}`;
const RUNTIME = "/src/lib/i18n/runtime.ts";

type Dictionaries = Record<string, Record<string, string>>;

export function i18nLocaleSplit(): Plugin {
  let isBuild = false;
  let root = process.cwd();
  let cache: Promise<{ dictionaries: Dictionaries; locales: string[]; fallback: string }> | null =
    null;

  const source = () =>
    (cache ??= (async () => {
      const [dicts, config] = await Promise.all([
        runnerImport<{ dictionaries: Dictionaries }>(
          path.join(root, "src/lib/i18n/dictionaries.ts"),
        ),
        runnerImport<{ LOCALES: readonly string[]; DEFAULT_LOCALE: string }>(
          path.join(root, "src/lib/i18n/config.ts"),
        ),
      ]);
      return {
        dictionaries: dicts.module.dictionaries,
        locales: [...config.module.LOCALES],
        fallback: config.module.DEFAULT_LOCALE,
      };
    })());

  return {
    name: "i18n-locale-split",
    enforce: "pre",
    configResolved(config) {
      isBuild = config.command === "build";
      root = config.root;
    },
    resolveId(id) {
      if (id.startsWith(VIRTUAL)) return RESOLVED + id.slice(VIRTUAL.length);
      return null;
    },
    async load(id, options) {
      if (id.startsWith(RESOLVED)) {
        const locale = id.slice(RESOLVED.length);
        const { dictionaries } = await source();
        const dict = dictionaries[locale];
        if (!dict) this.error(`i18n-locale-split: unknown locale "${locale}"`);
        // JSON.parse of a string literal parses faster than an object literal of this size.
        return `export default JSON.parse(${JSON.stringify(JSON.stringify(dict))});`;
      }
      if (isBuild && !options?.ssr && id.split("?")[0]!.replace(/\\/g, "/").endsWith(RUNTIME)) {
        const { locales, fallback } = await source();
        const lazy = locales.filter((l) => l !== fallback);
        return [
          `import fallback from ${JSON.stringify(VIRTUAL + fallback)};`,
          `export const initialDictionaries = { ${JSON.stringify(fallback)}: fallback };`,
          `const loaders = {`,
          ...lazy.map(
            (l) => `  ${JSON.stringify(l)}: () => import(${JSON.stringify(VIRTUAL + l)}),`,
          ),
          `};`,
          `export async function loadDictionary(locale) {`,
          `  if (initialDictionaries[locale]) return initialDictionaries[locale];`,
          `  const load = loaders[locale];`,
          `  if (!load) return fallback;`,
          `  const mod = await load();`,
          `  initialDictionaries[locale] = mod.default;`,
          `  return mod.default;`,
          `}`,
        ].join("\n");
      }
      return null;
    },
  };
}
