/**
 * The report card (bulletin) of one student for one period, as a printable document (ADR-008).
 *
 * One line per enrolled group: the student's weighted average /20, the class average, the rank and
 * the teacher's remark; then the general average (mean of the group averages), its mention and
 * the administration's remark. Everything is derived at display time from the scores; nothing is
 * frozen. A teacher only sees the lines of their own groups (RLS).
 */

import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { RequireAuth } from "@/features/auth/require-auth";
import { DocRow, DocumentShell } from "@/features/finance/components/document-shell";
import { useBillingIdentity } from "@/features/finance/queries";
import { generalAverage, groupMatrix, mentionOf } from "@/features/pedagogy/grades-model";
import { formatMark, parsePedSearch } from "@/features/pedagogy/ped-search";
import { usePeriods, useReportCard } from "@/features/pedagogy/queries";
import { useGroups } from "@/features/school/queries";
import { useBrand } from "@/hooks/use-brand";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/documents/report-cards")({
  validateSearch: parsePedSearch,
  head: () => ({
    meta: [{ title: "Bulletin — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin", "teacher"]}>
      <ReportCardDocument />
    </RequireAuth>
  ),
});

function ReportCardDocument() {
  const { t, locale } = useI18n();
  const search = Route.useSearch();
  const periods = usePeriods();
  const period = (periods.data ?? []).find((p) => p.id === search.period) ?? null;
  const card = useReportCard(period, search.student ?? null);
  const groups = useGroups();
  const identity = useBillingIdentity();
  const { brand } = useBrand();

  const lines = useMemo(() => {
    if (!card.data) return [];
    const byId = new Map((groups.data ?? []).map((g) => [g.id, g]));
    return card.data.groups
      .map((g) => {
        const m = groupMatrix(g.assessments, card.data.scores, g.roster);
        const mine = m.rows.find((r) => r.student.studentId === card.data.student.id);
        const group = byId.get(g.groupId);
        return {
          groupId: g.groupId,
          name: group?.name ?? "—",
          subject: group?.subjectName ?? null,
          teacher: group?.teacherName ?? null,
          assessments: g.assessments.length,
          average: mine?.average ?? null,
          rank: mine?.rank ?? null,
          classSize: m.classStats.count,
          classAverage: m.classStats.average,
          remark: card.data.comments.find((c) => c.groupId === g.groupId)?.comment ?? null,
        };
      })
      .filter((l) => l.assessments > 0 || l.remark)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [card.data, groups.data]);

  if (periods.isLoading || card.isLoading || groups.isLoading || identity.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  const idn = identity.data;
  const general = generalAverage(lines.map((l) => l.average));
  const mention = mentionOf(general);
  const generalRemark = card.data?.comments.find((c) => c.groupId === null)?.comment ?? null;

  return (
    <DocumentShell
      issuer={{
        schoolName: idn?.schoolName ?? brand.schoolName,
        legalName: idn?.legalName ?? null,
        address: idn?.address ?? null,
        phone: idn?.phone ?? null,
        logoUrl: idn?.logoUrl ?? brand.logoUrl,
      }}
      title={t("reportCard.title")}
      number={
        period ? `${period.name}${period.academicYear ? ` · ${period.academicYear}` : ""}` : "—"
      }
      voided={false}
      voidedLabel=""
      backTo="/dashboard/grades"
    >
      {!period || !card.data ? (
        <p className="text-sm text-neutral-500" data-testid="report-card-missing">
          {t("reportCard.missing")}
        </p>
      ) : (
        <div className="space-y-6" data-testid="report-card">
          <div className="grid gap-x-8 sm:grid-cols-2">
            <DocRow
              label={t("reportCard.student")}
              value={<span data-testid="report-card-student">{card.data.student.fullName}</span>}
            />
            <DocRow
              label={t("reportCard.birth")}
              value={
                card.data.student.dateOfBirth
                  ? formatDate(card.data.student.dateOfBirth, locale)
                  : "—"
              }
            />
            <DocRow
              label={t("reportCard.period")}
              value={`${formatDate(period.startsOn, locale)} – ${formatDate(period.endsOn, locale)}`}
            />
            <DocRow
              label={t("reportCard.issuedOn")}
              value={formatDate(new Date().toISOString(), locale)}
            />
          </div>

          {lines.length === 0 ? (
            <p className="text-sm text-neutral-500">{t("reportCard.empty")}</p>
          ) : (
            <table className="w-full border-collapse text-sm" data-testid="report-card-lines">
              <thead>
                <tr className="border-b-2 border-neutral-300 text-xs text-neutral-600">
                  <th className="py-2 text-start font-medium">{t("reportCard.course")}</th>
                  <th className="px-2 py-2 text-center font-medium">{t("reportCard.average")}</th>
                  <th className="px-2 py-2 text-center font-medium">
                    {t("reportCard.classAverage")}
                  </th>
                  <th className="px-2 py-2 text-center font-medium">{t("reportCard.rank")}</th>
                  <th className="py-2 text-start font-medium">{t("reportCard.remark")}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr
                    key={l.groupId}
                    className="border-b border-neutral-200 align-top"
                    data-testid="report-card-line"
                  >
                    <td className="py-2 pe-2">
                      <p className="font-medium">{l.subject ?? l.name}</p>
                      <p className="text-xs text-neutral-500">
                        {l.subject ? l.name : ""}
                        {l.teacher ? `${l.subject ? " · " : ""}${l.teacher}` : ""}
                      </p>
                    </td>
                    <td
                      className="px-2 py-2 text-center font-semibold tabular-nums"
                      data-testid="report-card-average"
                    >
                      {formatMark(l.average, locale)}
                    </td>
                    <td className="px-2 py-2 text-center tabular-nums">
                      {formatMark(l.classAverage, locale)}
                    </td>
                    <td className="px-2 py-2 text-center tabular-nums">
                      {l.rank === null ? "—" : `${l.rank}/${l.classSize}`}
                    </td>
                    <td className="py-2 text-xs text-neutral-700">{l.remark ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="rounded-xl border border-neutral-300 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold">{t("reportCard.general")}</p>
              <p className="text-xl font-bold tabular-nums" data-testid="report-card-general">
                {general === null ? "—" : `${formatMark(general, locale)} / 20`}
              </p>
            </div>
            {mention && (
              <p className="mt-1 text-sm" data-testid="report-card-mention">
                {t("reportCard.mention")} :{" "}
                <span className="font-medium">{t(`grades.mention.${mention}`)}</span>
              </p>
            )}
            {generalRemark && (
              <p className="mt-3 border-t border-neutral-200 pt-3 text-sm">
                <span className="font-medium">{t("reportCard.generalRemark")} : </span>
                {generalRemark}
              </p>
            )}
          </div>

          <p className="text-[11px] text-neutral-500">{t("reportCard.rule")}</p>

          <div className="grid grid-cols-2 gap-8 pt-6 text-xs text-neutral-600">
            <div>
              <p>{t("reportCard.signDirection")}</p>
              <div className="mt-12 border-t border-neutral-300" />
            </div>
            <div>
              <p>{t("reportCard.signParent")}</p>
              <div className="mt-12 border-t border-neutral-300" />
            </div>
          </div>
        </div>
      )}
    </DocumentShell>
  );
}
