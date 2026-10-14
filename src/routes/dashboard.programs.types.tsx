/**
 * Formation types: the purposes / educational contexts the institution offers formations in
 * (20261005100000_formation_types.sql, ADR-004 section 1).
 *
 * Built-in types come with Gestion École (translated by code; they can be deactivated, never deleted or
 * renamed). The institution adds its own types, renames or describes them, deactivates them, and
 * deletes them while no formation uses them. An inactive type stays on the formations that use it
 * but is no longer offered to a new formation. Every rule is also a database rule; administrators
 * only (route guard + RLS).
 */

import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2, MoreHorizontal, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RequireAuth } from "@/features/auth/require-auth";
import { usePrograms } from "@/features/school/programs";
import {
  useDeleteFormationType,
  useFormationTypeLabels,
  useFormationTypes,
  useSaveFormationType,
  useSetFormationTypeStatus,
} from "@/features/school/formation-types";
import {
  FORMATION_TYPE_DESCRIPTION_MAX,
  FORMATION_TYPE_NAME_MAX,
  formationTypeActions,
  formationTypeUsage,
  isDuplicateFormationTypeName,
  isFormationTypeInUse,
  validateFormationTypeDraft,
  type FormationTypeRow,
} from "@/features/school/formation-type-model";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";

export const Route = createFileRoute("/dashboard/programs/types")({
  head: () => ({
    meta: [
      { title: "Types de formation — Gestion École" },
      { name: "description", content: "Les types de formation proposés par l'établissement." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <FormationTypesPage />
    </RequireAuth>
  ),
});

interface TypeRow extends FormationTypeRow {
  label: string;
  descriptionText: string | null;
  usage: number;
  usedBy: string[];
}

type EditState = { mode: "create" } | { mode: "edit"; type: TypeRow };

function FormationTypesPage() {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const { data: types = [], isLoading, error, refetch, isFetching } = useFormationTypes();
  const { data: programs = [] } = usePrograms();
  const labels = useFormationTypeLabels();
  const setStatus = useSetFormationTypeStatus();
  const [editing, setEditing] = useState<EditState | null>(null);
  const [deleting, setDeleting] = useState<TypeRow | null>(null);

  const rows: TypeRow[] = useMemo(() => {
    const usage = formationTypeUsage(programs);
    return types.map((ft) => ({
      ...ft,
      label: labels.label(ft),
      descriptionText: labels.description(ft),
      usage: usage.get(ft.code) ?? 0,
      usedBy: programs
        .filter((p) => p.category === ft.code)
        .map((p) => p.name)
        .sort((a, b) => a.localeCompare(b)),
    }));
  }, [types, programs, labels]);

  const toggle = async (row: TypeRow) => {
    try {
      await setStatus.mutateAsync({
        id: row.id,
        status: row.status === "active" ? "inactive" : "active",
      });
      notifySuccess(
        row.status === "active" ? "formationTypes.deactivated" : "formationTypes.activated",
      );
    } catch (e) {
      notifyError(e);
    }
  };

  const columns: Column<TypeRow>[] = [
    {
      key: "name",
      header: t("formationTypes.col.type"),
      sortValue: (r) => r.position,
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.label}</p>
          <p className="line-clamp-2 text-xs text-muted-foreground">{r.descriptionText ?? "—"}</p>
        </div>
      ),
    },
    {
      key: "origin",
      header: t("formationTypes.col.origin"),
      sortValue: (r) => (r.builtIn ? 0 : 1),
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {t(r.builtIn ? "formationTypes.builtIn" : "formationTypes.custom")}
        </span>
      ),
    },
    {
      key: "usage",
      header: t("formationTypes.col.usage"),
      sortValue: (r) => r.usage,
      cell: (r) => (
        <span className="tabular-nums" title={r.usedBy.join(", ") || undefined}>
          {r.usage}
        </span>
      ),
    },
    {
      key: "status",
      header: t("formationTypes.col.status"),
      sortValue: (r) => r.status,
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "actions",
      header: "",
      className: "w-12 text-end",
      cell: (r) => {
        const can = formationTypeActions(r, r.usage);
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-lg"
                aria-label={t("formationTypes.actionsAria", { name: r.label })}
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl">
              <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
                {r.label}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {can.canEdit && (
                <DropdownMenuItem onSelect={() => setEditing({ mode: "edit", type: r })}>
                  <Pencil className="size-4" aria-hidden />
                  {t("formationTypes.edit")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => void toggle(r)}>
                {t(r.status === "active" ? "formationTypes.deactivate" : "formationTypes.activate")}
              </DropdownMenuItem>
              {!r.builtIn && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => setDeleting(r)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {t("formationTypes.delete")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 rounded-xl text-muted-foreground">
        <Link to="/dashboard/programs">
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          {t("programs.back")}
        </Link>
      </Button>

      <PageHeader
        title={t("formationTypes.title")}
        description={t("formationTypes.subtitle")}
        actions={
          <Button className="rounded-xl" onClick={() => setEditing({ mode: "create" })}>
            <Plus className="size-4" aria-hidden />
            {t("formationTypes.new")}
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
        // A short reference list: every type on one page rather than 10 per page.
        pageSize={50}
        searchable={(r) => `${r.label} ${r.descriptionText ?? ""}`}
        searchPlaceholder={t("formationTypes.search")}
        emptyState={
          <EmptyState
            icon={Tags}
            title={t("formationTypes.emptyTitle")}
            description={t("formationTypes.emptyDescription")}
            className="border-none shadow-none"
          />
        }
      />

      {editing && (
        <TypeFormDialog
          key={editing.mode === "edit" ? editing.type.id : "new"}
          state={editing}
          otherNames={rows
            .filter((r) => editing.mode !== "edit" || r.id !== editing.type.id)
            .flatMap((r) => [r.name, r.label])}
          onClose={() => setEditing(null)}
        />
      )}
      <DeleteTypeDialog type={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function TypeFormDialog({
  state,
  otherNames,
  onClose,
}: {
  state: EditState;
  otherNames: string[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const save = useSaveFormationType();
  const editing = state.mode === "edit" ? state.type : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [submitted, setSubmitted] = useState(false);

  const validation = validateFormationTypeDraft({ name, description }, otherNames);
  const errors = validation.ok ? {} : validation.errors;
  const show = (field: "name" | "description") =>
    submitted && errors[field] ? t(errors[field] as string) : null;

  const submit = async () => {
    setSubmitted(true);
    if (!validation.ok) return;
    try {
      await save.mutateAsync({
        ...(editing ? { id: editing.id } : {}),
        ...validation.values,
      });
      notifySuccess(editing ? "formationTypes.saved" : "formationTypes.created");
      onClose();
    } catch (e) {
      if (isDuplicateFormationTypeName(e)) toast.error(t("formationTypes.error.duplicate"));
      else notifyError(e);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-start">
            {t(editing ? "formationTypes.editTitle" : "formationTypes.newTitle")}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="type-name">{t("formationTypes.name")}</Label>
            <Input
              id="type-name"
              className="h-11 rounded-xl"
              value={name}
              maxLength={FORMATION_TYPE_NAME_MAX}
              aria-invalid={!!show("name")}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("formationTypes.nameHint")}</p>
            {show("name") && <p className="text-xs text-destructive">{show("name")}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="type-description">{t("formationTypes.description")}</Label>
            <Textarea
              id="type-description"
              className="rounded-xl"
              rows={3}
              value={description}
              maxLength={FORMATION_TYPE_DESCRIPTION_MAX}
              onChange={(e) => setDescription(e.target.value)}
            />
            {show("description") && (
              <p className="text-xs text-destructive">{show("description")}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
              {t("ui.cancel")}
            </Button>
            <Button type="submit" className="rounded-xl" disabled={save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t(editing ? "formationTypes.save" : "formationTypes.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Deletes an unused custom type; a used one is explained instead (deactivate it). */
function DeleteTypeDialog({ type, onClose }: { type: TypeRow | null; onClose: () => void }) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const remove = useDeleteFormationType();
  const blocked = (type?.usage ?? 0) > 0;

  const confirm = async () => {
    if (!type) return;
    try {
      await remove.mutateAsync(type.id);
      notifySuccess("formationTypes.deleted");
      onClose();
    } catch (e) {
      if (isFormationTypeInUse(e)) toast.error(t("formationTypes.error.inUse"));
      else notifyError(e);
    }
  };

  return (
    <AlertDialog
      open={type !== null}
      onOpenChange={(open) => {
        if (remove.isPending) return;
        if (!open) onClose();
      }}
    >
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-start">
            {t(blocked ? "formationTypes.deleteBlockedTitle" : "formationTypes.deleteTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-start">
            {type &&
              (blocked
                ? t("formationTypes.deleteBlockedBody", {
                    name: type.label,
                    count: type.usage,
                    formations: type.usedBy.slice(0, 5).join(", "),
                  })
                : t("formationTypes.deleteBody", { name: type.label }))}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 rounded-xl" disabled={remove.isPending}>
            {t(blocked ? "programs.delete.close" : "ui.cancel")}
          </AlertDialogCancel>
          {!blocked && (
            <AlertDialogAction
              className="h-11 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                void confirm();
              }}
            >
              {remove.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("formationTypes.delete")}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
