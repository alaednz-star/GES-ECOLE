/**
 * Cahier de textes (ADR-008): what was covered in each session, and the homework given.
 *
 * Sessions are derived from the group's weekly slots (ADR-003): every session held up to today is
 * listed, with or without its entry, so the missing ones stand out. An entry can also be written
 * ahead for an upcoming session. One entry per session; the database checks the date.
 */

import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BookOpen, Loader2, NotebookPen, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
import {
  Figure,
  GroupSelect,
  patternOf,
  usePedGroups,
} from "@/features/pedagogy/components/ped-groups";
import {
  heldSessions,
  isSessionDay,
  lessonEntryErrors,
  lessonLog,
  logCounters,
  type LogRow,
} from "@/features/pedagogy/lesson-model";
import {
  useChapters,
  useDeleteLessonEntry,
  useLessonEntries,
  useSaveLessonEntry,
} from "@/features/pedagogy/queries";
import { formatSessionDate, parsePedSearch } from "@/features/pedagogy/ped-search";
import type { LessonEntry, PedChapter } from "@/features/pedagogy/types";
import type { GroupRow } from "@/features/school/types";
import { isQueuedOffline } from "@/features/desktop/queue";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/lesson-log")({
  validateSearch: parsePedSearch,
  head: () => ({
    meta: [{ title: "Cahier de textes — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin", "teacher"]}>
      <LessonLogPage />
    </RequireAuth>
  ),
});

const NONE = "__none__";

