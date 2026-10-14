/**
 * The teacher list export control, and the document it produces.
 *
 * Built from the same parts as the student roster: `rosterMeta` for the letterhead,
 * `rosterFilename` for the name, `buildTabularDocx` for the Word file, `RosterPrintDocument`
 * for the printed page and `printRoster` for both printing and PDF. Only the columns and the
 * scope differ, which is the whole reason those four were made list-agnostic.
 *
 * WHAT YOU SEE IS WHAT YOU PRINT. The scope select feeds `buildTeacherRoster`, and the
 * printed document is rendered from that same array -- there is no second query behind the
 * export, so a filtered screen cannot produce an unfiltered file.
 *
 * AUTHORIZATION LIVES ON THE ROUTE. `/dashboard/teachers` is wrapped in
 * `RequireAuth roles={["admin"]}`, and the caller passes the rows it already holds; nothing
 * here re-decides who may read staff contact details.
 */

import { useMemo, useState } from "react";
import { FileText, Printer, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/hooks/use-i18n";
import { useBrand } from "@/hooks/use-brand";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { rosterFilename, rosterMeta } from "./roster-model";
import { buildTeacherRoster, type TeacherRosterSourceRow } from "./teacher-roster-model";
// The Word builder (the `docx` library, ~90 KB compressed) loads only when Word is clicked.
import type { DocumentLabels } from "./roster-export";
import { RosterPrintDocument, type PrintColumn } from "./roster-print-document";

export interface TeacherRosterExportProps {
  /** The teachers the viewer already holds. */
  source: TeacherRosterSourceRow[];
  /** The caller's live search box, so the document matches the screen. */
  search?: string;
}

export function TeacherRosterExport({ source, search = "" }: TeacherRosterExportProps) {
  const { t, locale } = useI18n();
  const { brand } = useBrand();
  const { notifySuccess, notifyError } = useActionFeedback();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(
    () => buildTeacherRoster(source, { scope: { status }, search }),
    [source, status, search],
  );

  // The same wording the status column shows, so the document cannot describe a teacher
  // differently from the screen it was printed from.
  const statusLabel = (value: string) =>
    value === "active" ? t("entity.teachers.statusActive") : t("entity.teachers.statusInactive");

  const scopeLabel = status ? statusLabel(status) : t("teacherRoster.allStatuses");

  const meta = useMemo(
    () =>
      rosterMeta({
        schoolName: brand.schoolName,
        title: t("teacherRoster.title"),
        groupName: scopeLabel,
        rows,
        locale,
      }),
    [brand.schoolName, t, scopeLabel, rows, locale],
  );

  const labels: DocumentLabels = {
    generatedOn: t("roster.generatedOn"),
    total: t("roster.total"),
  };

  const columns: PrintColumn[] = [
    { label: t("roster.number"), numeric: true },
    { label: t("teacherRoster.teacher") },
    { label: t("teacherRoster.email") },
    { label: t("teacherRoster.phone") },
    { label: t("teacherRoster.subjects") },
    { label: t("teacherRoster.groups"), numeric: true },
    { label: t("teacherRoster.status") },
  ];

  // An em dash rather than an empty cell: a blank in a printed table reads as a column that
  // slipped, while a dash reads as "we have no number for this person".
  const cells = (r: (typeof rows)[number]) => [
    String(r.index),
    r.teacherName,
    r.email ?? "—",
    r.phone ?? "—",
    r.subjects || "—",
    String(r.groupCount),
    statusLabel(r.status),
  ];

  const empty = rows.length === 0;

  const onWord = async () => {
    setBusy(true);
    try {
      const { exportTabularDocx } = await import("./roster-export");
      await exportTabularDocx(
        meta,
        columns.map((c) => c.label),
        rows.map(cells),
        labels,
        rosterFilename(meta, "docx", "teachers"),
      );
      notifySuccess("roster.exported");
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center print:hidden">
        <Select value={status ?? "all"} onValueChange={(v) => setStatus(v === "all" ? null : v)}>
          <SelectTrigger className="sm:w-64" aria-label={t("teacherRoster.scope")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("teacherRoster.allStatuses")}</SelectItem>
            <SelectItem value="active">{t("entity.teachers.statusActive")}</SelectItem>
            <SelectItem value="inactive">{t("entity.teachers.statusInactive")}</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={empty} onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden />
            {t("roster.print")}
          </Button>
          {/* The PDF path is the browser's own print pipeline -- see `roster-export.ts` for
              why no PDF library is used. The hint tells the user what to choose. */}
          <Button
            variant="outline"
            size="sm"
            disabled={empty}
            title={t("roster.pdfHint")}
            onClick={() => window.print()}
          >
            <FileText className="size-4" aria-hidden />
            {t("roster.pdf")}
          </Button>
          <Button variant="outline" size="sm" disabled={empty || busy} onClick={onWord}>
            <Table2 className="size-4" aria-hidden />
            {t("roster.word")}
          </Button>
        </div>

        {empty && <p className="text-xs text-muted-foreground">{t("teacherRoster.empty")}</p>}
      </div>

      <RosterPrintDocument
        meta={meta}
        columns={columns}
        rows={rows.map((r) => ({ key: r.teacherId, cells: cells(r) }))}
        labels={labels}
        logoUrl={brand.logoUrl}
      />
    </>
  );
}
