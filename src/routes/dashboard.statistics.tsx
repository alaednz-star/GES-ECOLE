/**
 * Statistiques (ADR-007): the institution's figures -- students, enrollments, groups' fill rate,
 * attendance by month, new enrollments, teachers' load -- derived from existing data
 * (stats-model.ts). Read-only; the money side is in the financial reports.
 */

import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { CalendarCheck, ClipboardList, GraduationCap, Layers3, PieChart } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { RequireAuth } from "@/features/auth/require-auth";
import { useGroups, useRegistrations, useStudents } from "@/features/school/queries";
import { useAttendanceMonthly } from "@/features/operations/queries";
import { buildStats } from "@/features/operations/stats-model";
import { todayIso } from "@/lib/format";
import { useI18n } from "@/hooks/use-i18n";

export const Route = createFileRoute("/dashboard/statistics")({
  head: () => ({
    meta: [{ title: "Statistiques — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <StatisticsPage />
    </RequireAuth>
  ),
});

function StatisticsPage() {
  const { t, locale } = useI18n();
  const students = useStudents();
  const registrations = useRegistrations();
  const groups = useGroups();
  const attendance = useAttendanceMonthly();
  const today = todayIso();

  const stats = useMemo(
    () =>
      buildStats(
        (students.data ?? []).map((s) => ({
          id: s.id,
          status: s.status,
          registeredAt: s.registeredAt,
        })),
        (registrations.data ?? []).map((r) => ({
          id: r.id,
          studentId: r.studentId,
          groupId: r.groupId,
          status: r.status,
          createdAt: r.createdAt,
        })),
        (groups.data ?? []).map((g) => ({
          id: g.id,
          name: g.name,
          status: g.status,
          maxStudents: g.maxStudents,
          enrolled: g.enrolled,
          programName: g.programName,
          levelName: g.levelName,
          teacherId: g.teacherId,
          teacherName: g.teacherName,
          schedules: g.schedules,
        })),
        attendance.data ?? [],
        today,
      ),
    [students.data, registrations.data, groups.data, attendance.data, today],
  );

  const monthLabel = (ym: string) =>
    new Intl.DateTimeFormat(
      locale === "ar" ? "ar-DZ-u-nu-latn" : locale === "en" ? "en-GB" : "fr-FR",
      {
        month: "short",
        year: "2-digit",
      },
    ).format(new Date(`${ym}-01T00:00:00Z`));

  const loading =
    students.isLoading || registrations.isLoading || groups.isLoading || attendance.isLoading;
  const error = students.error ?? registrations.error ?? groups.error ?? attendance.error;
  const percent = (n: number | null) => (n === null ? "—" : `${n} %`);

  return (
    <>
      <PageHeader
        title={t("stats.title")}
        description={t("stats.subtitle")}
        actions={
          <Button asChild variant="outline" className="rounded-xl">
            <Link to="/dashboard/reports">
              <PieChart className="size-4" aria-hidden /> {t("stats.finance")}
            </Link>
          </Button>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={() => void groups.refetch()} />
      ) : loading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4" data-testid="stats-kpis">
            <StatCard
              label={t("stats.kpi.students")}
              value={String(stats.students.total)}
              icon={GraduationCap}
              hint={t("stats.kpi.studentsHint", {
                active: stats.students.active,
                new: stats.students.newThisMonth,
              })}
            />
            <StatCard
              label={t("stats.kpi.enrollments")}
              value={String(stats.enrollments.active)}
              icon={ClipboardList}
              hint={t("stats.kpi.enrollmentsHint", {
                pending: stats.enrollments.pending,
                new: stats.enrollments.newThisMonth,
              })}
            />
            <StatCard
              label={t("stats.kpi.fill")}
              value={percent(stats.groups.fillRate)}
              icon={Layers3}
              tone="accent"
              hint={t("stats.kpi.fillHint", {
                enrolled: stats.groups.enrolled,
                seats: stats.groups.seats,
              })}
            />
            <StatCard
              label={t("stats.kpi.attendance")}
              value={percent(stats.attendance.rate)}
              icon={CalendarCheck}
              tone="success"
              hint={t("stats.kpi.attendanceHint", { count: stats.attendance.sessionsMarked })}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard
              title={t("stats.attendanceByMonth")}
              testId="stats-attendance-chart"
              data={stats.attendanceByMonth.map((m) => ({
                label: monthLabel(m.month),
                value: m.rate ?? 0,
              }))}
              color="var(--color-success)"
              empty={t("stats.noData")}
            />
            <ChartCard
              title={t("stats.enrollmentsByMonth")}
              testId="stats-enrollments-chart"
              data={stats.enrollmentsByMonth.map((m) => ({
                label: monthLabel(m.month),
                value: m.count,
              }))}
              color="var(--color-primary)"
              empty={t("stats.noData")}
            />
            <ChartCard
              title={t("stats.byProgram")}
              testId="stats-program-chart"
              data={stats.byProgram.map((p) => ({
                label: p.name || t("stats.noProgram"),
                value: p.enrolled,
              }))}
              color="var(--color-primary)"
              empty={t("stats.noData")}
            />
            <ChartCard
              title={t("stats.byLevel")}
              testId="stats-level-chart"
              data={stats.byLevel.map((l) => ({
                label: l.name || t("stats.noLevel"),
                value: l.enrolled,
              }))}
              color="var(--color-accent)"
              empty={t("stats.noData")}
            />
            <SectionCard title={t("stats.fill")}>
              <SimpleTable
                testId="stats-fill"
                headers={[
                  t("stats.col.group"),
                  t("stats.col.enrolled"),
                  t("stats.col.seats"),
                  t("stats.col.rate"),
                ]}
                rows={stats.fill.map((g) => [
                  g.name,
                  String(g.enrolled),
                  String(g.seats),
                  `${g.rate} %`,
                ])}
                empty={t("stats.noData")}
              />
            </SectionCard>
            <SectionCard title={t("stats.teacherLoad")}>
              <SimpleTable
                testId="stats-teachers"
                headers={[t("stats.col.teacher"), t("stats.col.groups"), t("stats.col.hours")]}
                rows={stats.teacherLoad.map((x) => [x.name, String(x.groups), String(x.hours)])}
                empty={t("stats.noData")}
              />
            </SectionCard>
          </div>
        </>
      )}
    </>
  );
}

function ChartCard({
  title,
  data,
  color,
  empty,
  testId,
}: {
  title: string;
  data: { label: string; value: number }[];
  color: string;
  empty: string;
  testId: string;
}) {
  const config: ChartConfig = { value: { label: title, color } };
  return (
    <SectionCard title={title}>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div data-testid={testId} dir="ltr">
          <ChartContainer config={config} className="h-56 w-full">
            <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                interval={0}
                // Long formation names would overlap: the axis shows the start, the tooltip all.
                tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
              />
              <YAxis tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </div>
      )}
    </SectionCard>
  );
}

function SimpleTable({
  headers,
  rows,
  empty,
  testId,
}: {
  headers: string[];
  rows: string[][];
  empty: string;
  testId: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="max-h-72 overflow-auto" data-testid={testId}>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            {headers.map((h, i) => (
              <th
                key={h}
                className={i === 0 ? "py-2 text-start font-medium" : "py-2 text-end font-medium"}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={j === 0 ? "py-2 pe-3" : "py-2 text-end tabular-nums"}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
