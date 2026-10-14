/**
 * Display formatters.
 *
 * These exist mainly to pin the Arabic behaviour. ICU embeds RIGHT-TO-LEFT MARKs inside
 * Arabic date and number patterns, and those marks reorder the string wherever it lands --
 * a `dir="ltr"` wrapper does not undo them, because the marks are inside the text. A date
 * that renders as "/132026/8" looks like a rendering glitch and is actually the data.
 *
 *   node --test src/lib/format.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDate, formatDateTime, formatDecimal, formatDzd, initialsOf, toLocalIso } from "./format.ts";

/** Anything in this class reorders neighbouring text and must never reach the DOM. */
const BIDI = /[‎‏؜⁦-⁩]/;

test("formatDate: no bidi control characters in any locale", () => {
  for (const locale of ["fr", "ar", "en"]) {
    const out = formatDate("2026-08-13", locale);
    assert.equal(BIDI.test(out), false, `${locale} -> ${JSON.stringify(out)}`);
  }
});

test("formatDate: Arabic keeps day/month/year in reading order", () => {
  const out = formatDate("2026-08-13", "ar");
  // The parts must be separated by plain slashes, in that order -- not "/132026/8".
  assert.match(out, /^13\/0?8\/2026$/, JSON.stringify(out));
});

test("formatDate: Arabic uses Latin digits, so a date is scannable", () => {
  assert.match(formatDate("2026-08-13", "ar"), /^[0-9/]+$/);
});

test("formatDate: an unparseable date is an em dash, not Invalid Date", () => {
  assert.equal(formatDate("not-a-date", "fr"), "—");
});

test("formatDzd: no bidi marks, and the currency stays at the end", () => {
  for (const locale of ["fr", "ar", "en"]) {
    const out = formatDzd(3000, locale);
    assert.equal(BIDI.test(out), false, `${locale} -> ${JSON.stringify(out)}`);
    assert.ok(out.endsWith("DZD"), out);
  }
});

test("formatDecimal: the separator follows the locale", () => {
  assert.equal(formatDecimal(3.5, "fr"), "3,5");
  assert.equal(formatDecimal(3.5, "en"), "3.5");
  assert.equal(BIDI.test(formatDecimal(3.5, "ar")), false);
});

test("formatDecimal: a whole number carries no separator at all", () => {
  assert.equal(formatDecimal(2, "fr"), "2");
});

test("initialsOf: first letters of the first two words", () => {
  assert.equal(initialsOf("Mehdi Saadi"), "MS");
  assert.equal(initialsOf("Karim"), "K");
  assert.equal(initialsOf("Rachid Ben Ali Zerrouki"), "RB");
  assert.equal(initialsOf(""), "?");
});

test("toLocalIso: uses the local calendar date, not UTC", () => {
  // 23:30 local on the 13th is the 13th, even where UTC has already rolled over.
  const d = new Date(2026, 7, 13, 23, 30);
  assert.equal(toLocalIso(d), "2026-08-13");
});

test("formatDateTime: date and time, Latin digits, no bidi marks, em dash when unparseable", () => {
  for (const locale of ["fr", "ar", "en"]) {
    const out = formatDateTime("2026-09-30T13:05:00Z", locale);
    assert.ok(!BIDI.test(out), `${locale}: ${JSON.stringify(out)}`);
    assert.match(out, /2026/);
    assert.match(out, /\d{1,2}:\d{2}/);
    assert.ok(!/[٠-٩]/.test(out), `${locale} must use Latin digits`);
  }
  assert.equal(formatDateTime("not a date", "fr"), "—");
});
