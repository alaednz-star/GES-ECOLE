import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarCheck, Search } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { StatusBadge } from "@/components/common/status-badge";
import { AttendanceBreakdown } from "@/features/school/components/attendance-breakdown";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RequireAuth } from "@/features/auth/require-auth";
import { useStudentPortal } from "@/features/school/student-portal";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/dashboard/my-attendance")({
  head: () => ({
    meta: [
      { title: "Mes présences — Gestion École" },
      { name: "description", content: "Votre historique de présence." },
    ],
  }),
  component: () => (
    <RequireAuth roles={["student"]}>
      <MyAttendancePage />
    </RequireAuth>
  ),
});

/** Answers exactly one question: what is my attendance record? */
function MyAttendancePage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { attendance, attendanceSummary, isLoading, isFetching, error, refetch } = useStudentPortal(
    user?.id,
  );

  const header = (
    <PageHeader title={t("myAttendance.title")} description={t("myAttendance.description")} />
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
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </>
    );
  }

  if (attendance.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={CalendarCheck}
          title={t("myAttendance.emptyTitle")}
          description={t("myAttendance.emptyBody")}
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

      <SectionCard title={t("attendance.statsTitle")} description={t("myAttendance.statsDesc")}>
        <AttendanceBreakdown summary={attendanceSummary} />
      </SectionCard>

      <SectionCard
        title={t("attendance.historyTitle")}
        description={t("myAttendance.historyDesc", { count: String(attendance.length) })}
      >
        <ul className="divide-y divide-border">
          {attendance.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{a.groups?.name ?? "—"}</p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {formatDate(a.session_date, locale)}
                </p>
              </div>
              <StatusBadge status={a.status} />
            </li>
          ))}
        </ul>
      </SectionCard>
    </>
  );
}
