/**
 * `useSessions` -- the Session Spine, assembled.
 *
 * See docs/ADR-003-session-architecture.md sections 4 and 5.
 *
 * Three inputs, joined client-side:
 *
 *   useGroups()                    the weekly pattern, term window, subject,
 *                                  teacher, room  (existing, unchanged)
 *   session_attendance_summary     per-session counts  (Phase 2A view)
 *   group_enrollment_counts        approved enrolments per group  (Phase 2A view)
 *
 * Recurrence expansion stays on the client, via `occurrencesForGroups()`. The
 * stored pattern is tiny, the expansion is pure and already capped, and there is
 * no server API layer in this architecture to move it to.
 *
 * WHAT THIS HOOK MUST NOT BECOME
 *
 * It returns the spine and nothing else. Homework, course resources, teacher
 * notes and announcements each own their data and contribute a
 * `Map<SessionKey, Summary>` the calendar composes separately. Adding a module
 * must not require editing this file -- if it seems to, see ADR-003 section 8.1.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useGroups, schoolKeys } from "../queries";
import { sessionKeys } from "./keys";
import { occurrencesForGroups } from "../schedule";
import type { GroupRow } from "../types";
import { sessionKey } from "./session-key";
import { compareSessions, countersFor, deriveStatus, needsAction } from "./status";
import {
  EMPTY_ROLLUP,
  type AttendanceRollup,
  type SessionCounters,
  type SessionInstance,
  type SessionQuery,
} from "./types";

/**
 * Cache keys live in `./keys` so a plain Node test can import them without
 * pulling in React. Re-exported here because this is where callers look.
 *
 * The runtime check keeps the literal in `keys.ts` honest: if `attendanceRoot`
 * is ever renamed, this throws in development instead of silently detaching the
 * session caches from the invalidation that refreshes them.
 */
export { sessionKeys };

if (import.meta.env?.DEV && sessionKeys.summaries("a", "b")[0] !== schoolKeys.attendanceRoot[0]) {
  throw new Error(
    "session cache keys no longer nest under schoolKeys.attendanceRoot; " +
      "update ATTENDANCE_ROOT in session/keys.ts",
  );
}

/* --------------------------- AGGREGATE QUERIES --------------------------- */

/** Row shape of `session_attendance_summary`, keyed by `sessionKey`. */
type SummaryMap = Map<string, AttendanceRollup>;

/**
 * Per-session attendance counts for a date window.
 *
 * Counts only -- no student rows. RLS on `attendance` decides which sessions
 * appear, and the view is `security_invoker`, so a teacher receives only their
 * own groups without this hook filtering anything. That is deliberate: a copy of
 * an authorisation rule is a rule that can drift.
 *
 * Sessions with nothing marked are ABSENT from the view (there are no rows to
 * aggregate). A missing entry therefore means "zero marked", which is what
 * `EMPTY_ROLLUP` expresses at the join below.
 */
export function useSessionSummaries(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: sessionKeys.summaries(from, to),
    enabled,
    queryFn: async (): Promise<SummaryMap> => {
      const { data, error } = await supabase
        .from("session_attendance_summary")
        .select(
          "group_id, session_date, marked_count, present_count, absent_count, late_count, excused_count, last_marked_at",
        )
        .gte("session_date", from)
        .lte("session_date", to);
      if (error) throw new Error(error.message);

      const out: SummaryMap = new Map();
      for (const r of data ?? []) {
        // The view's columns are nullable in the generated types because
        // Postgres cannot prove non-nullability through a view. In practice
        // group_id/session_date are never null (they are the GROUP BY key), but
        // skipping malformed rows is cheaper than trusting that.
        if (!r.group_id || !r.session_date) continue;
        out.set(sessionKey(r.group_id, r.session_date), {
          marked: r.marked_count ?? 0,
          present: r.present_count ?? 0,
          absent: r.absent_count ?? 0,
          late: r.late_count ?? 0,
          excused: r.excused_count ?? 0,
          lastMarkedAt: r.last_marked_at ?? null,
        });
      }
      return out;
    },
  });
}

/**
 * Approved enrolment count per group.
 *
 * Replaces counting `registrations` rows on the client. Not windowed, so it is
 * cached once and shared across every calendar navigation -- enrolment does not
 * change per week.
 */
export function useEnrollmentCounts(enabled = true) {
  return useQuery({
    queryKey: sessionKeys.enrollment,
    enabled,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabase
        .from("group_enrollment_counts")
        .select("group_id, enrolled_count");
      if (error) throw new Error(error.message);

      const out = new Map<string, number>();
      for (const r of data ?? []) {
        if (!r.group_id) continue;
        out.set(r.group_id, r.enrolled_count ?? 0);
      }
      return out;
    },
  });
}

/* ------------------------------- ASSEMBLY ------------------------------- */

