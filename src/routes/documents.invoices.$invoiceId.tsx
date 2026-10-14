/**
 * A printable invoice (ADR-006 section 4): the frozen snapshot, issuer included -- later changes
 * to fees, payments or the billing identity never alter an invoice already issued.
 */

import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { RequireAuth } from "@/features/auth/require-auth";
import { DocumentShell } from "@/features/finance/components/document-shell";
import { useInvoice } from "@/features/finance/queries";
import { useFeeTypes } from "@/features/school/fees";
import { useChargeTitle } from "@/features/school/fee-labels";
import { useBrand } from "@/hooks/use-brand";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate, formatDzd } from "@/lib/format";

export const Route = createFileRoute("/documents/invoices/$invoiceId")({
  head: () => ({ meta: [{ title: "Facture — Gestion École" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <RequireAuth roles={["admin", "student"]}>
      <InvoiceDocument />
    </RequireAuth>
  ),
});

function InvoiceDocument() {
  const { t, locale } = useI18n();
  const { invoiceId } = Route.useParams();
  const invoice = useInvoice(invoiceId);
  const feeTypes = useFeeTypes();
  const chargeTitle = useChargeTitle(feeTypes.data ?? []);
  const { brand } = useBrand();

  if (invoice.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }
  const inv = invoice.data;
  if (!inv)
    return <p className="p-10 text-center text-muted-foreground">{t("invoices.doc.notFound")}</p>;
  const money = (n: number) => formatDzd(n, locale);
  const issuer = inv.issuer;

  return (
    <DocumentShell
      issuer={{
        ...issuer,
        schoolName: issuer.schoolName ?? brand.schoolName,
        logoUrl: issuer.logoUrl ?? brand.logoUrl,
      }}
      title={t("invoices.doc.title")}
      number={inv.number}
      voided={inv.status === "voided"}
      voidedLabel={t("invoices.doc.voided")}
      backTo="/dashboard/invoices"
    >
      <div className="mb-6 flex flex-wrap justify-between gap-4">
        <div>
          <p className="text-xs text-neutral-500">{t("invoices.doc.billedTo")}</p>
          <p className="font-semibold">{inv.studentName ?? "—"}</p>
          <p className="text-xs text-neutral-600">
            {[inv.programName, inv.groupName].filter(Boolean).join(" · ")}
          </p>
        </div>
        <p className="text-xs text-neutral-600">
          {t("invoices.doc.issuedAt", { date: formatDate(inv.issuedAt, locale) })}
        </p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-300 text-xs text-neutral-500">
            <th className="py-2 text-start font-medium">{t("invoices.doc.line")}</th>
            <th className="py-2 text-start font-medium">{t("invoices.doc.installments")}</th>
            <th className="py-2 text-end font-medium">{t("finance.col.amount")}</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l) => (
            <tr
              key={l.chargeId}
              className="border-b border-neutral-100 align-top"
              data-testid="doc-line"
            >
              <td className="py-2 pe-3 font-medium">{chargeTitle(l)}</td>
              <td className="py-2 pe-3 text-xs tabular-nums text-neutral-600">
                {l.installments
                  .map((i) => `${formatDate(i.dueOn, locale)} · ${money(i.amountDzd)}`)
                  .join(" — ")}
              </td>
              <td className="py-2 text-end tabular-nums">{money(l.amountDzd)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ms-auto mt-6 w-full max-w-xs space-y-1 text-sm tabular-nums">
        <div className="flex justify-between">
          <span className="text-neutral-600">{t("invoices.doc.subtotal")}</span>
          <span>{money(inv.totalDzd)}</span>
        </div>
        {inv.discounts.map((d, i) => (
          <div key={i} className="flex justify-between text-neutral-600">
            <span className="truncate pe-2">{d.label}</span>
            <span>−{money(d.amountDzd)}</span>
          </div>
        ))}
        <div className="flex justify-between">
          <span className="text-neutral-600">{t("invoices.doc.paid")}</span>
          <span>−{money(inv.paidDzd)}</span>
        </div>
        <div className="mt-2 flex justify-between rounded-lg bg-neutral-100 px-3 py-2 text-base font-bold">
          <span>{t("invoices.doc.balance")}</span>
          <span data-testid="doc-balance">{money(inv.balanceDzd)}</span>
        </div>
      </div>
      {inv.status === "voided" && inv.voidReason && (
        <p className="mt-4 text-xs font-medium text-red-600">
          {t("receipts.voidedBecause", { reason: inv.voidReason })}
        </p>
      )}
    </DocumentShell>
  );
}
