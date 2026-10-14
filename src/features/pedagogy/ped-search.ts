/**
 * The pedagogy pages' URL state (?group=&period=&student=), so a page can be linked to a group,
 * and the printable report card to a period and a student.
 */

export interface PedSearch {
  group?: string;
  period?: string;
  student?: string;
}

const UUID = /^[0-9a-f-]{36}$/i;

export function parsePedSearch(raw: Record<string, unknown>): PedSearch {
  const out: PedSearch = {};
  for (const k of ["group", "period", "student"] as const) {
    const v = raw[k];
    if (typeof v === "string" && UUID.test(v)) out[k] = v;
  }
  return out;
}

/** "mardi 08/09/2026": a session reads with its weekday. Latin digits in Arabic, like formatDate. */
export function formatSessionDate(iso: string, locale: string): string {
  const tag = locale === "ar" ? "ar-DZ-u-nu-latn" : locale === "en" ? "en-GB" : "fr-FR";
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(tag, {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
    .format(date)
    .replace(/[‎‏؜]/g, "");
}

/** A /20 figure, "12,5" in French, "12.5" in English. */
export function formatMark(value: number | null, locale: string): string {
  if (value === null) return "—";
  const tag = locale === "ar" ? "ar-DZ-u-nu-latn" : locale === "en" ? "en-GB" : "fr-FR";
  return new Intl.NumberFormat(tag, { maximumFractionDigits: 2 })
    .format(value)
    .replace(/[‎‏؜]/g, "");
}
