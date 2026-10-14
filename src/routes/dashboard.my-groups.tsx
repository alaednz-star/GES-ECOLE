import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarClock, ClipboardCheck, GraduationCap, Users } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { RequireAuth } from "@/features/auth/require-auth";
import { useTeacherWorkspace } from "@/features/school/teacher-workspace";
import { weekdayLabel } from "@/features/school/schedule";
import { useI18n } from "@/hooks/use-i18n";

export const Route = createFileRoute("/dashboard/my-groups")({
  head: () => ({
    meta: [
      { title: "Mes groupes — Gestion École" },
      { name: "description", content: "Vos groupes, effectifs, horaires et présences." },
    ],
  }),
  component: () => (
    <RequireAuth roles={["teacher", "admin"]}>
      <MyGroupsPage />
    </RequireAuth>
  ),
});

/**
 * The teacher's groups, as operational cards.
 *
 * This is where the reference figures live -- enrolment, weekly hours, next
 * session -- so the workspace can stay focused on today's work. It reads from
 * `useTeacherWorkspace`, the same hook the workspace uses, so a group cannot
 * report one enrolment here and another there.
 */
function MyGroupsPage() {
  const { t } = useI18n();
  const ws = useTeacherWorkspace();

  if (ws.isLoading) {
    return (
      <>
        <PageHeader title={t("menu.myGroups")} description={t("myGroups.description")} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-56 w-full rounded-2xl" />
          ))}
        </div>
      </>
    );
  }

  if (ws.error) {
    return (
      <>
        <PageHeader title={t("menu.myGroups")} description={t("myGroups.description")} />
        <ErrorState error={ws.error} onRetry={ws.refetch} isRetrying={ws.isFetching} />
      </>
    );
  }

  if (ws.cards.length === 0) {
    return (
      <>
        <PageHeader title={t("menu.myGroups")} description={t("myGroups.description")} />
        <EmptyState
          icon={GraduationCap}
          title={t("myGroups.emptyTitle")}
          description={t("myGroups.emptyBody")}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("menu.myGroups")}
        description={t("myGroups.summary", {
          groups: String(ws.cards.length),
          students: String(ws.totalStudents),
          hours: String(Math.round(ws.weeklyMinutes / 60)),
        })}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ws.cards.map((c) => {
          const fill = Math.min(100, (c.studentCount / Math.max(1, c.group.maxStudents)) * 100);
          return (
            <article key={c.group.id} className="surface-card flex flex-col gap-4 p-5">
              <header className="min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="min-w-0 truncate text-base font-semibold tracking-tight">
                    {c.group.name}
                  </h2>
                  {c.pendingAttendance > 0 && (
                    <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-accent">
                      {t("myGroups.pendingBadge", { count: String(c.pendingAttendance) })}
                    </span>
                  )}
                </div>
                <p className="truncate text-sm text-muted-foreground">
                  {c.group.subjectName ?? "—"}
                  {c.group.levelName ? ` · ${c.group.levelName}` : ""}
                </p>
              </header>

              <dl className="space-y-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <dt className="flex items-center gap-2 text-muted-foreground">
                    <Users className="size-4" aria-hidden />
                    {t("myGroups.enrolment")}
                  </dt>
                  <dd className="font-medium tabular-nums">
                    {c.studentCount} / {c.group.maxStudents}
                  </dd>
                </div>
                <Progress value={fill} className="h-1.5" />

                <div className="flex items-center justify-between gap-2 pt-1">
                  <dt className="flex items-center gap-2 text-muted-foreground">
                    <CalendarClock className="size-4" aria-hidden />
                    {t("myGroups.weeklyHours")}
                  </dt>
                  <dd className="font-medium tabular-nums">
                    {t("myGroups.hoursValue", {
                      hours: String(Math.round((c.weeklyMinutes / 60) * 10) / 10),
                    })}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">{t("myGroups.nextSession")}</dt>
                  <dd className="truncate font-medium tabular-nums">
                    {c.next
                      ? `${weekdayLabel(c.next.startsAt.getDay(), t)} ${c.next.slot.startTime.slice(0, 5)}`
                      : t("myGroups.noNext")}
                  </dd>
                </div>
              </dl>

              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <Button asChild size="sm" className="rounded-lg">
                  <Link to="/dashboard/attendance">
                    <ClipboardCheck className="size-3.5" aria-hidden />
                    {t("teacher.markAttendance")}
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline" className="rounded-lg">
                  <Link to="/dashboard/groups/$groupId" params={{ groupId: c.group.id }}>
                    {t("myGroups.openGroup")}
                  </Link>
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
