import { useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useGroups, useMarkedSessions, useRegistrations } from "@/features/school/queries";
import {
  isGroupRunning,
  occurrencesForGroups,
  type SessionOccurrence,
} from "@/features/school/schedule";
import type { GroupRow } from "@/features/school/types";

/** A group plus the operational numbers a teacher needs at a glance. */
export interface TeacherGroupCard {
  group: GroupRow;
  studentCount: number;
  /** Next dated occurrence, or null when the term is over / none scheduled. */
  next: SessionOccurrence | null;
  weeklyMinutes: number;
  /** Past occurrences with no attendance recorded. */
  pendingAttendance: number;
  running: boolean;
}

/** Local-timezone ISO date. `toISOString` would shift across the UTC boundary. */
function isoDate(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return Math.max(0, (eh ?? 0) * 60 + (em ?? 0) - ((sh ?? 0) * 60 + (sm ?? 0)));
}

/**
 * Everything the teacher workspace and My Groups need, derived once.
 *
 * Both screens read the same three queries, so computing here keeps the numbers
 * consistent between them -- a group showing "12 students" on one page and "11"
 * on another is the kind of drift that erodes trust in the whole product.
 *
 * All scheduling comes from real dated occurrences, never the raw weekly
 * pattern: a pattern ignores `start_date`/`end_date` and would advertise
 * classes for terms that have not begun or have already finished.
 */
export function useTeacherWorkspace() {
  const { user } = useAuth();
  const groupsQuery = useGroups();
  const registrationsQuery = useRegistrations();

  // Two weeks back: far enough to catch a missed week, short enough that the
  // pending list stays actionable instead of becoming a backlog.
  const lookback = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return isoDate(d);
  }, []);
  const attendanceQuery = useMarkedSessions(lookback);

  const teacherId = user?.id ?? null;

  const value = useMemo(() => {
    const groups = groupsQuery.data ?? [];
    const registrations = registrationsQuery.data ?? [];
    const attendance = attendanceQuery.data ?? [];

    const mine = teacherId ? groups.filter((g) => g.teacherId === teacherId) : [];

    const approvedByGroup = new Map<string, number>();
    for (const r of registrations) {
      if (r.status !== "approved") continue;
      approvedByGroup.set(r.groupId, (approvedByGroup.get(r.groupId) ?? 0) + 1);
    }

    // A register is "done" for a (group, date) if any row exists for it.
    const marked = new Set(attendance.map((a) => `${a.groupId}|${a.sessionDate}`));

    const now = new Date();
    const today = isoDate(now);

    // Look back two weeks for forgotten registers: far enough to catch a missed
    // week, short enough that the list stays actionable rather than a backlog.
    const lookbackFrom = new Date(now);
    lookbackFrom.setDate(lookbackFrom.getDate() - 14);

    const past = occurrencesForGroups(mine, { from: isoDate(lookbackFrom), to: today });
    const pendingAttendance = past
      .filter((o) => o.startsAt < now && !marked.has(`${o.group.id}|${o.date}`))
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + 14);
    const upcoming = occurrencesForGroups(mine, { from: today, to: isoDate(horizon) })
      .filter((o) => o.startsAt >= now)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

    const todays = occurrencesForGroups(mine, { from: today, to: today }).sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
    );

    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const week = occurrencesForGroups(mine, { from: today, to: isoDate(weekEnd) }).sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
    );

    const cards: TeacherGroupCard[] = mine.map((group) => {
      const groupPending = pendingAttendance.filter((o) => o.group.id === group.id).length;
      return {
        group,
        studentCount: approvedByGroup.get(group.id) ?? 0,
        next: upcoming.find((o) => o.group.id === group.id) ?? null,
        weeklyMinutes: group.schedules.reduce(
          (sum, s) => sum + minutesBetween(s.startTime, s.endTime),
          0,
        ),
        pendingAttendance: groupPending,
        running: isGroupRunning(group, now),
      };
    });

    const totalStudents = new Set(
      registrations
        .filter((r) => r.status === "approved" && mine.some((g) => g.id === r.groupId))
        .map((r) => r.studentId),
    ).size;

    return {
      groups: mine,
      cards,
      todays,
      week,
      upcoming,
      /** The very next class. The single most-asked question of the day. */
      nextClass: upcoming[0] ?? null,
      pendingAttendance,
      totalStudents,
      weeklyMinutes: cards.reduce((sum, c) => sum + c.weeklyMinutes, 0),
      /** Registers already completed today, over sessions scheduled today. */
      todayMarked: todays.filter((o) => marked.has(`${o.group.id}|${o.date}`)).length,
    };
  }, [groupsQuery.data, registrationsQuery.data, attendanceQuery.data, teacherId]);

  return {
    ...value,
    isLoading: groupsQuery.isLoading || registrationsQuery.isLoading || attendanceQuery.isLoading,
    isFetching: groupsQuery.isFetching || registrationsQuery.isFetching,
    error: groupsQuery.error ?? registrationsQuery.error ?? attendanceQuery.error,
    refetch: () => {
      void groupsQuery.refetch();
      void registrationsQuery.refetch();
      void attendanceQuery.refetch();
    },
  };
}
