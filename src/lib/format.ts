/** Shared display formatters. Keep presentation-only logic here, not in components. */

/** "Amine Belkacem" -> "AB". Falls back to "?" for empty input. */
export function initialsOf(name: string): string {
  const letters = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return letters || "?";
}

/**
 * Bidi control characters ICU embeds in Arabic patterns.
 *
 * `Intl.DateTimeFormat("ar-DZ")` returns "13‏/8‏/2026": a RIGHT-TO-LEFT MARK
 * between each component. Those marks reorder the parts wherever the string is placed,
 * even inside a `dir="ltr"` isolate -- "13/8/2026" renders as "/132026/8", which is not a
 * date. Stripping them is the same intent as forcing Latin digits below: a numeric date
 * should read the same way in every locale.
 */
const BIDI_MARKS = /[‎‏؜]/g;

/** Locale-aware date, e.g. 03/08/2026. Arabic uses Latin digits for scannability. */
export function formatDate(iso: string, locale: string): string {
  const tag = locale === "ar" ? "ar-DZ-u-nu-latn" : locale === "en" ? "en-GB" : "fr-FR";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(tag, { dateStyle: "short" }).format(date).replace(BIDI_MARKS, "");
}

/** Locale-aware date and time, e.g. 30/09/2026 14:05. Same digit and bidi rules as `formatDate`. */
export function formatDateTime(iso: string, locale: string): string {
  const tag = locale === "ar" ? "ar-DZ-u-nu-latn" : locale === "en" ? "en-GB" : "fr-FR";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(tag, { dateStyle: "short", timeStyle: "short" })
    .format(date)
    .replace(BIDI_MARKS, "");
}

/**
 * A decimal quantity, e.g. "3,5" in French and "3.5" in English.
 *
 * `String(3.5)` is always a full stop, which is wrong in French and Arabic. Used for
 * weekly hours, where a card would otherwise read "3.5 h / sem.".
 */
export function formatDecimal(value: number, locale: string): string {
  const tag = locale === "ar" ? "ar-DZ-u-nu-latn" : locale === "en" ? "en-GB" : "fr-FR";
  return new Intl.NumberFormat(tag, { maximumFractionDigits: 1 })
    .format(value)
    .replace(BIDI_MARKS, "");
}

/** Amount in Algerian dinar, e.g. "3 000 DZD". */
export function formatDzd(amount: number, locale: string): string {
  const tag = locale === "ar" ? "ar-DZ-u-nu-latn" : locale === "en" ? "en-GB" : "fr-FR";
  return `${new Intl.NumberFormat(tag).format(amount).replace(BIDI_MARKS, "")} DZD`;
}

/**
 * Today as a local `YYYY-MM-DD` calendar date.
 *
 * NOT `toISOString().slice(0, 10)`: that converts to UTC first, so anywhere east
 * of Greenwich after ~22:00 local it returns tomorrow. Attendance, schedules and
 * reports all key on calendar dates, where being a day out is a silent data bug.
 */
export function todayIso(): string {
  return toLocalIso(new Date());
}

/** A `Date` as a local `YYYY-MM-DD`, for the same reason as `todayIso`. */
export function toLocalIso(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
