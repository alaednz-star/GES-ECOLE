/**
 * Soldes & impayés: what each enrollment owes after discounts and payments (ADR-006 section 1).
 *
 * Derived only: active charges (with installments and discounts) and the payments total per
 * enrollment, through `balanceOf` -- the same rule as the student page and the payment form.
 * Nothing on this page is typed in or stored.
 */

import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Download, HandCoins, Percent, Scale, Wallet } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { DataTable, type Column } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RequireAuth } from "@/features/auth/require-auth";
import { useFinanceLedger } from "@/features/finance/queries";
import {
  balanceTotals,
  buildBalanceRows,
  filterBalanceRows,
  type BalanceRow,
  type BalanceView,
} from "@/features/finance/balances-model";
import { exportCsv } from "@/lib/export-csv";
import { formatDate, formatDzd, todayIso } from "@/lib/format";
import { useI18n } from "@/hooks/use-i18n";

export const Route = createFileRoute("/dashboard/balances")({
  head: () => ({
    meta: [{ title: "Soldes & impayés — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <BalancesPage />
    </RequireAuth>
  ),
});

function BalancesPage() {
  const { t, locale } = useI18n();
  const ledger = useFinanceLedger();
  const today = todayIso();
  const [view, setView] = useState<BalanceView>("owing");
  const [programId, setProgramId] = useState<string>("all");

  const all = useMemo(
    () =>
      ledger.data
        ? buildBalanceRows(ledger.data.enrollments, ledger.data.charges, ledger.data.paid, today)
        : [],
    [ledger.data, today],
  );
  const programs = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of all) if (r.programId) m.set(r.programId, r.programName ?? "—");
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);
  const rows = filterBalanceRows(all, view, programId);
  const totals = balanceTotals(rows);

  const money = (n: number) => formatDzd(n, locale);
  const enrollmentText = (r: BalanceRow) =>
    [r.programName, r.groupName].filter(Boolean).join(" · ") || "—";

  const handleExport = () => {
    if (rows.length === 0) {
      toast.error(t("entity.common.noRows"));
      return;
    }
    exportCsv(
      "soldes-impayes",
      rows.map((r) => ({
        [t("finance.col.student")]: r.studentName,
        [t("finance.col.enrollment")]: enrollmentText(r),
        [t("finance.col.due")]: r.balance.dueDzd,
        [t("finance.col.discount")]: r.balance.discountDzd,
        [t("finance.col.paid")]: r.balance.paidDzd,
        [t("finance.col.remaining")]: r.balance.remainingDzd,
        [t("finance.col.overdue")]: r.balance.overdueDzd,
        [t("finance.col.nextDue")]: r.balance.nextDue?.dueOn ?? "",
      })),
    );
    toast.success(t("finance.exported", { count: rows.length }));
  };

  const columns: Column<BalanceRow>[] = [
    {
      key: "student",
      header: t("finance.col.student"),
      sortValue: (r) => r.studentName,
      cell: (r) => (
        <div className="min-w-0">
          <Link
            to="/dashboard/students/$studentId"
            params={{ studentId: r.studentId }}
            className="focus-ring block truncate rounded font-medium hover:text-primary"
          >
            {r.studentName}
          </Link>
          <p className="truncate text-xs text-muted-foreground">{enrollmentText(r)}</p>
        </div>
      ),
    },
    {
      key: "due",
      header: t("finance.col.due"),
      className: "hidden text-end md:table-cell",
      sortValue: (r) => r.balance.dueDzd,
      cell: (r) => <span className="tabular-nums">{money(r.balance.dueDzd)}</span>,
    },
    {
      key: "discount",
      header: t("finance.col.discount"),
      className: "hidden text-end lg:table-cell",
      sortValue: (r) => r.balance.discountDzd,
      cell: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {r.balance.discountDzd > 0 ? money(r.balance.discountDzd) : "—"}
        </span>
      ),
    },
    {
      key: "paid",
      header: t("finance.col.paid"),
      className: "hidden text-end md:table-cell",
      sortValue: (r) => r.balance.paidDzd,
      cell: (r) => <span className="tabular-nums text-success">{money(r.balance.paidDzd)}</span>,
    },
    {
      key: "remaining",
      header: t("finance.col.remaining"),
      className: "text-end",
      sortValue: (r) => r.balance.remainingDzd,
      cell: (r) => (
        <div
          className="text-end"
          data-testid="balance-remaining"
          data-registration={r.registrationId}
        >
          <p className="font-semibold tabular-nums">{money(r.balance.remainingDzd)}</p>
          {r.balance.overdueDzd > 0 && (
            <p className="text-xs tabular-nums text-destructive">
              {t("finance.col.overdue")} {money(r.balance.overdueDzd)}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "next",
      header: t("finance.col.nextDue"),
      className: "hidden lg:table-cell",
      sortValue: (r) => r.balance.nextDue?.dueOn ?? "9999",
      cell: (r) =>
        r.oldestOverdueOn ? (
          <span className="text-xs text-destructive">
            {t("balances.since", { date: formatDate(r.oldestOverdueOn, locale) })}
          </span>
        ) : r.balance.nextDue ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatDate(r.balance.nextDue.dueOn, locale)} · {money(r.balance.nextDue.remainingDzd)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("balances.title")}
        description={t("balances.subtitle")}
        actions={
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={handleExport}
            data-testid="balances-export"
          >
            <Download className="size-4" aria-hidden /> {t("entity.common.export")}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5" data-testid="balances-kpis">
        <StatCard label={t("balances.kpi.due")} value={money(totals.dueDzd)} icon={Scale} />
        <StatCard
          label={t("balances.kpi.discount")}
          value={money(totals.discountDzd)}
          icon={Percent}
        />
        <StatCard
          label={t("balances.kpi.paid")}
          value={money(totals.paidDzd)}
          icon={Wallet}
          tone="success"
        />
        <StatCard
          label={t("balances.kpi.remaining")}
          value={money(totals.remainingDzd)}
          icon={HandCoins}
        />
        <StatCard
          label={t("balances.kpi.overdue")}
          value={money(totals.overdueDzd)}
          icon={AlertTriangle}
          tone="accent"
          hint={t("balances.kpi.overdueCount", { count: totals.overdueEnrollments })}
        />
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        isLoading={ledger.isLoading}
        error={ledger.error}
        onRetry={() => void ledger.refetch()}
        isRetrying={ledger.isFetching}
        rowKey={(r) => r.registrationId}
        pageSize={50}
        searchable={(r) => [r.studentName, r.groupName, r.programName].filter(Boolean).join(" ")}
        searchPlaceholder={t("finance.search")}
        emptyState={
          <EmptyState
            icon={Scale}
            title={t("balances.emptyTitle")}
            description={t("balances.emptyBody")}
          />
        }
        filters={
          <>
            <Select value={view} onValueChange={(v) => v && setView(v as BalanceView)}>
              <SelectTrigger
                className="h-9 w-48 rounded-xl"
                aria-label={t("balances.filter")}
                data-testid="balances-view"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["all", "owing", "overdue", "settled"] as const).map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(`balances.view.${v}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={programId} onValueChange={(v) => v && setProgramId(v)}>
              <SelectTrigger
                className="h-9 w-56 rounded-xl"
                aria-label={t("balances.filterFormation")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("finance.allFormations")}</SelectItem>
                {programs.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />
    </>
  );
}
