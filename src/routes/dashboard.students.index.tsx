import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, Link2, Loader2, Pencil, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/empty-state";
import { PersonAvatar } from "@/features/profile/person-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RequireAuth } from "@/features/auth/require-auth";
import {
  useGroups,
  useLevels,
  useRegistrations,
  useStudents,
  useUpdateStudent,
} from "@/features/school/queries";
import { StudentRosterExport } from "@/features/school/student-roster-export";
import type { RosterSourceRow } from "@/features/school/roster-model";
import type { EntityStatus, StudentRow } from "@/features/school/types";
import { exportCsv } from "@/lib/export-csv";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { publicUrl } from "@/lib/desktop";

export const Route = createFileRoute("/dashboard/students/")({
  head: () => ({
    meta: [
      { title: "Élèves — Gestion École" },
      { name: "description", content: "Gérez les élèves de votre centre de soutien scolaire." },
      { property: "og:title", content: "Élèves — Gestion École" },
      { property: "og:description", content: "Gérez les élèves de votre centre." },
    ],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <StudentsPage />
    </RequireAuth>
  ),
});

type EditState = {
  id: string;
  fullName: string;
  phone: string;
  levelId: string;
  status: EntityStatus;
};

function StudentsPage() {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const { data = [], isLoading, error, refetch, isFetching } = useStudents();
  /*
    The roster is built from registrations, not from the student list: a roster is a list of
    PLACES IN GROUPS, and `StudentRow` carries only a count of them. Both queries are already
    scoped by RLS, so nothing here decides who may see what.
  */
  const { data: groups = [] } = useGroups();
  const { data: registrations = [] } = useRegistrations();

  const rosterSource: RosterSourceRow[] = useMemo(
    () =>
      registrations.map((r) => ({
        studentId: r.studentId,
        studentName: r.studentName,
        groupId: r.groupId,
        groupName: r.groupName,
        subjectName: r.subjectName,
        levelName: r.levelName,
        status: r.status,
      })),
    [registrations],
  );

  const rosterGroups = useMemo(() => groups.map((g) => ({ id: g.id, name: g.name })), [groups]);
  const { data: levels = [] } = useLevels();
  const update = useUpdateStudent();
  const [levelFilter, setLevelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editing, setEditing] = useState<EditState | null>(null);

  const rows = useMemo(
    () =>
      data.filter(
        (r) =>
          (levelFilter === "all" || r.levelId === levelFilter) &&
          (statusFilter === "all" || r.status === statusFilter),
      ),
    [data, levelFilter, statusFilter],
  );

  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl("/register"));
      notifySuccess("entity.students.inviteLinkCopied");
    } catch {
      toast.error(t("entity.common.copyFail"));
    }
  };

  const handleExport = (list: StudentRow[]) => {
    if (list.length === 0) {
      toast.error(t("entity.common.noRows"));
      return;
    }
    exportCsv(
      "eleves",
      list.map((r) => ({
        Nom: r.fullName,
        Email: r.email ?? "",
        Téléphone: r.phone ?? "",
        Niveau: r.levelName ?? "",
        Groupes: r.groupCount,
        Statut: r.status,
        Inscription: new Date(r.registeredAt).toLocaleDateString("fr-FR"),
      })),
    );
    toast.success(t("entity.students.exportedCount", { count: String(list.length) }));
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!editing.fullName.trim()) {
      toast.error(t("entity.students.nameRequired"));
      return;
    }
    try {
      await update.mutateAsync({
        id: editing.id,
        fullName: editing.fullName.trim(),
        phone: editing.phone.trim() || null,
        levelId: editing.levelId === "none" ? null : editing.levelId,
        status: editing.status,
      });
      notifySuccess("entity.students.updated");
      setEditing(null);
    } catch (e) {
      notifyError(e);
    }
  };

  const columns: Column<StudentRow>[] = [
    {
      key: "name",
      header: t("entity.students.columnStudent"),
      sortValue: (r) => r.fullName,
      cell: (r) => (
        <div className="flex items-center gap-3">
          <PersonAvatar
            name={r.fullName}
            url={r.avatarUrl}
            accent="var(--color-primary)"
            className="size-9 text-xs"
          />
          <div className="min-w-0">
            <Link
              to="/dashboard/students/$studentId"
              params={{ studentId: r.id }}
              className="focus-ring block truncate rounded font-medium hover:text-primary"
            >
              {r.fullName}
            </Link>
            <p className="truncate text-xs text-muted-foreground">{r.email ?? "—"}</p>
          </div>
        </div>
      ),
    },
    { key: "phone", header: t("entity.students.columnPhone"), cell: (r) => r.phone ?? "—" },
    {
      key: "level",
      header: t("entity.students.columnLevel"),
      sortValue: (r) => r.levelName ?? "",
      cell: (r) => r.levelName ?? "—",
    },
    {
      key: "groups",
      header: t("entity.students.columnGroups"),
      sortValue: (r) => r.groupCount,
      cell: (r) => <span className="tabular-nums">{r.groupCount}</span>,
    },
    {
      key: "date",
      header: t("entity.students.columnRegistered"),
      sortValue: (r) => r.registeredAt,
      cell: (r) => new Date(r.registeredAt).toLocaleDateString("fr-FR"),
    },
    {
      key: "status",
      header: t("entity.students.columnStatus"),
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "actions",
      header: "",
      className: "w-16 text-end",
      cell: (r) => (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("entity.students.editAria", { name: r.fullName })}
          className="size-9 rounded-lg"
          onClick={() =>
            setEditing({
              id: r.id,
              fullName: r.fullName,
              phone: r.phone ?? "",
              levelId: r.levelId ?? "none",
              status: r.status,
            })
          }
        >
          <Pencil className="size-4" aria-hidden />
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("entity.students.title")}
        description={t("entity.students.description", {
          count: String(data.length),
          shown: String(rows.length),
        })}
        actions={
          <>
            <Button variant="outline" className="rounded-xl" onClick={() => handleExport(rows)}>
              <Download className="size-4" aria-hidden /> {t("entity.common.export")}
            </Button>
            <Button className="rounded-xl" onClick={copyInviteLink}>
              <UserPlus className="size-4" aria-hidden /> {t("entity.students.invite")}
            </Button>
          </>
        }
      />

      {/*
        Scoped by its own group selector rather than by the table's search box: the search
        lives inside `DataTable` and is not readable from here, and a document that silently
        followed a filter the user could not see beside the buttons would be worse than one
        whose scope is stated on the control itself.
      */}
      <section className="surface-card p-4">
        <h2 className="mb-3 text-sm font-semibold">{t("roster.export")}</h2>
        <StudentRosterExport source={rosterSource} groups={rosterGroups} />
      </section>

      <DataTable
        rows={rows}
        columns={columns}
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        isRetrying={isFetching}
        rowKey={(r) => r.id}
        searchable={(r) => `${r.fullName} ${r.email ?? ""} ${r.phone ?? ""} ${r.levelName ?? ""}`}
        searchPlaceholder={t("entity.students.searchPlaceholder")}
        filters={
          <>
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger
                className="h-9 w-44 rounded-xl"
                aria-label={t("entity.students.filterLevelAria")}
              >
                <SelectValue placeholder={t("entity.students.level")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("entity.students.allLevels")}</SelectItem>
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
                aria-label={t("entity.students.filterStatusAria")}
              >
                <SelectValue placeholder={t("entity.students.status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("entity.students.allStatuses")}</SelectItem>
                <SelectItem value="active">{t("entity.students.statusActive")}</SelectItem>
                <SelectItem value="inactive">{t("entity.students.statusInactive")}</SelectItem>
              </SelectContent>
            </Select>
            {(levelFilter !== "all" || statusFilter !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                className="rounded-lg"
                onClick={() => {
                  setLevelFilter("all");
                  setStatusFilter("all");
                }}
              >
                {t("entity.common.reset")}
              </Button>
            )}
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
            icon={Users}
            title={t("entity.students.emptyTitle")}
            description={t("entity.students.emptyDescription")}
            className="border-none shadow-none"
            action={
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                <Button className="rounded-xl" onClick={copyInviteLink}>
                  <Link2 className="size-4" aria-hidden /> {t("entity.students.copyInviteLink")}
                </Button>
                <Button variant="outline" className="rounded-xl" onClick={() => handleExport(data)}>
                  <Download className="size-4" aria-hidden /> {t("entity.common.export")}
                </Button>
              </div>
            }
          />
        }
      />

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>{t("entity.students.editTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="student-name">{t("entity.students.fullName")}</Label>
              <Input
                id="student-name"
                className="h-11 rounded-xl"
                value={editing?.fullName ?? ""}
                onChange={(e) => setEditing((p) => (p ? { ...p, fullName: e.target.value } : p))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="student-phone">{t("entity.students.phone")}</Label>
              <Input
                id="student-phone"
                className="h-11 rounded-xl"
                value={editing?.phone ?? ""}
                onChange={(e) => setEditing((p) => (p ? { ...p, phone: e.target.value } : p))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="student-level">{t("entity.students.level")}</Label>
              <Select
                value={editing?.levelId ?? "none"}
                onValueChange={(value) => setEditing((p) => (p ? { ...p, levelId: value } : p))}
              >
                <SelectTrigger id="student-level" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("entity.students.noLevel")}</SelectItem>
                  {levels.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="student-status">{t("entity.students.status")}</Label>
              <Select
                value={editing?.status ?? "active"}
                onValueChange={(value) =>
                  setEditing((p) => (p ? { ...p, status: value as EntityStatus } : p))
                }
              >
                <SelectTrigger id="student-status" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t("entity.students.statusActive")}</SelectItem>
                  <SelectItem value="inactive">{t("entity.students.statusInactive")}</SelectItem>
                </SelectContent>
              </Select>
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
            <Button className="rounded-xl" onClick={saveEdit} disabled={update.isPending}>
              {update.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {update.isPending ? t("ui.saving") : t("entity.common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
