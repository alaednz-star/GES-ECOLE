/**
 * Évaluations (ADR-008): a group's tests and exams, their score sheets, and publication.
 *
 * An assessment has a maximum (default 20) and a coefficient; its date must be a session day of
 * the group (database). Students see an assessment and their own score only once it is published.
 * Teachers see their groups; administrators every group.
 */

import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ClipboardCheck,
  Eye,
  EyeOff,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
import { GroupSelect, patternOf, usePedGroups } from "@/features/pedagogy/components/ped-groups";
import { ScoreSheetDialog } from "@/features/pedagogy/components/score-sheet";
import { isSessionDay } from "@/features/pedagogy/lesson-model";
import { formatMark, parsePedSearch } from "@/features/pedagogy/ped-search";
import {
  useAssessments,
  useDeleteAssessment,
  useSaveAssessment,
  useScores,
  useSetAssessmentPublished,
} from "@/features/pedagogy/queries";
import { ASSESSMENT_KINDS, type Assessment, type AssessmentKind } from "@/features/pedagogy/types";
import type { GroupRow } from "@/features/school/types";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate, todayIso } from "@/lib/format";

export const Route = createFileRoute("/dashboard/assessments")({
  validateSearch: parsePedSearch,
  head: () => ({
    meta: [{ title: "Évaluations — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin", "teacher"]}>
      <AssessmentsPage />
    </RequireAuth>
  ),
});

const ALL = "__all__";

function AssessmentsPage() {
  const { t, locale } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/dashboard/assessments" });
  const { groups, isLoading, error, refetch } = usePedGroups();
  const groupId = search.group ?? null;
  const assessments = useAssessments(groupId);
  const [kind, setKind] = useState<string>(ALL);
  const [editing, setEditing] = useState<Assessment | "new" | null>(null);
  const [grading, setGrading] = useState<Assessment | null>(null);
  const publish = useSetAssessmentPublished();
  const remove = useDeleteAssessment();

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  // Only the caller's groups (an administrator: all). RLS already narrows a teacher's list.
  const rows = useMemo(
    () =>
      (assessments.data ?? []).filter(
        (a) => groupById.has(a.groupId) && (kind === ALL || a.kind === kind),
      ),
    [assessments.data, groupById, kind],
  );
  const scores = useScores(rows.map((a) => a.id));
  const graded = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of scores.data ?? []) {
      if (s.absent || s.score !== null) m.set(s.assessmentId, (m.get(s.assessmentId) ?? 0) + 1);
    }
    return m;
  }, [scores.data]);

  const columns: Column<Assessment>[] = [
    {
      key: "title",
      header: t("assessments.col.title"),
      sortValue: (a) => a.title,
      cell: (a) => (
        <div className="min-w-0" data-testid="assessment-row" data-assessment={a.id}>
          <p className="truncate font-medium">{a.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {t(`assessments.kind.${a.kind}`)}
            {!groupId && ` · ${groupById.get(a.groupId)?.name ?? ""}`}
          </p>
        </div>
      ),
    },
    {
      key: "date",
      header: t("assessments.col.date"),
      sortValue: (a) => a.heldOn,
      cell: (a) => <span className="tabular-nums">{formatDate(a.heldOn, locale)}</span>,
    },
    {
      key: "scale",
      header: t("assessments.col.scale"),
      className: "hidden md:table-cell",
      cell: (a) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          /{formatMark(a.maxScore, locale)} ·{" "}
          {t("assessments.coefShort", { coef: formatMark(a.coefficient, locale) })}
        </span>
      ),
    },
    {
      key: "graded",
      header: t("assessments.col.graded"),
      className: "hidden sm:table-cell",
      sortValue: (a) => graded.get(a.id) ?? 0,
      cell: (a) => (
        <span className="tabular-nums" data-testid="assessment-graded">
          {graded.get(a.id) ?? 0}/{groupById.get(a.groupId)?.enrolled ?? 0}
        </span>
      ),
    },
    {
      key: "published",
      header: t("assessments.col.status"),
      cell: (a) => (
        <span
          className={
            a.published
              ? "rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success"
              : "rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
          }
          data-testid="assessment-status"
        >
          {t(a.published ? "assessments.published" : "assessments.draft")}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-end",
      cell: (a) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={() => setGrading(a)}
            data-testid="assessment-grade"
          >
            <ListChecks className="size-4" aria-hidden />
            <span className="hidden lg:inline">{t("assessments.enterScores")}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-lg"
            aria-label={t(a.published ? "assessments.unpublish" : "assessments.publish")}
            title={t(a.published ? "assessments.unpublish" : "assessments.publish")}
            data-testid="assessment-publish"
            onClick={() =>
              publish.mutate(
                { id: a.id, published: !a.published },
                {
                  onSuccess: () =>
                    notifySuccess(
                      a.published ? "assessments.unpublished" : "assessments.publishedToast",
                    ),
                  onError: notifyError,
                },
              )
            }
          >
            {a.published ? (
              <EyeOff className="size-4" aria-hidden />
            ) : (
              <Eye className="size-4" aria-hidden />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-lg"
            aria-label={t("assessments.editTitle")}
            data-testid="assessment-edit"
            onClick={() => setEditing(a)}
          >
            <Pencil className="size-4" aria-hidden />
          </Button>
          <ConfirmDialog
            title={t("assessments.deleteTitle")}
            description={t("assessments.deleteBody", { title: a.title })}
            confirmLabel={t("assessments.delete")}
            onConfirm={async () => {
              try {
                await remove.mutateAsync(a.id);
                notifySuccess("assessments.deleted");
              } catch (e) {
                notifyError(e);
              }
            }}
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-lg text-destructive"
                aria-label={t("assessments.delete")}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            }
          />
        </div>
      ),
    },
  ];

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("assessments.title")}
        description={t("assessments.subtitle")}
        actions={
          groups.length > 0 && (
            <Button
              className="rounded-xl"
              onClick={() => setEditing("new")}
              data-testid="assessment-add"
            >
              <Plus className="size-4" aria-hidden /> {t("assessments.add")}
            </Button>
          )
        }
      />
      {isLoading ? (
        <Skeleton className="h-10 w-72 rounded-xl" />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title={t("ped.noGroups")}
          description={t("ped.noGroupsBody")}
        />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          isLoading={assessments.isLoading}
          error={assessments.error}
          onRetry={() => void assessments.refetch()}
          isRetrying={assessments.isFetching}
          rowKey={(a) => a.id}
          pageSize={50}
          searchable={(a) => `${a.title} ${groupById.get(a.groupId)?.name ?? ""}`}
          filters={
            <div className="flex flex-wrap gap-2">
              <GroupSelect
                groups={groups}
                value={groupId}
                allowAll
                onChange={(id) => void navigate({ search: id ? { group: id } : {}, replace: true })}
              />
              <Select value={kind} onValueChange={(v) => v && v !== kind && setKind(v)}>
                <SelectTrigger
                  className="h-10 w-full rounded-xl sm:w-48"
                  data-testid="assessment-kind-filter"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t("assessments.allKinds")}</SelectItem>
                  {ASSESSMENT_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`assessments.kind.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
          emptyState={
            <EmptyState
              icon={ClipboardCheck}
              title={t("assessments.emptyTitle")}
              description={t("assessments.emptyBody")}
            />
          }
        />
      )}
      {editing && (
        <AssessmentDialog
          assessment={editing === "new" ? null : editing}
          groups={groups}
          defaultGroupId={groupId}
          onClose={() => setEditing(null)}
        />
      )}
      {grading && (
        <ScoreSheetDialog
          assessment={grading}
          groupName={groupById.get(grading.groupId)?.name ?? ""}
          onClose={() => setGrading(null)}
        />
      )}
    </div>
  );
}

function AssessmentDialog({
  assessment,
  groups,
  defaultGroupId,
  onClose,
}: {
  assessment: Assessment | null;
  groups: GroupRow[];
  defaultGroupId: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const save = useSaveAssessment();
  const active = groups.filter((g) => g.status === "active");
  const [form, setForm] = useState({
    groupId: assessment?.groupId ?? defaultGroupId ?? active[0]?.id ?? groups[0]?.id ?? "",
    title: assessment?.title ?? "",
    kind: (assessment?.kind ?? "test") as AssessmentKind,
    heldOn: assessment?.heldOn ?? todayIso(),
    maxScore: String(assessment?.maxScore ?? 20),
    coefficient: String(assessment?.coefficient ?? 1),
    published: assessment?.published ?? false,
  });
  const [submitted, setSubmitted] = useState(false);
  const group = groups.find((g) => g.id === form.groupId) ?? null;
  const max = Number(form.maxScore.replace(",", "."));
  const coef = Number(form.coefficient.replace(",", "."));
  const errors: Partial<Record<"group" | "title" | "heldOn" | "maxScore" | "coefficient", string>> =
    {};
  if (!group) errors.group = "assessments.error.group";
  const title = form.title.trim();
  if (title.length < 1 || title.length > 120) errors.title = "assessments.error.title";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.heldOn)) errors.heldOn = "assessments.error.date";
  else if (group && !isSessionDay(patternOf(group), form.heldOn))
    errors.heldOn = "assessments.error.notSessionDay";
  if (!Number.isFinite(max) || max <= 0 || max > 100) errors.maxScore = "assessments.error.max";
  if (!Number.isFinite(coef) || coef <= 0 || coef > 10)
    errors.coefficient = "assessments.error.coef";

  const err = (k: keyof typeof errors) =>
    submitted && errors[k] ? <p className="text-xs text-destructive">{t(errors[k])}</p> : null;

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-start">
            {t(assessment ? "assessments.editTitle" : "assessments.addTitle")}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
            if (Object.keys(errors).length) return;
            save.mutate(
              {
                ...(assessment ? { id: assessment.id } : {}),
                groupId: form.groupId,
                title,
                kind: form.kind,
                heldOn: form.heldOn,
                maxScore: max,
                coefficient: coef,
                published: form.published,
              },
              {
                onSuccess: () => {
                  notifySuccess("assessments.saved");
                  onClose();
                },
                onError: notifyError,
              },
            );
          }}
        >
          <div className="space-y-1.5">
            <Label>{t("assessments.group")}</Label>
            {assessment ? (
              <p className="text-sm">{group?.name ?? "—"}</p>
            ) : (
              <GroupSelect
                groups={groups}
                value={form.groupId || null}
                onChange={(id) => setForm({ ...form, groupId: id ?? "" })}
                className="h-11 w-full rounded-xl"
                testId="assessment-group"
              />
            )}
            {err("group")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assessment-title">{t("assessments.titleLabel")}</Label>
            <Input
              id="assessment-title"
              className="h-11 rounded-xl"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              data-testid="assessment-title"
            />
            {err("title")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("assessments.kindLabel")}</Label>
              <Select
                value={form.kind}
                onValueChange={(v) =>
                  v && v !== form.kind && setForm({ ...form, kind: v as AssessmentKind })
                }
              >
                <SelectTrigger className="h-11 rounded-xl" data-testid="assessment-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSESSMENT_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`assessments.kind.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assessment-date">{t("assessments.dateLabel")}</Label>
              <Input
                id="assessment-date"
                type="date"
                dir="ltr"
                className="h-11 rounded-xl"
                value={form.heldOn}
                onChange={(e) => setForm({ ...form, heldOn: e.target.value })}
                data-testid="assessment-date"
              />
            </div>
          </div>
          {err("heldOn")}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="assessment-max">{t("assessments.maxLabel")}</Label>
              <Input
                id="assessment-max"
                inputMode="decimal"
                dir="ltr"
                className="h-11 rounded-xl"
                value={form.maxScore}
                onChange={(e) => setForm({ ...form, maxScore: e.target.value })}
                data-testid="assessment-max"
              />
              {err("maxScore")}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assessment-coef">{t("assessments.coefLabel")}</Label>
              <Input
                id="assessment-coef"
                inputMode="decimal"
                dir="ltr"
                className="h-11 rounded-xl"
                value={form.coefficient}
                onChange={(e) => setForm({ ...form, coefficient: e.target.value })}
                data-testid="assessment-coef"
              />
              {err("coefficient")}
            </div>
          </div>
          <label className="flex items-start gap-3 rounded-xl border border-border px-3 py-2.5 text-sm">
            <Switch
              checked={form.published}
              onCheckedChange={(v) => setForm({ ...form, published: v })}
              data-testid="assessment-published"
            />
            <span>
              <span className="font-medium">{t("assessments.publishLabel")}</span>
              <span className="block text-xs text-muted-foreground">
                {t("assessments.publishHint")}
              </span>
            </span>
          </label>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="rounded-xl" onClick={onClose}>
              {t("ped.cancel")}
            </Button>
            <Button
              type="submit"
              className="rounded-xl"
              disabled={save.isPending}
              data-testid="assessment-save"
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
