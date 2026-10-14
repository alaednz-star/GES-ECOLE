/**
 * Week / month window arithmetic for the session calendar. PURE.
 *
 * Kept separate from the React layer so the boundary cases -- month rollovers,
 * leap days, the 6-week grid -- are unit-testable without rendering anything.
 *
 * Every date here is a LOCAL ISO `YYYY-MM-DD` string. Never `toISOString()`,
 * which converts to UTC first and returns tomorrow anywhere east of Greenwich
 * after ~22:00. In an attendance system a day's drift is a silent data bug, and
 * `lib/format.ts` already documents this for the same reason.
 */

export type CalendarView = "week" | "month";

export interface DateWindow {
  /** Inclusive local ISO date. */
  from: string;
  /** Inclusive local ISO date. */
  to: string;
}

/** Local ISO date for a Date. */
export function toIso(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Parses `YYYY-MM-DD` as LOCAL midnight, not UTC. */
export function fromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Adds days, crossing month and year boundaries correctly. */
export function addDays(iso: string, days: number): string {
  const d = fromIso(iso);
  d.setDate(d.getDate() + days);
  return toIso(d);
}

/** Adds months, clamping the day so 31 Jan + 1 month is 28/29 Feb, not 3 Mar. */
export function addMonths(iso: string, months: number): string {
  const d = fromIso(iso);
  const targetDay = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(targetDay, lastDay));
  return toIso(d);
}

/**
 * Start of the week containing `iso`.
 *
 * `weekStartsOn` is a parameter rather than a constant because the calendar is
 * shown in three locales: Algerian/Arabic weeks conventionally begin Saturday or
 * Sunday, French ones Monday. Defaults to Monday to match the reference layout.
 */
export function startOfWeek(iso: string, weekStartsOn = 1): string {
  const d = fromIso(iso);
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  return addDays(iso, -diff);
}

/** First day of the month containing `iso`. */
export function startOfMonth(iso: string): string {
  const d = fromIso(iso);
  return toIso(new Date(d.getFullYear(), d.getMonth(), 1));
}

/** Last day of the month containing `iso`. */
export function endOfMonth(iso: string): string {
  const d = fromIso(iso);
  return toIso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/**
 * The window a view needs to FETCH.
 *
 * For a month this deliberately spans the whole 6-week grid, not just the
 * calendar month: the grid shows trailing days of the previous month and leading
 * days of the next, and a session on one of those days must appear rather than
 * silently vanish because the query stopped at the month edge.
 */
export function windowFor(anchor: string, view: CalendarView, weekStartsOn = 1): DateWindow {
  if (view === "week") {
    const from = startOfWeek(anchor, weekStartsOn);
    return { from, to: addDays(from, 6) };
  }
  const gridStart = startOfWeek(startOfMonth(anchor), weekStartsOn);
  // 6 weeks always covers a month: 31 days plus at most 6 leading days = 37 <= 42.
  return { from: gridStart, to: addDays(gridStart, 41) };
}

/** The seven dates of a week, in display order. */
export function weekDays(anchor: string, weekStartsOn = 1): string[] {
  const start = startOfWeek(anchor, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/**
 * The 42 cells of a month grid, in display order.
 *
 * Always 6 rows so the grid does not change height between months -- a shifting
 * container is far more distracting than one blank row.
 */
export function monthGrid(anchor: string, weekStartsOn = 1): string[] {
  const { from } = windowFor(anchor, "month", weekStartsOn);
  return Array.from({ length: 42 }, (_, i) => addDays(from, i));
}

/** True when `iso` falls inside the month that `anchor` belongs to. */
export function isSameMonth(iso: string, anchor: string): boolean {
  return iso.slice(0, 7) === anchor.slice(0, 7);
}

/** Steps the anchor by one period in the active view. */
export function step(anchor: string, view: CalendarView, direction: -1 | 1): string {
  return view === "week" ? addDays(anchor, 7 * direction) : addMonths(anchor, direction);
}
