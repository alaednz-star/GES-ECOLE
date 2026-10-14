/**
 * The score sheet of one assessment: one line per enrolled student (score, absent, comment), the
 * assessment's figures, and a save that sends only the changed lines. The database checks the
 * maximum and the enrollment again.
 */

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isQueuedOffline } from "@/features/desktop/queue";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate } from "@/lib/format";
import { assessmentStats, parseScore, scoreError } from "../grades-model";
import { formatMark } from "../ped-search";
import { useGroupRoster, useSaveScores, useScores, type ScoreLine } from "../queries";
import type { Assessment, Score } from "../types";

interface Line {
  raw: string;
  absent: boolean;
  comment: string;
}

const lineOf = (s: Score | undefined): Line => ({
  raw: s?.score === null || s?.score === undefined ? "" : String(s.score),
  absent: s?.absent ?? false,
  comment: s?.comment ?? "",
});

export function ScoreSheetDialog({
  assessment,
  groupName,
  onClose,
}: {
  assessment: Assessment;
  groupName: string;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const roster = useGroupRoster(assessment.groupId);
  const scores = useScores([assessment.id]);
  const ready = !roster.isLoading && !scores.isLoading;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-start">{assessment.title}</DialogTitle>
          <DialogDescription className="text-start">
            {groupName} · {formatDate(assessment.heldOn, locale)} ·{" "}
            {t("assessments.outOf", { max: formatMark(assessment.maxScore, locale) })} ·{" "}
            {t("assessments.coefShort", { coef: formatMark(assessment.coefficient, locale) })}
          </DialogDescription>
        </DialogHeader>
        {!ready ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-11 rounded-xl" />
            ))}
          </div>
        ) : (
          <SheetBody
            assessment={assessment}
            roster={roster.data ?? []}
            scores={scores.data ?? []}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SheetBody({
  assessment,
  roster,
  scores,
  onClose,
}: {
  assessment: Assessment;
  roster: { studentId: string; fullName: string }[];
  scores: Score[];
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const save = useSaveScores();
  const initial = useMemo(() => {
    const by = new Map(scores.map((s) => [s.studentId, s]));
    return new Map(roster.map((r) => [r.studentId, lineOf(by.get(r.studentId))]));
  }, [roster, scores]);
  const [lines, setLines] = useState(initial);
  const [submitted, setSubmitted] = useState(false);

  const set = (id: string, patch: Partial<Line>) =>
    setLines((prev) => new Map(prev).set(id, { ...(prev.get(id) as Line), ...patch }));

  const errors = new Map<string, string>();
  for (const [id, l] of lines) {
    const err = scoreError(l.raw, l.absent, assessment.maxScore);
    if (err) errors.set(id, err);
    else if (l.comment.length > 300) errors.set(id, "assessments.error.comment");
  }

  // Live figures from what is typed (valid lines only).
  const live = assessmentStats(
    assessment,
    [...lines]
      .filter(([id]) => !errors.has(id))
      .map(([studentId, l]) => ({
        assessmentId: assessment.id,
        studentId,
        score: l.absent ? null : parseScore(l.raw),
        absent: l.absent,
        comment: null,
      })),
    roster,
  );

  if (roster.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("assessments.noStudents")}
      </p>
    );
  }

  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        if (errors.size) return;
        const changed: ScoreLine[] = [];
        for (const [studentId, l] of lines) {
          const before = initial.get(studentId) as Line;
          if (before.raw === l.raw && before.absent === l.absent && before.comment === l.comment)
            continue;
          changed.push({
            studentId,
            score: l.absent ? null : parseScore(l.raw),
            absent: l.absent,
            comment: l.comment.trim() || null,
          });
        }
        if (changed.length === 0) {
          onClose();
          return;
        }
        save.mutate(
          { assessmentId: assessment.id, lines: changed },
          {
            onSuccess: () => {
              notifySuccess("assessments.scoresSaved");
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
      <dl className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6" data-testid="score-stats">
        {(
          [
            ["assessments.stat.average", formatMark(live.average, locale)],
            ["assessments.stat.min", formatMark(live.min, locale)],
            ["assessments.stat.max", formatMark(live.max, locale)],
            ["assessments.stat.graded", `${live.count}/${roster.length}`],
            ["assessments.stat.absent", String(live.absent)],
            ["assessments.stat.missing", String(live.missing)],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-xl bg-muted/60 px-2 py-1.5">
            <dt className="text-[11px] text-muted-foreground">{t(k)}</dt>
            <dd className="text-sm font-semibold tabular-nums" data-stat={k.split(".").pop()}>
              {v}
            </dd>
          </div>
        ))}
      </dl>

      <ul className="divide-y divide-border rounded-xl border border-border">
        {roster.map((r) => {
          const l = lines.get(r.studentId) as Line;
          const err = submitted ? errors.get(r.studentId) : undefined;
          return (
            <li
              key={r.studentId}
              className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2 sm:grid-cols-[1fr_6rem_auto_12rem]"
              data-testid="score-line"
              data-student={r.studentId}
            >
              <span className="truncate text-sm font-medium">{r.fullName}</span>
              <Input
                inputMode="decimal"
                dir="ltr"
                className="h-9 w-24 rounded-lg text-end tabular-nums"
                aria-label={t("assessments.scoreOf", { name: r.fullName })}
                value={l.raw}
                disabled={l.absent}
                aria-invalid={!!err}
                onChange={(e) => set(r.studentId, { raw: e.target.value })}
                data-testid="score-input"
              />
              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox
                  checked={l.absent}
                  onCheckedChange={(v) =>
                    set(r.studentId, { absent: v === true, raw: v === true ? "" : l.raw })
                  }
                  data-testid="score-absent"
                />
                {t("assessments.absent")}
              </label>
              <Input
                className="col-span-2 h-9 rounded-lg text-xs sm:col-span-1"
                placeholder={t("assessments.commentPlaceholder")}
                value={l.comment}
                onChange={(e) => set(r.studentId, { comment: e.target.value })}
              />
              {err && (
                <p className="col-span-full text-xs text-destructive">
                  {t(err, { max: formatMark(assessment.maxScore, locale) })}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" className="rounded-xl" onClick={onClose}>
          {t("ped.cancel")}
        </Button>
        <Button
          type="submit"
          className="rounded-xl"
          disabled={save.isPending}
          data-testid="scores-save"
        >
          {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t("ped.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
