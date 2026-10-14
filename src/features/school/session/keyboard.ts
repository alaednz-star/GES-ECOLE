/**
 * Keyboard marking rules for the attendance drawer. PURE.
 *
 * A teacher marks the same students every session, so reaching for the mouse
 * four times per student is most of the work. These are the rules behind
 * `P A R E` to mark and advance, arrows to move, `Ctrl/Cmd+S` to save.
 *
 * Pure and in a leaf module for the same reason as `keys.ts` and `deep-link.ts`:
 * the rules are testable from a plain Node process, and the component keeps only
 * the event plumbing.
 */

import type { AttendanceStatus } from "../types";

/**
 * Latin shortcut per status, always accepted regardless of UI language.
 *
 * A teacher on a French or Arabic interface is still typing on a QWERTY/AZERTY
 * keyboard, so the Latin letters must keep working; the localised code is
 * accepted *in addition* (see `buildKeyMap`), never instead.
 *
 * `r` for late is the French "Retard". English shows "L", which is why the
 * localised code has to be layered on top rather than assumed.
 */
export const LATIN_KEYS: Record<AttendanceStatus, string> = {
  present: "p",
  absent: "a",
  late: "r",
  excused: "e",
};

export const STATUS_ORDER: AttendanceStatus[] = ["present", "absent", "late", "excused"];

/**
 * Maps a pressed key to a status.
 *
 * @param localisedCode Resolves the displayed one-letter code for a status, i.e.
 *        `t("entity.session.code.<status>")`. Passed in rather than imported so
 *        this module stays free of the i18n runtime.
 */
export function buildKeyMap(
  localisedCode: (status: AttendanceStatus) => string,
): Map<string, AttendanceStatus> {
  const map = new Map<string, AttendanceStatus>();
  for (const status of STATUS_ORDER) {
    map.set(LATIN_KEYS[status], status);
    const code = localisedCode(status).trim().toLowerCase();
    // Only add a localised code that does not collide with a Latin shortcut
    // already claimed by a DIFFERENT status -- otherwise a locale could silently
    // steal "a" from `absent`.
    if (code && (!map.has(code) || map.get(code) === status)) map.set(code, status);
  }
  return map;
}

/**
 * Next focused row after a move.
 *
 * CLAMPS, never wraps. Wrapping from the last student back to the first would
 * silently re-mark someone already done, which in a register is a data error
 * rather than a navigation quirk.
 *
 * `current < 0` means nothing is focused yet: the drawer does not steal focus on
 * open, so the first keypress should land on row 0 instead of acting on a row the
 * user never chose.
 */
export function nextRow(current: number, delta: number, total: number): number {
  if (total <= 0) return -1;
  if (current < 0) return 0;
  return Math.max(0, Math.min(total - 1, current + delta));
}

/** The row a mark applies to: row 0 when nothing is focused yet. */
export function targetRow(current: number, total: number): number {
  if (total <= 0) return -1;
  return current < 0 ? 0 : Math.min(current, total - 1);
}
