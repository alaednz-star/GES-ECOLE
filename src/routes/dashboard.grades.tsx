/**
 * Notes & bulletins (ADR-008): a group's results for a period -- every score, each student's
 * weighted average /20 and rank, the class figures -- the report-card remarks, and the link to
 * each student's printable report card.
 *
 * Averages are derived (grades-model), never stored. Periods are set by administrators; without
 * periods, the whole year is shown and remarks wait for a period.
 */

import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Award, CalendarRange, FileText, Loader2, MessageSquareText } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RequireAuth } from "@/features/auth/require-auth";
import { Figure, GroupSelect, usePedGroups } from "@/features/pedagogy/components/ped-groups";
import { PeriodsDialog } from "@/features/pedagogy/components/period-dialogs";
import {
  groupMatrix,
  inPeriod,
  indexScores,
  mentionOf,
  periodOf,
  scoreFor,
} from "@/features/pedagogy/grades-model";
import { formatMark, parsePedSearch } from "@/features/pedagogy/ped-search";
import {
  useAssessments,
  useGroupRoster,
  usePeriods,
  useReportComments,
  useSaveReportComment,
  useScores,
} from "@/features/pedagogy/queries";
import type { ReportComment } from "@/features/pedagogy/types";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/grades")({
  validateSearch: parsePedSearch,
  head: () => ({
    meta: [{ title: "Notes & bulletins — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin", "teacher"]}>
      <GradesPage />
    </RequireAuth>
  ),
});

const YEAR = "__year__";

