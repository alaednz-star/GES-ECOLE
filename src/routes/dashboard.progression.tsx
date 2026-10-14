/**
 * Progression (ADR-008): where each group stands.
 *
 * Overview: per group, sessions logged against sessions held and chapters covered. Detail for one
 * group: each chapter's coverage (sessions that referenced it in the lesson log, or marked done
 * by the teacher) and the class average period after period. Everything is derived from the lesson
 * log, the chapters and the scores; only "marked done" is stored (chapters.completed_on).
 */

import { useMemo } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Circle, CircleDot, NotebookPen, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { RequireAuth } from "@/features/auth/require-auth";
import { GroupSelect, patternOf, usePedGroups } from "@/features/pedagogy/components/ped-groups";
import { periodTrend } from "@/features/pedagogy/grades-model";
import {
  chapterCoverage,
  coverageRate,
  heldSessions,
  lessonLog,
  logCounters,
} from "@/features/pedagogy/lesson-model";
import { formatMark, parsePedSearch } from "@/features/pedagogy/ped-search";
import {
  useAssessments,
  useChapters,
  useGroupRoster,
  useLessonEntries,
  usePeriods,
  useScores,
  useSetChapterCompleted,
} from "@/features/pedagogy/queries";
import type { LessonEntry } from "@/features/pedagogy/types";
import type { GroupRow } from "@/features/school/types";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/progression")({
  validateSearch: parsePedSearch,
  head: () => ({
    meta: [{ title: "Progression — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin", "teacher"]}>
      <ProgressionPage />
    </RequireAuth>
  ),
});

