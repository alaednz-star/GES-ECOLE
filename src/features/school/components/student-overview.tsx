import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import {
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  GraduationCap,
  Search,
  UserRound,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useStudentPortal } from "@/features/school/student-portal";
import type { MyRegistration } from "@/features/school/my-registrations";
import { weekdayLabel } from "@/features/school/schedule";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Quick actions point at the pages that own each job. The dashboard links to
 * them rather than reproducing them -- that is the whole reason those pages
 * exist as separate destinations.
 */
const QUICK_ACTIONS = [
  { to: "/dashboard/registration", labelKey: "dash.student.qaRegister", icon: Search },
  { to: "/dashboard/my-classes", labelKey: "dash.student.qaMyClasses", icon: GraduationCap },
  { to: "/dashboard/schedule", labelKey: "dash.student.qaSchedule", icon: CalendarClock },
  { to: "/dashboard/my-attendance", labelKey: "dash.student.qaAttendance", icon: CalendarCheck },
  { to: "/dashboard/my-registrations", labelKey: "dash.student.qaRequests", icon: ClipboardList },
  { to: "/dashboard/profile", labelKey: "dash.student.qaProfile", icon: UserRound },
] as const;

const PREVIEW_LIMIT = 3;

/**
 * The student dashboard answers one question: what should I know today?
 *
 * It deliberately holds no full lists. The weekly timetable, the class list,
 * the attendance history and the request list each have their own page; what
 * appears here is today's slice plus a short preview with a "view all" link.
 */
