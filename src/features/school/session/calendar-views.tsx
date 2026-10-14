/**
 * Week, month and agenda views for the session calendar.
 *
 * LAYOUT CONTRACT
 *
 * The grid is FLUID, never wider than its container. An earlier version set
 * `min-width: 62rem` and let the card scroll horizontally; at 1280px and below
 * that pushed the last column off-screen and chips appeared clipped at the edge
 * of the Sunday cell. Seven equal `minmax(0, 1fr)` tracks plus `min-w-0` on every
 * cell means a long group name shrinks and ellipsises instead of widening its
 * track -- `1fr` alone is NOT enough, because its implicit `auto` minimum lets
 * content force the track wider.
 *
 * Below the `lg` breakpoint the week grid stops being readable at seven columns,
 * so it is replaced by a single-day agenda with a date strip rather than being
 * squeezed or made scrollable.
 *
 * Weekday and month names come from `Intl` with the active locale, so Arabic and
 * English are correct without a second translation table.
 */

import { useI18n } from "@/hooks/use-i18n";
import { groupByDate, groupByTimeSlot } from "./status";
import { SessionCard } from "./session-card";
import { fromIso, isSameMonth, monthGrid, weekDays } from "./calendar-range";
import type { SessionInstance } from "./types";
import { cn } from "@/lib/utils";

/** Intl tag. Arabic uses Latin digits so dates stay scannable, per `lib/format.ts`. */
function tag(locale: string): string {
  return locale === "ar" ? "ar-DZ-u-nu-latn" : locale === "en" ? "en-GB" : "fr-FR";
}

/** Seven equal, shrinkable tracks. The `minmax(0, ...)` is what allows truncation. */
const SEVEN_COLS = { gridTemplateColumns: "repeat(7, minmax(0, 1fr))" } as const;

/**
 * A time range, forced to read start-to-end in every locale.
 *
 * "14:00 – 16:00" is bidi-NEUTRAL: under `dir="rtl"` the browser reorders it to
 * "16:00 – 14:00", which silently states the wrong times. `dir="ltr"` on the
 * span isolates the run so the clock reads correctly in Arabic while the
 * surrounding layout stays mirrored. `unicode-bidi: isolate` (Tailwind's
 * `isolate` is a z-index utility, hence the inline style) keeps it from
 * affecting neighbouring text.
 */
function TimeRange({ slot, className }: { slot: string; className?: string }) {
  const [start, end] = slot.split("-");
  return (
    <span dir="ltr" style={{ unicodeBidi: "isolate" }} className={className}>
      {start} – {end}
    </span>
  );
}

/**
 * Chips shown per month cell before collapsing into "+N".
 *
 * Adaptive rather than fixed: a centre where one group meets per day wants a
 * compact grid, but a Saturday with eight parallel groups showing "3 + 17 autres"
 * hides the day rather than summarising it. The limit follows the BUSIEST day in
 * the month, so every cell keeps a consistent height while a busy month simply
 * gets taller rows. Capped so one outlier day cannot stretch the grid without
 * bound.
 */
function chipLimit(busiest: number): number {
  if (busiest <= 3) return 3;
  if (busiest <= 6) return busiest;
  return 6;
}

/* -------------------------------- WEEK -------------------------------- */

