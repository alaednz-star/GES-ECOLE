/**
 * Algerian phone numbers.
 *
 * Mobile numbers are 10 digits and always start 05, 06 or 07 (Djezzy, Mobilis,
 * Ooredoo). The international form is +213 followed by the same 9 digits with
 * the leading zero dropped.
 *
 * Landlines (021 Algiers, 031 Constantine, ...) are deliberately rejected: the
 * centre uses these numbers to reach a student or parent about an absence, and
 * a fixed line at an address nobody is at defeats the purpose.
 */

/** 05|06|07 + 8 more digits, once separators are stripped. */
const NORMALISED_RE = /^0(5|6|7)\d{8}$/;

/**
 * Strips everything a human might type -- spaces, dots, dashes, brackets -- and
 * converts +213 / 00213 to the local 0 form so stored numbers are comparable.
 * Returns null when the result is not a valid Algerian mobile.
 */
export function normaliseAlgerianPhone(input: string): string | null {
  const cleaned = input.replace(/[\s.\-()]/g, "");
  if (cleaned === "") return null;

  let local = cleaned;
  if (local.startsWith("+213")) local = `0${local.slice(4)}`;
  else if (local.startsWith("00213")) local = `0${local.slice(5)}`;
  // A bare 9-digit number missing its leading zero, e.g. "555123456".
  else if (/^[5-7]\d{8}$/.test(local)) local = `0${local}`;

  return NORMALISED_RE.test(local) ? local : null;
}

/** True when the input is a valid Algerian mobile in any accepted format. */
export function isValidAlgerianPhone(input: string): boolean {
  return normaliseAlgerianPhone(input) !== null;
}

/** "0555123456" -> "0555 12 34 56" for display. */
export function formatAlgerianPhone(input: string): string {
  const n = normaliseAlgerianPhone(input);
  if (!n) return input;
  return `${n.slice(0, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)} ${n.slice(8, 10)}`;
}