export function StudentOverview() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const {
    registrations,
    enrolled,
    pending,
    todayOccurrences,
    nextOccurrence,
    attendanceSummary,
    unreadNotifications,
    todayWeekday,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useStudentPortal(user?.id);

  const activity = useActivityTimeline(registrations, attendanceSummary.total);

  const header = (
    <PageHeader
      title={t("dash.student.hello", { name: user?.fullName ?? "" })}
      description={t("dash.student.description")}
      actions={
        <Button asChild className="rounded-xl">
          <Link to="/dashboard/registration">{t("dash.student.enroll")}</Link>
        </Button>
      }
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

  return (
    <>
      {header}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
        ) : (
          <>
            <StatCard
              label={t("dash.student.todayClasses")}
              value={String(todayOccurrences.length)}
              icon={CalendarClock}
              hint={weekdayLabel(todayWeekday, t)}
            />
            <StatCard
              label={t("dash.student.nextClass")}
              value={nextOccurrence ? nextOccurrence.slot.startTime.slice(0, 5) : "—"}
              icon={CalendarClock}
              tone="accent"
              hint={
                nextOccurrence
                  ? `${nextOccurrence.group.subjectName ?? nextOccurrence.group.name} · ${formatDate(nextOccurrence.date, locale)} · ${nextOccurrence.slot.startTime.slice(0, 5)}–${nextOccurrence.slot.endTime.slice(0, 5)} · ${nextOccurrence.slot.room ?? t("dash.section.noRoom")}`
                  : t("dash.student.noUpcoming")
              }
            />
            <StatCard
              label={t("dash.student.attendanceRate")}
              value={attendanceSummary.total > 0 ? `${attendanceSummary.rate}%` : "—"}
              icon={CalendarCheck}
              tone="success"
              hint={t("dash.student.sessionsCount", {
                present: String(attendanceSummary.present + attendanceSummary.late),
                total: String(attendanceSummary.total),
              })}
            />
            <StatCard
              label={t("dash.student.approvedClasses")}
              value={String(enrolled.length)}
              icon={GraduationCap}
              hint={
                pending.length > 0
                  ? t("dash.student.pendingHint", { count: String(pending.length) })
                  : t("dash.student.noPending")
              }
            />
          </>
        )}
      </div>

      <section aria-label={t("dash.pulse.quickActions")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_ACTIONS.map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className="surface-card focus-ring flex items-center gap-3 p-4 transition-colors hover:bg-muted/40"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                <a.icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{t(a.labelKey)}</span>
              {a.to === "/dashboard/my-registrations" && unreadNotifications > 0 && (
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-destructive text-[0.625rem] font-semibold text-destructive-foreground">
                  {unreadNotifications > 9 ? "9+" : unreadNotifications}
                </span>
              )}
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Today only. The full week lives on the Schedule page. */}
        <SectionCard
          title={t("dash.student.todayTitle")}
          description={weekdayLabel(todayWeekday, t)}
          actions={
            <Button asChild variant="ghost" size="sm" className="rounded-lg">
              <Link to="/dashboard/schedule">{t("dash.student.viewWeek")}</Link>
            </Button>
          }
        >
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-xl" />
              ))}
            </div>
          ) : todayOccurrences.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title={t("dash.student.noClassTodayTitle")}
              description={t("dash.student.noClassTodayBody")}
              className="border-none shadow-none"
            />
          ) : (
            <ul className="divide-y divide-border">
              {todayOccurrences.map((o) => (
                <li key={o.slot.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{o.group.name}</p>
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
          )}
        </SectionCard>

        <SectionCard
          title={t("dash.student.activityTitle")}
          description={t("dash.student.activityDesc")}
        >
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-xl" />
              ))}
            </div>
          ) : activity.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title={t("dash.student.noActivityTitle")}
              description={t("dash.student.noActivityBody")}
              className="border-none shadow-none"
            />
          ) : (
            <ol className="relative space-y-4 ps-6">
              <span
                className="absolute inset-y-1 w-px bg-border ltr:left-2 rtl:right-2"
                aria-hidden
              />
              {activity.map((a) => (
                <li key={a.id} className="relative">
                  <span
                    className={cn(
                      "absolute grid size-4 place-items-center rounded-full ring-4 ring-card ltr:-left-6 rtl:-right-6",
                      a.tone,
                    )}
                    aria-hidden
                  >
                    <a.icon className="size-2.5 text-white" />
                  </span>
                  <p className="text-sm">{a.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(a.at, locale)}</p>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      </div>

      {/* Compact preview only -- the full list is on My Registrations. */}
      {!isLoading && registrations.length > 0 && (
        <SectionCard
          title={t("dash.student.requestsTitle")}
          description={t("dash.student.requestsPreview", {
            shown: String(Math.min(PREVIEW_LIMIT, registrations.length)),
            total: String(registrations.length),
          })}
          actions={
            <Button asChild variant="ghost" size="sm" className="rounded-lg">
              <Link to="/dashboard/my-registrations">{t("dash.student.viewAll")}</Link>
            </Button>
          }
        >
          <ul className="divide-y divide-border">
            {registrations.slice(0, PREVIEW_LIMIT).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {r.groupUnavailable ? t("myReg.unavailableGroup") : r.groupName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{r.subjectName ?? "—"}</p>
                </div>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {!isLoading && registrations.length === 0 && (
        <EmptyState
          icon={ClipboardList}
          title={t("myReg.emptyTitle")}
          description={t("myReg.emptyBody")}
          action={
            <Button asChild className="mt-2 rounded-xl">
              <Link to="/dashboard/registration">{t("myReg.browse")}</Link>
            </Button>
          }
        />
      )}
    </>
  );
}

interface ActivityEntry {
  id: string;
  label: string;
  at: string;
  icon: typeof CheckCircle2;
  tone: string;
}

/**
 * Derived from data the student already has -- no events table.
 * Only real occurrences are listed; nothing is invented to pad the timeline.
 */
function useActivityTimeline(
  registrations: MyRegistration[],
  attendanceCount: number,
): ActivityEntry[] {
  const { t } = useI18n();

  return useMemo(() => {
    const entries: ActivityEntry[] = [];

    for (const r of registrations) {
      entries.push({
        id: `sub-${r.id}`,
        label: t("dash.student.actSubmitted", { group: r.groupName }),
        at: r.createdAt,
        icon: ClipboardList,
        tone: "bg-muted-foreground",
      });

      if (r.decidedAt && r.status !== "pending") {
        entries.push({
          id: `dec-${r.id}`,
          label: t(
            r.status === "approved" ? "dash.student.actApproved" : "dash.student.actRejected",
            { group: r.groupName },
          ),
          at: r.decidedAt,
          icon: r.status === "approved" ? CheckCircle2 : XCircle,
          tone: r.status === "approved" ? "bg-success" : "bg-destructive",
        });
      }
    }

    if (attendanceCount > 0) {
      entries.push({
        id: "attendance",
        label: t("dash.student.actAttendance", { count: String(attendanceCount) }),
        at: new Date().toISOString(),
        icon: CalendarCheck,
        tone: "bg-primary",
      });
    }

    return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  }, [registrations, attendanceCount, t]);
}
