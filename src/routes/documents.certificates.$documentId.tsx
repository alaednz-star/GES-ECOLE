/**
 * A printable certificate (ADR-007): the frozen snapshot of the enrollment, written as the
 * certificate's text in the reader's language. Administrators, and the student it belongs to.
 */

import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { RequireAuth } from "@/features/auth/require-auth";
import { DocumentShell } from "@/features/finance/components/document-shell";
import { useOfficialDocument } from "@/features/operations/queries";
import { attendanceRate } from "@/features/operations/stats-model";
import { useBrand } from "@/hooks/use-brand";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate, formatDzd } from "@/lib/format";

export const Route = createFileRoute("/documents/certificates/$documentId")({
  head: () => ({
    meta: [{ title: "Attestation — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin", "student"]}>
      <CertificateDocument />
    </RequireAuth>
  ),
});

function CertificateDocument() {
  const { t, locale } = useI18n();
  const { documentId } = Route.useParams();
  const doc = useOfficialDocument(documentId);
  const { brand } = useBrand();

  if (doc.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }
  const d = doc.data;
  if (!d) return <p className="p-10 text-center text-muted-foreground">{t("docs.doc.notFound")}</p>;

  const s = d.snapshot as Record<string, string | number | null | undefined | unknown[]>;
  const str = (k: string) => (typeof s[k] === "string" ? (s[k] as string) : null);
  const num = (k: string) => Number(s[k] ?? 0);
  const issuer = d.issuer;
  const school = issuer["legal_name"] || issuer["school_name"] || brand.schoolName || "—";
  const born = str("date_of_birth")
    ? t("docs.doc.born", { date: formatDate(str("date_of_birth") as string, locale) })
    : "";
  const program = str("program_name")
    ? t("docs.doc.program", { program: str("program_name") as string })
    : "";
  const common = {
    school,
    student: d.studentName ?? "—",
    born,
    group: str("group_name") ?? "—",
    program,
  };

  let body: string;
  if (d.kind === "enrollment") {
    body = t("docs.doc.enrollment.body", {
      ...common,
      year: str("academic_year") ?? "—",
      date: str("enrolled_on") ? formatDate(str("enrolled_on") as string, locale) : "—",
    });
  } else if (d.kind === "attendance") {
    const counted = num("total") - num("excused");
    body =
      num("total") === 0
        ? t("docs.doc.attendance.none", common)
        : t("docs.doc.attendance.body", {
            ...common,
            attended: num("present") + num("late"),
            counted,
            from: str("first") ? formatDate(str("first") as string, locale) : "—",
            to: str("last") ? formatDate(str("last") as string, locale) : "—",
            rate:
              attendanceRate({
                present: num("present"),
                late: num("late"),
                excused: num("excused"),
                total: num("total"),
              }) ?? 0,
          });
  } else {
    body = t("docs.doc.payment.body", { ...common, amount: formatDzd(num("total_dzd"), locale) });
  }
  const payments = (Array.isArray(s["payments"]) ? s["payments"] : []) as {
    paid_on: string;
    amount_dzd: number;
    method: string;
  }[];

  return (
    <DocumentShell
      issuer={{
        schoolName: issuer["school_name"] ?? brand.schoolName,
        legalName: issuer["legal_name"] ?? null,
        address: issuer["address"] ?? null,
        phone: issuer["phone"] ?? null,
        logoUrl: issuer["logo_url"] ?? brand.logoUrl,
        nif: issuer["nif"] ?? null,
        nis: issuer["nis"] ?? null,
        rc: issuer["rc"] ?? null,
        taxArticle: issuer["tax_article"] ?? null,
      }}
      title={t(`docs.kind.${d.kind}`)}
      number={d.number}
      voided={d.status === "voided"}
      voidedLabel={t("invoices.doc.voided")}
      backTo="/dashboard/official-documents"
    >
      <p className="text-base leading-8" data-testid="certificate-body">
        {body}
      </p>
      {d.kind === "attendance" && num("total") > 0 && (
        <table className="mt-6 w-full max-w-sm text-sm">
          <tbody>
            {(["present", "late", "excused", "absent"] as const).map((k) => (
              <tr key={k} className="border-b border-neutral-100">
                <td className="py-1.5 text-neutral-600">{t(`docs.doc.${k}`)}</td>
                <td className="py-1.5 text-end tabular-nums">{num(k)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d.kind === "payment" && payments.length > 0 && (
        <table className="mt-6 w-full max-w-sm text-sm">
          <tbody>
            {payments.map((p, i) => (
              <tr key={i} className="border-b border-neutral-100">
                <td className="py-1.5 tabular-nums text-neutral-600">
                  {formatDate(p.paid_on, locale)}
                </td>
                <td className="py-1.5">{t(`payments.method.${p.method}`)}</td>
                <td className="py-1.5 text-end tabular-nums">{formatDzd(p.amount_dzd, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {str("withdrawn_on") && (
        <p className="mt-4 text-sm text-neutral-600">
          {t("docs.doc.withdrawn", { date: formatDate(str("withdrawn_on") as string, locale) })}
        </p>
      )}
      <p className="mt-8 text-sm">{t("docs.doc.closing")}</p>
      {d.status === "voided" && d.voidReason && (
        <p className="mt-4 text-xs font-medium text-red-600">
          {t("receipts.voidedBecause", { reason: d.voidReason })}
        </p>
      )}
      <div className="mt-12 flex items-end justify-between gap-6 text-sm text-neutral-600">
        <span>{t("docs.doc.madeOn", { date: formatDate(d.issuedAt, locale) })}</span>
        <span className="w-56 border-t border-neutral-400 pt-1 text-center text-xs">
          {t("docs.doc.signature")}
        </span>
      </div>
    </DocumentShell>
  );
}