export function WeekView({
  anchor,
  sessions,
  today,
  onOpen,
}: {
  anchor: string;
  sessions: SessionInstance[];
  today: string;
  onOpen: (s: SessionInstance) => void;
}) {
  const { locale, t } = useI18n();
  const days = weekDays(anchor);
  const byDate = groupByDate(sessions);
  const dayFmt = new Intl.DateTimeFormat(tag(locale), { weekday: "short" });

  return (
    <div className="surface-card overflow-hidden">
      {/* Header strip */}
      <div className="grid border-b border-border" style={SEVEN_COLS}>
        {days.map((d) => {
          const isToday = d === today;
          const count = byDate.get(d)?.length ?? 0;
          return (
            <div
              key={d}
              className={cn(
                "flex min-w-0 items-center justify-between gap-1.5 border-e border-border px-2 py-2 last:border-e-0 sm:px-3",
                isToday && "bg-primary-soft",
              )}
            >
              <div className="min-w-0">
                <p
                  className={cn(
                    "truncate text-[10.5px] font-semibold uppercase tracking-wide",
                    isToday ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {dayFmt.format(fromIso(d))}
                </p>
                <p
                  className={cn(
                    "text-[15px] font-semibold tabular-nums leading-tight",
                    isToday &&
                      "grid size-6 place-items-center rounded-full bg-primary text-primary-foreground",
                  )}
                >
                  {Number(d.slice(8, 10))}
                </p>
              </div>
              {count > 0 && (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                  {count}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Body */}
      <div className="grid" style={SEVEN_COLS}>
        {days.map((d) => {
          const slots = groupByTimeSlot(byDate.get(d) ?? []);
          return (
            <div
              key={d}
              className={cn(
                "min-w-0 space-y-2.5 border-e border-border p-1.5 last:border-e-0 sm:p-2",
                "min-h-80",
                d === today && "bg-primary-soft/25",
              )}
            >
              {slots.size === 0 ? (
                <p className="pt-6 text-center text-sm text-muted-foreground/50">—</p>
              ) : (
                [...slots.entries()].map(([slot, list]) => (
                  <div key={slot} className="min-w-0">
                    <div className="mb-1 min-w-0 px-0.5">
                      <TimeRange
                        slot={slot}
                        className="block truncate text-[10.5px] font-bold tabular-nums"
                      />
                      {list.length > 1 && (
                        <p className="truncate text-[10px] text-muted-foreground">
                          {t("entity.session.parallelCount", { count: list.length })}
                        </p>
                      )}
                    </div>
                    {/* A start-edge rule groups parallel cards without merging
                        them. Logical, so it flips under RTL. */}
                    <div
                      className={cn(
                        "min-w-0 space-y-1.5",
                        list.length > 1 && "border-s-2 border-border ps-1.5",
                      )}
                    >
                      {list.map((s) => (
                        <SessionCard key={s.key} session={s} onOpen={onOpen} />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------- MONTH -------------------------------- */

export function MonthView({
  anchor,
  sessions,
  today,
  onOpen,
}: {
  anchor: string;
  sessions: SessionInstance[];
  today: string;
  onOpen: (s: SessionInstance) => void;
}) {
  const { locale, t } = useI18n();
  const cells = monthGrid(anchor);
  const byDate = groupByDate(sessions);
  const dayFmt = new Intl.DateTimeFormat(tag(locale), { weekday: "short" });

  // Header labels come from the FIRST ROW of the same grid, so they cannot drift
  // out of alignment with the body columns at any width.
  const headers = cells.slice(0, 7);

  let busiest = 0;
  for (const d of cells) busiest = Math.max(busiest, byDate.get(d)?.length ?? 0);
  const limit = chipLimit(busiest);

  // Trailing all-empty weeks are dropped: a fixed 6-row grid left a large blank
  // band in most months, which is the "huge empty area" this addresses. At least
  // five rows are kept so the height stays stable across most months.
  const weeks: string[][] = [];
  for (let i = 0; i < 42; i += 7) weeks.push(cells.slice(i, i + 7));
  while (weeks.length > 5) {
    const last = weeks[weeks.length - 1] as string[];
    const empty = last.every((d) => !byDate.get(d)?.length && !isSameMonth(d, anchor));
    if (!empty) break;
    weeks.pop();
  }

  return (
    <div className="surface-card overflow-hidden">
      <div className="grid border-b border-border" style={SEVEN_COLS}>
        {headers.map((d) => (
          <div
            key={d}
            className="min-w-0 border-e border-border px-1 py-1.5 text-center last:border-e-0"
          >
            <p className="truncate text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              {dayFmt.format(fromIso(d))}
            </p>
          </div>
        ))}
      </div>

      <div className="grid" style={SEVEN_COLS}>
        {weeks.flat().map((d) => {
          const dayS = byDate.get(d) ?? [];
          const outside = !isSameMonth(d, anchor);
          const isToday = d === today;
          const shown = dayS.slice(0, limit);
          const extra = dayS.length - shown.length;
          return (
            <div
              key={d}
              className={cn(
                "min-w-0 space-y-1 overflow-hidden border-b border-e border-border p-1 last:border-e-0",
                // Compact base height, but the row grows when a day is busy.
                "min-h-21",
                isToday && "bg-primary-soft/35",
                outside && "bg-muted/25",
              )}
            >
              <p
                className={cn(
                  "px-0.5 text-[11px] font-semibold tabular-nums leading-none",
                  outside ? "text-muted-foreground/45" : "text-foreground",
                  isToday &&
                    "grid size-4.5 place-items-center rounded-full bg-primary text-primary-foreground",
                )}
              >
                {Number(d.slice(8, 10))}
              </p>
              {shown.map((s) => (
                <SessionCard key={s.key} session={s} onOpen={onOpen} compact />
              ))}
              {extra > 0 && (
                <p className="truncate px-1 text-[10px] font-medium text-muted-foreground">
                  {t(
                    extra === 1
                      ? "entity.session.moreSessions"
                      : "entity.session.moreSessionsPlural",
                    { count: extra },
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------- AGENDA -------------------------------- */

/**
 * Single-day agenda for narrow screens.
 *
 * A seven-column grid below ~1024px gives each day ~100px, which cannot hold a
 * group name. Rather than squeeze it or push the page sideways, the week becomes
 * a date strip plus one day's sessions at full width.
 */
export function AgendaView({
  anchor,
  selected,
  onSelect,
  sessions,
  today,
  onOpen,
}: {
  anchor: string;
  selected: string;
  onSelect: (date: string) => void;
  sessions: SessionInstance[];
  today: string;
  onOpen: (s: SessionInstance) => void;
}) {
  const { locale, t } = useI18n();
  const days = weekDays(anchor);
  const byDate = groupByDate(sessions);
  const dayFmt = new Intl.DateTimeFormat(tag(locale), { weekday: "narrow" });
  const fullFmt = new Intl.DateTimeFormat(tag(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const dayS = byDate.get(selected) ?? [];
  const slots = groupByTimeSlot(dayS);

  return (
    <div className="space-y-3">
      {/* Date strip: seven equal tap targets, each showing its session count. */}
      <div className="surface-card grid gap-1 p-1.5" style={SEVEN_COLS}>
        {days.map((d) => {
          const count = byDate.get(d)?.length ?? 0;
          const isSel = d === selected;
          const isToday = d === today;
          return (
            <button
              key={d}
              type="button"
              onClick={() => onSelect(d)}
              aria-pressed={isSel}
              className={cn(
                "focus-ring flex min-w-0 flex-col items-center gap-0.5 rounded-lg py-1.5 transition-colors",
                isSel ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              <span className="text-[10px] font-medium uppercase opacity-80">
                {dayFmt.format(fromIso(d))}
              </span>
              <span
                className={cn(
                  "text-[13px] font-semibold tabular-nums",
                  !isSel && isToday && "text-primary",
                )}
              >
                {Number(d.slice(8, 10))}
              </span>
              <span
                className={cn(
                  "size-1 rounded-full",
                  count > 0 ? (isSel ? "bg-primary-foreground" : "bg-primary") : "bg-transparent",
                )}
                aria-hidden
              />
            </button>
          );
        })}
      </div>

      <div className="surface-card p-3">
        <p className="mb-2.5 text-[13px] font-semibold capitalize">
          {fullFmt.format(fromIso(selected))}
        </p>
        {slots.size === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("entity.session.noSessions")}
          </p>
        ) : (
          <div className="space-y-3">
            {[...slots.entries()].map(([slot, list]) => (
              <div key={slot} className="min-w-0">
                <div className="mb-1 flex items-baseline gap-2">
                  <TimeRange slot={slot} className="text-[11px] font-bold tabular-nums" />
                  {list.length > 1 && (
                    <p className="truncate text-[10px] text-muted-foreground">
                      {t("entity.session.parallelCount", { count: list.length })}
                    </p>
                  )}
                </div>
                <div
                  className={cn(
                    "min-w-0 space-y-1.5",
                    list.length > 1 && "border-s-2 border-border ps-2",
                  )}
                >
                  {list.map((s) => (
                    <SessionCard key={s.key} session={s} onOpen={onOpen} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
