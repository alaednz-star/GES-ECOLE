/**
 * Formations (table `programs`, ADR-004): what the institution offers, run as groups.
 *
 * A formation names WHAT is offered -- "English C1", "Excel Advanced", "Bac Mathematics
 * preparation" -- with a type, a lifecycle, optional subject/level/dates/duration and content.
 * Groups do everything operational (teacher, schedule, capacity, attendance, resources,
 * registrations, payments). Creating a formation can include its first group in the same form
 * (atomic, `create_formation`); the new formation then opens on its own page
 * (`dashboard.programs.$programId.tsx`), where further groups are added.
 *
 * Capacity and teachers shown here are DERIVED from the formation's groups
 * (`summariseProgramGroups`); nothing on this screen stores them.
 *
 * Security is RLS (20261001100000): administrators write, teachers read only the formations
 * of their own groups, students read nothing. The route guard is navigation.
 */

import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Eye, Library, MoreHorizontal, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RequireAuth } from "@/features/auth/require-auth";
import { usePrograms, type ProgramRow } from "@/features/school/programs";
import { useProgramLevelLabel } from "@/features/school/level-system-label";
import { useFormationTypeLabels } from "@/features/school/formation-types";
import {
  PROGRAM_STATUSES,
  nextStatuses,
  summariseProgramGroups,
  type ProgramCategory,
  type ProgramStatus,
} from "@/features/school/program-model";
import {
  ProgramFormDialog,
  ProgramDeleteDialog,
  ProgramStatusDialog,
  type ProgramFormState,
  type ProgramStatusChange,
} from "@/features/school/components/program-dialogs";
import { useI18n } from "@/hooks/use-i18n";

