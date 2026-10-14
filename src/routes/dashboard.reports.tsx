/**
 * Rapports financiers (ADR-006 section 5): collections, fees, discounts over a period, and the
 * arrears as of today with their ageing. Received and owed are shown apart.
 *
 * Period figures come from the monthly security_invoker views; today's arrears from the same
 * balance data as Soldes & impayés (`balanceOf`). Every table exports to CSV.
 */

import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Download,
  FileDown,
  HandCoins,
  Percent,
  Receipt,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RequireAuth } from "@/features/auth/require-auth";
import { useFinanceLedger, useFinanceReportRows } from "@/features/finance/queries";
import { buildReport, type Period } from "@/features/finance/reports-model";
import {
  AGEING_BUCKETS,
  ageingOf,
  balanceTotals,
  buildBalanceRows,
} from "@/features/finance/balances-model";
import { useFeeTypes } from "@/features/school/fees";
import { useFeeTypeName } from "@/features/school/fee-labels";
import { exportCsv } from "@/lib/export-csv";
import { formatDzd, todayIso } from "@/lib/format";
import { useI18n } from "@/hooks/use-i18n";

export const Route = createFileRoute("/dashboard/reports")({
  head: () => ({
    meta: [{ title: "Rapports financiers — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <ReportsPage />
    </RequireAuth>
  ),
});

type Preset = "thisMonth" | "last3" | "thisYear" | "schoolYear" | "custom";

function presetPeriod(preset: Exclude<Preset, "custom">, today: string): Period {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const ym = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}`;
  switch (preset) {
    case "thisMonth":
      return { from: ym(y, m), to: ym(y, m) };
    case "last3": {
      const start = new Date(Date.UTC(y, m - 3, 1));
      return { from: ym(start.getUTCFullYear(), start.getUTCMonth() + 1), to: ym(y, m) };
    }
    case "thisYear":
      return { from: ym(y, 1), to: ym(y, 12) };
    case "schoolYear":
      // Algerian school year: September to June.
      return m >= 9 ? { from: ym(y, 9), to: ym(y + 1, 6) } : { from: ym(y - 1, 9), to: ym(y, 6) };
  }
}

function ReportsPage() {
  const { t, locale } = useI18n();
  const today = todayIso();
  const report = useFinanceReportRows();
  const ledger = useFinanceLedger();
  const feeTypes = useFeeTypes();
  const typeName = useFeeTypeName(feeTypes.data ?? []);
  const [preset, setPreset] = useState<Preset>("schoolYear");
  const [custom, setCustom] = useState<Period>(() => presetPeriod("schoolYear", today));
  const period = preset === "custom" ? custom : presetPeriod(preset, today);

  const data = useMemo(
    () => buildReport(report.data?.payments ?? [], report.data?.charges ?? [], period),
    [report.data, period],
  );
  const balances = useMemo(
    () =>
      ledger.data
        ? buildBalanceRows(ledger.data.enrollments, ledger.data.charges, ledger.data.paid, today)
        : [],
    [ledger.data, today],
  );
  const now = balanceTotals(balances);
  const ageing = ageingOf(balances, today);

  const money = (n: number) => formatDzd(n, locale);
  const monthLabel = (ym: string) =>
    new Intl.DateTimeFormat(
      locale === "ar" ? "ar-DZ-u-nu-latn" : locale === "en" ? "en-GB" : "fr-FR",
      {
        month: "short",
        year: "numeric",
      },
    ).format(new Date(`${ym}-01T00:00:00Z`));

  const csv = (name: string, rows: Record<string, string | number>[]) => {
    if (rows.length === 0) {
      toast.error(t("entity.common.noRows"));
      return;
    }
    exportCsv(name, rows);
    toast.success(t("finance.exported", { count: rows.length }));
  };

  const loading = report.isLoading || ledger.isLoading;
  const error = report.error ?? ledger.error;

  return (
    <>
      <PageHeader
        title={t("reports.title")}
        description={t("reports.subtitle")}
        actions={
          <Button asChild variant="outline" className="rounded-xl">
            <Link
              to="/documents/reports"
              search={{ from: period.from, to: period.to }}
              data-testid="reports-pdf"
            >
              <FileDown className="size-4" aria-hidden /> {t("reports.pdf")}
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3" data-testid="reports-period">
        <div className="space-y-1.5">
          <Label htmlFor="reports-preset">{t("reports.preset")}</Label>
          <Select
            value={preset}
            onValueChange={(v) => {
              if (!v) return;
              if (v !== "custom") setCustom(presetPeriod(v as Exclude<Preset, "custom">, today));
              setPreset(v as Preset);
            }}
          >
            <SelectTrigger id="reports-preset" className="h-10 w-52 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["thisMonth", "last3", "thisYear", "schoolYear"] as const).map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`reports.preset.${p}`)}
                </SelectItem>
              ))}
              <SelectItem value="custom">
                {t("reports.from")} / {t("reports.to")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reports-from">{t("reports.from")}</Label>
          <Input
            id="reports-from"
            type="month"
            dir="ltr"
            className="h-10 w-40 rounded-xl"
            value={period.from}
            onChange={(e) => {
              setPreset("custom");
              setCustom({ ...period, from: e.target.value || period.from });
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reports-to">{t("reports.to")}</Label>
          <Input
            id="reports-to"
            type="month"
            dir="ltr"
            className="h-10 w-40 rounded-xl"
            value={period.to}
            onChange={(e) => {
              setPreset("custom");
              setCustom({ ...period, to: e.target.value || period.to });
            }}
          />
        </div>
      </div>

      {error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            void report.refetch();
            void ledger.refetch();
          }}
        />
      ) : loading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-5" data-testid="reports-kpis">
            <StatCard
              label={t("reports.kpi.received")}
              value={money(data.receivedDzd)}
              icon={Wallet}
              tone="success"
              hint={t("reports.kpi.payments", { count: data.paymentCount })}
            />
            <StatCard
              label={t("reports.kpi.charged")}
              value={money(data.chargedDzd)}
              icon={Receipt}
            />
            <StatCard
              label={t("reports.kpi.discounted")}
              value={money(data.discountedDzd)}
              icon={Percent}
            />
            <StatCard
              label={t("reports.kpi.remaining")}
              value={money(now.remainingDzd)}
              icon={HandCoins}
            />
            <StatCard
              label={t("reports.kpi.overdue")}
              value={money(now.overdueDzd)}
              icon={AlertTriangle}
              tone="accent"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <ReportTable
              title={t("reports.byMonth")}
              testId="report-by-month"
              headers={[
                t("reports.col.month"),
                t("reports.col.received"),
                t("reports.col.charged"),
                t("reports.col.discounted"),
              ]}
              rows={data.byMonth.map((m) => [
                monthLabel(m.month),
                money(m.receivedDzd),
                money(m.chargedDzd),
                money(m.discountedDzd),
              ])}
              onExport={() =>
                csv(
                  "rapport-mois",
                  data.byMonth.map((m) => ({
                    [t("reports.col.month")]: m.month,
                    [t("reports.col.received")]: m.receivedDzd,
                    [t("reports.col.charged")]: m.chargedDzd,
                    [t("reports.col.discounted")]: m.discountedDzd,
                  })),
                )
              }
            />
            <ReportTable
              title={t("reports.byMethod")}
              testId="report-by-method"
              headers={[t("reports.col.method"), t("reports.col.count"), t("reports.col.received")]}
              rows={data.byMethod.map((m) => [
                t(`payments.method.${m.method}`),
                String(m.paymentCount),
                money(m.receivedDzd),
              ])}
              onExport={() =>
                csv(
                  "rapport-moyens",
                  data.byMethod.map((m) => ({
                    [t("reports.col.method")]: t(`payments.method.${m.method}`),
                    [t("reports.col.count")]: m.paymentCount,
                    [t("reports.col.received")]: m.receivedDzd,
                  })),
                )
              }
            />
            <ReportTable
              title={t("reports.byProgram")}
              testId="report-by-program"
              headers={[
                t("reports.col.formation"),
                t("reports.col.received"),
                t("reports.col.charged"),
                t("reports.col.discounted"),
              ]}
              rows={data.byProgram.map((p) => [
                p.programName ?? t("reports.noProgram"),
                money(p.receivedDzd),
                money(p.chargedDzd),
                money(p.discountedDzd),
              ])}
              onExport={() =>
                csv(
                  "rapport-formations",
                  data.byProgram.map((p) => ({
                    [t("reports.col.formation")]: p.programName ?? t("reports.noProgram"),
                    [t("reports.col.received")]: p.receivedDzd,
                    [t("reports.col.charged")]: p.chargedDzd,
                    [t("reports.col.discounted")]: p.discountedDzd,
                  })),
                )
              }
            />
            <ReportTable
              title={t("reports.byFeeType")}
              testId="report-by-fee"
              headers={[
                t("reports.col.feeType"),
                t("reports.col.charged"),
                t("reports.col.discounted"),
              ]}
              rows={data.byFeeType.map((f) => [
                typeName(f.feeType),
                money(f.chargedDzd),
                money(f.discountedDzd),
              ])}
              onExport={() =>
                csv(
                  "rapport-types-frais",
                  data.byFeeType.map((f) => ({
                    [t("reports.col.feeType")]: typeName(f.feeType),
                    [t("reports.col.charged")]: f.chargedDzd,
                    [t("reports.col.discounted")]: f.discountedDzd,
                  })),
                )
              }
            />
            <ReportTable
              title={t("reports.ageing")}
              testId="report-ageing"
              headers={[t("reports.col.bucket"), t("reports.col.amount")]}
              rows={AGEING_BUCKETS.map((b) => [t(`reports.bucket.${b}`), money(ageing[b])])}
              onExport={() =>
                csv(
                  "rapport-anciennete",
                  AGEING_BUCKETS.map((b) => ({
                    [t("reports.col.bucket")]: t(`reports.bucket.${b}`),
                    [t("reports.col.amount")]: ageing[b],
                  })),
                )
              }
            />
          </div>
        </>
      )}
    </>
  );
}

function ReportTable({
  title,
  headers,
  rows,
  onExport,
  testId,
}: {
  title: string;
  headers: string[];
  rows: ReactNode[][];
  onExport: () => void;
  testId: string;
}) {
  const { t } = useI18n();
  return (
    <SectionCard
      title={title}
      actions={
        <Button variant="ghost" size="sm" className="rounded-lg" onClick={onExport}>
          <Download className="size-4" aria-hidden />
          {t("reports.exportTable")}
        </Button>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("reports.noData")}</p>
      ) : (
        <div className="overflow-x-auto" data-testid={testId}>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {headers.map((h, i) => (
                  <th
                    key={h}
                    className={
                      i === 0 ? "py-2 text-start font-medium" : "py-2 text-end font-medium"
                    }
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
      )}
    </SectionCard>
  );
}
