/**
 * HR: staff files.
 *
 * An HR file sits on an existing staff account (teacher or administrator) and records
 * EMPLOYMENT -- type, status, position, contracts, availability, working time, leave and
 * documents. It never changes the sign-in role or the account lifecycle.
 *
 * Header figures come from records only (`summariseHr`); nothing is estimated, and nothing
 * financial is shown -- payroll is a separate, future module.
 *
 * Security is RLS (20261001110100): every HR table is administrator-only.
 */

import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  CalendarClock,
  Clock,
  Contact,
  Download,
  FileWarning,
  GraduationCap,
  Loader2,
  Plane,
  Plus,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { DataTable, type Column } from "@/components/common/data-table";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/empty-state";
import { PersonAvatar } from "@/features/profile/person-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RequireAuth } from "@/features/auth/require-auth";
import {
  useCreateEmployee,
  useEmployees,
  useHrOverview,
  useStaffCandidates,
  type EmployeeListRow,
} from "@/features/hr/hr";
import {
  CONTRACT_EXPIRY_WINDOW_DAYS,
  CONTRACT_TYPES,
  EMPLOYMENT_STATUSES,
  STAFF_TYPES,
  formatMinutes,
  summariseHr,
  type ContractType,
  type EmploymentStatus,
  type StaffType,
} from "@/features/hr/hr-model";
import { Field } from "@/features/hr/components/field";
import { errorCode } from "@/features/hr/hr-model";
import { exportCsv } from "@/lib/export-csv";
import { formatDate, todayIso } from "@/lib/format";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";

