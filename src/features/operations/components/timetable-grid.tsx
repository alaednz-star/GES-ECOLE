/**
 * The weekly timetable grid (ADR-007): one column per day of the Algerian school week (Saturday
 * first), one row per hour, blocks positioned by time and laid out side by side when they
 * overlap (timetable-model.ts). On a phone the same blocks are listed day by day.
 */

import { useI18n } from "@/hooks/use-i18n";
import { weekdayLabel } from "@/features/school/schedule";
import { cn } from "@/lib/utils";
import { WEEK_ORDER, hourRange, type TimetableBlock } from "../timetable-model";

const HOUR_PX = 56;

export function TimetableGrid({
  blocks,
  printable = false,
}: {
  blocks: readonly TimetableBlock[];
  /** Documents layout: always the grid (no phone list), compact. */
  printable?: boolean;
}) {
  const { t } = useI18n();
  const { from, to } = hourRange(blocks);
  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  const days = WEEK_ORDER.filter(
    (d) => d !== 5 || blocks.some((b) => b.weekday === 5), // Friday only when used
  );
  const height = (to - from) * HOUR_PX;

  const block = (b: TimetableBlock) => (
    <div
      key={b.slotId}
      data-testid="timetable-block"
      className="absolute overflow-hidden rounded-md border border-primary/30 bg-primary-soft px-1.5 py-1 text-[11px] leading-tight text-foreground"
      style={{
        top: ((b.start - from * 60) / 60) * HOUR_PX,
        height: Math.max(((b.end - b.start) / 60) * HOUR_PX - 2, 18),
        insetInlineStart: `calc(${(b.lane / b.lanes) * 100}% + 2px)`,
        width: `calc(${100 / b.lanes}% - 4px)`,
        borderInlineStartColor: b.color ?? undefined,
        borderInlineStartWidth: 3,
      }}
      title={`${b.groupName} · ${b.startTime}–${b.endTime}`}
    >
      <p className="truncate font-semibold">{b.groupName}</p>
      <p className="truncate tabular-nums text-muted-foreground" dir="ltr">
        {b.startTime}–{b.endTime}
      </p>
      {b.teacherName && <p className="truncate text-muted-foreground">{b.teacherName}</p>}
      <p className="truncate text-muted-foreground">{b.room ?? t("timetable.noRoom")}</p>
    </div>
  );

  return (
    <>
      <div
        className={cn("overflow-x-auto", !printable && "hidden md:block")}
        data-testid="timetable-grid"
      >
        <div className="min-w-[760px]">
          <div
            className="grid"
            style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(0, 1fr))` }}
          >
            <div />
            {days.map((d) => (
              <div
                key={d}
                className="border-b border-border px-1 pb-1 text-center text-xs font-semibold"
              >
                {weekdayLabel(d, t)}
              </div>
            ))}
          </div>
          <div
            className="grid"
            style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(0, 1fr))` }}
          >
            <div className="relative" style={{ height }}>
              {hours.map((h, i) => (
                <span
                  key={h}
                  className="absolute -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                  style={{ top: i * HOUR_PX + (i === 0 ? 6 : 0) }}
                  dir="ltr"
                >
                  {String(h).padStart(2, "0")}:00
                </span>
              ))}
            </div>
            {days.map((d) => (
              <div
                key={d}
                className="relative border-s border-border"
                style={{
                  height,
                  backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px ${HOUR_PX}px)`,
                }}
              >
                {blocks.filter((b) => b.weekday === d).map(block)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {!printable && (
        <ul className="space-y-3 md:hidden" data-testid="timetable-list">
          {days
            .filter((d) => blocks.some((b) => b.weekday === d))
            .map((d) => (
              <li key={d}>
                <p className="mb-1 text-xs font-semibold">{weekdayLabel(d, t)}</p>
                <ul className="space-y-1">
                  {blocks
                    .filter((b) => b.weekday === d)
                    .sort((a, b) => a.start - b.start)
                    .map((b) => (
                      <li
                        key={b.slotId}
                        className="surface-row flex items-center justify-between gap-2 px-3 py-2 text-xs"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{b.groupName}</span>
                          <span className="block truncate text-muted-foreground">
                            {[b.teacherName, b.room ?? t("timetable.noRoom")]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums" dir="ltr">
                          {b.startTime}–{b.endTime}
                        </span>
                      </li>
                    ))}
                </ul>
              </li>
            ))}
        </ul>
      )}
    </>
  );
}
