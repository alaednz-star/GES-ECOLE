import { useMemo, useState } from "react";
import { useSubjectLabel } from "@/features/school/subject-label";
import { createFileRoute, Link } from "@tanstack/react-router";
import { GraduationCap, Library, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { StatusBadge } from "@/components/common/status-badge";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RequireAuth } from "@/features/auth/require-auth";
import {
  useDeleteGroup,
  useGroups,
  useLevels,
  useSubjects,
  type GroupInput,
} from "@/features/school/queries";
import { weekdayLabel } from "@/features/school/schedule";
import { type GroupRow } from "@/features/school/types";
import { useI18n } from "@/hooks/use-i18n";
import { useAuth } from "@/hooks/use-auth";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useStreamOptions } from "@/features/school/streams";
import { usePrograms } from "@/features/school/programs";
import { matchesFormationFilter, type FormationFilter } from "@/features/school/program-model";
import { GroupFormDialog } from "@/features/school/components/group-form-dialog";
import { emptyGroupDraft, groupToDraft } from "@/features/school/group-draft";

export const Route = createFileRoute("/dashboard/groups/")({
  head: () => ({
    meta: [
      { title: "Groupes — Gestion École" },
      { name: "description", content: "Groupes, capacités et emplois du temps hebdomadaires." },
      { property: "og:title", content: "Groupes — Gestion École" },
      { property: "og:description", content: "Groupes, capacités et emplois du temps." },
    ],
  }),
  // Admin only. This is the CRUD console -- create, edit, assign teachers, set
  // capacity and prices. A teacher's view of their own groups is
  // /dashboard/my-groups, which is operational rather than administrative.
  // Allowing teachers here previously gave the module two group lists.
  component: () => (
    <RequireAuth roles={["admin"]}>
      <GroupsPage />
    </RequireAuth>
  ),
});

function occupancyTone(ratio: number) {
  if (ratio >= 100) return "text-destructive";
  if (ratio >= 80) return "text-accent";
  return "text-success";
}

