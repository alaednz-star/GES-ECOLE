import { useMemo, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import {
  ArrowLeft,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  Check,
  GraduationCap,
  Library,
  LogOut,
  Percent,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/empty-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { RequireAuth } from "@/features/auth/require-auth";
import { StudentRosterExport } from "@/features/school/student-roster-export";
import type { RosterSourceRow } from "@/features/school/roster-model";
import { useGroupDetail } from "@/features/school/group-detail";
import { useDecideRegistration, useEnrollStudent } from "@/features/school/queries";
import {
  EnrollStudentDialog,
  WithdrawDialog,
} from "@/features/school/components/enrollment-dialogs";
import { useEnrollmentErrors } from "@/features/school/use-enrollment-errors";
import type { RegistrationRow } from "@/features/school/types";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { weekdayLabel } from "@/features/school/schedule";
import { useI18n } from "@/hooks/use-i18n";
import { useAuth } from "@/hooks/use-auth";
import { formatDate } from "@/lib/format";
import { FeeTemplatesCard } from "@/features/school/components/fee-templates-card";

export const Route = createFileRoute("/dashboard/groups/$groupId")({
  head: () => ({ meta: [{ title: "Détail du groupe — Gestion École" }] }),
  component: () => (
    <RequireAuth roles={["admin", "teacher"]}>
      <GroupDetailPage />
    </RequireAuth>
  ),
});

function GroupDetailPage() {
  const { t, locale } = useI18n();
  const { hasRole } = useAuth();
  const { groupId } = useParams({ from: "/dashboard/groups/$groupId" });

  // One shared derivation: the detail page, My Groups and the workspace must
  // never disagree about a group's numbers.
  const detail = useGroupDetail(groupId);
  const isAdmin = hasRole("admin");
  const [enrolling, setEnrolling] = useState(false);
  const [withdrawing, setWithdrawing] = useState<RegistrationRow | null>(null);
  const approve = useEnrollStudent();
  const decide = useDecideRegistration();
  const showEnrollmentError = useEnrollmentErrors();
  const { notifySuccess, notifyError } = useActionFeedback();
  /*
    One entry per enrolment in this group. `enrolled` is already filtered to `approved` and
    to this group by `useGroupDetail`; the roster model applies the same status rule again,
    which is harmless and keeps the two from silently disagreeing.
  */
  const rosterSource: RosterSourceRow[] = useMemo(
    () =>
      detail.enrolled.map((r) => ({
        studentId: r.studentId,
        studentName: r.studentName,
        groupId: r.groupId,
        groupName: r.groupName,
        subjectName: r.subjectName,
        levelName: r.levelName,
        status: r.status,
      })),
    [detail.enrolled],
  );
  const { group, enrolled, pending, history, occupancy } = detail;

  if (detail.error) {
    return (
      <>
        <BackLink />
        <ErrorState
          error={detail.error}
          onRetry={() => void detail.refetch()}
          isRetrying={detail.isFetching}
        />
      </>
    );
  }

  if (detail.isLoading) {
    return (
      <>
        <BackLink />
        <Skeleton className="h-32 rounded-2xl" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      </>
    );
  }

  if (!group) {
    return (
      <>
        <BackLink />
        <EmptyState
          icon={GraduationCap}
          title={t("group.notFoundTitle")}
          description={t("group.notFoundBody")}
        />
      </>
    );
  }

  const room = group.schedules.find((s) => s.room)?.room ?? null;

  return (
    <>
      <BackLink />

      <PageHeader
        title={group.name}
        description={t("group.detailDescription", {
          subject: group.subjectName ?? "—",
          level: group.levelName ?? "—",
        })}
        actions={
          <Button asChild className="rounded-xl">
            <Link to="/dashboard/attendance">
              <CalendarCheck className="size-4" aria-hidden />
              {t("group.markAttendance")}
            </Link>
          </Button>
        }
      />

      {/* The formation this group delivers. Its page is administrator-only, so a teacher
          sees the name without a link. */}
      {group.programId && group.programName && (
        <p className="-mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Library className="size-4 shrink-0" aria-hidden />
          <span>{t("group.program")}</span>
          {hasRole("admin") ? (
            <Link
              to="/dashboard/programs/$programId"
              params={{ programId: group.programId }}
              className="focus-ring truncate rounded font-medium text-foreground hover:text-primary"
            >
              {group.programName}
            </Link>
          ) : (
            <span className="truncate font-medium text-foreground">{group.programName}</span>
          )}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("group.enrolled")}
          value={`${enrolled.length}/${group.maxStudents}`}
          icon={Users}
        />
        <StatCard
          label={t("group.occupancy")}
          value={`${occupancy}%`}
          icon={Percent}
          tone={occupancy >= 100 ? "accent" : "success"}
        />
        <StatCard
          label={t("group.pendingRequests")}
          value={String(pending.length)}
          icon={ClipboardList}
          tone="accent"
        />
        <StatCard
          label={t("group.sessionsPerWeek")}
          value={String(group.schedules.length)}
          icon={CalendarClock}
        />
      </div>

      {/*
        The roster for THIS group, preselected.

        `enrolled` is what the page already resolved -- the approved registrations of this
        group, scoped by RLS -- and the scope select is handed exactly one group, so the
        control cannot be steered at a group the viewer was not already shown.
      */}
      <section className="surface-card p-4">
        <h2 className="mb-3 text-sm font-semibold">{t("roster.export")}</h2>
        <StudentRosterExport
          source={rosterSource}
          groups={[{ id: group.id, name: group.name }]}
          initialGroupId={group.id}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title={t("group.infoTitle")} description={t("group.infoDesc")}>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Field label={t("group.subject")} value={group.subjectName ?? "—"} />
            <Field
              label={t("group.teacher")}
              value={group.teacherName ?? t("entity.common.notAssigned")}
            />
            <Field label={t("group.level")} value={group.levelName ?? "—"} />
            <Field label={t("group.room")} value={room ?? t("dash.section.noRoom")} />
            <Field label={t("group.capacity")} value={String(group.maxStudents)} />
            {/* Monthly tariff hidden with the form field above; `group.priceDzd` and the
                `group.price` translation are both left in place for its return. */}
            <div className="rounded-xl bg-muted/60 px-4 py-3">
              <dt className="text-xs text-muted-foreground">{t("group.status")}</dt>
              <dd className="mt-1">
                <StatusBadge status={group.status} />
              </dd>
            </div>
          </dl>
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{t("group.occupancy")}</span>
              <span className="tabular-nums">
                {enrolled.length}/{group.maxStudents}
              </span>
            </div>
            <Progress value={Math.min(occupancy, 100)} className="h-2" />
          </div>
        </SectionCard>

        <SectionCard title={t("group.scheduleTitle")} description={t("group.scheduleDesc")}>
          {group.schedules.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title={t("group.noScheduleTitle")}
              description={t("group.noScheduleBody")}
              className="border-none shadow-none"
            />
          ) : (
            <ul className="divide-y divide-border">
              {group.schedules.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span className="font-medium">{weekdayLabel(s.weekday, t)}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.room ?? t("dash.section.noRoom")}
                  </span>
                  <span className="shrink-0 rounded-lg bg-primary-soft px-2.5 py-1 text-xs font-medium tabular-nums text-primary">
                    {s.startTime} – {s.endTime}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title={t("group.studentsTitle")}
        description={t("group.studentsDesc", { count: String(enrolled.length) })}
        actions={
          isAdmin ? (
            <Button className="rounded-xl" onClick={() => setEnrolling(true)}>
              <UserPlus className="size-4" aria-hidden />
              {t("enroll.title")}
            </Button>
          ) : undefined
        }
      >
        {detail.truncated && (
          <p className="surface-alert mb-3 px-3 py-2 text-xs">{t("group.truncated")}</p>
        )}
        {enrolled.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t("group.noStudentTitle")}
            description={t("group.noStudentBody")}
            className="border-none shadow-none"
          />
        ) : (
          <ul className="divide-y divide-border">
            {enrolled.map((r) => {
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    {hasRole("admin") || hasRole("teacher") ? (
                      <Link
                        to="/dashboard/students/$studentId"
                        params={{ studentId: r.studentId }}
                        className="focus-ring truncate rounded text-sm font-medium hover:text-primary"
                      >
                        {r.studentName}
                      </Link>
                    ) : (
                      <span className="truncate text-sm font-medium">{r.studentName}</span>
                    )}
                    <p className="truncate text-xs text-muted-foreground">
                      {r.levelName ?? group.levelName ?? "—"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(r.decidedAt ?? r.createdAt, locale)}
                    </span>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-lg text-muted-foreground hover:text-destructive"
                        aria-label={t("withdraw.aria", { name: r.studentName })}
                        onClick={() => setWithdrawing(r)}
                      >
                        <LogOut className="size-3.5" aria-hidden />
                        {t("withdraw.action")}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {pending.length > 0 && (
        <SectionCard title={t("group.requestsTitle")} description={t("group.requestsDesc")}>
          <ul className="divide-y divide-border">
            {pending.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <span className="min-w-0 truncate font-medium">{r.studentName}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={r.status} />
                  {isAdmin && (
                    <>
                      <Button
                        size="sm"
                        className="rounded-lg"
                        disabled={approve.isPending || decide.isPending}
                        onClick={async () => {
                          try {
                            await approve.mutateAsync({
                              groupId: group.id,
                              studentId: r.studentId,
                              pendingRegistrationId: r.id,
                            });
                            notifySuccess("entity.registrations.approved");
                          } catch (e) {
                            showEnrollmentError(e, group.name);
                          }
                        }}
                      >
                        <Check className="size-3.5" aria-hidden />
                        {t("entity.registrations.approve")}
                      </Button>
                      <ConfirmDialog
                        title={t("entity.registrations.rejectTitle")}
                        description={t("entity.registrations.rejectDescription", {
                          name: r.studentName,
                        })}
                        confirmLabel={t("entity.registrations.reject")}
                        onConfirm={async () => {
                          try {
                            await decide.mutateAsync({ id: r.id, status: "rejected" });
                            notifySuccess("entity.registrations.rejected");
                          } catch (e) {
                            notifyError(e);
                          }
                        }}
                        trigger={
                          <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-lg text-destructive"
                            disabled={approve.isPending || decide.isPending}
                          >
                            <X className="size-3.5" aria-hidden />
                            {t("entity.registrations.reject")}
                          </Button>
                        }
                      />
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* Refused requests and withdrawn places: kept, never deleted (ADR-004 section 4). */}
      {/* Every group can be priced: by its formation (override optional) or, without formation, itself. */}
      {isAdmin && <FeeTemplatesCard programId={group.programId} groupId={group.id} />}

      {isAdmin && history.length > 0 && (
        <SectionCard title={t("group.historyTitle")} description={t("group.historyDesc")}>
          <ul className="divide-y divide-border" aria-label={t("group.historyTitle")}>
            {history.map((r) => {
              const when = r.status === "withdrawn" ? r.withdrawnAt : r.decidedAt;
              const why = r.status === "withdrawn" ? r.withdrawalReason : r.note;
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link
                      to="/dashboard/students/$studentId"
                      params={{ studentId: r.studentId }}
                      className="focus-ring truncate rounded text-sm font-medium hover:text-primary"
                    >
                      {r.studentName}
                    </Link>
                    {why && <p className="truncate text-xs text-muted-foreground">{why}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {when && (
                      <span className="text-xs text-muted-foreground">
                        {formatDate(when, locale)}
                      </span>
                    )}
                    <StatusBadge status={r.status} />
                  </div>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}

      {enrolling && (
        <EnrollStudentDialog
          group={{
            id: group.id,
            name: group.name,
            maxStudents: group.maxStudents,
            enrolled: enrolled.length,
          }}
          onClose={() => setEnrolling(false)}
        />
      )}
      {withdrawing && (
        <WithdrawDialog
          registration={withdrawing}
          groupName={group.name}
          onClose={() => setWithdrawing(null)}
        />
      )}
    </>
  );
}

function BackLink() {
  const { t } = useI18n();
  return (
    <Button asChild variant="ghost" size="sm" className="w-fit rounded-xl">
      <Link to="/dashboard/groups">
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("group.backToList")}
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
