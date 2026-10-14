/**
 * The Session Spine.
 *
 * See docs/ADR-003-session-architecture.md sections 3 and 4.
 *
 * This module holds types only -- no React, no Supabase, no derivation. That
 * keeps it importable from anywhere, including a plain Node test process.
 */

import type { AttendanceStatus } from "../types";

/**
 * A session's lifecycle state. DERIVED on read, never stored.
 *
 * These are locale-independent identities, not labels: the UI renders
 * `t("entity.session.status.<status>")`. A status is data; its French wording is
 * presentation, and hardcoding "Non pointée" here would break Arabic and English.
 *
 * | value       | meaning                                              |
 * |-------------|------------------------------------------------------|
 * | `empty`     | nobody enrolled -- nothing to mark, and not a debt   |
 * | `complete`  | every enrolled student has a status                  |
 * | `partial`   | some marked, some not                                |
 * | `overdue`   | in the past, nothing marked -- work owed             |
 * | `due`       | today, nothing marked -- actionable now              |
 * | `scheduled` | in the future, nothing marked -- nothing owed yet    |
 * | `cancelled` | did not happen; excluded from every counter          |
 *
 * `cancelled` has no storage yet (it needs a `session_exceptions` table, ADR-003
 * section 8.2). It is present so that consumers written now switch exhaustively
 * and adding the storage later is not a breaking change.
 */
export type SessionStatus =
  "empty" | "complete" | "partial" | "overdue" | "due" | "scheduled" | "cancelled";

/**
 * Per-session attendance totals, from `session_attendance_summary`.
 *
 * Counts, never rosters. The calendar must not pull student rows: a month across
 * a school is thousands of them, and `useAttendanceRange`'s 2000-row cap made
 * that a correctness bug rather than a slow path (ADR-003 section 5.2).
 */
export interface AttendanceRollup {
  /** Distinct students with any status recorded. */
  marked: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  /** Latest write to this session, for "changed since I loaded it" checks. */
  lastMarkedAt: string | null;
}

/** A session with nothing recorded. Shared so "no rows" is one object, not many. */
export const EMPTY_ROLLUP: AttendanceRollup = {
  marked: 0,
  present: 0,
  absent: 0,
  late: 0,
  excused: 0,
  lastMarkedAt: null,
};

/**
 * One occurrence of a group's timetable slot on a concrete date, plus the
 * numbers needed to show and act on it.
 *
 * WHAT IS DELIBERATELY ABSENT: homework, course resources, teacher notes,
 * announcements. Each future module owns its own table, query, cache key and
 * hook, and contributes at most a `Map<SessionKey, Summary>` overlay that the
 * calendar composes alongside this. `useSessions` must never reach into a
 * module, or opening the calendar starts loading things nobody asked for.
 *
 * If a feature seems to require a new field here, re-read ADR-003 section 8.1
 * before adding one.
 */
export interface SessionInstance {
  /** `sessionKey(groupId, date)`. Stable across refetches; safe as a React key. */
  key: string;

  groupId: string;
  groupName: string;

  subjectId: string | null;
  /** Stable locale-independent subject identity; the UI resolves the label. */
  subjectKey: string | null;
  /** Stored name, used as the fallback for custom subjects with no dictionary entry. */
  subjectName: string | null;
  /** From `subjects.color`. Tints derive from this; a fallback applies when null. */
  subjectColor: string | null;

  teacherId: string | null;
  teacherName: string | null;
  room: string | null;

  /** Local calendar date, ISO `YYYY-MM-DD`. */
  date: string;
  /** `HH:MM`, 24-hour. */
  startTime: string;
  endTime: string;
  /**
   * Local Date for the slot's start. Used for ordering and past/future tests.
   * Local, not UTC: an attendance system that is a day out is silently wrong.
   */
  startsAt: Date;

  /** Approved registrations for the group, from `group_enrollment_counts`. */
  enrolled: number;
  attendance: AttendanceRollup;
  status: SessionStatus;
}

/**
 * The three header counters, folded over whatever sessions are visible.
 *
 * Computed AFTER filtering so they always describe what is on screen -- a count
 * that disagrees with the list below it is worse than no count.
 */
export interface SessionCounters {
  /** Every session in the period, `cancelled` excluded. */
  total: number;
  /** Work available now: `due` + `partial`. */
  toMark: number;
  /** Work owed: `overdue` only. */
  overdue: number;
}

/** Window and filters for `useSessions`. Every field is a cache-key dimension. */
export interface SessionQuery {
  /** Inclusive ISO date. */
  from: string;
  /** Inclusive ISO date. */
  to: string;
  /** Restrict to one teacher's sessions. A teacher account is forced to self. */
  teacherId?: string | null | undefined;
  levelId?: string | null | undefined;
  subjectId?: string | null | undefined;
  /** Hide sessions that need no action (`complete`, `empty`, `cancelled`). */
  toMarkOnly?: boolean | undefined;
}

/** Maps an `AttendanceStatus` onto its rollup field. Keeps the two in step. */
export const ROLLUP_FIELD: Record<AttendanceStatus, keyof AttendanceRollup> = {
  present: "present",
  absent: "absent",
  late: "late",
  excused: "excused",
};
