import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, Loader2, UserPlus, UserSquare2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/empty-state";
import { PersonAvatar } from "@/features/profile/person-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { TeacherRosterExport } from "@/features/school/teacher-roster-export";
import type { TeacherRosterSourceRow } from "@/features/school/teacher-roster-model";
import { useSubjects, useTeachers, useUpdateTeacher } from "@/features/school/queries";
import type { EntityStatus, TeacherRow } from "@/features/school/types";
import { exportCsv } from "@/lib/export-csv";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { currentAccessToken } from "@/integrations/supabase/access-token";
import { CreateTeacherDialog } from "@/features/teachers/components/create-teacher-dialog";
import {
  TeacherActionsMenu,
  type TeacherAction,
} from "@/features/teachers/components/teacher-actions-menu";
import {
  LifecycleDialog,
  type ConfirmableAction,
} from "@/features/teachers/components/lifecycle-dialog";
import {
  deleteTeacherFn,
  resetTeacherPasswordFn,
  setTeacherLifecycleFn,
  teacherDependenciesFn,
  type DependencyRow,
} from "@/features/teachers/provisioning.functions";
import {
  CredentialsDialog,
  type Credentials,
} from "@/features/teachers/components/credentials-dialog";

export const Route = createFileRoute("/dashboard/teachers/")({
  head: () => ({
    meta: [
      { title: "Enseignants — Gestion École" },
      { name: "description", content: "Gérez les enseignants, leurs matières et leurs groupes." },
      { property: "og:title", content: "Enseignants — Gestion École" },
      { property: "og:description", content: "Gérez les enseignants de votre centre." },
    ],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <TeachersPage />
    </RequireAuth>
  ),
});

function TeachersPage() {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const { data = [], isLoading, error, refetch, isFetching } = useTeachers();
  const { data: subjects = [] } = useSubjects();
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editing, setEditing] = useState<TeacherRow | null>(null);
  const [creating, setCreating] = useState(false);
  // Holds the one-time temporary password between creation and the dialog
  // closing. Never persisted; cleared the moment the admin dismisses it.
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  // Lifecycle: which action is awaiting confirmation, for whom, and the
  // dependency list that decides whether deletion is even offered.
  const [confirming, setConfirming] = useState<ConfirmableAction | null>(null);
  const [target, setTarget] = useState<TeacherRow | null>(null);
  const [dependencies, setDependencies] = useState<DependencyRow[] | null>(null);
  const [loadingDeps, setLoadingDeps] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const update = useUpdateTeacher();

  const patch = (values: Partial<TeacherRow>) => setEditing((p) => (p ? { ...p, ...values } : p));

  /**
   * Routes a menu selection: immediate for non-destructive actions, otherwise
   * open the confirmation dialog. For deletion the dependency list is fetched
   * first so the dialog can explain rather than fail after the fact.
   */
  const handleAction = async (action: TeacherAction, teacher: TeacherRow) => {
    if (action === "view") return; // the menu navigates directly
    if (action === "edit") {
      setEditing(teacher);
      return;
    }

    setTarget(teacher);
    setConfirming(action as ConfirmableAction);
    setDependencies(null);

    if (action === "delete") {
      setLoadingDeps(true);
      try {
        const accessToken = await currentAccessToken();
        if (!accessToken) return;
        const result = await teacherDependenciesFn({
          data: { accessToken, teacherId: teacher.id },
        });
        setDependencies(result.ok ? (result.dependencies ?? []) : []);
      } catch (e) {
        notifyError(e);
        setDependencies([]);
      } finally {
        setLoadingDeps(false);
      }
    }
  };

  const runAction = async (reason: string) => {
    if (!confirming || !target || actionPending) return;
    setActionPending(true);
    try {
      const accessToken = await currentAccessToken();
      if (!accessToken) {
        toast.error(t("error.sessionExpired"));
        return;
      }

      if (confirming === "resetPassword") {
        const result = await resetTeacherPasswordFn({
          data: { accessToken, teacherId: target.id },
        });
        if (!result.ok || !result.teacher) {
          toast.error(result.message ?? t("error.generic"));
          return;
        }
        // Same one-time hand-off as creation: shown once, never stored.
        setCredentials({
          fullName: result.teacher.fullName,
          email: result.teacher.email,
          temporaryPassword: result.teacher.temporaryPassword,
        });
      } else if (confirming === "delete") {
        const result = await deleteTeacherFn({ data: { accessToken, teacherId: target.id } });
        if (!result.ok) {
          toast.error(result.message ?? t("error.generic"));
          return;
        }
        notifySuccess("lifecycle.delete.done");
      } else {
        const status =
          confirming === "suspend" ? "suspended" : confirming === "archive" ? "archived" : "active";
        const result = await setTeacherLifecycleFn({
          data: { accessToken, teacherId: target.id, status, reason: reason || undefined },
        });
        if (!result.ok) {
          // The database explains precisely why (e.g. groups still assigned).
          toast.error(result.message ?? t("error.generic"));
          return;
        }
        notifySuccess(`lifecycle.${confirming}.done`);
      }

      await refetch();
      setConfirming(null);
      setTarget(null);
    } catch (e) {
      notifyError(e);
    } finally {
      setActionPending(false);
    }
  };

  const submitTeacher = async () => {
    if (!editing) return;
    // A teacher with no subject cannot be assigned to any group -- the database
    // trigger would reject every attempt -- so refuse to save that state.
    if (editing.subjectIds.length === 0) {
      toast.error(t("form.teachers.subjectRequired"));
      return;
    }
    try {
      await update.mutateAsync({
        id: editing.id,
        experienceYears: editing.experienceYears,
        status: editing.status,
        subjectIds: editing.subjectIds,
        phone: editing.phone?.trim() || null,
        bio: editing.bio?.trim() || null,
      });
      notifySuccess("form.teachers.saved");
      setEditing(null);
    } catch (e) {
      notifyError(e);
    }
  };

  const rows = useMemo(
    () =>
      data.filter(
        (r) =>
          (subjectFilter === "all" || r.subjects.includes(subjectFilter)) &&
          (statusFilter === "all" || r.status === statusFilter),
      ),
    [data, subjectFilter, statusFilter],
  );

  // The document's own view of a teacher: identity and contact, not the table's cells.
  const rosterSource: TeacherRosterSourceRow[] = useMemo(
    () =>
      data.map((r) => ({
        teacherId: r.id,
        teacherName: r.fullName,
        email: r.email,
        phone: r.phone,
        subjects: r.subjects,
        groupCount: r.groupCount,
        status: r.status,
      })),
    [data],
  );

  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/register`);
      notifySuccess("entity.teachers.inviteLinkCopied");
    } catch {
      toast.error(t("entity.common.copyFail"));
    }
  };

  const handleExport = (list: TeacherRow[]) => {
    if (list.length === 0) {
      toast.error(t("entity.common.noRows"));
      return;
    }
    exportCsv(
      "enseignants",
      list.map((r) => ({
        Nom: r.fullName,
        Email: r.email ?? "",
        Téléphone: r.phone ?? "",
        Matières: r.subjects.join(" / "),
        Groupes: r.groupCount,
        Expérience: r.experienceYears,
        Statut: r.status,
      })),
    );
    toast.success(t("entity.teachers.exportedCount", { count: String(list.length) }));
  };

  const columns: Column<TeacherRow>[] = [
    {
      key: "name",
      header: t("entity.teachers.columnTeacher"),
      sortValue: (r) => r.fullName,
      cell: (r) => (
        <div className="flex items-center gap-3">
          <PersonAvatar
            name={r.fullName}
            url={r.avatarUrl}
            accent="var(--color-accent)"
            className="size-9 text-xs"
          />
          <div className="min-w-0">
            <Link
              to="/dashboard/teachers/$teacherId"
              params={{ teacherId: r.id }}
              className="focus-ring block truncate rounded font-medium hover:text-primary"
            >
              {r.fullName}
            </Link>
            <p className="truncate text-xs text-muted-foreground">{r.email ?? "—"}</p>
          </div>
        </div>
      ),
    },
    { key: "phone", header: t("entity.teachers.columnPhone"), cell: (r) => r.phone ?? "—" },
    {
      key: "subjects",
      header: t("entity.teachers.columnSubjects"),
      cell: (r) =>
        r.subjects.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {r.subjects.map((s) => (
              <Badge key={s} variant="secondary" className="rounded-full">
                {s}
              </Badge>
            ))}
          </div>
        ),
    },
    {
      key: "groups",
      header: t("entity.teachers.columnGroups"),
      sortValue: (r) => r.groupCount,
      cell: (r) => <span className="tabular-nums">{r.groupCount}</span>,
    },
    {
      key: "exp",
      header: t("entity.teachers.columnExperience"),
      sortValue: (r) => r.experienceYears,
      cell: (r) => t("entity.teachers.experienceYears", { count: String(r.experienceYears) }),
    },
    {
      key: "status",
      header: t("entity.teachers.columnStatus"),
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "actions",
      header: "",
      className: "w-16 text-end",
      cell: (r) => (
        <div className="flex justify-end">
          <TeacherActionsMenu teacher={r} onAction={handleAction} />
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("entity.teachers.title")}
        description={t("entity.teachers.description", {
          count: String(data.length),
          shown: String(rows.length),
        })}
        actions={
          <>
            <Button variant="outline" className="rounded-xl" onClick={() => handleExport(rows)}>
              <Download className="size-4" aria-hidden /> {t("entity.common.export")}
            </Button>
            <Button className="rounded-xl" onClick={() => setCreating(true)}>
              <UserPlus className="size-4" aria-hidden /> {t("teachers.create.action")}
            </Button>
          </>
        }
      />
      {/*
        Scoped by its own status selector rather than by the table's search box: the search
        lives inside `DataTable` and is not readable from here, and a document that silently
        followed a filter the user could not see beside the buttons would be worse than one
        whose scope is stated on the control itself.

        Fed `data` rather than `rows` for the same reason: the table's subject filter is a
        way of reading the screen, and a printed staff list that had quietly dropped every
        teacher of another subject -- without saying so anywhere on the page -- is exactly
        the document a school would later act on wrongly.
      */}
      <section className="surface-card p-4">
        <h2 className="mb-3 text-sm font-semibold">{t("teacherRoster.export")}</h2>
        <TeacherRosterExport source={rosterSource} />
      </section>

      <DataTable
        rows={rows}
        columns={columns}
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        isRetrying={isFetching}
        rowKey={(r) => r.id}
        searchable={(r) => `${r.fullName} ${r.email ?? ""} ${r.subjects.join(" ")}`}
        searchPlaceholder={t("entity.teachers.searchPlaceholder")}
        filters={
          <>
            <Select value={subjectFilter} onValueChange={setSubjectFilter}>
              <SelectTrigger
                className="h-9 w-44 rounded-xl"
                aria-label={t("entity.teachers.filterSubjectAria")}
              >
                <SelectValue placeholder={t("entity.teachers.columnSubjects")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("entity.teachers.allSubjects")}</SelectItem>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={s.name}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger
                className="h-9 w-40 rounded-xl"
                aria-label={t("entity.teachers.filterStatusAria")}
              >
                <SelectValue placeholder={t("entity.teachers.columnStatus")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("entity.teachers.allStatuses")}</SelectItem>
                <SelectItem value="active">{t("entity.teachers.statusActive")}</SelectItem>
                <SelectItem value="inactive">{t("entity.teachers.statusInactive")}</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
        bulkActions={(selected) => (
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={() => handleExport(selected)}
          >
            <Download className="size-3.5" aria-hidden /> {t("entity.common.exportSelection")}
          </Button>
        )}
        emptyState={
          <EmptyState
            icon={UserSquare2}
            title={t("entity.teachers.emptyTitle")}
            description={t("entity.teachers.emptyDescription")}
            className="border-none shadow-none"
            action={
              <Button className="mt-2 rounded-xl" onClick={() => setCreating(true)}>
                <UserPlus className="size-4" aria-hidden /> {t("teachers.create.action")}
              </Button>
            }
          />
        }
      />

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>{t("form.teachers.editTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="teacher-phone">{t("form.teachers.phone")}</Label>
                <Input
                  id="teacher-phone"
                  className="h-11 rounded-xl"
                  dir="ltr"
                  value={editing?.phone ?? ""}
                  onChange={(e) => patch({ phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="teacher-exp">{t("form.teachers.experience")}</Label>
                <Input
                  id="teacher-exp"
                  type="number"
                  min={0}
                  className="h-11 rounded-xl"
                  value={editing?.experienceYears ?? 0}
                  onChange={(e) => patch({ experienceYears: Number(e.target.value) || 0 })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="teacher-status">{t("form.teachers.status")}</Label>
              <Select
                value={editing?.status ?? "active"}
                onValueChange={(v) => patch({ status: v as EntityStatus })}
              >
                <SelectTrigger id="teacher-status" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t("form.common.statusActive")}</SelectItem>
                  <SelectItem value="inactive">{t("form.common.statusInactive")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("form.teachers.subjects")}</legend>
              {subjects.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("form.teachers.noSubjects")}</p>
              ) : (
                <div className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-2">
                  {subjects.map((s) => {
                    const checked = editing?.subjectIds.includes(s.id) ?? false;
                    return (
                      <label key={s.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) =>
                            patch({
                              subjectIds: value
                                ? [...(editing?.subjectIds ?? []), s.id]
                                : (editing?.subjectIds ?? []).filter((id) => id !== s.id),
                              subjects: value
                                ? [...(editing?.subjects ?? []), s.name]
                                : (editing?.subjects ?? []).filter((n) => n !== s.name),
                            })
                          }
                        />
                        <span className="truncate">{s.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="teacher-bio">{t("form.teachers.bio")}</Label>
              <Textarea
                id="teacher-bio"
                rows={3}
                className="rounded-xl"
                value={editing?.bio ?? ""}
                onChange={(e) => patch({ bio: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              className="rounded-xl"
              onClick={() => setEditing(null)}
              disabled={update.isPending}
            >
              {t("entity.common.cancel")}
            </Button>
            <Button className="rounded-xl" onClick={submitTeacher} disabled={update.isPending}>
              {update.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {update.isPending ? t("ui.saving") : t("entity.common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin-only provisioning. Kept as siblings of the edit dialog so each
          owns exactly one piece of state: `creating` drives the form, and
          `credentials` drives the one-time password hand-off that follows it. */}
      <CreateTeacherDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(created) => {
          setCredentials(created);
          void refetch();
        }}
      />

      <CredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} />

      <LifecycleDialog
        action={confirming}
        teacherName={target?.fullName ?? ""}
        dependencies={dependencies}
        loadingDependencies={loadingDeps}
        pending={actionPending}
        onConfirm={runAction}
        onCancel={() => {
          setConfirming(null);
          setTarget(null);
          setDependencies(null);
        }}
      />
    </>
  );
}
