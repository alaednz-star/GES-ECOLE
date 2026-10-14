import { Link } from "@tanstack/react-router";
import { ClipboardCheck, DoorOpen, GraduationCap, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { sessionKey } from "@/features/school/session/session-key";
import type { SessionOccurrence } from "@/features/school/schedule";

export type SessionState = "upcoming" | "running" | "finished";

/**
 * Where a session sits relative to now.
 *
 * Exported because the timeline colours its rows by the same rule -- one
 * definition, so a session cannot read "in progress" in one widget and
 * "finished" in another.
 */
export function sessionState(o: SessionOccurrence, now: Date = new Date()): SessionState {
  const end = new Date(o.startsAt);
  const [h, m] = o.slot.endTime.split(":").map(Number);
  end.setHours(h ?? 0, m ?? 0, 0, 0);
  if (now < o.startsAt) return "upcoming";
  if (now <= end) return "running";
  return "finished";
}

/** Morning / afternoon / evening. Small touch, but it makes the page feel addressed to a person. */
export function greetingKey(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "teacher.greet.morning";
  if (h < 18) return "teacher.greet.afternoon";
  return "teacher.greet.evening";
}

/** Split into value + unit so the number can carry the type weight. */
function countdownParts(target: Date, now: Date): { value: string; unitKey: string } | null {
  const mins = Math.round((target.getTime() - now.getTime()) / 60000);
  if (mins <= 0) return null;
  if (mins < 60) return { value: String(mins), unitKey: "teacher.unit.minutes" };
  const h = Math.floor(mins / 60);
  const rest = mins % 60;
  if (h < 24) {
    return rest === 0
      ? { value: String(h), unitKey: "teacher.unit.hours" }
      : { value: `${h}h${String(rest).padStart(2, "0")}`, unitKey: "teacher.unit.away" };
  }
  return { value: String(Math.round(h / 24)), unitKey: "teacher.unit.days" };
}

/**
 * The workspace anchor.
 *
 * Answers "where do I go next, and can I start from here?" in one glance. The
 * layout is a two-column band on desktop -- identity on the left, the countdown
 * as a single large numeral on the right -- so the width is used by content
 * rather than padding. Below `md` it stacks with the countdown first, because on
 * a phone the remaining time is the thing being checked between classes.
 */
export function NextClassHero({
  occurrence,
  studentCount,
  teacherName,
  sessionsToday,
  sessionsDone,
  now = new Date(),
}: {
  occurrence: SessionOccurrence;
  studentCount: number;
  teacherName: string;
  /** Today's totals: fill the countdown column with the day's shape. */
  sessionsToday: number;
  sessionsDone: number;
  now?: Date;
}) {
  const { t } = useI18n();
  const state = sessionState(occurrence, now);
  const { group, slot } = occurrence;
  const countdown = state === "upcoming" ? countdownParts(occurrence.startsAt, now) : null;

  const facts = [
    { icon: GraduationCap, label: t("teacher.subject"), value: group.subjectName ?? "—" },
    { icon: Users, label: t("teacher.students"), value: String(studentCount) },
    { icon: DoorOpen, label: t("teacher.room"), value: slot.room ?? t("dash.section.noRoom") },
  ];

  return (
    <section aria-labelledby="hero-heading" className="surface-hero overflow-hidden">
      {/* The greeting is the page's only h1: the hero replaces the old
          PageHeader rather than sitting beneath a second, differently-worded
          welcome. */}
      <div className="border-b border-border/50 px-5 pt-5 pb-4 sm:px-7">
        <h1 id="hero-heading" className="text-xl font-semibold tracking-tight sm:text-2xl">
          {t(greetingKey(now), { name: teacherName })}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("teacher.workspaceLead")}</p>
      </div>

      <div className="grid gap-x-10 gap-y-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-stretch">
        <div className="order-2 min-w-0 space-y-4 lg:order-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                state === "running"
                  ? "bg-primary text-primary-foreground"
                  : "bg-primary-soft text-primary"
              }`}
            >
              {state === "running" && (
                <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />
              )}
              {state === "running" ? t("teacher.currentClass") : t("teacher.nextClass")}
            </span>
            <span className="text-sm font-medium tabular-nums text-muted-foreground">
              {slot.startTime.slice(0, 5)} – {slot.endTime.slice(0, 5)}
            </span>
          </div>

          <div className="min-w-0">
            <p className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
              {group.name}
            </p>
            {group.levelName && (
              <p className="mt-0.5 text-sm text-muted-foreground">{group.levelName}</p>
            )}
          </div>

          {/* Facts grouped on one rule rather than scattered as separate labels. */}
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border/60 pt-4">
            {facts.map((f) => (
              <div key={f.label} className="flex items-center gap-2">
                <f.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <dt className="sr-only">{f.label}</dt>
                <dd className="text-sm font-medium">{f.value}</dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild className="h-11 rounded-xl px-5 shadow-sm">
              <Link
                to="/dashboard/attendance"
                search={{
                  date: occurrence.date,
                  session: sessionKey(occurrence.group.id, occurrence.date),
                }}
              >
                <ClipboardCheck className="size-4" aria-hidden />
                {t("teacher.markAttendance")}
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-11 rounded-xl">
              <Link to="/dashboard/groups/$groupId" params={{ groupId: group.id }}>
                {t("teacher.viewGroup")}
              </Link>
            </Button>
            <Button asChild variant="ghost" className="h-11 rounded-xl">
              <Link to="/dashboard/my-students">{t("teacher.viewStudents")}</Link>
            </Button>
          </div>
        </div>

        {/* Right column: countdown over the day's totals, separated from the
            identity block by a hairline rather than a boxed panel -- a card
            inside the hero re-introduced exactly the border noise this pass is
            removing. */}
        <aside className="order-1 flex flex-col justify-center gap-3 lg:order-2 lg:border-s lg:border-border/50 lg:ps-8">
          <div className="text-center">
            {countdown ? (
              <>
                <p className="text-6xl font-semibold leading-none tracking-tighter tabular-nums text-primary">
                  {countdown.value}
                </p>
                <p className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">
                  {t(countdown.unitKey)}
                </p>
              </>
            ) : (
              <>
                <p className="text-2xl font-semibold leading-tight text-primary">
                  {t("teacher.state.running")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t("teacher.inProgressHint")}</p>
              </>
            )}
          </div>

          {/* Progress reads as a fraction, not two disconnected numbers: "0/2"
              answers "how much of today is behind me?" in one glance. */}
          <p className="text-center text-xs text-muted-foreground">
            <span className="font-semibold tabular-nums text-foreground">{sessionsDone}</span>
            <span className="mx-0.5">/</span>
            <span className="tabular-nums">{sessionsToday}</span> {t("teacher.sessionsDoneToday")}
          </p>
        </aside>
      </div>
    </section>
  );
}
