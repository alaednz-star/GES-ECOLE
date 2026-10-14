/**
 * Cache keys for the session aggregate reads.
 *
 * Deliberately a LEAF module: no React, no Supabase, no `@/` alias imports. That
 * keeps the keys testable from a plain Node process (`verify-session-spine.mjs`
 * asserts window separation directly) and means importing a key never drags the
 * query client in with it.
 *
 * Both keys nest under the `["attendance"]` root that `queries.ts` established,
 * so a single `invalidateQueries({ queryKey: schoolKeys.attendanceRoot })`
 * refreshes them along with every existing attendance consumer. The comment on
 * `attendanceRoot` documents three real bugs caused by naming caches
 * individually; this inherits that fix rather than re-deciding it.
 */

/** Mirrors `schoolKeys.attendanceRoot`. Duplicated as a literal to keep this
 *  module free of the `@/` alias -- see the note above. The E2E asserts the two
 *  stay equal, so a drift is caught rather than merely commented against. */
const ATTENDANCE_ROOT = "attendance" as const;

export const sessionKeys = {
  /**
   * Per-session attendance counts for a window.
   *
   * BOTH ends are in the key. `useMarkedSessions` keys on `from` alone while
   * filtering `.gte(from)` with no upper bound -- fine for one open-ended
   * consumer, but a bounded window keyed that way would let August and September
   * share an entry and serve each other's rows.
   */
  summaries: (from: string, to: string) =>
    [ATTENDANCE_ROOT, "session-summaries", from, to] as const,

  /** Approved enrolment per group. Not windowed: enrolment does not vary by week. */
  enrollment: ["group-enrollment-counts"] as const,
};
