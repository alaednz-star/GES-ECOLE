/**
 * One employee's HR file.
 *
 *   Overview      employment, personal HR data, and the (separate) account lifecycle
 *   Contracts     history; one active at a time; ended/cancelled, never deleted
 *   Availability  when the person CAN work
 *   Schedule      what the timetable says they teach -- read from groups, never copied
 *   Working time  daily check-in/check-out (not students' session attendance)
 *   Leave         requests and decisions
 *   Documents     private files (signed URLs)
 *   Activity      the existing audit trail for this person
 *
 * Administrator-only, enforced by RLS on every HR table.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { StatusBadge } from "@/components/common/status-badge";
import { ErrorState } from "@/components/common/error-state";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RequireAuth } from "@/features/auth/require-auth";
import { PersonAvatar } from "@/features/profile/person-avatar";
import { useEmployee } from "@/features/hr/hr";
import { OverviewPanel } from "@/features/hr/components/overview-panel";
import { ContractsPanel } from "@/features/hr/components/contracts-panel";
import { AvailabilityPanel } from "@/features/hr/components/availability-panel";
import { SchedulePanel } from "@/features/hr/components/schedule-panel";
import { TimePanel } from "@/features/hr/components/time-panel";
import { LeavePanel } from "@/features/hr/components/leave-panel";
import { DocumentsPanel } from "@/features/hr/components/documents-panel";
import { ActivityPanel } from "@/features/hr/components/activity-panel";
import { useI18n } from "@/hooks/use-i18n";
import { Contact } from "lucide-react";

export const Route = createFileRoute("/dashboard/hr/$employeeId")({
  head: () => ({
    meta: [{ title: "Dossier RH — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <EmployeePage />
    </RequireAuth>
  ),
});

const TABS = [
  "overview",
  "contracts",
  "availability",
  "schedule",
  "time",
  "leave",
  "documents",
  "activity",
] as const;

function EmployeePage() {
  const { t } = useI18n();
  const { employeeId } = Route.useParams();
  const { data: employee, isLoading, error, refetch, isFetching } = useEmployee(employeeId);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 rounded-xl text-muted-foreground">
        <Link to="/dashboard/hr">
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          {t("hr.back")}
        </Link>
      </Button>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} isRetrying={isFetching} />
      ) : !employee ? (
        <EmptyState icon={Contact} title={t("hr.title")} description={t("hr.notFound")} />
      ) : (
        <>
          <header className="flex flex-wrap items-center gap-4">
            <PersonAvatar name={employee.fullName} url={employee.avatarUrl} className="size-14" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-2xl font-semibold tracking-tight">
                {employee.fullName ?? t("hr.none")}
              </h1>
              <p className="truncate text-sm text-muted-foreground">
                {[t(`hr.staffType.${employee.staffType}`), employee.position, employee.department]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <StatusBadge status={employee.employmentStatus} />
          </header>

          <Tabs defaultValue="overview" className="space-y-4">
            <div className="overflow-x-auto">
              <TabsList className="h-auto flex-wrap justify-start rounded-xl">
                {TABS.map((tab) => (
                  <TabsTrigger key={tab} value={tab} className="rounded-lg">
                    {t(`hr.tab.${tab}`)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <TabsContent value="overview">
              <OverviewPanel employee={employee} />
            </TabsContent>
            <TabsContent value="contracts">
              <ContractsPanel employee={employee} />
            </TabsContent>
            <TabsContent value="availability">
              <AvailabilityPanel employee={employee} />
            </TabsContent>
            <TabsContent value="schedule">
              <SchedulePanel employee={employee} />
            </TabsContent>
            <TabsContent value="time">
              <TimePanel employee={employee} />
            </TabsContent>
            <TabsContent value="leave">
              <LeavePanel employee={employee} />
            </TabsContent>
            <TabsContent value="documents">
              <DocumentsPanel employee={employee} />
            </TabsContent>
            <TabsContent value="activity">
              <ActivityPanel employee={employee} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
