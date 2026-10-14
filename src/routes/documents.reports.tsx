/**
 * The financial report as a printable document (ADR-006 section 5): the same figures as
 * /dashboard/reports for the period in the URL (?from=YYYY-MM&to=YYYY-MM), laid out for A4. The
 * browser's print dialog saves it as PDF -- which also renders Arabic and right-to-left text
 * correctly, unlike a client-side PDF generator.
 */

import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { RequireAuth } from "@/features/auth/require-auth";
import { DocumentShell } from "@/features/finance/components/document-shell";
import {
  useBillingIdentity,
  useFinanceLedger,
  useFinanceReportRows,
} from "@/features/finance/queries";
import { buildReport, type Period } from "@/features/finance/reports-model";
import {
  AGEING_BUCKETS,
  ageingOf,
  balanceTotals,
  buildBalanceRows,
} from "@/features/finance/balances-model";
import { useFeeTypes } from "@/features/school/fees";
import { useFeeTypeName } from "@/features/school/fee-labels";
import { useBrand } from "@/hooks/use-brand";
import { useI18n } from "@/hooks/use-i18n";
import { formatDateTime, formatDzd, todayIso } from "@/lib/format";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function schoolYear(today: string): Period {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return m >= 9 ? { from: `${y}-09`, to: `${y + 1}-06` } : { from: `${y - 1}-09`, to: `${y}-06` };
}

export const Route = createFileRoute("/documents/reports")({
  validateSearch: (raw: Record<string, unknown>): Partial<Period> => {
    const out: Partial<Period> = {};
    if (typeof raw["from"] === "string" && MONTH.test(raw["from"])) out.from = raw["from"];
    if (typeof raw["to"] === "string" && MONTH.test(raw["to"])) out.to = raw["to"];
    return out;
  },
  head: () => ({
    meta: [{ title: "Rapport financier — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <ReportDocument />
    </RequireAuth>
  ),
});

function ReportDocument() {
  const { t, locale } = useI18n();
  const search = Route.useSearch();
  const today = todayIso();
  const fallback = schoolYear(today);
  const period: Period = { from: search.from ?? fallback.from, to: search.to ?? fallback.to };
  const rows = useFinanceReportRows();
  const ledger = useFinanceLedger();
  const identity = useBillingIdentity();
  const feeTypes = useFeeTypes();
  const typeName = useFeeTypeName(feeTypes.data ?? []);
  const { brand } = useBrand();

  const data = useMemo(
    () => buildReport(rows.data?.payments ?? [], rows.data?.charges ?? [], period),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows.data, period.from, period.to],
  );
  const balances = useMemo(
    () =>
      ledger.data
        ? buildBalanceRows(ledger.data.enrollments, ledger.data.charges, ledger.data.paid, today)
        : [],
    [ledger.data, today],
  );

  if (rows.isLoading || ledger.isLoading || identity.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  const now = balanceTotals(balances);
  const ageing = ageingOf(balances, today);
  const money = (n: number) => formatDzd(n, locale);
  const monthLabel = (ym: string) =>
    new Intl.DateTimeFormat(
      locale === "ar" ? "ar-DZ-u-nu-latn" : locale === "en" ? "en-GB" : "fr-FR",
      {
        month: "long",
        year: "numeric",
      },
    ).format(new Date(`${ym}-01T00:00:00Z`));
  const id = identity.data;

  return (
    <DocumentShell
      issuer={{
        schoolName: id?.schoolName ?? brand.schoolName,
        legalName: id?.legalName ?? null,
        address: id?.address ?? null,
        phone: id?.phone ?? null,
        logoUrl: id?.logoUrl ?? brand.logoUrl,
        nif: id?.nif ?? null,
        nis: id?.nis ?? null,
        rc: id?.rc ?? null,
        taxArticle: id?.taxArticle ?? null,
      }}
      title={t("reports.doc.title")}
      number={`${period.from} → ${period.to}`}
      voided={false}
      voidedLabel=""
      backTo="/dashboard/reports"
    >
      <p className="mb-4 text-xs text-neutral-600">
        {t("reports.doc.period", { from: monthLabel(period.from), to: monthLabel(period.to) })} ·{" "}
        {t("reports.doc.generatedAt", { date: formatDateTime(new Date().toISOString(), locale) })}
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="report-doc-kpis">
        {[
          [t("reports.kpi.received"), data.receivedDzd],
          [t("reports.kpi.charged"), data.chargedDzd],
          [t("reports.kpi.discounted"), data.discountedDzd],
          [t("reports.kpi.remaining"), now.remainingDzd],
          [t("reports.kpi.overdue"), now.overdueDzd],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-lg bg-neutral-100 px-3 py-2">
            <p className="text-[11px] text-neutral-600">{label}</p>
            <p className="text-sm font-bold tabular-nums">{money(value as number)}</p>
          </div>
        ))}
      </div>

      <DocTable
        title={t("reports.byMonth")}
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
        total={[
          t("finance.col.total"),
          money(data.receivedDzd),
          money(data.chargedDzd),
          money(data.discountedDzd),
        ]}
        empty={t("reports.noData")}
      />
      <DocTable
        title={t("reports.byMethod")}
        headers={[t("reports.col.method"), t("reports.col.count"), t("reports.col.received")]}
        rows={data.byMethod.map((m) => [
          t(`payments.method.${m.method}`),
          String(m.paymentCount),
          money(m.receivedDzd),
        ])}
        empty={t("reports.noData")}
      />
      <DocTable
        title={t("reports.byProgram")}
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
        empty={t("reports.noData")}
      />
      <DocTable
        title={t("reports.byFeeType")}
        headers={[t("reports.col.feeType"), t("reports.col.charged"), t("reports.col.discounted")]}
        rows={data.byFeeType.map((f) => [
          typeName(f.feeType),
          money(f.chargedDzd),
          money(f.discountedDzd),
        ])}
        empty={t("reports.noData")}
      />
      <DocTable
        title={t("reports.ageing")}
        headers={[t("reports.col.bucket"), t("reports.col.amount")]}
        rows={AGEING_BUCKETS.map((b) => [t(`reports.bucket.${b}`), money(ageing[b])])}
        total={[t("finance.col.total"), money(now.overdueDzd)]}
        empty={t("reports.noData")}
      />
    </DocumentShell>
  );
}

function DocTable({
  title,
  headers,
  rows,
  total,
  empty,
}: {
  title: string;
  headers: string[];
  rows: string[][];
  total?: string[];
  empty: string;
}) {
  return (
    <section className="mt-6 break-inside-avoid" data-testid="report-doc-table">
      <h2 className="mb-1 text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-neutral-500">{empty}</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-neutral-300 text-neutral-500">
              {headers.map((h, i) => (
                <th
                  key={h}
                  className={
                    i === 0 ? "py-1.5 text-start font-medium" : "py-1.5 text-end font-medium"
                  }
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-neutral-100">
                {r.map((c, j) => (
                  <td key={j} className={j === 0 ? "py-1.5 pe-3" : "py-1.5 text-end tabular-nums"}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
            {total && (
              <tr className="font-semibold">
                {total.map((c, j) => (
                  <td key={j} className={j === 0 ? "py-1.5 pe-3" : "py-1.5 text-end tabular-nums"}>
                    {c}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
