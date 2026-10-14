/**
 * Product vocabulary (ADR-004 section 2), checked across every dictionary in fr / ar / en.
 *
 *   Formation (table `programs`)   fr « Formation »   ar « تكوين »   en "Course"
 *   Group (table `groups`)         fr « Groupe »      ar « فوج »     en "Group"
 *   Registration                   fr « Inscription » ar « تسجيل »   en "Enrollment"
 *
 * The dictionaries are read as text (like navigation.test.ts): the modules import each other
 * through `@/` paths that `node --test` cannot resolve.
 *
 *   node --test src/lib/i18n-vocabulary.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

type Locale = "fr" | "ar" | "en";
type Entry = { file: string; locale: Locale; key: string; value: string };

const dictsDir = new URL("./i18n/dicts/", import.meta.url);
const files = [
  new URL("./i18n/dictionaries.ts", import.meta.url),
  ...readdirSync(dictsDir).map((f) => new URL(f, dictsDir)),
];

function parse(url: URL): Entry[] {
  const file = url.pathname.split("/").pop() ?? "";
  const lines = readFileSync(url, "utf8").replace(/\r/g, "").split("\n");
  const out: Entry[] = [];
  let locale: Locale | null = null;
  for (let i = 0; i < lines.length; i++) {
    const block = /^\s*(?:export )?(?:const )?(fr|ar|en)\b[^{"]*\{\s*$/.exec(lines[i] ?? "");
    if (block) {
      locale = block[1] as Locale;
      continue;
    }
    const kv = /^\s*"([^"]+)":\s*(.*)$/.exec(lines[i] ?? "");
    if (!kv || !locale) continue;
    let raw = (kv[2] ?? "").trim();
    if (raw === "") raw = (lines[++i] ?? "").trim(); // prettier moves long values to the next line
    raw = raw.replace(/,$/, "");
    if (!/^["']/.test(raw)) continue; // not a string value
    out.push({ file, locale, key: kv[1] as string, value: raw.slice(1, -1) });
  }
  return out;
}

const entries = files.flatMap(parse);
const value = (locale: Locale, key: string) =>
  entries.find((e) => e.locale === locale && e.key === key)?.value;

test("the dictionaries were read (sanity)", () => {
  assert.ok(entries.length > 1000, `${entries.length} entries`);
  for (const l of ["fr", "ar", "en"] as const) {
    assert.ok(
      entries.some((e) => e.locale === l && e.key === "programs.title"),
      l,
    );
  }
});

test("the offer is a Formation / تكوين / Course everywhere it is named", () => {
  assert.equal(value("fr", "programs.title"), "Formations");
  assert.equal(value("ar", "programs.title"), "التكوينات");
  assert.equal(value("en", "programs.title"), "Courses");
  assert.equal(value("fr", "menu.programs"), "Formations");
  assert.equal(value("ar", "menu.programs"), "التكوينات");
  assert.equal(value("en", "menu.programs"), "Courses");
});

test("no French or English string still calls the offer a programme", () => {
  // `{program}` is an interpolation placeholder, not a word the reader sees.
  const offenders = entries.filter(
    (e) => e.locale !== "ar" && /\bprogram(me)?s?\b/i.test(e.value.replace(/\{[^}]*\}/g, "")),
  );
  assert.deepEqual(
    offenders.map((e) => `${e.file} ${e.locale} ${e.key}: ${e.value}`),
    [],
  );
});

test("no Arabic administration string still says برنامج for the offer", () => {
  // "برنامج" legitimately means software or a personal schedule elsewhere (landing, teacher
  // workspace); the offer's own screens must not use it.
  const scoped = /^(programs\.|menu\.programs|form\.groups\.|entity\.groups\.|group\.program)/;
  const offenders = entries.filter(
    (e) => e.locale === "ar" && scoped.test(e.key) && /برنامج|البرامج|برامج/.test(e.value),
  );
  assert.deepEqual(
    offenders.map((e) => `${e.file} ${e.key}: ${e.value}`),
    [],
  );
});

test("Arabic uses one word for a group: فوج, never مجموعة", () => {
  // "مجموعات واتساب" (WhatsApp groups) on the landing page is not a teaching group.
  const offenders = entries.filter(
    (e) =>
      e.locale === "ar" &&
      /مجموعة|مجموعات|المجموعات|المجموعة/.test(e.value) &&
      !/واتساب/.test(e.value),
  );
  assert.deepEqual(
    offenders.map((e) => `${e.file} ${e.key}: ${e.value}`),
    [],
  );
});

test('no screen describes standalone groups as "school groups"', () => {
  const offenders = entries.filter((e) =>
    /groupes? scolaires?|school groups?|المجموعات المدرسية|الأفواج المدرسية/i.test(e.value),
  );
  assert.deepEqual(
    offenders.map((e) => `${e.file} ${e.locale} ${e.key}: ${e.value}`),
    [],
  );
});

test("English names a registration an enrollment in navigation and titles", () => {
  assert.equal(value("en", "menu.registrations"), "Enrollments");
  assert.equal(value("en", "entity.registrations.title"), "Enrollments");
  assert.equal(value("en", "menu.myRegistrations"), "My enrollments");
  assert.equal(value("fr", "menu.registrations"), "Inscriptions");
  assert.equal(value("ar", "menu.registrations"), "التسجيلات");
});