export const Route = createFileRoute("/dashboard/programs/")({
  head: () => ({
    meta: [
      { title: "Formations — Gestion École" },
      {
        name: "description",
        content: "Formations proposées par l'établissement et leurs groupes.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <ProgramsPage />
    </RequireAuth>
  ),
});

function ProgramsPage() {
  const { t } = useI18n();
  const levelLabel = useProgramLevelLabel();
  const typeLabels = useFormationTypeLabels();
  const navigate = useNavigate();
  const { data = [], isLoading, error, refetch, isFetching } = usePrograms();

  const [statusFilter, setStatusFilter] = useState<ProgramStatus | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<ProgramCategory | "all">("all");
  const [form, setForm] = useState<ProgramFormState | null>(null);
  const [deleting, setDeleting] = useState<ProgramRow | null>(null);
  const [change, setChange] = useState<ProgramStatusChange | null>(null);

  const rows = useMemo(
    () =>
      data.filter(
        (p) =>
          (statusFilter === "all" || p.status === statusFilter) &&
          (categoryFilter === "all" || p.category === categoryFilter),
      ),
    [data, statusFilter, categoryFilter],
  );
  const openProgram = (id: string) =>
    void navigate({ to: "/dashboard/programs/$programId", params: { programId: id } });

  const columns: Column<ProgramRow>[] = [
    {
      key: "name",
      header: t("programs.col.name"),
      sortValue: (p) => p.name,
      cell: (p) => (
        <div className="min-w-0">
          <Link
            to="/dashboard/programs/$programId"
            params={{ programId: p.id }}
            className="focus-ring block max-w-full truncate rounded text-start font-medium hover:text-primary"
          >
            {p.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {[levelLabel(p), p.subjectName].filter(Boolean).join(" · ") || t("programs.none")}
          </p>
        </div>
      ),
    },
    {
      key: "category",
      header: t("programs.col.category"),
      sortValue: (p) => typeLabels.labelOf(p.category),
      cell: (p) => <span className="text-muted-foreground">{typeLabels.labelOf(p.category)}</span>,
    },
    {
      key: "status",
      header: t("programs.col.status"),
      sortValue: (p) => PROGRAM_STATUSES.indexOf(p.status),
      cell: (p) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={p.status} />
          {p.registrationOpen && (
            <span className="inline-flex items-center rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
              {t("programs.registrationOpen")}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "groups",
      header: t("programs.col.groups"),
      className: "text-end",
      sortValue: (p) => p.groups.length,
      cell: (p) => <span className="tabular-nums">{p.groups.length}</span>,
    },
    {
      key: "seats",
      header: t("programs.col.seats"),
      className: "text-end",
      sortValue: (p) => summariseProgramGroups(p.groups).seats,
      cell: (p) => {
        const s = summariseProgramGroups(p.groups);
        return (
          <span className="tabular-nums" dir="ltr">
            {t("programs.seats", { enrolled: s.enrolled, seats: s.seats })}
          </span>
        );
      },
    },
    {
      key: "teachers",
      header: t("programs.col.teachers"),
      cell: (p) => {
        const { teachers } = summariseProgramGroups(p.groups);
        if (teachers.length === 0) {
          return <span className="text-muted-foreground">{t("programs.none")}</span>;
        }
        const shown = teachers.slice(0, 2).map((x) => x.name ?? t("programs.none"));
        return (
          <span className="text-muted-foreground">
            {shown.join(", ")}
            {teachers.length > 2 &&
              ` ${t("programs.moreTeachers", { count: teachers.length - 2 })}`}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      className: "w-12 text-end",
      cell: (p) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg"
              aria-label={t("programs.actionsAria", { name: p.name })}
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 rounded-xl">
            <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
              {p.name}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openProgram(p.id)}>
              <Eye className="size-4" aria-hidden />
              {t("programs.details")}
            </DropdownMenuItem>
            {p.status !== "archived" && (
              <DropdownMenuItem onSelect={() => setForm({ mode: "edit", program: p })}>
                <Pencil className="size-4" aria-hidden />
                {t("programs.edit")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {nextStatuses(p.status).map((to) => (
              <DropdownMenuItem
                key={to}
                onSelect={() => setChange({ program: p, to })}
                className={
                  to === "cancelled" ? "text-destructive focus:text-destructive" : undefined
                }
              >
                {t(`programs.action.${to}`)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => setDeleting(p)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="size-4" aria-hidden />
              {t("programs.action.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("programs.title")}
        description={t("programs.subtitle")}
        actions={
          <>
            <Button variant="outline" className="rounded-xl" asChild>
              <Link to="/dashboard/programs/types">
                <Tags className="size-4" aria-hidden />
                {t("formationTypes.manage")}
              </Link>
            </Button>
            <Button className="rounded-xl" onClick={() => setForm({ mode: "create" })}>
              <Plus className="size-4" aria-hidden />
              {t("programs.new")}
            </Button>
          </>
        }
      />

      <DataTable
        rows={rows}
        columns={columns}
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        isRetrying={isFetching}
        rowKey={(p) => p.id}
        searchable={(p) =>
          [p.name, levelLabel(p), p.subjectName, typeLabels.labelOf(p.category)]
            .filter(Boolean)
            .join(" ")
        }
        searchPlaceholder={t("programs.search")}
        emptyState={
          <EmptyState
            icon={Library}
            title={t("programs.emptyTitle")}
            description={t("programs.emptyBody")}
          />
        }
        filters={
          <>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as ProgramStatus | "all")}
            >
              <SelectTrigger
                className="h-9 w-40 rounded-xl"
                aria-label={t("programs.filter.status")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("programs.filter.allStatuses")}</SelectItem>
                {PROGRAM_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`ui.status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={categoryFilter}
              onValueChange={(v) => setCategoryFilter(v as ProgramCategory | "all")}
            >
              <SelectTrigger
                className="h-9 w-52 rounded-xl"
                aria-label={t("programs.filter.category")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("programs.filter.allCategories")}</SelectItem>
                {typeLabels.types.map((ft) => (
                  <SelectItem key={ft.code} value={ft.code}>
                    {typeLabels.label(ft)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />

      {form && (
        <ProgramFormDialog
          key={form.mode === "edit" ? form.program.id : "create"}
          state={form}
          onClose={() => setForm(null)}
          // A new formation opens on its own page, where its groups are managed.
          onSaved={(id, created) => created && openProgram(id)}
        />
      )}

      <ProgramStatusDialog change={change} onClose={() => setChange(null)} />
      <ProgramDeleteDialog program={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}
