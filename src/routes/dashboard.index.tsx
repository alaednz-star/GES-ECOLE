import { createFileRoute, Link } from "@tanstack/react-router";
import { useSubjectLabel } from "@/features/school/subject-label";
import {
  AlertTriangle,
  BookOpen,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Circle,
  GraduationCap,
  Percent,
  Sparkles,
  UserSquare2,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import {
  useGroups,
  useLevels,
  useRegistrations,
  useStudents,
  useSubjects,
  useTeachers,
  useTodayAttendance,
} from "@/features/school/queries";
import { sessionsForDay, weekdayLabel } from "@/features/school/schedule";
import { summarise, useAttendanceRange } from "@/features/school/profiles";
import type { AttendanceStatus } from "@/features/school/types";
import { StudentOverview } from "@/features/school/components/student-overview";
import { TeacherOverview } from "@/features/school/components/teacher-overview";
import { useI18n } from "@/hooks/use-i18n";
import { todayIso, toLocalIso } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/")({
  head: () => ({
    meta: [
      { title: "Tableau de bord — Gestion École" },
      {
        name: "description",
        content: "Vue d'ensemble de votre centre : élèves, groupes, présences.",
      },
      { property: "og:title", content: "Tableau de bord — Gestion École" },
      {
        property: "og:description",
        content: "Vue d'ensemble de votre centre de soutien scolaire.",
      },
    ],
  }),
  component: DashboardOverview,
});

function DashboardOverview() {
  const { user } = useAuth();
  if (user?.role === "teacher") return <TeacherOverview />;
  if (user?.role === "student") return <StudentOverview />;
  return <AdminOverview />;
}

const QUICK_ACTIONS = [
  { to: "/dashboard/students", labelKey: "dash.action.addStudent", icon: Users },
  { to: "/dashboard/teachers", labelKey: "dash.action.addTeacher", icon: UserSquare2 },
  { to: "/dashboard/groups", labelKey: "dash.action.createGroup", icon: GraduationCap },
  { to: "/dashboard/attendance", labelKey: "dash.action.markAttendance", icon: CalendarCheck },
  { to: "/dashboard/registrations", labelKey: "dash.action.processRequests", icon: ClipboardList },
] as const;

