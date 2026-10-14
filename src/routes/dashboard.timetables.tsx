/**
 * Emplois du temps (ADR-007): the weekly timetable of the whole institution, a group, a teacher,
 * a room or a level -- derived from the active groups' slots, never typed twice. Teachers booked
 * in two places at once are flagged. Printable (/documents/timetables).
 */

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, CalendarRange, Printer } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RequireAuth } from "@/features/auth/require-auth";
import { TimetableGrid } from "@/features/operations/components/timetable-grid";
import { parseTimetableSearch } from "@/features/operations/timetable-search";
import { useTimetable } from "@/features/operations/use-timetable";
import type { TimetableView } from "@/features/operations/timetable-model";
import { weekdayLabel } from "@/features/school/schedule";
import { useI18n } from "@/hooks/use-i18n";

export const Route = createFileRoute("/dashboard/timetables")({
  validateSearch: parseTimetableSearch,
  head: () => ({
    meta: [{ title: "Emplois du temps — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <TimetablesPage />
    </RequireAuth>
  ),
});

function TimetablesPage() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/dashboard/timetables" });
  const view: TimetableView = search.view ?? "all";
  const id = view === "all" ? null : (search.id ?? null);
  const tt = useTimetable({ view, id });
  const options = view === "all" ? [] : tt.options[view];
  const needsPick = view !== "all" && !id;

  return (
    <>
      <PageHeader
        title={t("timetable.title")}
        description={t("timetable.subtitle")}
        actions={
          <Button asChild variant="outline" className="rounded-xl">
            <Link
              to="/documents/timetables"
              search={{ view, ...(id ? { id } : {}) }}
              data-testid="timetable-print"
            >
              <Printer className="size-4" aria-hidden /> {t("timetable.print")}
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <Select
          value={view}
          onValueChange={(v) => {
            if (!v) return;
            void navigate({ search: { view: v as TimetableView } });
          }}
        >
          <SelectTrigger
            className="h-10 w-52 rounded-xl"
            aria-label={t("timetable.view")}
            data-testid="timetable-view"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["all", "group", "teacher", "room", "level"] as const).map((v) => (
              <SelectItem key={v} value={v}>
                {t(`timetable.view.${v}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {view !== "all" && (
          <Select
            value={id ?? ""}
            onValueChange={(v) => {
              if (v) void navigate({ search: { view, id: v } });
            }}
          >
            <SelectTrigger
              className="h-10 w-64 rounded-xl"
              aria-label={t("timetable.pick")}
              data-testid="timetable-entity"
            >
              <SelectValue placeholder={t("timetable.pick")} />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {tt.conflicts.length > 0 && (
        <div
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"
          data-testid="timetable-conflicts"
        >
          <p className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="size-4" aria-hidden />
            {t("timetable.conflicts", { count: tt.conflicts.length })}
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {tt.conflicts.slice(0, 6).map((c, i) => (
              <li key={i}>
                {t("timetable.conflictLine", {
                  teacher: c.teacherName,
                  day: weekdayLabel(c.weekday, t),
                  a: c.a,
                  b: c.b,
                })}
              </li>
            ))}
          </ul>
        </div>
      )}

      <SectionCard
        title={
          view === "all"
            ? t("timetable.view.all")
            : (options.find((o) => o.id === id)?.label ?? t(`timetable.view.${view}`))
        }
      >
        {tt.error ? (
          <ErrorState error={tt.error} onRetry={tt.refetch} className="border-none shadow-none" />
        ) : tt.isLoading ? (
          <Skeleton className="h-96 rounded-xl" />
        ) : needsPick || tt.blocks.length === 0 ? (
          <EmptyState
            icon={CalendarRange}
            title={needsPick ? t("timetable.pick") : t("timetable.empty")}
            description=""
            className="border-none shadow-none"
          />
        ) : (
          <TimetableGrid blocks={tt.blocks} />
        )}
      </SectionCard>
    </>
  );
}
