import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarClock, Search } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RequireAuth } from "@/features/auth/require-auth";
import { useStudentPortal } from "@/features/school/student-portal";
import { toIsoDate, weekdayLabel, type SessionOccurrence } from "@/features/school/schedule";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/schedule")({
  head: () => ({
    meta: [
      { title: "Mon emploi du temps — Gestion École" },
      { name: "description", content: "Votre emploi du temps hebdomadaire." },
    ],
  }),
  component: () => (
    <RequireAuth roles={["student"]}>
      <SchedulePage />
    </RequireAuth>
  ),
});

/** Answers exactly one question: when are my classes this week? */
function SchedulePage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { occurrences, isLoading, isFetching, error, refetch } = useStudentPortal(user?.id);

  // Grouped by real date: each heading is an actual day the student attends,
  // not a recurring weekday. Occurrences already arrive in chronological order.
  const byDate = useMemo(() => {
    const map = new Map<string, SessionOccurrence[]>();
    for (const o of occurrences) {
      const list = map.get(o.date) ?? [];
      list.push(o);
      map.set(o.date, list);
    }
    return map;
  }, [occurrences]);

  const dates = [...byDate.keys()].sort();
  const todayIso = toIsoDate(new Date());

  const header = (
    <PageHeader
      title={t("schedule.title")}
      description={t("schedule.description", { count: String(occurrences.length) })}
    />
  );

  if (error) {
    return (
      <>
        {header}
        <ErrorState error={error} onRetry={refetch} isRetrying={isFetching} />
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        {header}
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      </>
    );
  }

  if (occurrences.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={CalendarClock}
          title={t("schedule.emptyTitle")}
          description={t("schedule.emptyBody")}
          action={
            <Button asChild className="mt-2 rounded-xl">
              <Link to="/dashboard/registration">
                <Search className="size-4" aria-hidden />
                {t("myReg.browse")}
              </Link>
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      <div className="space-y-4">
        {dates.map((date) => (
          <SectionCard
            key={date}
            title={`${weekdayLabel(new Date(`${date}T00:00:00`).getDay(), t)} ${formatDate(date, locale)}`}
            description={
              date === todayIso
                ? t("schedule.today")
                : t("schedule.sessionCount", { count: String(byDate.get(date)?.length ?? 0) })
            }
          >
            <ul className="divide-y divide-border">
              {(byDate.get(date) ?? []).map((o) => (
                <li
                  key={`${date}-${o.slot.id}`}
                  className={cn(
                    "flex items-center justify-between gap-3 py-3",
                    date === todayIso && "rounded-lg bg-primary-soft/30 px-2",
                  )}
                >
                  <div className="min-w-0">
                    <Link
                      to="/dashboard/my-classes"
                      className="focus-ring block truncate rounded text-sm font-medium hover:text-primary"
                    >
                      {o.group.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {o.group.subjectName ?? "—"} · {o.slot.room ?? t("dash.section.noRoom")}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-lg bg-primary-soft px-2.5 py-1 text-xs font-medium tabular-nums text-primary">
                    {o.slot.startTime.slice(0, 5)} – {o.slot.endTime.slice(0, 5)}
                  </span>
                </li>
              ))}
            </ul>
          </SectionCard>
        ))}
      </div>
    </>
  );
}