function AdminOverview() {
  const { t } = useI18n();
  const subjectLabel = useSubjectLabel();
  const today = new Date();
  const dateKey = toLocalIso(today);
  const studentsQuery = useStudents();
  const groupsQuery = useGroups();
  const { data: students = [], isLoading } = studentsQuery;
  const { data: teachers = [] } = useTeachers();
  const { data: subjects = [] } = useSubjects();
  const { data: levels = [] } = useLevels();
  const { data: groups = [] } = groupsQuery;
  const { data: registrations = [] } = useRegistrations();
  const { data: attendance } = useTodayAttendance(dateKey);

  // The overview aggregates several queries into headline numbers. If a core
  // one fails we must not render "0 students" -- that reads as an empty centre
  // rather than a failed load.
  const overviewError = studentsQuery.error ?? groupsQuery.error;

  const pending = registrations.filter((r) => r.status === "pending");
  const todaySessions = sessionsForDay(groups, today.getDay());
  const capacity = groups.reduce((sum, g) => sum + g.maxStudents, 0);
  const enrolled = groups.reduce((sum, g) => sum + g.enrolled, 0);
  const occupancy = capacity > 0 ? Math.round((enrolled / capacity) * 100) : 0;
  const presentToday = attendance?.present ?? 0;
  const totalToday = attendance?.total ?? 0;
  const absentToday = Math.max(0, totalToday - presentToday);
  const attendanceRate = totalToday > 0 ? Math.round((presentToday / totalToday) * 100) : 0;

  const setupSteps = [
    { labelKey: "dash.setup.subjects", done: subjects.length > 0, to: "/dashboard/subjects" },
    { labelKey: "dash.setup.teachers", done: teachers.length > 0, to: "/dashboard/teachers" },
    { labelKey: "dash.setup.groups", done: groups.length > 0, to: "/dashboard/groups" },
    { labelKey: "dash.setup.students", done: students.length > 0, to: "/dashboard/students" },
  ];
  const completed = setupSteps.filter((s) => s.done).length;
  const setupDone = completed === setupSteps.length;

  if (overviewError) {
    return (
      <>
        <PageHeader title={t("dash.overview.title")} />
        <ErrorState
          error={overviewError}
          onRetry={() => {
            void studentsQuery.refetch();
            void groupsQuery.refetch();
          }}
          isRetrying={studentsQuery.isFetching || groupsQuery.isFetching}
        />
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        <PageHeader title={t("dash.overview.title")} description={t("dash.overview.loading")} />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("dash.overview.title")}
        description={t("dash.overview.description", {
          day: weekdayLabel(today.getDay(), t),
          groups: String(groups.length),
          levels: String(levels.length),
        })}
        actions={
          <Button asChild className="rounded-xl">
            <Link to="/dashboard/registrations">
              <ClipboardList className="size-4" aria-hidden />{" "}
              {t("dash.overview.requests", { count: String(pending.length) })}
            </Link>
          </Button>
        }
      />

      {!setupDone && (
        <section className="surface-card overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
            <span className="grid size-9 place-items-center rounded-xl bg-primary-soft text-primary">
              <Sparkles className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold tracking-tight">
                {t("dash.overview.welcomeTitle")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("dash.overview.welcomeBody", { count: String(setupSteps.length) })}
              </p>
            </div>
            <span className="text-sm font-semibold tabular-nums text-primary">
              {completed}/{setupSteps.length}
            </span>
          </div>
          <div className="space-y-4 p-5">
            <Progress value={(completed / setupSteps.length) * 100} className="h-2" />
            <ol className="grid gap-2 sm:grid-cols-2">
              {setupSteps.map((step) => (
                <li key={step.labelKey}>
                  <Link
                    to={step.to}
                    className={cn(
                      "focus-ring flex items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm transition-colors hover:bg-muted/50",
                      step.done && "text-muted-foreground",
                    )}
                  >
                    {step.done ? (
                      <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
                    ) : (
                      <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className={cn("truncate", step.done && "line-through")}>
                      {t(step.labelKey)}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("dash.stat.students")}
          value={String(students.length)}
          icon={Users}
          hint={t("dash.stat.studentsHint")}
        />
        <StatCard
          label={t("dash.stat.teachers")}
          value={String(teachers.length)}
          icon={UserSquare2}
          tone="neutral"
          hint={t("dash.stat.teachersHint")}
        />
        <StatCard
          label={t("dash.stat.activeGroups")}
          value={String(groups.filter((g) => g.status === "active").length)}
          icon={GraduationCap}
          tone="neutral"
          hint={t("dash.stat.subjectsCount", { count: String(subjects.length) })}
        />
        <StatCard
          label={t("dash.stat.pendingRequests")}
          value={String(pending.length)}
          icon={ClipboardList}
          tone={pending.length > 0 ? "warning" : "success"}
          hint={pending.length > 0 ? t("dash.stat.pendingToday") : t("dash.stat.allHandled")}
        />
      </div>

      {/* Pouls du jour — hiérarchie visuelle : une seule zone pour l'opérationnel */}
      <section className="surface-card overflow-hidden">
        <div className="grid gap-px bg-border md:grid-cols-[1.2fr_1fr_1fr_1fr]">
          <div className="bg-card p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CalendarCheck className="size-4 text-primary" aria-hidden />
              {t("dash.pulse.attendance", { day: weekdayLabel(today.getDay(), t) })}
            </div>
            <p className="mt-3 flex items-baseline gap-2">
              <span className="text-4xl font-semibold tracking-tight tabular-nums">
                {attendanceRate}%
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {t("dash.pulse.students", {
                  present: String(presentToday),
                  total: String(totalToday),
                })}
              </span>
            </p>
            <Progress value={attendanceRate} className="mt-3 h-1.5" />
          </div>

          <div className="bg-card p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <AlertTriangle
                className={cn("size-4", absentToday > 0 ? "text-destructive" : "text-success")}
                aria-hidden
              />
              {t("dash.pulse.absent")}
            </div>
            <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{absentToday}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {absentToday > 0 ? t("dash.pulse.absentReport") : t("dash.pulse.noAbsence")}
            </p>
          </div>

          <div className="bg-card p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CalendarClock className="size-4 text-primary" aria-hidden />
              {t("dash.pulse.sessions")}
            </div>
            <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">
              {todaySessions.length}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{t("dash.pulse.sessionsToday")}</p>
          </div>

          <div className="bg-card p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Percent
                className={cn("size-4", occupancy >= 85 ? "text-accent" : "text-success")}
                aria-hidden
              />
              {t("dash.pulse.occupancy")}
            </div>
            <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{occupancy}%</p>
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              {t("dash.pulse.occupancyPlaces", {
                enrolled: String(enrolled),
                capacity: String(capacity),
              })}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/30 px-4 py-3">
          <span className="me-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("dash.pulse.quickActions")}
          </span>
          {QUICK_ACTIONS.map((a) => (
            <Button
              key={a.to + a.labelKey}
              asChild
              variant="outline"
              size="sm"
              className="rounded-full bg-card"
            >
              <Link to={a.to}>
                <a.icon className="size-3.5 text-primary" aria-hidden />
                <span className="text-xs font-medium">{t(a.labelKey)}</span>
              </Link>
            </Button>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title={t("dash.section.todaySessions")}
          description={weekdayLabel(today.getDay(), t)}
          actions={
            <Button asChild variant="ghost" size="sm" className="rounded-lg">
              <Link to="/dashboard/attendance">{t("dash.section.attendanceLink")}</Link>
            </Button>
          }
        >
          {todaySessions.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title={t("dash.section.noSessionTitle")}
              description={t("dash.section.noSessionBody")}
              className="border-none shadow-none"
            />
          ) : (
            <ul className="divide-y divide-border">
              {todaySessions.slice(0, 6).map(({ group, slot }) => (
                <li key={slot.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{group.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {group.teacherName ?? "—"} · {slot.room ?? t("dash.section.noRoom")}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-lg bg-primary-soft px-2.5 py-1 text-xs font-medium tabular-nums text-primary">
                    {slot.startTime.slice(0, 5)} – {slot.endTime.slice(0, 5)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title={t("dash.section.recentRequests")}
          description={t("dash.section.recentRequestsDesc")}
          actions={
            <Button asChild variant="ghost" size="sm" className="rounded-lg">
              <Link to="/dashboard/registrations">{t("dash.section.viewAll")}</Link>
            </Button>
          }
        >
          {registrations.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title={t("dash.section.noRequestTitle")}
              description={t("dash.section.noRequestBody")}
              className="border-none shadow-none"
            />
          ) : (
            <ul className="divide-y divide-border">
              {registrations.slice(0, 6).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.studentName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.groupName} · {subjectLabel(r.subjectKey, r.subjectName)}
                    </p>
                  </div>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title={t("dash.section.groupsNearCapacity")}
          description={t("dash.section.groupsNearCapacityDesc")}
        >
          {groups.length === 0 ? (
            <EmptyState
              icon={GraduationCap}
              title={t("dash.section.noGroupTitle")}
              description={t("dash.section.noGroupBody")}
              className="border-none shadow-none"
            />
          ) : (
            <ul className="space-y-3">
              {[...groups]
                .sort(
                  (a, b) =>
                    b.enrolled / Math.max(1, b.maxStudents) -
                    a.enrolled / Math.max(1, a.maxStudents),
                )
                .slice(0, 5)
                .map((g) => {
                  const ratio =
                    g.maxStudents > 0 ? Math.round((g.enrolled / g.maxStudents) * 100) : 0;
                  return (
                    <li key={g.id} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate font-medium">{g.name}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {g.enrolled}/{g.maxStudents}
                        </span>
                      </div>
                      <Progress value={Math.min(ratio, 100)} className="h-1.5" />
                    </li>
                  );
                })}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title={t("dash.section.subjectsOfCenter")}
          description={t("dash.section.subjectsOfCenterDesc")}
          actions={
            <Button asChild variant="ghost" size="sm" className="rounded-lg">
              <Link to="/dashboard/subjects">{t("dash.section.manage")}</Link>
            </Button>
          }
        >
          {subjects.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title={t("dash.section.noSubjectTitle")}
              description={t("dash.section.noSubjectBody")}
              className="border-none shadow-none"
            />
          ) : (
            <ul className="flex flex-wrap gap-2">
              {subjects.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm"
                >
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: s.color }}
                    aria-hidden
                  />
                  <span className="truncate">{s.name}</span>
                  <span className="tabular-nums text-xs text-muted-foreground">
                    {groups.filter((g) => g.subjectId === s.id).length}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <StudentsAtRisk />
    </>
  );
}

const AT_RISK_THRESHOLD = 70;
const AT_RISK_MIN_SESSIONS = 3;

/**
 * Students whose attendance has dropped below the threshold over the last 30
 * days. Requires a minimum number of sessions so a single absence in a brand
 * new group does not flag someone.
 */
function StudentsAtRisk() {
  const { t } = useI18n();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const rangeQuery = useAttendanceRange(toLocalIso(from), todayIso());

  const atRisk = (() => {
    const byStudent = new Map<string, { name: string; statuses: AttendanceStatus[] }>();
    for (const row of rangeQuery.data ?? []) {
      const entry = byStudent.get(row.studentId) ?? { name: row.studentName, statuses: [] };
      entry.statuses.push(row.status);
      byStudent.set(row.studentId, entry);
    }
    return [...byStudent.entries()]
      .map(([id, v]) => ({ id, name: v.name, summary: summarise(v.statuses) }))
      .filter((s) => s.summary.total >= AT_RISK_MIN_SESSIONS && s.summary.rate < AT_RISK_THRESHOLD)
      .sort((a, b) => a.summary.rate - b.summary.rate)
      .slice(0, 8);
  })();

  return (
    <SectionCard
      title={t("dash.atRisk.title")}
      description={t("dash.atRisk.description", { threshold: String(AT_RISK_THRESHOLD) })}
      actions={
        <Button asChild variant="ghost" size="sm" className="rounded-lg">
          <Link to="/dashboard/attendance-report">{t("dash.atRisk.viewReport")}</Link>
        </Button>
      }
    >
      {rangeQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-lg" />
          ))}
        </div>
      ) : atRisk.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={t("dash.atRisk.emptyTitle")}
          description={t("dash.atRisk.emptyBody")}
          className="border-none shadow-none"
        />
      ) : (
        <ul className="divide-y divide-border">
          {atRisk.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-3">
              <Link
                to="/dashboard/students/$studentId"
                params={{ studentId: s.id }}
                className="focus-ring min-w-0 truncate rounded text-sm font-medium hover:text-primary"
              >
                {s.name}
              </Link>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t("dash.atRisk.sessions", {
                    present: String(s.summary.present + s.summary.late),
                    total: String(s.summary.total),
                  })}
                </span>
                <span className="w-12 text-end text-sm font-semibold tabular-nums text-destructive">
                  {s.summary.rate}%
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
