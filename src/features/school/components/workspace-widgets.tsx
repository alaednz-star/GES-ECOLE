import { Link } from "@tanstack/react-router";
import { ArrowRight, CalendarClock, CalendarDays, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/empty-state";
import { useI18n } from "@/hooks/use-i18n";
import { sessionKey } from "@/features/school/session/session-key";
import { weekdayLabel, type SessionOccurrence } from "@/features/school/schedule";
import { sessionState } from "./next-class-hero";

/** Local-timezone ISO date; `toISOString` shifts across the UTC boundary. */
function isoDate(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function minutesOf(slot: { startTime: string; endTime: string }): number {
  const [sh, sm] = slot.startTime.split(":").map(Number);
  const [eh, em] = slot.endTime.split(":").map(Number);
  return Math.max(0, (eh ?? 0) * 60 + (em ?? 0) - ((sh ?? 0) * 60 + (sm ?? 0)));
}

/**
 * Today, as a real timeline.
 *
 * A rail runs down the left with a node per session, so the day reads as a
 * sequence rather than a list of equal rows. The three states are carried by
 * weight, not just colour: finished recedes and strikes its time, current sits
 * on a glowing card, upcoming stays quiet but legible.
 */
export function TodayTimeline({
  occurrences,
  isMarked,
  studentCountFor,
  now = new Date(),
}: {
  occurrences: SessionOccurrence[];
  isMarked: (o: SessionOccurrence) => boolean;
  studentCountFor: (groupId: string) => number;
  now?: Date;
}) {
  const { t } = useI18n();

  return (
    <SectionCard
      variant="quiet"
      title={t("teacher.todayTitle")}
      description={weekdayLabel(now.getDay(), t)}
    >
      {occurrences.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={t("teacher.noSessionTitle")}
          description={t("teacher.noSessionBody")}
          className="border-none shadow-none"
        />
      ) : (
        <ol className="relative space-y-2.5">
          {occurrences.map((o, i) => {
            const state = sessionState(o, now);
            const marked = isMarked(o);
            const last = i === occurrences.length - 1;

            return (
              <li
                key={`${o.group.id}-${o.date}-${o.slot.startTime}`}
                className="relative flex gap-3"
              >
                {/* Rail: node + connector to the next session. */}
                <div className="relative flex w-4 shrink-0 justify-center pt-4">
                  <span
                    aria-hidden
                    className={`z-10 size-2.5 rounded-full ring-4 ring-card ${
                      state === "running"
                        ? "bg-primary"
                        : marked
                          ? "bg-success"
                          : state === "finished"
                            ? "bg-accent"
                            : "bg-border"
                    }`}
                  />
                  {!last && (
                    <span aria-hidden className="absolute top-6 -bottom-2.5 w-px bg-border" />
                  )}
                </div>

                {/* Only the running session gets a surface. Past and upcoming
                    rows sit on the panel itself, so the live one is the single
                    thing the eye lands on. */}
                <div
                  className={`flex min-w-0 flex-1 items-center gap-3 py-2 pe-1 ${
                    state === "running" ? "surface-live ps-3 pe-2.5" : "ps-0"
                  }`}
                >
                  <div className="w-14 shrink-0">
                    <p
                      className={`text-sm tabular-nums ${
                        state === "running"
                          ? "font-semibold text-primary"
                          : marked
                            ? "text-muted-foreground line-through decoration-1"
                            : "font-medium"
                      }`}
                    >
                      {o.slot.startTime.slice(0, 5)}
                    </p>
                    <p className="text-[11px] tabular-nums text-muted-foreground">
                      {t("teacher.minutesShort", { count: String(minutesOf(o.slot)) })}
                    </p>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-sm ${
                        state === "running"
                          ? "font-semibold text-primary"
                          : marked
                            ? "text-muted-foreground"
                            : "font-medium"
                      }`}
                    >
                      {o.group.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {o.group.subjectName ?? "—"} ·{" "}
                      {t("teacher.studentCount", { count: String(studentCountFor(o.group.id)) })}
                      {o.slot.room ? ` · ${o.slot.room}` : ""}
                    </p>
                  </div>

                  {marked ? (
                    <Check
                      className="size-4 shrink-0 text-success"
                      aria-label={t("teacher.attendanceDone")}
                    />
                  ) : state === "upcoming" ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t("teacher.state.upcoming")}
                    </span>
                  ) : (
                    // An outstanding register is an action, not a link: give it
                    // a real target even when the session is merely finished.
                    <Button
                      asChild
                      size="sm"
                      variant={state === "running" ? "default" : "outline"}
                      className="h-7 shrink-0 rounded-lg px-3 text-xs"
                    >
                      <Link
                        to="/dashboard/attendance"
                        search={{
                          date: o.date,
                          session: sessionKey(o.group.id, o.date),
                        }}
                      >
                        {state === "running"
                          ? t("teacher.markAttendance")
                          : t("teacher.completeNow")}
                      </Link>
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}

/**
 * Past sessions with no register.
 *
 * Nothing else in the product tells a teacher they forgot, so this is never
 * collapsed or hidden. An empty list is genuinely good news and says so.
 */
export function AttendancePending({
  occurrences,
  now = new Date(),
}: {
  occurrences: SessionOccurrence[];
  now?: Date;
}) {
  const { t } = useI18n();

  if (occurrences.length === 0) {
    return (
      <section className="surface-done flex items-center gap-3 px-5 py-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-success/12 text-success">
          <Check className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{t("teacher.pendingNoneTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("teacher.pendingNoneBody")}</p>
        </div>
      </section>
    );
  }

  return (
    <SectionCard
      variant="quiet"
      title={t("teacher.pendingTitle")}
      description={t("teacher.pendingDesc")}
      actions={
        <span className="rounded-full bg-accent/15 px-2.5 py-1 text-xs font-semibold tabular-nums text-accent">
          {occurrences.length}
        </span>
      }
    >
      {/* Capped at 4: a long backlog of near-identical amber rows pushes the
          week planner off-screen and stops reading as urgent. The count in the
          header carries the full total. */}
      {/* One tap target per row, so the whole line is clickable and no repeated
          button competes with the primary CTA in the hero. The age sits in a
          fixed right column: four rows of aligned "il y a N j" scan in one
          vertical sweep, where four buttons did not. */}
      <ul className="-mx-1">
        {occurrences.slice(0, 4).map((o) => {
          const days = Math.round((now.getTime() - o.startsAt.getTime()) / 86400000);
          const overdue = days >= 7;
          return (
            <li key={`${o.group.id}-${o.date}-${o.slot.startTime}`}>
              <Link
                to="/dashboard/attendance"
                search={{ date: o.date, session: sessionKey(o.group.id, o.date) }}
                className="focus-ring surface-alert group mb-1.5 flex items-center gap-3 py-2 ps-3 pe-2.5 transition-colors hover:bg-accent/12"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{o.group.name}</span>
                  <span className="block truncate text-xs text-muted-foreground tabular-nums">
                    {weekdayLabel(o.startsAt.getDay(), t)} {o.slot.startTime.slice(0, 5)}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-xs tabular-nums ${
                    overdue ? "font-semibold text-accent" : "text-muted-foreground"
                  }`}
                >
                  {days <= 0
                    ? t("teacher.pendingToday")
                    : t("teacher.pendingDaysAgo", { count: String(days) })}
                </span>
                <ArrowRight
                  className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none rtl:rotate-180"
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>

      {occurrences.length > 4 && (
        <Link
          to="/dashboard/attendance"
          // No single session here, so carry the INTENT instead: the filter that
          // shows exactly the outstanding registers this widget is summarising.
          search={{ toMark: true }}
          className="focus-ring mt-1 block rounded-lg py-1.5 text-center text-xs font-medium text-primary hover:underline"
        >
          {t("teacher.pendingSeeAll", { count: String(occurrences.length - 4) })}
        </Link>
      )}
    </SectionCard>
  );
}

/**
 * Seven-day planner built from real dated occurrences.
 *
 * Each day carries its session count and a load bar, so a heavy Thursday is
 * visible before reading a single group name. Never the weekly pattern: that
 * ignores term dates and would advertise classes for a finished term.
 */
export function WeekStrip({
  occurrences,
  isMarked,
  now = new Date(),
}: {
  occurrences: SessionOccurrence[];
  isMarked: (o: SessionOccurrence) => boolean;
  now?: Date;
}) {
  const { t } = useI18n();
  const today = isoDate(now);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const iso = isoDate(d);
    const items = occurrences.filter((o) => o.date === iso);
    return {
      iso,
      date: d,
      items,
      minutes: items.reduce((s, o) => s + minutesOf(o.slot), 0),
    };
  });

  const total = days.reduce((n, d) => n + d.items.length, 0);
  const busiest = Math.max(1, ...days.map((d) => d.minutes));

  return (
    <SectionCard variant="quiet" title={t("teacher.weekTitle")} description={t("teacher.weekDesc")}>
      {total === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={t("teacher.weekEmptyTitle")}
          description={t("teacher.weekEmptyBody")}
          className="border-none shadow-none"
        />
      ) : (
        <ul className="grid grid-cols-7 gap-1">
          {days.map((d) => {
            const isToday = d.iso === today;
            const done = d.items.filter(isMarked).length;
            return (
              // Columns, not boxes: no borders, aligned baselines, and a load
              // bar sitting on a shared rule. Today is marked by weight and a
              // single tinted pill, not by a coloured container.
              <li key={d.iso} className="flex flex-col items-center gap-2 py-1 text-center">
                <span
                  className={`text-[11px] font-medium uppercase tracking-wide ${
                    isToday ? "text-primary" : "text-muted-foreground/70"
                  }`}
                >
                  {weekdayLabel(d.date.getDay(), t).slice(0, 3)}
                </span>

                <span
                  className={`grid size-8 place-items-center rounded-full text-sm tabular-nums ${
                    isToday
                      ? "bg-primary font-semibold text-primary-foreground"
                      : d.items.length === 0
                        ? "font-normal text-muted-foreground/60"
                        : "font-medium text-foreground"
                  }`}
                >
                  {d.date.getDate()}
                </span>

                {/* Load bar relative to the busiest day: the week's shape reads
                    without comparing any numbers. */}
                <span className="flex h-8 w-full items-end justify-center">
                  {d.items.length === 0 ? (
                    <span aria-hidden className="mb-1 h-px w-4 bg-border" />
                  ) : (
                    <span
                      className={`w-1.5 rounded-full ${
                        done === d.items.length
                          ? "bg-success/60"
                          : isToday
                            ? "bg-primary"
                            : "bg-primary/35"
                      }`}
                      style={{ height: `${Math.max(20, (d.minutes / busiest) * 100)}%` }}
                    />
                  )}
                </span>

                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {d.items.length === 0
                    ? "—"
                    : t("teacher.daySessions", { count: String(d.items.length) })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