function LessonLogPage() {
  const { t, locale } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/dashboard/lesson-log" });
  const { groups, isLoading, error, refetch } = usePedGroups();
  const [missingOnly, setMissingOnly] = useState(false);
  const [editing, setEditing] = useState<{ date: string | null; entry: LessonEntry | null } | null>(
    null,
  );

  const groupId = search.group ?? groups[0]?.id ?? null;
  const group = groups.find((g) => g.id === groupId) ?? null;
  const entries = useLessonEntries(groupId, !!groupId);
  const chapters = useChapters(groupId, !!groupId);
  const remove = useDeleteLessonEntry();
  const today = useMemo(() => todayIso(), []);

  const rows = useMemo(() => {
    if (!group) return [];
    return lessonLog(heldSessions(patternOf(group), today), entries.data ?? []);
  }, [group, entries.data, today]);
  const counters = useMemo(() => logCounters(rows), [rows]);
  const visible = missingOnly ? rows.filter((r) => r.held && !r.entry) : rows;
  const chapterName = useMemo(
    () => new Map((chapters.data ?? []).map((c) => [c.id, c.title])),
    [chapters.data],
  );

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("lessonLog.title")}
        description={t("lessonLog.subtitle")}
        actions={
          group && (
            <Button
              className="rounded-xl"
              onClick={() => setEditing({ date: null, entry: null })}
              data-testid="lesson-add"
            >
              <Plus className="size-4" aria-hidden /> {t("lessonLog.add")}
            </Button>
          )
        }
      />

      {isLoading ? (
        <Skeleton className="h-10 w-72 rounded-xl" />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={NotebookPen}
          title={t("ped.noGroups")}
          description={t("ped.noGroupsBody")}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <GroupSelect
              groups={groups}
              value={groupId}
              onChange={(id) => void navigate({ search: id ? { group: id } : {}, replace: true })}
            />
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={missingOnly}
                onCheckedChange={setMissingOnly}
                data-testid="lesson-missing-only"
              />
              {t("lessonLog.missingOnly")}
            </label>
          </div>

          {group && group.schedules.length === 0 && (
            <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
              {t("lessonLog.noSlots")}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Figure label={t("lessonLog.held")} value={counters.held} testId="lesson-held" />
            <Figure
              label={t("lessonLog.logged")}
              value={
                counters.rate === null ? counters.logged : `${counters.logged} (${counters.rate} %)`
              }
              tone="success"
              testId="lesson-logged"
            />
            <Figure
              label={t("lessonLog.missing")}
              value={counters.missing}
              tone={counters.missing ? "danger" : undefined}
              testId="lesson-missing"
            />
            <Figure label={t("lessonLog.homeworkGiven")} value={counters.homework} />
          </div>

          {entries.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-20 rounded-2xl" />
              ))}
            </div>
          ) : entries.error ? (
            <ErrorState error={entries.error} onRetry={() => void entries.refetch()} />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title={t(missingOnly ? "lessonLog.allLogged" : "lessonLog.emptyTitle")}
              description={t(missingOnly ? "lessonLog.allLoggedBody" : "lessonLog.emptyBody")}
            />
          ) : (
            <ul className="space-y-2" data-testid="lesson-list">
              {visible.map((row) => (
                <LogItem
                  key={row.date}
                  row={row}
                  today={today}
                  chapterName={
                    row.entry?.chapterId ? (chapterName.get(row.entry.chapterId) ?? null) : null
                  }
                  onEdit={() => setEditing({ date: row.date, entry: row.entry })}
                  onDelete={async () => {
                    if (!row.entry) return;
                    try {
                      await remove.mutateAsync(row.entry.id);
                      notifySuccess("lessonLog.deleted");
                    } catch (e) {
                      notifyError(e);
                    }
                  }}
                  locale={locale}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {editing && group && (
        <LessonEntryDialog
          group={group}
          chapters={chapters.data ?? []}
          presetDate={editing.date}
          entry={editing.entry}
          takenDates={new Set((entries.data ?? []).map((e) => e.sessionDate))}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function LogItem({
  row,
  today,
  chapterName,
  onEdit,
  onDelete,
  locale,
}: {
  row: LogRow;
  today: string;
  chapterName: string | null;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  locale: string;
}) {
  const { t } = useI18n();
  const e = row.entry;
  return (
    <li
      className={cn(
        "surface-card flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between",
        !e && "border-dashed",
      )}
      data-testid="lesson-row"
      data-date={row.date}
      data-logged={e ? "true" : "false"}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold capitalize">{formatSessionDate(row.date, locale)}</p>
          {!e ? (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
              {t("lessonLog.toFill")}
            </span>
          ) : row.date > today ? (
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">
              {t("lessonLog.planned")}
            </span>
          ) : null}
          {chapterName && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {chapterName}
            </span>
          )}
        </div>
        {e && (
          <>
            <p className="whitespace-pre-line text-sm" data-testid="lesson-summary">
              {e.summary}
            </p>
            {e.homework && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{t("lessonLog.homework")} : </span>
                {e.homework}
                {e.homeworkDue &&
                  ` · ${t("lessonLog.dueOn", { date: formatDate(e.homeworkDue, locale) })}`}
              </p>
            )}
          </>
        )}
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          variant={e ? "ghost" : "outline"}
          size="sm"
          className="rounded-lg"
          onClick={onEdit}
          data-testid="lesson-edit"
        >
          {e ? <Pencil className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
          {t(e ? "lessonLog.edit" : "lessonLog.fill")}
        </Button>
        {e && (
          <ConfirmDialog
            title={t("lessonLog.deleteTitle")}
            description={t("lessonLog.deleteBody")}
            confirmLabel={t("lessonLog.delete")}
            onConfirm={onDelete}
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-lg text-destructive"
                aria-label={t("lessonLog.delete")}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            }
          />
        )}
      </div>
    </li>
  );
}

function LessonEntryDialog({
  group,
  chapters,
  presetDate,
  entry,
  takenDates,
  onClose,
}: {
  group: GroupRow;
  chapters: PedChapter[];
  presetDate: string | null;
  entry: LessonEntry | null;
  takenDates: Set<string>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const save = useSaveLessonEntry();
  const [form, setForm] = useState({
    date: entry?.sessionDate ?? presetDate ?? "",
    chapterId: entry?.chapterId ?? NONE,
    summary: entry?.summary ?? "",
    homework: entry?.homework ?? "",
    homeworkDue: entry?.homeworkDue ?? "",
  });
  const [submitted, setSubmitted] = useState(false);
  const errors = lessonEntryErrors(form);
  if (!errors.date && !entry) {
    if (!isSessionDay(patternOf(group), form.date)) errors.date = "lessonLog.error.notSessionDay";
    else if (takenDates.has(form.date)) errors.date = "lessonLog.error.taken";
  }
  const dateLocked = !!entry || !!presetDate;

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-start">
            {t(entry ? "lessonLog.editTitle" : "lessonLog.addTitle")}
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
                ...(entry ? { id: entry.id } : {}),
                groupId: group.id,
                sessionDate: form.date,
                chapterId: form.chapterId === NONE ? null : form.chapterId,
                summary: form.summary.trim(),
                homework: form.homework.trim() || null,
                homeworkDue: form.homework.trim() && form.homeworkDue ? form.homeworkDue : null,
              },
              {
                onSuccess: () => {
                  notifySuccess("lessonLog.saved");
                  onClose();
                },
                onError: notifyError,
              },
            );
            // Desktop offline: queued, sent when the connection returns.
            if (isQueuedOffline()) {
              notifySuccess("desktop.queued");
              onClose();
            }
          }}
        >
          <p className="text-xs text-muted-foreground">{group.name}</p>
          <div className="space-y-1.5">
            <Label htmlFor="lesson-date">{t("lessonLog.date")}</Label>
            <Input
              id="lesson-date"
              type="date"
              dir="ltr"
              className="h-11 rounded-xl"
              value={form.date}
              disabled={dateLocked}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              data-testid="lesson-date"
            />
            {submitted && errors.date && (
              <p className="text-xs text-destructive">{t(errors.date)}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>{t("lessonLog.chapter")}</Label>
            <Select
              value={form.chapterId}
              onValueChange={(v) => v && v !== form.chapterId && setForm({ ...form, chapterId: v })}
            >
              <SelectTrigger className="h-11 rounded-xl" data-testid="lesson-chapter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("lessonLog.noChapter")}</SelectItem>
                {chapters.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lesson-summary">{t("lessonLog.summary")}</Label>
            <Textarea
              id="lesson-summary"
              rows={4}
              className="rounded-xl"
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              data-testid="lesson-summary-input"
            />
            {submitted && errors.summary && (
              <p className="text-xs text-destructive">{t(errors.summary)}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lesson-homework">{t("lessonLog.homeworkOptional")}</Label>
            <Textarea
              id="lesson-homework"
              rows={2}
              className="rounded-xl"
              value={form.homework}
              onChange={(e) => setForm({ ...form, homework: e.target.value })}
              data-testid="lesson-homework-input"
            />
            {submitted && errors.homework && (
              <p className="text-xs text-destructive">{t(errors.homework)}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lesson-due">{t("lessonLog.dueOptional")}</Label>
            <Input
              id="lesson-due"
              type="date"
              dir="ltr"
              className="h-11 rounded-xl"
              value={form.homeworkDue}
              onChange={(e) => setForm({ ...form, homeworkDue: e.target.value })}
              data-testid="lesson-due"
            />
            {submitted && errors.homeworkDue && (
              <p className="text-xs text-destructive">{t(errors.homeworkDue)}</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="rounded-xl" onClick={onClose}>
              {t("ped.cancel")}
            </Button>
            <Button
              type="submit"
              className="rounded-xl"
              disabled={save.isPending}
              data-testid="lesson-save"
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
