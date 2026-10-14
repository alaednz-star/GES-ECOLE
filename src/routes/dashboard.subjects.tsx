import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { StatusBadge } from "@/components/common/status-badge";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  useDeleteSubject,
  useGroups,
  useSaveSubject,
  useSubjects,
  useTeachers,
} from "@/features/school/queries";
import type { Subject } from "@/features/school/types";
import {
  DEFAULT_SUBJECT_DOMAIN,
  SUBJECT_DOMAINS,
  type SubjectDomain,
} from "@/features/school/subject-domain";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";

export const Route = createFileRoute("/dashboard/subjects")({
  head: () => ({
    meta: [
      { title: "Matières — Gestion École" },
      { name: "description", content: "Créez et organisez les matières enseignées." },
      { property: "og:title", content: "Matières — Gestion École" },
      { property: "og:description", content: "Créez et organisez les matières enseignées." },
    ],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <SubjectsPage />
    </RequireAuth>
  ),
});

interface SubjectRow extends Subject {
  teacherCount: number;
  groupCount: number;
  studentCount: number;
}

function SubjectsPage() {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const { data: subjects = [], isLoading, error, refetch, isFetching } = useSubjects();
  const { data: groups = [] } = useGroups();
  const { data: teachers = [] } = useTeachers();
  const save = useSaveSubject();
  const remove = useDeleteSubject();
  const [editing, setEditing] = useState<Partial<Subject> | null>(null);

  const rows: SubjectRow[] = useMemo(
    () =>
      subjects.map((s) => {
        const subjectGroups = groups.filter((g) => g.subjectId === s.id);
        return {
          ...s,
          groupCount: subjectGroups.length,
          studentCount: subjectGroups.reduce((sum, g) => sum + g.enrolled, 0),
          // Qualified teachers, matched by id. Previously this compared
          // subject *names*, which breaks if two subjects share a label and
          // counted assignment rather than qualification.
          teacherCount: teachers.filter((t2) => t2.subjectIds.includes(s.id)).length,
        };
      }),
    [subjects, groups, teachers],
  );

  const submit = async () => {
    if (!editing?.name?.trim()) {
      toast.error(t("entity.subjects.nameRequired"));
      return;
    }
    try {
      await save.mutateAsync({ ...editing, name: editing.name.trim() });
      notifySuccess("entity.subjects.saved");
      setEditing(null);
    } catch (e) {
      notifyError(e);
    }
  };

  const columns: Column<SubjectRow>[] = [
    {
      key: "name",
      header: t("entity.subjects.columnSubject"),
      sortValue: (r) => r.name,
      cell: (r) => (
        <div className="flex items-center gap-3">
          <span
            className="size-8 shrink-0 rounded-lg"
            style={{ backgroundColor: r.color }}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="truncate font-medium">{r.name}</p>
            <p className="truncate text-xs text-muted-foreground">{r.description ?? "—"}</p>
          </div>
        </div>
      ),
    },
    {
      key: "domain",
      header: t("entity.subjects.columnDomain"),
      sortValue: (r) => t(`subjectDomain.${r.domain}`),
      cell: (r) => <span className="text-sm">{t(`subjectDomain.${r.domain}`)}</span>,
    },
    {
      key: "teachers",
      header: t("entity.subjects.columnTeachers"),
      sortValue: (r) => r.teacherCount,
      cell: (r) => <span className="tabular-nums">{r.teacherCount}</span>,
    },
    {
      key: "groups",
      header: t("entity.subjects.columnGroups"),
      sortValue: (r) => r.groupCount,
      cell: (r) => <span className="tabular-nums">{r.groupCount}</span>,
    },
    {
      key: "students",
      header: t("entity.subjects.columnStudents"),
      sortValue: (r) => r.studentCount,
      cell: (r) => <span className="tabular-nums">{r.studentCount}</span>,
    },
    {
      key: "status",
      header: t("entity.subjects.columnStatus"),
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "actions",
      header: "",
      className: "w-24 text-end",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-lg"
            aria-label={t("entity.subjects.editAria", { name: r.name })}
            onClick={() => setEditing(r)}
          >
            <Pencil className="size-4" aria-hidden />
          </Button>
          <ConfirmDialog
            title={t("entity.subjects.deleteTitle")}
            description={t("entity.subjects.deleteDescription")}
            confirmLabel={t("entity.subjects.deleteConfirm")}
            onConfirm={async () => {
              try {
                await remove.mutateAsync(r.id);
                notifySuccess("entity.subjects.deleted");
              } catch (e) {
                notifyError(e);
              }
            }}
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="size-9 rounded-lg text-destructive"
                aria-label={t("entity.subjects.deleteAria", { name: r.name })}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            }
          />
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("entity.subjects.title")}
        description={t("entity.subjects.description")}
        actions={
          <Button
            className="rounded-xl"
            onClick={() => setEditing({ color: "#0F766E", domain: DEFAULT_SUBJECT_DOMAIN })}
          >
            <Plus className="size-4" aria-hidden /> {t("entity.subjects.new")}
          </Button>
        }
      />

      <DataTable
        rows={rows}
        columns={columns}
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        isRetrying={isFetching}
        rowKey={(r) => r.id}
        searchable={(r) => `${r.name} ${r.description ?? ""} ${t(`subjectDomain.${r.domain}`)}`}
        searchPlaceholder={t("entity.subjects.searchPlaceholder")}
        emptyState={
          <EmptyState
            icon={BookOpen}
            title={t("entity.subjects.emptyTitle")}
            description={t("entity.subjects.emptyDescription")}
            className="border-none shadow-none"
            action={
              <Button
                className="mt-2 rounded-xl"
                onClick={() => setEditing({ color: "#0F766E", domain: DEFAULT_SUBJECT_DOMAIN })}
              >
                <Plus className="size-4" aria-hidden /> {t("entity.subjects.create")}
              </Button>
            }
          />
        }
      />

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? t("entity.subjects.editTitle") : t("entity.subjects.newTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="subject-name">{t("entity.subjects.name")}</Label>
              <Input
                id="subject-name"
                className="h-11 rounded-xl"
                value={editing?.name ?? ""}
                onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject-domain">{t("entity.subjects.domain")}</Label>
              <Select
                value={editing?.domain ?? DEFAULT_SUBJECT_DOMAIN}
                onValueChange={(v) => {
                  // Radix may report "" while the dialog mounts: not a choice.
                  if (v) setEditing((p) => ({ ...p, domain: v as SubjectDomain }));
                }}
              >
                <SelectTrigger id="subject-domain" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBJECT_DOMAINS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {t(`subjectDomain.${d}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("entity.subjects.domainHint")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject-color">{t("entity.subjects.color")}</Label>
              <Input
                id="subject-color"
                type="color"
                className="h-11 w-24 rounded-xl p-1"
                value={editing?.color ?? "#0F766E"}
                onChange={(e) => setEditing((p) => ({ ...p, color: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject-description">{t("entity.subjects.description.label")}</Label>
              <Textarea
                id="subject-description"
                className="rounded-xl"
                value={editing?.description ?? ""}
                onChange={(e) => setEditing((p) => ({ ...p, description: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="rounded-xl" onClick={() => setEditing(null)}>
              {t("entity.common.cancel")}
            </Button>
            <Button className="rounded-xl" onClick={submit} disabled={save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {save.isPending ? t("ui.saving") : t("entity.common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
