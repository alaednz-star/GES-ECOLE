import { Link } from "@tanstack/react-router";
import { CalendarClock, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { useTeacherWorkspace } from "@/features/school/teacher-workspace";
import { useMarkNotificationRead, useNotifications } from "@/features/school/notifications";
import { NextClassHero } from "./next-class-hero";
import { TodayPriorities } from "./today-priorities";
import { AttendancePending, TodayTimeline, WeekStrip } from "./workspace-widgets";
import { NotificationsPanel, QuickActions } from "./workspace-side";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";

/**
 * The teacher workspace: "Aujourd'hui".
 *
 * Every widget answers one operational question -- what is next, what is today,
 * what do I owe, what is coming, what changed. Reference figures such as total
 * groups or total students deliberately live on My Groups instead: they do not
 * help anyone teach today, and a page of counters is exactly what made the
 * previous version indistinguishable from the admin dashboard.
 *
 * All scheduling data comes from one hook, so two widgets cannot disagree about
 * the same session, and every date is a real occurrence rather than a weekly
 * pattern that ignores term dates.
 */
export function TeacherOverview() {
  const { t } = useI18n();
  const { user } = useAuth();
  const ws = useTeacherWorkspace();
  const notificationsQuery = useNotifications(user?.id);
  const markRead = useMarkNotificationRead(user?.id);

  // A past session is "marked" when it is NOT in the pending list. The hook
  // already resolved that against real attendance rows; recomputing it here
  // would risk the two disagreeing.
  const pendingKeys = new Set(ws.pendingAttendance.map((o) => `${o.group.id}|${o.date}`));
  const now = new Date();
  const isMarked = (o: { group: { id: string }; date: string; startsAt: Date }) =>
    o.startsAt < now && !pendingKeys.has(`${o.group.id}|${o.date}`);

  const studentCountFor = (groupId: string) =>
    ws.cards.find((c) => c.group.id === groupId)?.studentCount ?? 0;

  if (ws.isLoading) return <WorkspaceSkeleton />;

  if (ws.error) {
    return (
      <>
        <PageHeader title={t("teacher.helloShort", { name: user?.fullName ?? "" })} />
        <ErrorState error={ws.error} onRetry={ws.refetch} isRetrying={ws.isFetching} />
      </>
    );
  }

  // First-time experience: one clear explanation beats five widgets each
  // reporting zero.
  if (ws.groups.length === 0) {
    return (
      <>
        <PageHeader
          title={t("teacher.helloShort", { name: user?.fullName ?? "" })}
          description={t("teacher.noGroupsLead")}
        />
        <EmptyState
          icon={GraduationCap}
          title={t("teacher.onboardingTitle")}
          description={t("teacher.onboardingBody")}
          action={
            <Button asChild variant="outline" className="rounded-xl">
              <Link to="/dashboard/profile">{t("teacher.onboardingAction")}</Link>
            </Button>
          }
        />
        <NotificationsPanel
          notifications={notificationsQuery.data ?? []}
          onMarkRead={(id) => markRead.mutate(id)}
        />
      </>
    );
  }

  return (
    <>
      {/* No PageHeader here: the hero already greets by name and states the
          day's context. A second heading above it repeated the greeting with
          different wording, which read as a bug. */}
      {ws.nextClass ? (
        <NextClassHero
          occurrence={ws.nextClass}
          studentCount={studentCountFor(ws.nextClass.group.id)}
          teacherName={user?.fullName ?? ""}
          sessionsToday={ws.todays.length}
          sessionsDone={ws.todayMarked}
          now={now}
        />
      ) : (
        <SectionCard title={t("teacher.nextClass")}>
          <EmptyState
            icon={CalendarClock}
            title={t("teacher.noUpcomingTitle")}
            description={t("teacher.noUpcomingBody")}
            className="border-none shadow-none"
          />
        </SectionCard>
      )}

      {/* Immediately under the hero: what to do first, before what exists. */}
      <TodayPriorities
        pendingAttendance={ws.pendingAttendance}
        nextClass={ws.nextClass}
        unreadCount={(notificationsQuery.data ?? []).filter((n) => !n.readAt).length}
        now={now}
      />

      {/* Desktop: operational column left, context column right. Below `xl`
          everything stacks in priority order -- today, then what is owed -- so a
          phone surfaces the most urgent item without scrolling. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <div className="min-w-0 space-y-4">
          <TodayTimeline
            occurrences={ws.todays}
            isMarked={isMarked}
            studentCountFor={studentCountFor}
            now={now}
          />
          <AttendancePending occurrences={ws.pendingAttendance} now={now} />
          <WeekStrip occurrences={ws.week} isMarked={isMarked} now={now} />
        </div>

        <div className="min-w-0 space-y-4">
          <QuickActions pendingCount={ws.pendingAttendance.length} />
          <NotificationsPanel
            notifications={notificationsQuery.data ?? []}
            onMarkRead={(id) => markRead.mutate(id)}
            now={now}
          />
        </div>
      </div>
    </>
  );
}

/** Mirrors the real layout so the page does not jump when data lands. */
function WorkspaceSkeleton() {
  return (
    <>
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-56 w-full rounded-2xl" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-56 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </div>
    </>
  );
}
