/**
 * A printable receipt (ADR-006 section 3): the snapshot stored when the payment was recorded.
 * Administrators, and the student it belongs to (RLS), may open it.
 */

import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { RequireAuth } from "@/features/auth/require-auth";
import { DocRow, DocumentShell } from "@/features/finance/components/document-shell";
import { useBillingIdentity, useReceipt } from "@/features/finance/queries";
import { useBrand } from "@/hooks/use-brand";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate, formatDateTime, formatDzd } from "@/lib/format";

export const Route = createFileRoute("/documents/receipts/$receiptId")({
  head: () => ({ meta: [{ title: "Reçu — Gestion École" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <RequireAuth roles={["admin", "student"]}>
      <ReceiptDocument />
    </RequireAuth>
  ),
});

function ReceiptDocument() {
  const { t, locale } = useI18n();
  const { receiptId } = Route.useParams();
  const receipt = useReceipt(receiptId);
  const identity = useBillingIdentity();
  const { brand } = useBrand();

  if (receipt.isLoading || identity.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }
  const r = receipt.data;
  if (!r) {
    return <p className="p-10 text-center text-muted-foreground">{t("receipts.doc.notFound")}</p>;
  }
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
      title={t("receipts.doc.title")}
      number={r.number}
      voided={r.status === "voided"}
      voidedLabel={t("receipts.doc.voided")}
      backTo="/dashboard/receipts"
    >
      <div className="space-y-1">
        <DocRow label={t("receipts.doc.receivedFrom")} value={r.studentName ?? "—"} />
        <DocRow
          label={t("receipts.doc.for")}
          value={[r.programName, r.groupName].filter(Boolean).join(" · ") || "—"}
        />
        <DocRow label={t("receipts.doc.date")} value={formatDate(r.paidOn, locale)} />
        <DocRow label={t("receipts.doc.method")} value={t(`payments.method.${r.method}`)} />
        {r.reference && (
          <DocRow
            label={t("receipts.doc.reference")}
            value={<span dir="ltr">{r.reference}</span>}
          />
        )}
      </div>
      <div className="mt-6 flex items-center justify-between rounded-xl bg-neutral-100 px-5 py-4">
        <span className="font-medium">{t("receipts.doc.amount")}</span>
        <span className="text-2xl font-bold tabular-nums" data-testid="doc-amount">
          {formatDzd(r.amountDzd, locale)}
        </span>
      </div>
      {r.status === "voided" && r.voidReason && (
        <p className="mt-4 text-xs font-medium text-red-600">
          {t("receipts.voidedBecause", { reason: r.voidReason })}
        </p>
      )}
      <div className="mt-10 flex items-end justify-between gap-6 text-xs text-neutral-600">
        <span>{t("receipts.doc.issuedAt", { date: formatDateTime(r.issuedAt, locale) })}</span>
        <span className="w-48 border-t border-neutral-400 pt-1 text-center">
          {t("receipts.doc.signature")}
        </span>
      </div>
    </DocumentShell>
  );
}
