/**
 * Session status and counters. PURE -- no fetching, no React, no clock reads
 * except the one the caller passes in.
 *
 * See docs/ADR-003-session-architecture.md sections 3.1 and 3.3.
 *
 * Purity is a hard requirement, not a preference: it is what lets every state
 * and counter be tested without a database or a rendered component. `today` is
 * always an argument -- a function that reads `new Date()` internally cannot be
 * tested for "yesterday" without faking global time.
 */

import type { AttendanceRollup, SessionCounters, SessionInstance, SessionStatus } from "./types";

/** Inputs `deriveStatus` needs. A subset of `SessionInstance`, so it is callable
 *  before a full instance exists (which is how `use-sessions` uses it). */
export interface StatusInput {
  /** Local ISO `YYYY-MM-DD`. */
  date: string;
  enrolled: number;
  marked: number;
  /** No storage yet; see ADR-003 section 8.2. */
  cancelled?: boolean | undefined;
}

/**
 * The session lifecycle, as a total function of three facts.
 *
 * ORDER IS LOAD-BEARING. Each early return below prevents a specific wrong
 * answer, so reordering them is a behaviour change, not a refactor:
 *
 *  1. `cancelled` first -- a cancelled session is not owed work no matter what
 *     its date or roster says.
 *  2. `empty` before any date test. A group with nobody enrolled must NEVER
 *     report `overdue`: it would inflate the "en retard" counter permanently,
 *     and that counter's whole job is to reach zero when the teacher is done.
 *     A session nobody can attend is not a debt.
 *  3. `complete` before `partial`, so a fully-marked session is never described
 *     as half-done.
 *  4. `partial` before the date tests, because a session with SOME marks is
 *     "in progress" whether or not it is in the past -- the teacher has already
 *     started, and calling it `overdue` would lose that.
 *
 * @param today Local ISO date. Passed in, never read from the clock here.
 */
export function deriveStatus(input: StatusInput, today: string): SessionStatus {
  if (input.cancelled) return "cancelled";

  // Nobody to mark. Checked before the date so this can never be `overdue`.
  if (input.enrolled <= 0) return "empty";

  // Guard against a rollup that outruns the roster (a student unenrolled after
  // being marked). Treating marked > enrolled as complete is the honest reading:
  // every current student has a status.
  if (input.marked >= input.enrolled) return "complete";

  if (input.marked > 0) return "partial";

  // Nothing marked: the answer is purely about when.
  if (input.date < today) return "overdue";
  if (input.date === today) return "due";
  return "scheduled";
}

/**
 * Does this session represent work the user still has to do?
 *
 * `partial` counts: some students are marked, the rest are not. `overdue` counts
 * because it is owed. `due` counts because it is actionable today.
 */
export function isActionable(status: SessionStatus): boolean {
  return status === "due" || status === "partial" || status === "overdue";
}

/**
 * Backs the "à pointer seulement" filter.
 *
 * Deliberately NOT the same as `isActionable`: `overdue` sessions are shown by
 * that filter too, because hiding work the teacher owes would defeat the point
 * of the filter. What it hides is anything needing no action -- `complete`,
 * `empty`, `scheduled` and `cancelled`.
 */
export function needsAction(status: SessionStatus): boolean {
  return isActionable(status);
}

/** Sums a rollup's per-status fields. Used to sanity-check `marked`. */
export function rollupTotal(rollup: AttendanceRollup): number {
  return rollup.present + rollup.absent + rollup.late + rollup.excused;
}

/**
 * The three header counters.
 *
 * `cancelled` is excluded from `total` as well as from the actionable counts: a
 * session that did not happen should not inflate "17 séances".
 */
export function countersFor(sessions: readonly SessionInstance[]): SessionCounters {
  let total = 0;
  let toMark = 0;
  let overdue = 0;

  for (const s of sessions) {
    if (s.status === "cancelled") continue;
    total += 1;
    if (s.status === "due" || s.status === "partial") toMark += 1;
    if (s.status === "overdue") overdue += 1;
  }

  return { total, toMark, overdue };
}

/**
 * Chronological order: date first, then start time, then group name so that
 * parallel sessions in the same slot have a stable, human-meaningful order
 * rather than whatever order the two queries happened to resolve in.
 */
export function compareSessions(a: SessionInstance, b: SessionInstance): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.startTime !== b.startTime) return a.startTime < b.startTime ? -1 : 1;
  return a.groupName.localeCompare(b.groupName);
}

/** Groups sessions by date, for a week or month grid. Insertion order preserved. */
export function groupByDate(sessions: readonly SessionInstance[]): Map<string, SessionInstance[]> {
  const out = new Map<string, SessionInstance[]>();
  for (const s of sessions) {
    const list = out.get(s.date);
    if (list) list.push(s);
    else out.set(s.date, [s]);
  }
  return out;
}

/**
 * Groups one day's sessions by start time -- the "3 groupes en parallèle" case.
 *
 * Parallel sessions must never collapse into one card: at 08:00 three different
 * groups may share a subject and differ only by group, so merging them would
 * hide two of them entirely.
 */
export function groupByTimeSlot(
  sessions: readonly SessionInstance[],
): Map<string, SessionInstance[]> {
  const out = new Map<string, SessionInstance[]>();
  for (const s of sessions) {
    const slot = `${s.startTime}-${s.endTime}`;
    const list = out.get(slot);
    if (list) list.push(s);
    else out.set(slot, [s]);
  }
  return out;
}
