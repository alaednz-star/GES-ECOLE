/**
 * The printable frame of a financial document (receipt, invoice): the issuer's identity at the
 * top, the document below, and a print / back bar that disappears on paper. A4 width on screen;
 * the browser's print produces the PDF. Rendered OUTSIDE the dashboard layout (/documents/...).
 */

import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";

export interface Issuer {
  schoolName: string | null;
  legalName?: string | null;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
  nif?: string | null;
  nis?: string | null;
  rc?: string | null;
  taxArticle?: string | null;
}

export function DocumentShell({
  issuer,
  title,
  number,
  voided,
  voidedLabel,
  backTo,
  children,
}: {
  issuer: Issuer;
  title: string;
  number: string;
  voided: boolean;
  voidedLabel: string;
  backTo:
    | "/dashboard/receipts"
    | "/dashboard/invoices"
    | "/dashboard/reports"
    | "/dashboard/timetables"
    | "/dashboard/official-documents"
    | "/dashboard/grades";
  children: ReactNode;
}) {
  const { t, dir } = useI18n();
  const legal = [
    issuer.nif && `${t("invoices.nif")} : ${issuer.nif}`,
    issuer.nis && `${t("invoices.nis")} : ${issuer.nis}`,
    issuer.rc && `${t("invoices.rc")} : ${issuer.rc}`,
    issuer.taxArticle && `${t("invoices.taxArticle")} : ${issuer.taxArticle}`,
  ].filter(Boolean);

  return (
    <div dir={dir} className="min-h-dvh bg-muted/40 px-4 py-6 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost" size="sm" className="rounded-xl">
          <Link to={backTo}>
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
            {t("finance.back")}
          </Link>
        </Button>
        <p className="hidden flex-1 text-center text-xs text-muted-foreground sm:block">
          {t("finance.pdfHint")}
        </p>
        <Button
          size="sm"
          className="rounded-xl"
          onClick={() => window.print()}
          data-testid="doc-print"
        >
          <Printer className="size-4" aria-hidden />
          {t("finance.print")}
        </Button>
      </div>

      <article
        data-testid="document"
        data-print-document
        className="relative mx-auto max-w-[210mm] overflow-hidden rounded-2xl border border-border bg-white p-6 text-sm text-neutral-900 shadow-sm sm:p-10 print:rounded-none print:border-0 print:shadow-none"
      >
        {voided && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 grid place-items-center text-6xl font-black tracking-widest text-red-600/15 sm:text-8xl"
          >
            <span className="-rotate-12">{voidedLabel}</span>
          </div>
        )}
        <header className="flex items-start justify-between gap-6 border-b border-neutral-200 pb-6">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            {issuer.logoUrl && (
              <img
                src={issuer.logoUrl}
                alt=""
                className="size-14 shrink-0 rounded-lg object-contain"
              />
            )}
            <div className="min-w-0">
              <p className="text-base font-semibold">
                {issuer.legalName || issuer.schoolName || "—"}
              </p>
              {issuer.legalName && issuer.schoolName && (
                <p className="text-xs text-neutral-600">{issuer.schoolName}</p>
              )}
              {issuer.address && <p className="text-xs text-neutral-600">{issuer.address}</p>}
              {issuer.phone && (
                <p className="text-xs text-neutral-600" dir="ltr">
                  {issuer.phone}
                </p>
              )}
              {legal.length > 0 && (
                <p className="mt-1 text-[11px] text-neutral-500">{legal.join(" · ")}</p>
              )}
            </div>
          </div>
          <div className="shrink-0 text-end">
            <p className="text-xl font-bold uppercase tracking-wide">{title}</p>
            <p className="font-mono text-sm" dir="ltr" data-testid="doc-number">
              {number}
            </p>
            {voided && (
              <p className={cn("mt-1 text-xs font-semibold text-red-600")}>{voidedLabel}</p>
            )}
          </div>
        </header>
        <div className="pt-6">{children}</div>
      </article>
    </div>
  );
}

export function DocRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-neutral-200 py-2">
      <span className="text-neutral-600">{label}</span>
      <span className="text-end font-medium">{value}</span>
    </div>
  );
}