function GroupsPage() {
  const { t } = useI18n();
  const subjectLabel = useSubjectLabel();
  const { notifySuccess, notifyError } = useActionFeedback();
  const { hasRole } = useAuth();
  // Redundant with the route guard above (admin only), kept as defence in
  // depth: `groups` is admin-write-only at the database level, so if the guard
  // is ever loosened the controls still will not offer writes RLS would reject.
  const canManage = hasRole("admin");
  const { data = [], isLoading, error, refetch, isFetching } = useGroups();
  const { data: subjects = [] } = useSubjects();
  const { data: levels = [] } = useLevels();
  const { data: programs = [] } = usePrograms();
  const { nameOf: streamNameOf } = useStreamOptions();
  const remove = useDeleteGroup();
  const [draft, setDraft] = useState<GroupInput | null>(null);
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [levelFilter, setLevelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  // Which formation the group delivers, if any (`groups.program_id`). A group without a
  // formation is simply standalone -- it says nothing about the kind of teaching (ADR-004).
  const [formationFilter, setFormationFilter] = useState<FormationFilter>("all");

  const rows = useMemo(
    () =>
      data.filter(
        (g) =>
          matchesFormationFilter(g, formationFilter) &&
          (subjectFilter === "all" || g.subjectId === subjectFilter) &&
          (levelFilter === "all" || g.levelId === levelFilter) &&
          (statusFilter === "all" || g.status === statusFilter),
      ),
    [data, formationFilter, subjectFilter, levelFilter, statusFilter],
  );

  // Formations that actually have groups, with their group count, for the formation filter.
  const formationOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of data)
      if (g.programId) counts.set(g.programId, (counts.get(g.programId) ?? 0) + 1);
    return programs
      .filter((p) => counts.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, count: counts.get(p.id) ?? 0 }));
  }, [data, programs]);
  const standaloneCount = useMemo(() => data.filter((g) => g.programId === null).length, [data]);

  const columns: Column<GroupRow>[] = [
    {
      key: "name",
      header: t("entity.groups.columnGroup"),
      sortValue: (g) => g.name,
      cell: (g) => (
        <div className="flex items-center gap-3">
          <span
            className="size-8 shrink-0 rounded-lg"
            style={{ backgroundColor: g.subjectColor ?? "#0F766E" }}
            aria-hidden
          />
          <div className="min-w-0">
            <Link
              to="/dashboard/groups/$groupId"
              params={{ groupId: g.id }}
              className="focus-ring block truncate rounded font-medium hover:text-primary"
            >
              {g.name}
            </Link>
            <GroupSubline
              subject={
                g.subjectKey || g.subjectName ? subjectLabel(g.subjectKey, g.subjectName) : null
              }
              programId={g.programId}
              programName={g.programName}
            />
          </div>
        </div>
      ),
    },
    {
      key: "teacher",
      header: t("entity.groups.columnTeacher"),
      sortValue: (g) => g.teacherName ?? "",
      cell: (g) =>
        g.teacherName ?? (
          <span className="text-muted-foreground">{t("entity.common.notAssigned")}</span>
        ),
    },
    {
      key: "level",
      header: t("entity.groups.columnLevel"),
      sortValue: (g) => g.levelName ?? "",
      cell: (g) => g.levelName ?? "—",
    },
    {
      key: "stream",
      header: t("form.groups.stream"),
      sortValue: (g) => streamNameOf(g.streamId) ?? "",
      cell: (g) => streamNameOf(g.streamId) ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: "capacity",
      header: t("entity.groups.columnOccupancy"),
      sortValue: (g) => (g.maxStudents > 0 ? g.enrolled / g.maxStudents : 0),
      className: "min-w-40",
      cell: (g) => {
        const ratio = g.maxStudents > 0 ? (g.enrolled / g.maxStudents) * 100 : 0;
        return (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className={occupancyTone(ratio)}>{Math.round(ratio)}%</span>
              <span className="tabular-nums text-muted-foreground">
                {g.enrolled}/{g.maxStudents}
              </span>
            </div>
            <Progress value={Math.min(ratio, 100)} className="h-1.5" />
          </div>
        );
      },
    },
    {
      key: "schedule",
      header: t("entity.groups.columnSchedule"),
      cell: (g) =>
        g.schedules.length === 0 ? (
          <span className="text-xs text-muted-foreground">{t("entity.groups.noSchedule")}</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {g.schedules.map((s) => (
              <span
                key={s.id}
                className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                {weekdayLabel(s.weekday, t).slice(0, 3)} {s.startTime.slice(0, 5)}
              </span>
            ))}
          </div>
        ),
    },
    {
      key: "room",
      header: t("entity.groups.columnRoom"),
      cell: (g) => g.schedules.find((s) => s.room)?.room ?? "—",
    },
    {
      key: "status",
      header: t("entity.groups.columnStatus"),
      cell: (g) => <StatusBadge status={g.status} />,
    },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "",
            className: "w-24 text-end",
            cell: (g: GroupRow) => (
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 rounded-lg"
                  aria-label={t("form.groups.editAria", { name: g.name })}
                  onClick={() => setDraft(groupToDraft(g))}
                >
                  <Pencil className="size-4" aria-hidden />
                </Button>
                <ConfirmDialog
                  title={t("entity.groups.deleteTitle")}
                  description={t("entity.groups.deleteDescription")}
                  confirmLabel={t("entity.groups.deleteConfirm")}
                  onConfirm={async () => {
                    try {
                      await remove.mutateAsync(g.id);
                      notifySuccess("entity.groups.deleted");
                    } catch (e) {
                      // 23503 on a group delete means payments are recorded against its
                      // registrations (payments.registration_id is ON DELETE RESTRICT):
                      // the only foreign key under a group that refuses rather than cascades.
                      if ((e as { code?: string } | null)?.code === "23503") {
                        toast.error(t("entity.groups.deleteBlockedByPayments"));
                      } else {
                        notifyError(e);
                      }
                    }
                  }}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 rounded-lg text-destructive"
                      aria-label={t("entity.groups.deleteAria", { name: g.name })}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  }
                />
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={t("entity.groups.title")}
        description={t("entity.groups.description", { count: data.length })}
        actions={
          canManage ? (
            <Button className="rounded-xl" onClick={() => setDraft(emptyGroupDraft())}>
              <Plus className="size-4" aria-hidden /> {t("entity.groups.new")}
            </Button>
          ) : undefined
        }
      />

      <DataTable
        rows={rows}
        columns={columns}
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        isRetrying={isFetching}
        rowKey={(g) => g.id}
        searchable={(g) =>
          `${g.name} ${subjectLabel(g.subjectKey, g.subjectName)} ${g.teacherName ?? ""} ${g.levelName ?? ""} ${g.programName ?? ""}`
        }
        searchPlaceholder={t("entity.groups.searchPlaceholder")}
        filters={
          <>
            <Select
              value={formationFilter}
              onValueChange={(v) => setFormationFilter(v as FormationFilter)}
            >
              <SelectTrigger
                className="h-9 w-56 rounded-xl"
                aria-label={t("entity.groups.filterFormationAria")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("entity.groups.allFormations")}</SelectItem>
                {formationOptions.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name} ({f.count})
                  </SelectItem>
                ))}
                <SelectItem value="none">
                  {t("entity.groups.noFormation")} ({standaloneCount})
                </SelectItem>
              </SelectContent>
            </Select>
            <Select value={subjectFilter} onValueChange={setSubjectFilter}>
              <SelectTrigger
                className="h-9 w-44 rounded-xl"
                aria-label={t("entity.groups.filterSubjectAria")}
              >
                <SelectValue placeholder={t("entity.subjects.title")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("entity.groups.allSubjects")}</SelectItem>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger
                className="h-9 w-44 rounded-xl"
                aria-label={t("entity.groups.filterLevelAria")}
              >
                <SelectValue placeholder={t("entity.students.level")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("entity.groups.allLevels")}</SelectItem>
                {levels.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger
                className="h-9 w-40 rounded-xl"
                aria-label={t("entity.groups.filterStatusAria")}
              >
                <SelectValue placeholder={t("entity.students.status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("entity.groups.allStatuses")}</SelectItem>
                <SelectItem value="active">{t("entity.groups.statusActive")}</SelectItem>
                <SelectItem value="inactive">{t("entity.groups.statusInactive")}</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
        emptyState={
          <EmptyState
            icon={GraduationCap}
            title={t("entity.groups.emptyTitle")}
            description={t("entity.groups.emptyDescription")}
            className="border-none shadow-none"
            action={
              canManage ? (
                <Button className="mt-2 rounded-xl" onClick={() => setDraft(emptyGroupDraft())}>
                  <Plus className="size-4" aria-hidden /> {t("entity.groups.new")}
                </Button>
              ) : undefined
            }
          />
        }
      />

      {draft && (
        <GroupFormDialog key={draft.id ?? "new"} initial={draft} onClose={() => setDraft(null)} />
      )}
    </>
  );
}

/** Subject and, for a group that delivers a formation, a link to that formation. */
function GroupSubline({
  subject,
  programId,
  programName,
}: {
  subject: string | null;
  programId: string | null;
  programName: string | null;
}) {
  const program = programId && programName ? { id: programId, name: programName } : null;
  if (!subject && !program) return <p className="truncate text-xs text-muted-foreground">—</p>;
  return (
    <p className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
      {subject && <span className="truncate">{subject}</span>}
      {subject && program && <span aria-hidden>·</span>}
      {program && (
        <Link
          to="/dashboard/programs/$programId"
          params={{ programId: program.id }}
          className="focus-ring inline-flex min-w-0 items-center gap-1 rounded hover:text-primary"
        >
          <Library className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{program.name}</span>
        </Link>
      )}
    </p>
  );
}
