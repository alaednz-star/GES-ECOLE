/**
 * Cahier de textes and Progression (ADR-008): sessions held, entries missing, chapter coverage.
 * PURE.
 *
 * A session is (group, date) -- ADR-003. The sessions held are the dates, from the group's start
 * up to today (or its end), that fall on one of its slot weekdays; two slots on the same day are
 * one session. A group without slots has no derived sessions: its entries are listed as written.
 */

import type { LessonEntry, PedChapter } from "./types";

export interface SessionPattern {
  startDate: string | null;
  endDate: string | null;
  /** 0 = Sunday ... 6 = Saturday, as in group_schedules. */
  weekdays: number[];
}

/** Hard cap so an open-ended group never expands forever (about four years of 3 sessions/week). */
const MAX_SESSIONS = 600;

function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Session dates from the group's start to `until` (inclusive), newest first. */
export function heldSessions(pattern: SessionPattern, until: string): string[] {
  if (!pattern.startDate || pattern.weekdays.length === 0) return [];
  const last = pattern.endDate && pattern.endDate < until ? pattern.endDate : until;
  if (last < pattern.startDate) return [];
  const days = new Set(pattern.weekdays);
  const out: string[] = [];
  const end = parse(last);
  for (const d = parse(pattern.startDate); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (days.has(d.getUTCDay())) out.push(iso(d));
  }
  return out.slice(-MAX_SESSIONS).reverse();
}

/** True when `date` is a session day of the pattern (term and weekday). */
export function isSessionDay(pattern: SessionPattern, date: string): boolean {
  if (pattern.startDate && date < pattern.startDate) return false;
  if (pattern.endDate && date > pattern.endDate) return false;
  if (pattern.weekdays.length === 0) return true;
  return pattern.weekdays.includes(parse(date).getUTCDay());
}

export interface LogRow {
  date: string;
  entry: LessonEntry | null;
  /** The date is a derived session up to today (as opposed to an entry written ahead). */
  held: boolean;
}

/**
 * The lesson log of one group: every session held (with or without an entry) plus entries on
 * other dates (written ahead, or for a group without slots), newest first.
 */
export function lessonLog(held: string[], entries: LessonEntry[]): LogRow[] {
  const byDate = new Map(entries.map((e) => [e.sessionDate, e]));
  const rows: LogRow[] = held.map((date) => ({
    date,
    entry: byDate.get(date) ?? null,
    held: true,
  }));
  const heldSet = new Set(held);
  for (const e of entries) {
    if (!heldSet.has(e.sessionDate)) rows.push({ date: e.sessionDate, entry: e, held: false });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export interface LogCounters {
  held: number;
  logged: number;
  missing: number;
  homework: number;
  /** Share of sessions held that have an entry, 0..100, or null without sessions. */
  rate: number | null;
}

export function logCounters(rows: LogRow[]): LogCounters {
  const held = rows.filter((r) => r.held);
  const logged = held.filter((r) => r.entry).length;
  return {
    held: held.length,
    logged,
    missing: held.length - logged,
    homework: rows.filter((r) => r.entry?.homework).length,
    rate: held.length ? Math.round((logged / held.length) * 100) : null,
  };
}

export interface ChapterCoverage {
  chapter: PedChapter;
  sessions: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Covered = referenced by an entry, or marked done. */
  covered: boolean;
  done: boolean;
}

export function chapterCoverage(chapters: PedChapter[], entries: LessonEntry[]): ChapterCoverage[] {
  return [...chapters]
    .sort((a, b) => a.position - b.position)
    .map((chapter) => {
      const dates = entries
        .filter((e) => e.chapterId === chapter.id)
        .map((e) => e.sessionDate)
        .sort();
      return {
        chapter,
        sessions: dates.length,
        firstDate: dates[0] ?? null,
        lastDate: dates[dates.length - 1] ?? null,
        covered: dates.length > 0 || chapter.completedOn !== null,
        done: chapter.completedOn !== null,
      };
    });
}

export function coverageRate(rows: ChapterCoverage[]): number | null {
  if (rows.length === 0) return null;
  return Math.round((rows.filter((r) => r.covered).length / rows.length) * 100);
}

/** Validates the lesson-entry form. Returns i18n keys by field. */
export function lessonEntryErrors(v: {
  date: string;
  summary: string;
  homework: string;
  homeworkDue: string;
}): Partial<Record<"date" | "summary" | "homework" | "homeworkDue", string>> {
  const out: Partial<Record<"date" | "summary" | "homework" | "homeworkDue", string>> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) out.date = "lessonLog.error.date";
  const summary = v.summary.trim();
  if (summary.length < 1 || summary.length > 4000) out.summary = "lessonLog.error.summary";
  if (v.homework.trim().length > 2000) out.homework = "lessonLog.error.homework";
  if (v.homeworkDue) {
    if (!v.homework.trim()) out.homeworkDue = "lessonLog.error.dueWithoutHomework";
    else if (v.homeworkDue < v.date) out.homeworkDue = "lessonLog.error.dueBefore";
  }
  return out;
}
