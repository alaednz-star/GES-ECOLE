/**
 * Deep-link parameters for the attendance calendar. PURE.
 *
 * WHY THIS EXISTS
 *
 * Six places in the workspace link to `/dashboard/attendance`, and several name a
 * SPECIFIC session -- "Compléter maintenant" on the oldest unmarked register, the
 * next-class hero, each row of the pending-attendance widget. Before this they
 * all landed on the current week with no indication which session was meant, so
 * the teacher had to find it again: the call to action was precise and its
 * destination was not.
 *
 * A leaf module with no React and no `@/` alias imports, for the same reason as
 * `keys.ts`: the parsing rules are testable from a plain Node process, and the
 * route stays a thin consumer.
 *
 * `session` is a `SessionKey` (`groupId|date`) so identity still comes from
 * `session-key.ts` and is never re-derived here.
 */

// The `.ts` extension is REQUIRED on this one. Node's type-stripping resolves
// relative VALUE imports literally, so an extensionless path fails under
// `node --test`; type-only imports (below) are erased and need no extension.
// `allowImportingTsExtensions` is already on in tsconfig, and Vite resolves it.
import { parseSessionKey } from "./session-key.ts";
import type { CalendarView } from "./calendar-range";

/** ISO `YYYY-MM-DD`. Validated before it is trusted as a calendar anchor. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface AttendanceSearch {
  /** Calendar anchor. Absent means today. */
  date?: string | undefined;
  /** `SessionKey` of a session to open on arrival. */
  session?: string | undefined;
  view?: CalendarView | undefined;
  /** Pre-apply the "à pointer seulement" filter. */
  toMark?: boolean | undefined;
}

/**
 * Normalises raw search params into a trusted shape.
 *
 * Anything malformed is DROPPED rather than throwing. A stale bookmark, a
 * hand-edited URL or a link from an older build should open the ordinary
 * calendar; a validation error boundary on a page whose whole job is "show me my
 * sessions" would be a worse outcome than ignoring one parameter.
 *
 * Absent keys are omitted rather than set to `undefined`, so the resulting object
 * serialises to a clean URL instead of `?date=undefined`.
 */
export function parseAttendanceSearch(raw: Record<string, unknown>): AttendanceSearch {
  const out: AttendanceSearch = {};

  const date = raw["date"];
  if (typeof date === "string" && ISO_DATE.test(date) && isRealDate(date)) out.date = date;

  const session = raw["session"];
  if (typeof session === "string" && parseSessionKey(session)) out.session = session;

  const view = raw["view"];
  if (view === "week" || view === "month") out.view = view;

  // Booleans arrive as real booleans from a typed `<Link search>` and as strings
  // from a pasted URL, so both are accepted.
  const toMark = raw["toMark"];
  if (toMark === true || toMark === "true") out.toMark = true;

  return out;
}

/**
 * A trusted calendar anchor, or the fallback.
 *
 * Used at the POINT OF USE, not only at the router boundary. Validating once in
 * `validateSearch` is not sufficient defence: an unparseable anchor reaching
 * `Intl.DateTimeFormat().format()` throws `RangeError: Invalid time value`, which
 * takes down the whole page through the dashboard error boundary -- the calendar
 * disappears and the user sees "Impossible de charger ces données", which is both
 * alarming and wrong, since nothing failed to load.
 *
 * Reproduced with `?date=not-a-date`. Note that `?date=2026-02-31` did NOT crash,
 * because it parses to 3 March -- so the failure only showed up for input that is
 * unparseable rather than merely wrong, which is exactly the kind of gap a single
 * validation layer leaves behind.
 */
export function safeDate(value: string | undefined, fallback: string): string {
  if (!value || !ISO_DATE.test(value) || !isRealDate(value)) return fallback;
  return value;
}

/**
 * Rejects well-formed strings that are not real dates, e.g. `2026-02-31`.
 *
 * The shape test alone would let one through, and it would then silently shift
 * when parsed -- 31 February becomes 3 March, so the calendar would open on a
 * different week than the URL says.
 */
function isRealDate(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}