export const Route = createFileRoute("/dashboard/hr/")({
  head: () => ({
    meta: [{ title: "Ressources humaines — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <HrPage />
    </RequireAuth>
  ),
});

function HrPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const today = todayIso();
  const { data = [], isLoading, error, refetch, isFetching } = useEmployees();
  const overview = useHrOverview(today);

  const [statusFilter, setStatusFilter] = useState<EmploymentStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<StaffType | "all">("all");
  const [contractFilter, setContractFilter] = useState<ContractType | "none" | "all">("all");
  const [creating, setCreating] = useState(false);

  const summary = useMemo(
    () =>
      summariseHr(
        {
          employees: data,
          activeContracts: overview.data?.activeContracts ?? [],
          approvedLeaves: overview.data?.approvedLeaves ?? [],
          attendanceThisMonth: overview.data?.attendanceThisMonth ?? [],
        },
        today,
      ),
    [data, overview.data, today],
  );

  const rows = useMemo(
    () =>
      data.filter(
        (e) =>
          (statusFilter === "all" || e.employmentStatus === statusFilter) &&
          (typeFilter === "all" || e.staffType === typeFilter) &&
          (contractFilter === "all" ||
            (contractFilter === "none"
              ? e.activeContract === null
              : e.activeContract?.contractType === contractFilter)),
      ),
    [data, statusFilter, typeFilter, contractFilter],
  );

  const contractLabel = (e: EmployeeListRow) =>
    e.activeContract
      ? [
          t(`hr.contractType.${e.activeContract.contractType}`),
          e.activeContract.workingTime ? t(`hr.workingTime.${e.activeContract.workingTime}`) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : t("hr.none");

  const exportRoster = () =>
    exportCsv(
      `hr-roster-${today}.csv`,
      rows.map((e) => ({
        [t("hr.col.name")]: e.fullName ?? "",
        [t("hr.field.email")]: e.email ?? "",
        [t("hr.field.phone")]: e.phone ?? "",
        [t("hr.col.staffType")]: t(`hr.staffType.${e.staffType}`),
        [t("hr.col.status")]: t(`ui.status.${e.employmentStatus}`),
        [t("hr.field.position")]: e.position ?? "",
        [t("hr.col.department")]: e.department ?? "",
        [t("hr.field.code")]: e.employeeCode ?? "",
        [t("hr.col.start")]: e.startDate,
        [t("hr.field.endDate")]: e.endDate ?? "",
        [t("hr.col.contract")]: e.activeContract ? contractLabel(e) : "",
        [t("hr.contracts.end")]: e.activeContract?.endDate ?? "",
      })),
    );

  const columns: Column<EmployeeListRow>[] = [
    {
      key: "name",
      header: t("hr.col.name"),
      sortValue: (e) => e.fullName ?? "",
      cell: (e) => (
        <div className="flex min-w-0 items-center gap-3">
          <PersonAvatar name={e.fullName} url={e.avatarUrl} className="size-9" />
          <div className="min-w-0">
            <Link
              to="/dashboard/hr/$employeeId"
              params={{ employeeId: e.id }}
              className="focus-ring block truncate rounded font-medium hover:text-primary"
            >
              {e.fullName ?? t("hr.none")}
            </Link>
            <p className="truncate text-xs text-muted-foreground">{e.position ?? e.email ?? ""}</p>
          </div>
        </div>
      ),
    },
    {
      key: "type",
      header: t("hr.col.staffType"),
      sortValue: (e) => t(`hr.staffType.${e.staffType}`),
      cell: (e) => (
        <span className="text-muted-foreground">{t(`hr.staffType.${e.staffType}`)}</span>
      ),
    },
    {
      key: "status",
      header: t("hr.col.status"),
      sortValue: (e) => EMPLOYMENT_STATUSES.indexOf(e.employmentStatus),
      cell: (e) => <StatusBadge status={e.employmentStatus} />,
    },
    {
      key: "contract",
      header: t("hr.col.contract"),
      cell: (e) => (
        <div className="min-w-0">
          <p className="truncate">{contractLabel(e)}</p>
          {e.activeContract?.endDate && (
            <p className="text-xs text-muted-foreground tabular-nums">
              → {formatDate(e.activeContract.endDate, locale)}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "department",
      header: t("hr.col.department"),
      sortValue: (e) => e.department ?? "",
      cell: (e) => <span className="text-muted-foreground">{e.department ?? t("hr.none")}</span>,
    },
    {
      key: "start",
      header: t("hr.col.start"),
      sortValue: (e) => e.startDate,
      cell: (e) => <span className="tabular-nums">{formatDate(e.startDate, locale)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("hr.title")}
        description={t("hr.subtitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={exportRoster}
              disabled={rows.length === 0}
            >
              <Download className="size-4" aria-hidden />
              {t("hr.export")}
            </Button>
            <Button className="rounded-xl" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              {t("hr.new")}
            </Button>
          </div>
        }
      />

      <section className="space-y-3">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <StatCard
            label={t("hr.summary.active")}
            value={String(summary.activeEmployees)}
            icon={Users}
          />
          <StatCard
            label={t("hr.summary.teachers")}
            value={String(summary.teachers)}
            hint={`${t("hr.summary.trainers")} : ${summary.trainers}`}
            icon={GraduationCap}
            tone="neutral"
          />
          <StatCard
            label={t("hr.summary.onLeave")}
            value={String(summary.onLeaveToday)}
            icon={Plane}
            tone="warning"
          />
          <StatCard
            label={t("hr.summary.expiring")}
            value={String(summary.contractsExpiringSoon)}
            hint={t("hr.summary.expiringHint", { days: CONTRACT_EXPIRY_WINDOW_DAYS })}
            icon={FileWarning}
            tone={summary.contractsExpiringSoon > 0 ? "danger" : "neutral"}
          />
          <StatCard
            label={t("hr.summary.attendanceToday")}
            value={String(summary.attendanceRecordedToday)}
            icon={CalendarClock}
            tone="success"
          />
          <StatCard
            label={t("hr.summary.hoursMonth")}
            value={formatMinutes(summary.minutesWorkedThisMonth)}
            icon={Clock}
            tone="success"
          />
        </div>
        <p className="text-xs text-muted-foreground">{t("hr.recordsOnly")}</p>
      </section>

      <DataTable
        rows={rows}
        columns={columns}
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        isRetrying={isFetching}
        rowKey={(e) => e.id}
        searchable={(e) =>
          [e.fullName, e.email, e.position, e.department, e.employeeCode].filter(Boolean).join(" ")
        }
        searchPlaceholder={t("hr.search")}
        emptyState={
          <EmptyState icon={Contact} title={t("hr.emptyTitle")} description={t("hr.emptyBody")} />
        }
        filters={
          <>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as EmploymentStatus | "all")}
            >
              <SelectTrigger className="h-9 w-40 rounded-xl" aria-label={t("hr.filter.status")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("hr.filter.allStatuses")}</SelectItem>
                {EMPLOYMENT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`ui.status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as StaffType | "all")}>
              <SelectTrigger className="h-9 w-48 rounded-xl" aria-label={t("hr.filter.type")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("hr.filter.allTypes")}</SelectItem>
                {STAFF_TYPES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`hr.staffType.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={contractFilter}
              onValueChange={(v) => setContractFilter(v as ContractType | "none" | "all")}
            >
              <SelectTrigger className="h-9 w-48 rounded-xl" aria-label={t("hr.filter.contract")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("hr.filter.allContracts")}</SelectItem>
                <SelectItem value="none">{t("hr.filter.noContract")}</SelectItem>
                {CONTRACT_TYPES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`hr.contractType.${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />

      {creating && (
        <CreateEmployeeDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            void navigate({ to: "/dashboard/hr/$employeeId", params: { employeeId: id } });
          }}
        />
      )}
    </div>
  );
}

function CreateEmployeeDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const candidates = useStaffCandidates(true);
  const create = useCreateEmployee();
  const [profileId, setProfileId] = useState<string>("");
  const [staffType, setStaffType] = useState<StaffType>("teacher");
  const [startDate, setStartDate] = useState(todayIso());
  const [position, setPosition] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const list = candidates.data ?? [];
  const pick = (id: string) => {
    setProfileId(id);
    // A sensible default from the sign-in role; the admin can change it. It grants nothing.
    const roles = list.find((c) => c.profileId === id)?.roles ?? [];
    setStaffType(roles.includes("teacher") ? "teacher" : "administrative");
  };

  const submit = async () => {
    setSubmitted(true);
    if (!profileId || !startDate) return;
    try {
      const id = await create.mutateAsync({
        profileId,
        staffType,
        employmentStatus: "active",
        position: position.trim() || null,
        department: null,
        employeeCode: null,
        startDate,
        endDate: null,
        address: null,
        dateOfBirth: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        notes: null,
      });
      notifySuccess("hr.create.created");
      if (id) onCreated(id);
      else onClose();
    } catch (e) {
      if (errorCode(e) === "23505") toast.error(t("hr.create.accountNone"));
      else notifyError(e);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !create.isPending && onClose()}>
      <DialogContent className="rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-start">{t("hr.create.title")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field
            id="hr-account"
            label={t("hr.create.account")}
            hint={
              list.length === 0 && !candidates.isLoading
                ? t("hr.create.accountNone")
                : t("hr.create.accountHint")
            }
            error={submitted && !profileId ? t("hr.create.accountRequired") : null}
          >
            <Select
              value={profileId}
              onValueChange={pick}
              disabled={candidates.isLoading || list.length === 0}
            >
              <SelectTrigger id="hr-account" className="h-11 rounded-xl">
                <SelectValue placeholder={t("hr.create.accountPick")} />
              </SelectTrigger>
              <SelectContent>
                {list.map((c) => (
                  <SelectItem key={c.profileId} value={c.profileId}>
                    {c.fullName ?? c.email ?? c.profileId} ·{" "}
                    {c.roles.map((r) => t(`hr.role.${r}`)).join(", ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="hr-type" label={t("hr.field.staffType")}>
              <Select value={staffType} onValueChange={(v) => setStaffType(v as StaffType)}>
                <SelectTrigger id="hr-type" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAFF_TYPES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`hr.staffType.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="hr-start" label={t("hr.field.startDate")}>
              <Input
                id="hr-start"
                type="date"
                dir="ltr"
                className="h-11 rounded-xl"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </Field>
          </div>
          <Field id="hr-position" label={`${t("hr.field.position")} ${t("hr.field.optional")}`}>
            <Input
              id="hr-position"
              className="h-11 rounded-xl"
              value={position}
              maxLength={120}
              onChange={(e) => setPosition(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>
              {t("hr.cancelLabel")}
            </Button>
            <Button type="submit" className="rounded-xl" disabled={create.isPending}>
              {create.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("hr.create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
