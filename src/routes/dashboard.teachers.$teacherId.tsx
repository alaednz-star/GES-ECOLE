import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, CalendarClock, GraduationCap, Layers3, UserSquare2, Users } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { PersonAvatar } from "@/features/profile/person-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { RequireAuth } from "@/features/auth/require-auth";
import { useGroups, useTeachers } from "@/features/school/queries";
import { weeklySessions, weekdayLabel } from "@/features/school/schedule";
import { useI18n } from "@/hooks/use-i18n";

export const Route = createFileRoute("/dashboard/teachers/$teacherId")({
  head: () => ({ meta: [{ title: "Fiche enseignant — Gestion École" }] }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <TeacherDetailPage />
    </RequireAuth>
  ),
});

function TeacherDetailPage() {
  const { t } = useI18n();
  const { teacherId } = useParams({ from: "/dashboard/teachers/$teacherId" });

  const teachersQuery = useTeachers();
  const { data: groups = [] } = useGroups();

  const teacher = teachersQuery.data?.find((x) => x.id === teacherId);
  const myGroups = groups.filter((g) => g.teacherId === teacherId);
  const sessions = weeklySessions(myGroups);
  const students = myGroups.reduce((sum, g) => sum + g.enrolled, 0);
  const capacity = myGroups.reduce((sum, g) => sum + g.maxStudents, 0);
  const fillRate = capacity > 0 ? Math.round((students / capacity) * 100) : 0;

  if (teachersQuery.error) {
    return (
      <>
        <BackLink />
        <ErrorState
          error={teachersQuery.error}
          onRetry={() => void teachersQuery.refetch()}
          isRetrying={teachersQuery.isFetching}
        />
      </>
    );
  }

  if (teachersQuery.isLoading) {
    return (
      <>
        <BackLink />
        <Skeleton className="h-40 rounded-2xl" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      </>
    );
  }

  if (!teacher) {
    return (
      <>
        <BackLink />
        <EmptyState
          icon={UserSquare2}
          title={t("teacher.notFoundTitle")}
          description={t("teacher.notFoundBody")}
        />
      </>
    );
  }

  return (
    <>
      <BackLink />

      <PageHeader title={teacher.fullName} description={t("teacher.detailDescription")} />

      <SectionCard title={t("teacher.identityTitle")} description={t("teacher.identityDesc")}>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <PersonAvatar
            name={teacher.fullName}
            url={teacher.avatarUrl}
            accent="var(--color-accent)"
            className="size-20 shrink-0 text-lg"
          />

          <div className="min-w-0 flex-1 space-y-4">
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={t("teacher.email")} value={teacher.email ?? "—"} />
              <Field label={t("teacher.phone")} value={teacher.phone ?? "—"} />
              <Field
                label={t("teacher.experience")}
                value={t("teacher.years", { count: String(teacher.experienceYears) })}
              />
              <div className="rounded-xl bg-muted/60 px-4 py-3">
                <dt className="text-xs text-muted-foreground">{t("teacher.status")}</dt>
                <dd className="mt-1">
                  <StatusBadge status={teacher.status} />
                </dd>
              </div>
            </dl>

            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">{t("teacher.subjects")}</p>
              {teacher.subjects.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("teacher.noSubjects")}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {teacher.subjects.map((s) => (
                    <Badge key={s} variant="secondary" className="rounded-lg">
                      {s}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {teacher.bio && (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">{t("teacher.bio")}</p>
                <p className="whitespace-pre-wrap text-sm">{teacher.bio}</p>
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("teacher.groups")}
          value={String(myGroups.length)}
          icon={GraduationCap}
        />
        <StatCard
          label={t("teacher.students")}
          value={String(students)}
          icon={Users}
          tone="success"
        />
        <StatCard
          label={t("teacher.weeklyLoad")}
          value={String(sessions.length)}
          icon={CalendarClock}
          tone="accent"
        />
        <StatCard label={t("teacher.fillRate")} value={`${fillRate}%`} icon={Layers3} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title={t("teacher.groupsTitle")} description={t("teacher.groupsDesc")}>
          {myGroups.length === 0 ? (
            <EmptyState
              icon={GraduationCap}
              title={t("teacher.noGroupTitle")}
              description={t("teacher.noGroupBody")}
              className="border-none shadow-none"
            />
          ) : (
            <ul className="space-y-4">
              {myGroups.map((g) => (
                <li key={g.id} className="space-y-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <Link
                      to="/dashboard/groups/$groupId"
                      params={{ groupId: g.id }}
                      className="focus-ring truncate rounded font-medium hover:text-primary"
                    >
                      {g.name}
                    </Link>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {g.enrolled}/{g.maxStudents}
                    </span>
                  </div>
                  <Progress
                    value={Math.min(100, (g.enrolled / Math.max(1, g.maxStudents)) * 100)}
                    className="h-1.5"
                  />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title={t("teacher.timetableTitle")} description={t("teacher.timetableDesc")}>
          {sessions.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title={t("teacher.noSessionTitle")}
              description={t("teacher.noSessionBody")}
              className="border-none shadow-none"
            />
          ) : (
            <ul className="divide-y divide-border">
              {sessions.map(({ group, slot }) => (
                <li key={slot.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{group.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {weekdayLabel(slot.weekday, t)} · {slot.room ?? t("dash.section.noRoom")}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-lg bg-primary-soft px-2.5 py-1 text-xs font-medium tabular-nums text-primary">
                    {slot.startTime} – {slot.endTime}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </>
  );
}

function BackLink() {
  const { t } = useI18n();
  return (
    <Button asChild variant="ghost" size="sm" className="w-fit rounded-xl">
      <Link to="/dashboard/teachers">
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("teacher.backToList")}
      </Link>
    </Button>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{value}</dd>
    </div>
  );
}
