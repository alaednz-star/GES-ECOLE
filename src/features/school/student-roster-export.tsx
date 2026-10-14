/**
 * The roster export control, and the document it produces.
 *
 * ONE COMPONENT, TWO CALLERS. The students page and a group page both need this, and the
 * brief is explicit that the buttons must not be duplicated. Everything role-specific stays
 * outside: the caller passes the registrations it can already see, so a teacher's export is
 * scoped by the same RLS that scoped their screen, and this file contains no authorization
 * logic to get out of step with it.
 *
 * WHAT YOU SEE IS WHAT YOU PRINT. The scope select and the caller's search both feed
 * `buildRoster`, and the printed document is rendered from that same array -- there is no
 * second query behind the export, so a filtered screen cannot produce an unfiltered file.
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
import { buildRoster, rosterFilename, rosterMeta, type RosterSourceRow } from "./roster-model";
// The Word builder (the `docx` library, ~90 KB compressed) loads only when Word is clicked.
import type { RosterLabels } from "./roster-export";
import { RosterPrintDocument, type PrintColumn } from "./roster-print-document";

export interface StudentRosterExportProps {
  /** Registrations the viewer can already see. RLS decided this, not us. */
  source: RosterSourceRow[];
  /** Groups offered in the scope select -- the caller's own authorized list. */
  groups: { id: string; name: string }[];
  /** Preselects a group when opened from a group page. */
  initialGroupId?: string | null;
  /** The caller's live search box, so the document matches the screen. */
  search?: string;
}

export function StudentRosterExport({
  source,
  groups,
  initialGroupId = null,
  search = "",
}: StudentRosterExportProps) {
  const { t, locale } = useI18n();
  const { brand } = useBrand();
  const { notifySuccess, notifyError } = useActionFeedback();
  const [groupId, setGroupId] = useState<string | null>(initialGroupId);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(
    () => buildRoster(source, { scope: { groupId }, search }),
    [source, groupId, search],
  );

  const meta = useMemo(
    () =>
      rosterMeta({
        schoolName: brand.schoolName,
        title: t("roster.title"),
        groupName: groupId ? (groups.find((g) => g.id === groupId)?.name ?? null) : null,
        rows,
        locale,
      }),
    [brand.schoolName, t, groupId, groups, rows, locale],
  );

  const labels: RosterLabels = {
    number: t("roster.number"),
    student: t("roster.student"),
    group: t("roster.group"),
    subject: t("roster.subject"),
    level: t("roster.level"),
    generatedOn: t("roster.generatedOn"),
    total: t("roster.total"),
  };

  const printColumns: PrintColumn[] = [
    { label: labels.number, numeric: true },
    { label: labels.student },
    { label: labels.group },
    { label: labels.subject },
    { label: labels.level },
  ];

  const empty = rows.length === 0;

  const onWord = async () => {
    setBusy(true);
    try {
      const { exportRosterDocx } = await import("./roster-export");
      await exportRosterDocx(meta, rows, labels, rosterFilename(meta, "docx"));
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
        <Select value={groupId ?? "all"} onValueChange={(v) => setGroupId(v === "all" ? null : v)}>
          <SelectTrigger className="sm:w-64" aria-label={t("roster.scope")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("roster.allGroups")}</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
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

        {empty && <p className="text-xs text-muted-foreground">{t("roster.empty")}</p>}
      </div>

      <RosterPrintDocument
        meta={meta}
        columns={printColumns}
        rows={rows.map((r) => ({
          key: `${r.studentId}-${r.groupName}`,
          cells: [
            String(r.index),
            r.studentName,
            r.groupName,
            r.subjectName ?? "—",
            r.levelName ?? "—",
          ],
        }))}
        labels={labels}
        logoUrl={brand.logoUrl}
      />
    </>
  );
}