/** Local-timezone ISO date. `toISOString` would shift a day across the UTC boundary. */
function todayLocalIso(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Applies the group-level filters before recurrence is expanded.
 *
 * Filtering groups rather than occurrences matters: a group excluded here costs
 * nothing to expand, and for a month view that is the difference between
 * expanding 4 groups and expanding 40.
 */
function filterGroups(
  groups: GroupRow[],
  q: Pick<SessionQuery, "teacherId" | "levelId" | "subjectId">,
  forcedTeacherId: string | null,
) {
  return groups.filter((g) => {
    // A teacher account is scoped to itself regardless of what the caller asked
    // for. RLS already enforces this server-side; doing it here as well keeps the
    // counters honest rather than showing totals the user cannot open.
    if (forcedTeacherId && g.teacherId !== forcedTeacherId) return false;
    if (q.teacherId && g.teacherId !== q.teacherId) return false;
    if (q.levelId && g.levelId !== q.levelId) return false;
    if (q.subjectId && g.subjectId !== q.subjectId) return false;
    return true;
  });
}

export interface UseSessionsResult {
  sessions: SessionInstance[];
  counters: SessionCounters;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Every scheduled session in a window, with its attendance state and status.
 *
 * @param query Window plus filters. Every field is part of a cache key, so
 *              navigating weeks or toggling a filter is a distinct cached entry
 *              and stepping back to a visited week is instant.
 * @param today Injectable local ISO date, for tests. Defaults to the real one.
 */
export function useSessions(query: SessionQuery, today = todayLocalIso()): UseSessionsResult {
  const { user } = useAuth();
  const groupsQuery = useGroups();

  // A teacher may only ever see their own sessions. Admins are unrestricted.
  const forcedTeacherId = user?.role === "teacher" ? (user.id ?? null) : null;

  const summariesQuery = useSessionSummaries(query.from, query.to);
  const enrollmentQuery = useEnrollmentCounts();

  // Depend on the FIELDS, not the object. Callers pass an inline literal
  // (`useSessions({ from, to })`), which is a new reference every render; using
  // `query` itself as a dependency would rebuild and re-sort every session on
  // each render and make the useMemo pure overhead.
  const { from, to, teacherId, levelId, subjectId, toMarkOnly } = query;

  const { sessions, counters } = useMemo(() => {
    const groups = groupsQuery.data ?? [];
    const summaries = summariesQuery.data;
    const enrollment = enrollmentQuery.data;

    // Wait for all three. Deriving from a partial join would flash wrong
    // statuses: no summaries yet reads as "nothing marked", i.e. every past
    // session briefly showing as overdue.
    if (!summaries || !enrollment) {
      return { sessions: [] as SessionInstance[], counters: countersFor([]) };
    }

    const scoped = filterGroups(groups, { teacherId, levelId, subjectId }, forcedTeacherId);

    const occurrences = occurrencesForGroups(scoped, { from, to });

    const built: SessionInstance[] = occurrences.map((o) => {
      const key = sessionKey(o.group.id, o.date);
      const rollup = summaries.get(key) ?? EMPTY_ROLLUP;
      const enrolled = enrollment.get(o.group.id) ?? 0;

      return {
        key,
        groupId: o.group.id,
        groupName: o.group.name,
        subjectId: o.group.subjectId,
        subjectKey: o.group.subjectKey,
        subjectName: o.group.subjectName,
        subjectColor: o.group.subjectColor,
        teacherId: o.group.teacherId,
        teacherName: o.group.teacherName,
        room: o.slot.room,
        date: o.date,
        startTime: o.slot.startTime,
        endTime: o.slot.endTime,
        startsAt: o.startsAt,
        enrolled,
        attendance: rollup,
        status: deriveStatus({ date: o.date, enrolled, marked: rollup.marked }, today),
      };
    });

    built.sort(compareSessions);

    // Counters are computed BEFORE the toMarkOnly filter, so the header keeps
    // telling the truth about the period while the grid shows a subset.
    // Filtering first would make "à pointer" equal to the visible count and the
    // number would stop being information.
    const periodCounters = countersFor(built);

    const visible = toMarkOnly ? built.filter((s) => needsAction(s.status)) : built;

    return { sessions: visible, counters: periodCounters };
  }, [
    groupsQuery.data,
    summariesQuery.data,
    enrollmentQuery.data,
    from,
    to,
    teacherId,
    levelId,
    subjectId,
    toMarkOnly,
    forcedTeacherId,
    today,
  ]);

  return {
    sessions,
    counters,
    isLoading: groupsQuery.isLoading || summariesQuery.isLoading || enrollmentQuery.isLoading,
    isFetching: groupsQuery.isFetching || summariesQuery.isFetching || enrollmentQuery.isFetching,
    error:
      (groupsQuery.error as Error | null) ??
      (summariesQuery.error as Error | null) ??
      (enrollmentQuery.error as Error | null) ??
      null,
    refetch: () => {
      void groupsQuery.refetch();
      void summariesQuery.refetch();
      void enrollmentQuery.refetch();
    },
  };
}