function GradesPage() {
  const { t, locale } = useI18n();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/dashboard/grades" });
  const { groups, isAdmin, isLoading, error, refetch } = usePedGroups();
  const periods = usePeriods();
  const [managing, setManaging] = useState(false);
  const [remarkFor, setRemarkFor] = useState<{ studentId: string; fullName: string } | null>(null);

  const periodList = periods.data ?? [];
  // Default: the period containing today, else the latest one, else the whole year.
  const fallbackPeriod =
    periodOf(todayIso(), periodList)?.id ?? periodList[periodList.length - 1]?.id ?? null;
  const periodId = search.period ?? fallbackPeriod;
  const period = periodList.find((p) => p.id === periodId) ?? null;
  const groupId = search.group ?? groups[0]?.id ?? null;
  const group = groups.find((g) => g.id === groupId) ?? null;

  const assessments = useAssessments(groupId);
  const roster = useGroupRoster(groupId);
  const list = useMemo(
    () =>
      [...inPeriod(assessments.data ?? [], period)].sort((a, b) =>
        a.heldOn.localeCompare(b.heldOn),
      ),
    [assessments.data, period],
  );
  const scores = useScores(list.map((a) => a.id));
  const comments = useReportComments(period?.id ?? null);
  const matrix = useMemo(
    () => groupMatrix(list, scores.data ?? [], roster.data ?? []),
    [list, scores.data, roster.data],
  );
  const index = useMemo(() => indexScores(scores.data ?? []), [scores.data]);
  const remarkOf = useMemo(() => {
    const m = new Map<string, ReportComment>();
    for (const c of comments.data ?? []) {
      if (c.groupId === groupId) m.set(c.studentId, c);
    }
    return m;
  }, [comments.data, groupId]);

  const setSearch = (patch: { group?: string | null; period?: string | null }) => {
    const next = {
      group: patch.group !== undefined ? patch.group : (search.group ?? null),
      period: patch.period !== undefined ? patch.period : (search.period ?? null),
    };
    void navigate({
      search: {
        ...(next.group ? { group: next.group } : {}),
        ...(next.period ? { period: next.period } : {}),
      },
      replace: true,
    });
  };

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const loadingData = assessments.isLoading || roster.isLoading || scores.isLoading;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("grades.title")}
        description={t("grades.subtitle")}
        actions={
          isAdmin && (
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setManaging(true)}
              data-testid="periods-manage"
            >
              <CalendarRange className="size-4" aria-hidden /> {t("grades.periods.manage")}
            </Button>
          )
        }
      />

      {isLoading || periods.isLoading ? (
        <Skeleton className="h-10 w-72 rounded-xl" />
      ) : groups.length === 0 ? (
        <EmptyState icon={Award} title={t("ped.noGroups")} description={t("ped.noGroupsBody")} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={period?.id ?? YEAR}
              onValueChange={(v) => {
                if (!v || v === (period?.id ?? YEAR)) return;
                setSearch({ period: v === YEAR ? null : v });
              }}
            >
              <SelectTrigger className="h-10 w-full rounded-xl sm:w-56" data-testid="grades-period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {periodList.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.academicYear ? ` · ${p.academicYear}` : ""}
                  </SelectItem>
                ))}
                {periodList.length === 0 && (
                  <SelectItem value={YEAR}>{t("grades.wholeYear")}</SelectItem>
                )}
              </SelectContent>
            </Select>
            <GroupSelect
              groups={groups}
              value={groupId}
              onChange={(id) => setSearch({ group: id })}
            />
          </div>

          {periodList.length === 0 && (
            <p
              className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground"
              data-testid="grades-no-periods"
            >
              {t(isAdmin ? "grades.noPeriodsAdmin" : "grades.noPeriodsTeacher")}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Figure
              label={t("grades.classAverage")}
              value={formatMark(matrix.classStats.average, locale)}
              testId="grades-class-average"
            />
            <Figure label={t("grades.min")} value={formatMark(matrix.classStats.min, locale)} />
            <Figure label={t("grades.max")} value={formatMark(matrix.classStats.max, locale)} />
            <Figure
              label={t("grades.assessmentsCount")}
              value={list.length}
              testId="grades-assessments"
            />
          </div>

          {loadingData ? (
            <Skeleton className="h-48 rounded-2xl" />
          ) : assessments.error || roster.error || scores.error ? (
            <ErrorState
              error={assessments.error ?? roster.error ?? scores.error}
              onRetry={() => {
                void assessments.refetch();
                void roster.refetch();
              }}
            />
          ) : (roster.data ?? []).length === 0 ? (
            <EmptyState
              icon={Award}
              title={t("grades.noStudents")}
              description={t("grades.noStudentsBody")}
            />
          ) : (
            <div className="surface-card overflow-x-auto p-0">
              <table className="w-full min-w-max text-sm" data-testid="grades-matrix">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="sticky start-0 z-10 bg-card px-3 py-2 text-start font-medium">
                      {t("grades.student")}
                    </th>
                    {list.map((a) => (
                      <th key={a.id} className="px-2 py-2 text-center font-medium" title={a.title}>
                        <span className="block max-w-28 truncate text-foreground">
                          {a.title}
                          {!a.published && <span className="text-accent"> *</span>}
                        </span>
                        <span className="block tabular-nums">
                          {formatDate(a.heldOn, locale)} · /{formatMark(a.maxScore, locale)} · ×
                          {formatMark(a.coefficient, locale)}
                        </span>
                      </th>
                    ))}
                    <th className="px-3 py-2 text-center font-medium">{t("grades.average")}</th>
                    <th className="px-3 py-2 text-center font-medium">{t("grades.rank")}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows.map((r) => {
                    const remark = remarkOf.get(r.student.studentId);
                    return (
                      <tr
                        key={r.student.studentId}
                        className="border-b border-border last:border-0"
                        data-testid="grades-row"
                        data-student={r.student.studentId}
                      >
                        <td className="sticky start-0 z-10 bg-card px-3 py-2 font-medium">
                          {r.student.fullName}
                          {remark && (
                            <span className="block max-w-56 truncate text-xs font-normal text-muted-foreground">
                              {remark.comment}
                            </span>
                          )}
                        </td>
                        {list.map((a) => {
                          const s = scoreFor(index, a.id, r.student.studentId);
                          return (
                            <td key={a.id} className="px-2 py-2 text-center tabular-nums">
                              {s?.absent ? (
                                <span className="text-xs text-destructive">{t("grades.abs")}</span>
                              ) : s && s.score !== null ? (
                                formatMark(s.score, locale)
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td
                          className={cn(
                            "px-3 py-2 text-center font-semibold tabular-nums",
                            r.average !== null && r.average < 10 && "text-destructive",
                          )}
                          data-testid="grades-average"
                        >
                          {formatMark(r.average, locale)}
                        </td>
                        <td
                          className="px-3 py-2 text-center tabular-nums"
                          data-testid="grades-rank"
                        >
                          {r.rank === null ? "—" : `${r.rank}/${matrix.classStats.count}`}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            {period && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 rounded-lg"
                                  aria-label={t("grades.remark")}
                                  title={t("grades.remark")}
                                  onClick={() => setRemarkFor(r.student)}
                                  data-testid="grades-remark"
                                >
                                  <MessageSquareText className="size-4" aria-hidden />
                                </Button>
                                <Button
                                  asChild
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 rounded-lg"
                                  aria-label={t("grades.reportCard")}
                                  title={t("grades.reportCard")}
                                >
                                  <Link
                                    to="/documents/report-cards"
                                    search={{ period: period.id, student: r.student.studentId }}
                                    data-testid="grades-report-card"
                                  >
                                    <FileText className="size-4" aria-hidden />
                                  </Link>
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {list.some((a) => !a.published) && (
                <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                  <span className="text-accent">*</span> {t("grades.draftNote")}
                </p>
              )}
            </div>
          )}
          {matrix.classStats.average !== null && (
            <p className="text-xs text-muted-foreground">{t("grades.rule")}</p>
          )}
        </>
      )}

      {managing && <PeriodsDialog periods={periodList} onClose={() => setManaging(false)} />}
      {remarkFor && period && group && (
        <RemarkDialog
          student={remarkFor}
          periodId={period.id}
          groupId={group.id}
          groupName={group.name}
          isAdmin={isAdmin}
          comments={comments.data ?? []}
          average={
            matrix.rows.find((r) => r.student.studentId === remarkFor.studentId)?.average ?? null
          }
          onClose={() => setRemarkFor(null)}
        />
      )}
    </div>
  );
}

function RemarkDialog({
  student,
  periodId,
  groupId,
  groupName,
  isAdmin,
  comments,
  average,
  onClose,
}: {
  student: { studentId: string; fullName: string };
  periodId: string;
  groupId: string;
  groupName: string;
  isAdmin: boolean;
  comments: ReportComment[];
  average: number | null;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const save = useSaveReportComment();
  const groupRemark = comments.find(
    (c) => c.studentId === student.studentId && c.groupId === groupId,
  );
  const general = comments.find((c) => c.studentId === student.studentId && c.groupId === null);
  const [text, setText] = useState(groupRemark?.comment ?? "");
  const [generalText, setGeneralText] = useState(general?.comment ?? "");
  const tooLong = text.trim().length > 500 || generalText.trim().length > 500;
  const mention = mentionOf(average);

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-start">{student.fullName}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {t("grades.average")} : {formatMark(average, locale)}
          {mention && ` · ${t(`grades.mention.${mention}`)}`}
        </p>
        <form
          className="space-y-3"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            if (tooLong) return;
            try {
              if (text.trim() !== (groupRemark?.comment ?? "")) {
                await save.mutateAsync({
                  id: groupRemark?.id ?? null,
                  periodId,
                  studentId: student.studentId,
                  groupId,
                  comment: text,
                });
              }
              if (isAdmin && generalText.trim() !== (general?.comment ?? "")) {
                await save.mutateAsync({
                  id: general?.id ?? null,
                  periodId,
                  studentId: student.studentId,
                  groupId: null,
                  comment: generalText,
                });
              }
              notifySuccess("grades.remarkSaved");
              onClose();
            } catch (err) {
              notifyError(err);
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="remark-group">{t("grades.groupRemark", { group: groupName })}</Label>
            <Textarea
              id="remark-group"
              rows={3}
              className="rounded-xl"
              value={text}
              onChange={(e) => setText(e.target.value)}
              data-testid="remark-group"
            />
          </div>
          {isAdmin && (
            <div className="space-y-1.5">
              <Label htmlFor="remark-general">{t("grades.generalRemark")}</Label>
              <Textarea
                id="remark-general"
                rows={3}
                className="rounded-xl"
                value={generalText}
                onChange={(e) => setGeneralText(e.target.value)}
                data-testid="remark-general"
              />
            </div>
          )}
          {tooLong && <p className="text-xs text-destructive">{t("grades.error.remark")}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="rounded-xl" onClick={onClose}>
              {t("ped.cancel")}
            </Button>
            <Button
              type="submit"
              className="rounded-xl"
              disabled={save.isPending}
              data-testid="remark-save"
            >
              {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("ped.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
