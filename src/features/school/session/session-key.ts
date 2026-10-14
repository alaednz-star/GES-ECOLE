/**
 * Session identity -- the ONE definition of what names a session.
 *
 * A session is `(group_id, session_date)`. This is not a convention chosen here;
 * it is guaranteed by the schema. `20260807140000_one_session_per_day.sql` puts
 * `UNIQUE (group_id, weekday)` on `group_schedules`, so a group meets at most
 * once per calendar day and a group plus a date resolves to exactly one lesson.
 *
 * See docs/ADR-003-session-architecture.md section 2.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * The `${groupId}|${date}` encoding was already hand-written in three places
 * (`teacher-workspace.ts`, `teacher-overview.tsx`, `queries.ts`). Three copies
 * of an identity rule is three places to fix if the rule ever changes -- and it
 * plausibly could: if the business ever allows a group to meet twice a day, this
 * file plus that one constraint is the entire blast radius. Every module that
 * routes through here gets fixed by fixing here.
 *
 * Do not re-derive the key inline. Import it.
 */

/** The two fields that identify a session. */
export interface SessionIdentity {
  groupId: string;
  /** Local calendar date, ISO `YYYY-MM-DD`. Never a timestamp. */
  date: string;
}

/**
 * Canonical string form, for Map keys, Set membership and React keys.
 *
 * The separator is safe: a UUID contains only hex and dashes, and an ISO date
 * only digits and dashes, so neither half can contain a pipe and the encoding
 * is unambiguous in both directions.
 */
export function sessionKey(groupId: string, date: string): string {
  return `${groupId}|${date}`;
}

/** Same, from an object. */
export function keyOf(identity: SessionIdentity): string {
  return sessionKey(identity.groupId, identity.date);
}

/**
 * Inverse of `sessionKey`. Returns null rather than throwing on malformed input,
 * so a stale key from storage or a URL cannot crash a render.
 *
 * Splits on the FIRST pipe only. A UUID cannot contain one, so anything after
 * the first separator belongs to the date -- being strict here would turn a
 * merely odd key into an exception.
 */
export function parseSessionKey(key: string): SessionIdentity | null {
  const at = key.indexOf("|");
  if (at <= 0 || at === key.length - 1) return null;
  const groupId = key.slice(0, at);
  const date = key.slice(at + 1);
  if (!groupId || !date) return null;
  return { groupId, date };
}
