import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarCheck, Download } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { DataTable, type Column } from "@/components/common/data-table";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/empty-state";
import { AttendanceBreakdown } from "@/features/school/components/attendance-breakdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RequireAuth } from "@/features/auth/require-auth";
import { useGroups } from "@/features/school/queries";
import { summarise, useAttendanceRange } from "@/features/school/profiles";
import type { AttendanceHistoryRow, AttendanceStatus } from "@/features/school/types";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { exportCsv } from "@/lib/export-csv";
import { formatDate, todayIso, toLocalIso } from "@/lib/format";

export const Route = createFileRoute("/dashboard/attendance-report")({
  head: () => ({
    meta: [
      { title: "Rapport de présence — Gestion École" },
      { name: "description", content: "Historique, statistiques et export des présences." },
    ],
  }),
  component: () => (
    <RequireAuth roles={["admin", "teacher"]}>
      <AttendanceReportPage />
    </RequireAuth>
  ),
});

const ALL = "all";

/** Local calendar date `n` days before today. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toLocalIso(d);
}

function AttendanceReportPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();

  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayIso);
  const [groupFilter, setGroupFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);

  const { data: groups = [] } = useGroups();
  const rangeQuery = useAttendanceRange(from, to);

  // A teacher may only report on their own groups.
  const visibleGroups = useMemo(
    () => groups.filter((g) => user?.role !== "teacher" || g.teacherId === user.id),
    [groups, user?.role, user?.id],
  );

  const rows: AttendanceHistoryRow[] = useMemo(() => {
    const allowed = new Set(visibleGroups.map((g) => g.id));
    return (rangeQuery.data ?? []).filter(
      (r) =>
        allowed.has(r.groupId) &&
        (groupFilter === ALL || r.groupId === groupFilter) &&
        (statusFilter === ALL || r.status === statusFilter),
    );
  }, [rangeQuery.data, visibleGroups, groupFilter, statusFilter]);

  const summary = useMemo(() => summarise(rows.map((r) => r.status)), [rows]);

  const columns: Column<AttendanceHistoryRow>[] = [
    {
      key: "date",
      header: t("attendance.columnDate"),
      sortValue: (r) => r.sessionDate,
      cell: (r) => <span className="tabular-nums">{formatDate(r.sessionDate, locale)}</span>,
    },
    {
      key: "student",
      header: t("attendance.columnStudent"),
      sortValue: (r) => r.studentName,
      cell: (r) => (
        <Link
          to="/dashboard/students/$studentId"
          params={{ studentId: r.studentId }}
          className="focus-ring rounded font-medium hover:text-primary"
        >
          {r.studentName}
        </Link>
      ),
    },
    {
      key: "group",
      header: t("attendance.columnGroup"),
      sortValue: (r) => r.groupName,
      cell: (r) => (
        <Link
          to="/dashboard/groups/$groupId"
          params={{ groupId: r.groupId }}
          className="focus-ring rounded hover:text-primary"
        >
          {r.groupName}
        </Link>
      ),
    },
    { key: "subject", header: t("attendance.columnSubject"), cell: (r) => r.subjectName ?? "—" },
    {
      key: "status",
      header: t("attendance.columnStatus"),
      sortValue: (r) => r.status,
      cell: (r) => <StatusBadge status={r.status} />,
    },
  ];

  const handleExport = () => {
    if (rows.length === 0) {
      toast.error(t("entity.common.noRows"));
      return;
    }
    exportCsv(
      "attendance",
      rows.map((r) => ({
        [t("attendance.columnDate")]: r.sessionDate,
        [t("attendance.columnStudent")]: r.studentName,
        [t("attendance.columnGroup")]: r.groupName,
        [t("attendance.columnSubject")]: r.subjectName ?? "",
        [t("attendance.columnStatus")]: t(`ui.status.${r.status}`),
      })),
    );
    toast.success(t("attendance.exported", { count: String(rows.length) }));
  };

  const statuses: AttendanceStatus[] = ["present", "absent", "late", "excused"];

  return (
    <>
      <PageHeader
        title={t("attendance.reportTitle")}
        description={t("attendance.reportDescription")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="rounded-xl">
              <Link to="/dashboard/attendance">
                <CalendarCheck className="size-4" aria-hidden />
                {t("attendance.markToday")}
              </Link>
            </Button>
            <Button variant="outline" className="rounded-xl" onClick={handleExport}>
              <Download className="size-4" aria-hidden />
              {t("entity.common.export")}
            </Button>
          </div>
        }
      />

      <SectionCard title={t("attendance.filtersTitle")} description={t("attendance.filtersDesc")}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="ar-from">{t("attendance.from")}</Label>
            <Input
              id="ar-from"
              type="date"
              className="h-11 rounded-xl"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ar-to">{t("attendance.to")}</Label>
            <Input
              id="ar-to"
              type="date"
              className="h-11 rounded-xl"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ar-group">{t("attendance.group")}</Label>
            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger id="ar-group" className="h-11 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("attendance.allGroups")}</SelectItem>
                {visibleGroups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ar-status">{t("attendance.columnStatus")}</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger id="ar-status" className="h-11 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("attendance.allStatuses")}</SelectItem>
                {statuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`ui.status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </SectionCard>

      <SectionCard title={t("attendance.statsTitle")} description={t("attendance.statsDesc")}>
        <AttendanceBreakdown summary={summary} />
      </SectionCard>

      <DataTable
        rows={rows}
        columns={columns}
        isLoading={rangeQuery.isLoading}
        error={rangeQuery.error}
        onRetry={() => void rangeQuery.refetch()}
        isRetrying={rangeQuery.isFetching}
        rowKey={(r) => r.id}
        pageSize={15}
        searchable={(r) => `${r.studentName} ${r.groupName} ${r.subjectName ?? ""}`}
        searchPlaceholder={t("attendance.searchPlaceholder")}
        emptyState={
          <EmptyState
            icon={CalendarCheck}
            title={t("attendance.noHistoryTitle")}
            description={t("attendance.noRangeBody")}
            className="border-none shadow-none"
          />
        }
      />
    </>
  );
}