function ProgressionPage() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/dashboard/progression" });
  const { groups, isLoading, error, refetch } = usePedGroups();
  const entries = useLessonEntries(null);
  const chapters = useChapters(null);
  const today = useMemo(() => todayIso(), []);
  const groupId = search.group ?? null;
  const group = groups.find((g) => g.id === groupId) ?? null;

  const overview = useMemo(() => {
    const entriesBy = new Map<string, LessonEntry[]>();
    for (const e of entries.data ?? []) {
      entriesBy.set(e.groupId, [...(entriesBy.get(e.groupId) ?? []), e]);
    }
    return groups.map((g) => {
      const list = entriesBy.get(g.id) ?? [];
      const counters = logCounters(lessonLog(heldSessions(patternOf(g), today), list));
      const coverage = chapterCoverage(
        (chapters.data ?? []).filter((c) => c.groupId === g.id),
        list,
      );
      return {
        group: g,
        counters,
        chapters: coverage.length,
        covered: coverage.filter((c) => c.covered).length,
        coverage: coverageRate(coverage),
        lastEntry: list[0]?.sessionDate ?? null,
      };
    });
  }, [groups, entries.data, chapters.data, today]);

  if (error || entries.error || chapters.error) {
    return (
      <ErrorState
        error={error ?? entries.error ?? chapters.error}
        onRetry={() => {
          void refetch();
          void entries.refetch();
          void chapters.refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t("progression.title")} description={t("progression.subtitle")} />
      {isLoading || entries.isLoading || chapters.isLoading ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title={t("ped.noGroups")}
          description={t("ped.noGroupsBody")}
        />
      ) : (
        <>
          <GroupSelect
            groups={groups}
            value={groupId}
            allowAll
            onChange={(id) => void navigate({ search: id ? { group: id } : {}, replace: true })}
          />
          {group ? (
            <GroupDetail
              group={group}
              row={overview.find((o) => o.group.id === group.id) ?? null}
              entries={(entries.data ?? []).filter((e) => e.groupId === group.id)}
              chapters={(chapters.data ?? []).filter((c) => c.groupId === group.id)}
            />
          ) : (
            <ul
              className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
              data-testid="progression-overview"
            >
              {overview.map((o) => (
                <li
                  key={o.group.id}
                  className="surface-card space-y-3 p-4"
                  data-testid="progression-card"
                  data-group={o.group.id}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{o.group.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[o.group.subjectName, o.group.teacherName].filter(Boolean).join(" · ") ||
                          "—"}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 rounded-lg"
                      onClick={() =>
                        void navigate({ search: { group: o.group.id }, replace: true })
                      }
                      data-testid="progression-open"
                    >
                      {t("progression.details")}
                    </Button>
                  </div>
                  <Meter
                    label={t("progression.logged")}
                    value={o.counters.rate}
                    detail={`${o.counters.logged}/${o.counters.held}`}
                    testId="progression-logged"
                  />
                  <Meter
                    label={t("progression.coverage")}
                    value={o.coverage}
                    detail={`${o.covered}/${o.chapters}`}
                    testId="progression-coverage"
                  />
                  <LastEntry date={o.lastEntry} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Meter({
  label,
  value,
  detail,
  testId,
}: {
  label: string;
  value: number | null;
  detail: string;
  testId?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums" data-testid={testId}>
          {value === null ? "—" : `${value} %`}{" "}
          <span className="text-muted-foreground">({detail})</span>
        </span>
      </div>
      <Progress value={value ?? 0} className="h-2" />
    </div>
  );
}

function LastEntry({ date }: { date: string | null }) {
  const { t, locale } = useI18n();
  return (
    <p className="text-xs text-muted-foreground">
      {date
        ? t("progression.lastEntry", { date: formatDate(date, locale) })
        : t("progression.noEntry")}
    </p>
  );
}

function GroupDetail({
  group,
  row,
  entries,
  chapters,
}: {
  group: GroupRow;
  row: {
    counters: ReturnType<typeof logCounters>;
    coverage: number | null;
    covered: number;
    chapters: number;
    lastEntry: string | null;
  } | null;
  entries: Parameters<typeof chapterCoverage>[1];
  chapters: Parameters<typeof chapterCoverage>[0];
}) {
  const { t, locale } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const setDone = useSetChapterCompleted();
  const coverage = useMemo(() => chapterCoverage(chapters, entries), [chapters, entries]);
  const periods = usePeriods();
  const assessments = useAssessments(group.id);
  const roster = useGroupRoster(group.id);
  const scores = useScores((assessments.data ?? []).map((a) => a.id));
  const trend = useMemo(
    () =>
      periodTrend(periods.data ?? [], assessments.data ?? [], scores.data ?? [], roster.data ?? []),
    [periods.data, assessments.data, scores.data, roster.data],
  );
  const today = todayIso();

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <section className="surface-card space-y-3 p-4" data-testid="progression-chapters">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{t("progression.chapters")}</h2>
          <Button asChild variant="outline" size="sm" className="rounded-lg">
            <Link to="/dashboard/lesson-log" search={{ group: group.id }}>
              <NotebookPen className="size-4" aria-hidden /> {t("progression.openLog")}
            </Link>
          </Button>
        </div>
        {row && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Meter
              label={t("progression.logged")}
              value={row.counters.rate}
              detail={`${row.counters.logged}/${row.counters.held}`}
              testId="progression-logged"
            />
            <Meter
              label={t("progression.coverage")}
              value={row.coverage}
              detail={`${row.covered}/${row.chapters}`}
              testId="progression-coverage"
            />
          </div>
        )}
        {coverage.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{t("progression.noChapters")}</p>
        ) : (
          <ol className="divide-y divide-border">
            {coverage.map((c) => (
              <li
                key={c.chapter.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                data-testid="progression-chapter"
                data-chapter={c.chapter.id}
                data-covered={c.covered ? "true" : "false"}
              >
                <div className="flex min-w-0 items-start gap-2">
                  {c.done ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  ) : c.covered ? (
                    <CircleDot className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.chapter.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.done
                        ? t("progression.doneOn", {
                            date: formatDate(c.chapter.completedOn as string, locale),
                          })
                        : c.sessions > 0
                          ? t("progression.sessions", {
                              count: c.sessions,
                              from: formatDate(c.firstDate as string, locale),
                              to: formatDate(c.lastDate as string, locale),
                            })
                          : t("progression.notStarted")}
                      {c.done &&
                        c.sessions > 0 &&
                        ` · ${t("progression.sessionsShort", { count: c.sessions })}`}
                    </p>
                  </div>
                </div>
                <Button
                  variant={c.done ? "ghost" : "outline"}
                  size="sm"
                  className={cn("rounded-lg", c.done && "text-muted-foreground")}
                  disabled={setDone.isPending}
                  data-testid="progression-toggle"
                  onClick={() =>
                    setDone.mutate(
                      { id: c.chapter.id, completedOn: c.done ? null : today },
                      {
                        onSuccess: () =>
                          notifySuccess(c.done ? "progression.reopened" : "progression.marked"),
                        onError: notifyError,
                      },
                    )
                  }
                >
                  {t(c.done ? "progression.reopen" : "progression.markDone")}
                </Button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="surface-card space-y-3 p-4" data-testid="progression-trend">
        <h2 className="font-semibold">{t("progression.results")}</h2>
        {periods.isLoading || assessments.isLoading || roster.isLoading ? (
          <Skeleton className="h-24 rounded-xl" />
        ) : trend.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("progression.noPeriods")}</p>
        ) : (
          <ul className="space-y-2">
            {trend.map((p, i) => {
              const prev = i > 0 ? (trend[i - 1]?.classAverage ?? null) : null;
              const delta = p.classAverage !== null && prev !== null ? p.classAverage - prev : null;
              return (
                <li
                  key={p.period.id}
                  className="flex items-center justify-between gap-2 text-sm"
                  data-testid="progression-period"
                >
                  <span className="min-w-0 truncate">
                    {p.period.name}
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      · {t("progression.assessmentsCount", { count: p.assessments })}
                    </span>
                  </span>
                  <span
                    className="shrink-0 font-semibold tabular-nums"
                    data-testid="progression-period-average"
                  >
                    {p.classAverage === null ? "—" : `${formatMark(p.classAverage, locale)} / 20`}
                    {delta !== null && delta !== 0 && (
                      <span
                        className={cn(
                          "ms-1 text-xs",
                          delta > 0 ? "text-success" : "text-destructive",
                        )}
                      >
                        {delta > 0 ? "+" : ""}
                        {formatMark(Math.round(delta * 100) / 100, locale)}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
