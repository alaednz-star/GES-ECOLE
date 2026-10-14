import type { GroupRow, ScheduleSlot } from "./types";

export const WEEKDAYS = [
  "dash.weekday.0",
  "dash.weekday.1",
  "dash.weekday.2",
  "dash.weekday.3",
  "dash.weekday.4",
  "dash.weekday.5",
  "dash.weekday.6",
] as const;

/**
 * Returns the i18n key for a weekday. Pass a `t` function to get the
 * translated label directly; otherwise the raw dictionary key is returned.
 */
export function weekdayLabel(weekday: number, t?: (key: string) => string): string {
  const key = WEEKDAYS[weekday];
  if (!key) return "—";
  return t ? t(key) : key;
}

export interface SessionItem {
  group: GroupRow;
  slot: ScheduleSlot;
}

/** All sessions of a given weekday (0 = Sunday), sorted by start time. */
/**
 * Total weekly hours across a group's slots -- what "2 h / sem." on a card means.
 *
 * Sums the slots rather than multiplying one of them: a group meeting Monday 14:00-16:00
 * and Wednesday 10:00-11:30 is 3.5 hours a week, not 2 and not 4.
 */
export function weeklyHours(schedules: { startTime: string; endTime: string }[]): number {
  const minutes = schedules.reduce((sum, sl) => {
    const [sh = 0, sm = 0] = sl.startTime.split(":").map(Number);
    const [eh = 0, em = 0] = sl.endTime.split(":").map(Number);
    return sum + Math.max(0, eh * 60 + em - (sh * 60 + sm));
  }, 0);
  return Math.round((minutes / 60) * 10) / 10;
}

export function sessionsForDay(groups: GroupRow[], weekday: number): SessionItem[] {
  return groups
    .flatMap((group) =>
      group.schedules.filter((s) => s.weekday === weekday).map((slot) => ({ group, slot })),
    )
    .sort((a, b) => a.slot.startTime.localeCompare(b.slot.startTime));
}

/** Full week timetable, ordered by day then start time. */
export function weeklySessions(groups: GroupRow[]): SessionItem[] {
  return groups
    .flatMap((group) => group.schedules.map((slot) => ({ group, slot })))
    .sort(
      (a, b) => a.slot.weekday - b.slot.weekday || a.slot.startTime.localeCompare(b.slot.startTime),
    );
}

/* ------------------------- RECURRING OCCURRENCES ------------------------- */

/**
 * One concrete lesson: a weekly slot resolved to an actual calendar date.
 *
 * Occurrences are always derived, never stored. The database keeps the pattern
 * (`group_schedules`) plus the window it repeats over (`groups.start_date` /
 * `end_date`), so a year of lessons costs a handful of rows instead of
 * thousands, and moving a start date needs no regeneration.
 */
export interface SessionOccurrence {
  group: GroupRow;
  slot: ScheduleSlot;
  /** Calendar date in ISO `YYYY-MM-DD`, matching `attendance.session_date`. */
  date: string;
  /** Local Date for the slot's start, for sorting and "is it past?" checks. */
  startsAt: Date;
}

/** Local-timezone ISO date. Avoids `toISOString`, which shifts across UTC. */
function toIsoDate(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Parses `YYYY-MM-DD` as a local date, not UTC midnight. */
function fromIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function atTime(day: Date, time: string): Date {
  const [h, min] = time.split(":").map(Number);
  const out = new Date(day);
  out.setHours(h ?? 0, min ?? 0, 0, 0);
  return out;
}

/**
 * Hard ceiling on how many occurrences one call may produce.
 *
 * A group with an open-ended `end_date` would otherwise expand forever. This
 * keeps generation bounded no matter what the caller asks for.
 */
const MAX_OCCURRENCES = 500;

export interface OccurrenceRange {
  /** Inclusive ISO date. Defaults to today. */
  from?: string | undefined;
  /** Inclusive ISO date. Defaults to `from` + 90 days. */
  to?: string | undefined;
  limit?: number | undefined;
}

/**
 * Expands a group's weekly pattern into real dates within a window.
 *
 * The window is intersected with the group's own term, so a group that ended
 * last month yields nothing and one starting next month yields nothing until
 * then. Iteration walks day by day over the requested range only -- it never
 * touches the whole academic year unless asked to.
 */
export function occurrencesForGroup(
  group: GroupRow,
  range: OccurrenceRange = {},
): SessionOccurrence[] {
  if (group.schedules.length === 0 || !group.startDate) return [];

  const windowFrom = fromIsoDate(range.from ?? toIsoDate(new Date()));
  const windowTo = range.to
    ? fromIsoDate(range.to)
    : new Date(windowFrom.getTime() + 90 * 86_400_000);

  // Clamp to the group's own term: the pattern is meaningless outside it.
  const termStart = fromIsoDate(group.startDate);
  const termEnd = group.endDate ? fromIsoDate(group.endDate) : null;

  const start = windowFrom > termStart ? windowFrom : termStart;
  const end = termEnd && termEnd < windowTo ? termEnd : windowTo;
  if (start > end) return [];

  // Index slots by weekday so each day costs one lookup rather than a scan.
  const byWeekday = new Map<number, ScheduleSlot[]>();
  for (const slot of group.schedules) {
    const list = byWeekday.get(slot.weekday) ?? [];
    list.push(slot);
    byWeekday.set(slot.weekday, list);
  }

  const cap = Math.min(range.limit ?? MAX_OCCURRENCES, MAX_OCCURRENCES);
  const out: SessionOccurrence[] = [];

  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const slots = byWeekday.get(cursor.getDay());
    if (!slots) continue;

    for (const slot of slots) {
      out.push({
        group,
        slot,
        date: toIsoDate(cursor),
        startsAt: atTime(cursor, slot.startTime),
      });
      if (out.length >= cap) return sortOccurrences(out);
    }
  }

  return sortOccurrences(out);
}

/** Same expansion across several groups -- a student's or teacher's calendar. */
export function occurrencesForGroups(
  groups: GroupRow[],
  range: OccurrenceRange = {},
): SessionOccurrence[] {
  const all = groups.flatMap((g) => occurrencesForGroup(g, range));
  return sortOccurrences(all).slice(0, range.limit ?? MAX_OCCURRENCES);
}

/** The next lessons from now, in chronological order. */
export function upcomingOccurrences(groups: GroupRow[], limit = 5): SessionOccurrence[] {
  const now = new Date();
  return occurrencesForGroups(groups, { from: toIsoDate(now) })
    .filter((o) => o.startsAt >= now)
    .slice(0, limit);
}

/** True when the group's term covers the given date (defaults to today). */
export function isGroupRunning(group: GroupRow, on: Date = new Date()): boolean {
  if (!group.startDate) return false;
  const day = fromIsoDate(toIsoDate(on));
  if (day < fromIsoDate(group.startDate)) return false;
  if (group.endDate && day > fromIsoDate(group.endDate)) return false;
  return true;
}

function sortOccurrences(list: SessionOccurrence[]): SessionOccurrence[] {
  return list.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export { toIsoDate };
