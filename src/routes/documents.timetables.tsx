/**
 * The timetable as a printable document (ADR-007): same view as /dashboard/timetables, laid out
 * for paper. The browser's print dialog saves it as PDF.
 */

import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { RequireAuth } from "@/features/auth/require-auth";
import { DocumentShell } from "@/features/finance/components/document-shell";
import { useBillingIdentity } from "@/features/finance/queries";
import { TimetableGrid } from "@/features/operations/components/timetable-grid";
import { parseTimetableSearch } from "@/features/operations/timetable-search";
import { useTimetable } from "@/features/operations/use-timetable";
import type { TimetableView } from "@/features/operations/timetable-model";
import { useBrand } from "@/hooks/use-brand";
import { useI18n } from "@/hooks/use-i18n";

export const Route = createFileRoute("/documents/timetables")({
  validateSearch: parseTimetableSearch,
  head: () => ({
    meta: [{ title: "Emploi du temps — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <TimetableDocument />
    </RequireAuth>
  ),
});

function TimetableDocument() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const view: TimetableView = search.view ?? "all";
  const id = view === "all" ? null : (search.id ?? null);
  const tt = useTimetable({ view, id });
  const identity = useBillingIdentity();
  const { brand } = useBrand();

  if (tt.isLoading || identity.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }
  const subject =
    view === "all"
      ? t("timetable.view.all")
      : (tt.options[view].find((o) => o.id === id)?.label ?? t(`timetable.view.${view}`));
  const idn = identity.data;

  return (
    <DocumentShell
      issuer={{
        schoolName: idn?.schoolName ?? brand.schoolName,
        legalName: idn?.legalName ?? null,
        address: idn?.address ?? null,
        phone: idn?.phone ?? null,
        logoUrl: idn?.logoUrl ?? brand.logoUrl,
      }}
      title={t("timetable.doc.title")}
      number={subject}
      voided={false}
      voidedLabel=""
      backTo="/dashboard/timetables"
    >
      {tt.blocks.length === 0 ? (
        <p className="text-sm text-neutral-500">{t("timetable.empty")}</p>
      ) : (
        <TimetableGrid blocks={tt.blocks} printable />
      )}
    </DocumentShell>
  );
}
