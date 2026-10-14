import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, Layers3, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { useLevelStatistics } from "@/features/school/level-statistics";
import { useDeleteLevel, useLevels, useSaveLevel } from "@/features/school/queries";
import { type EntityStatus, type Level, type LevelStage } from "@/features/school/types";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/levels")({
  head: () => ({
    meta: [
      { title: "Niveaux scolaires — Gestion École" },
      { name: "description", content: "Primaire, moyen et secondaire avec leurs années." },
      { property: "og:title", content: "Niveaux scolaires — Gestion École" },
      { property: "og:description", content: "Primaire, moyen et secondaire avec leurs années." },
    ],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <LevelsPage />
    </RequireAuth>
  ),
});

const STAGES: LevelStage[] = ["primary", "middle", "high"];

const STAGE_LABEL_KEYS: Record<LevelStage, string> = {
  primary: "entity.levels.stagePrimary",
  middle: "entity.levels.stageMiddle",
  high: "entity.levels.stageHigh",
};

type LevelDraft = Partial<Level> & { stage: LevelStage };

function LevelsPage() {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const { data: levels = [], isLoading, error, refetch, isFetching } = useLevels();
  // Shared derivation: a student belongs to a level through an approved
  // registration in one of its groups, never through `students.level_id` (the
  // declared onboarding level, which is null for admin-enrolled students).
  const levelStats = useLevelStatistics();
  const save = useSaveLevel();
  const remove = useDeleteLevel();
  const [editing, setEditing] = useState<LevelDraft | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({
    primary: true,
    middle: true,
    high: true,
  });

  const metrics = levelStats.byLevel;

  const submit = async () => {
    if (save.isPending) return;
    if (!editing?.name?.trim()) {
      toast.error(t("form.levels.nameRequired"));
      return;
    }
    if ((editing.position ?? 0) < 0) {
      toast.error(t("form.levels.positionInvalid"));
      return;
    }
    try {
      await save.mutateAsync({
        ...editing,
        name: editing.name.trim(),
        stage: editing.stage,
        position: editing.position ?? levels.filter((l) => l.stage === editing.stage).length,
        status: editing.status ?? "active",
      });
      notifySuccess("form.levels.saved");
      setEditing(null);
    } catch (e) {
      notifyError(e);
    }
  };

  const newLevelButton = (stage: LevelStage = "primary", className?: string) => (
    <Button className={cn("rounded-xl", className)} onClick={() => setEditing({ stage })}>
      <Plus className="size-4" aria-hidden /> {t("form.levels.new")}
    </Button>
  );

  if (isLoading) {
    return (
      <>
        <PageHeader
          title={t("entity.levels.title")}
          description={t("entity.levels.shortDescription")}
        />
        <div className="space-y-4">
          {STAGES.map((s) => (
            <Skeleton key={s} className="h-40 rounded-2xl" />
          ))}
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader
          title={t("entity.levels.title")}
          description={t("entity.levels.shortDescription")}
        />
        <ErrorState error={error} onRetry={() => void refetch()} isRetrying={isFetching} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("entity.levels.title")}
        description={t("entity.levels.description")}
        actions={newLevelButton()}
      />

      {levels.length === 0 ? (
        <EmptyState
          icon={Layers3}
          title={t("entity.levels.emptyTitle")}
          description={t("entity.levels.emptyDescription")}
          action={newLevelButton("primary", "mt-2")}
        />
      ) : (
        <div className="space-y-4">
          {STAGES.map((stage) => {
            const stageLevels = levels
              .filter((l) => l.stage === stage)
              .sort((a, b) => a.position - b.position);
            if (stageLevels.length === 0) return null;
            const isOpen = open[stage] ?? true;
            const stageStudents = stageLevels.reduce(
              (sum, l) => sum + (metrics.get(l.id)?.students ?? 0),
              0,
            );

            return (
              <Collapsible
                key={stage}
                open={isOpen}
                onOpenChange={(value) => setOpen((prev) => ({ ...prev, [stage]: value }))}
                className="surface-card overflow-hidden"
              >
                <div className="flex items-center gap-1 pe-3">
                  <CollapsibleTrigger className="focus-ring flex flex-1 items-center gap-3 px-5 py-4 text-start transition-colors hover:bg-muted/40">
                    <ChevronDown
                      className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform",
                        !isOpen && "ltr:-rotate-90 rtl:rotate-90",
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-base font-semibold tracking-tight">
                        {t(STAGE_LABEL_KEYS[stage])}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {t("entity.levels.yearsAndStudents", {
                          years: String(stageLevels.length),
                          students: String(stageStudents),
                        })}
                      </p>
                    </div>
                  </CollapsibleTrigger>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 shrink-0 rounded-lg"
                    aria-label={t("form.levels.new")}
                    onClick={() => setEditing({ stage })}
                  >
                    <Plus className="size-4" aria-hidden />
                  </Button>
                </div>

                <CollapsibleContent>
                  <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-2 xl:grid-cols-3">
                    {stageLevels.map((level) => {
                      const m = metrics.get(level.id);
                      return (
                        <article
                          key={level.id}
                          className="rounded-xl border border-border p-4 transition-colors hover:bg-muted/40"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="truncate text-sm font-semibold">{level.name}</h3>
                            <div className="flex shrink-0 items-center gap-1">
                              <StatusBadge status={level.status} />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 rounded-lg"
                                aria-label={t("form.levels.editAria", { name: level.name })}
                                onClick={() => setEditing(level)}
                              >
                                <Pencil className="size-3.5" aria-hidden />
                              </Button>
                              <ConfirmDialog
                                title={t("form.levels.deleteTitle")}
                                description={t("form.levels.deleteDescription")}
                                confirmLabel={t("entity.subjects.deleteConfirm")}
                                onConfirm={async () => {
                                  try {
                                    await remove.mutateAsync(level.id);
                                    notifySuccess("form.levels.deleted");
                                  } catch (e) {
                                    notifyError(e);
                                  }
                                }}
                                trigger={
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8 rounded-lg text-destructive"
                                    aria-label={t("form.levels.deleteAria", { name: level.name })}
                                  >
                                    <Trash2 className="size-3.5" aria-hidden />
                                  </Button>
                                }
                              />
                            </div>
                          </div>
                          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                            <Metric label={t("entity.students.title")} value={m?.students ?? 0} />
                            <Metric label={t("entity.groups.title")} value={m?.groups ?? 0} />
                            <Metric label={t("entity.teachers.title")} value={m?.teachers ?? 0} />
                            <Metric label={t("entity.levels.capacity")} value={m?.capacity ?? 0} />
                          </dl>
                        </article>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(value) => !value && setEditing(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? t("form.levels.editTitle") : t("form.levels.newTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="level-name">{t("form.levels.name")}</Label>
              <Input
                id="level-name"
                className="h-11 rounded-xl"
                value={editing?.name ?? ""}
                onChange={(e) => setEditing((p) => (p ? { ...p, name: e.target.value } : p))}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="level-stage">{t("form.levels.stage")}</Label>
                <Select
                  value={editing?.stage ?? "primary"}
                  onValueChange={(value) =>
                    setEditing((p) => (p ? { ...p, stage: value as LevelStage } : p))
                  }
                >
                  <SelectTrigger id="level-stage" className="h-11 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(STAGE_LABEL_KEYS[s])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="level-position">{t("form.levels.position")}</Label>
                <Input
                  id="level-position"
                  type="number"
                  min={0}
                  className="h-11 rounded-xl"
                  value={editing?.position ?? 0}
                  onChange={(e) =>
                    setEditing((p) => (p ? { ...p, position: Number(e.target.value) || 0 } : p))
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="level-status">{t("form.levels.status")}</Label>
              <Select
                value={editing?.status ?? "active"}
                onValueChange={(value) =>
                  setEditing((p) => (p ? { ...p, status: value as EntityStatus } : p))
                }
              >
                <SelectTrigger id="level-status" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t("form.common.statusActive")}</SelectItem>
                  <SelectItem value="inactive">{t("form.common.statusInactive")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              className="rounded-xl"
              onClick={() => setEditing(null)}
              disabled={save.isPending}
            >
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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2.5 py-2">
      <dt className="text-[0.7rem] text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
