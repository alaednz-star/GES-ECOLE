/**
 * The one group form: create and edit, from the Groups page or from a formation's page.
 *
 * Identity lives here (name, formation, subject, level); how the group is delivered (teacher,
 * places, term, weekly slots, room) is `GroupDeliveryFields`, shared with the "new formation +
 * first group" form. Opened from a formation (`lockedProgram`), the group belongs to it: the
 * formation is shown, not chosen again.
 *
 * Every rule here is also a database rule (teacher qualification, stream required for a level
 * that has streams, one session per day, formation level/subject/system consistency); the form only
 * keeps the admin from composing a group the server would refuse.
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Library, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  useAllLevels,
  useLevels,
  useLevelSystems,
  useSaveGroup,
  useSubjects,
  useTeachers,
  type GroupInput,
} from "@/features/school/queries";
import { usePrograms } from "@/features/school/programs";
import { useStreamOptions } from "@/features/school/streams";
import { validateGroupDraft } from "@/features/school/group-model";
import { levelAfterSystemChange, levelsOfSystem } from "@/features/school/level-model";
import { useLevelSystemLabel } from "@/features/school/level-system-label";
import { GroupDeliveryFields } from "@/features/school/components/group-delivery-fields";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";

const UNASSIGNED = "none";

export interface GroupFormDialogProps {
  /** The draft the dialog opens with. Mount with a `key` per draft to reset it. */
  initial: GroupInput;
  onClose: () => void;
  /** Opened from a formation: the group belongs to it, so the formation picker is not shown. */
  lockedProgram?: { id: string; name: string } | null;
}

export function GroupFormDialog({ initial, onClose, lockedProgram = null }: GroupFormDialogProps) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const { data: subjects = [] } = useSubjects();
  const { data: schoolLevels = [] } = useLevels();
  const { data: allLevels = [] } = useAllLevels();
  const { data: levelSystems = [] } = useLevelSystems();
  const systemLabel = useLevelSystemLabel();
  const { data: teachers = [] } = useTeachers();
  const { data: programs = [] } = usePrograms();
  const { levelHasStreams } = useStreamOptions();
  const save = useSaveGroup();
  const [draft, setDraft] = useState<GroupInput>(() =>
    lockedProgram ? { ...initial, programId: lockedProgram.id } : initial,
  );

  const patch = (values: Partial<GroupInput>) => setDraft((p) => ({ ...p, ...values }));

  // Formations a group may join: every one not archived, plus the group's current one.
  const programOptions = useMemo(
    () => programs.filter((p) => p.status !== "archived" || p.id === draft.programId),
    [programs, draft.programId],
  );

  // A formation that names a level or subject fixes it for its groups
  // (t_groups_program_consistent), so those two fields are shown but not editable.
  const program = programs.find((p) => p.id === draft.programId) ?? null;
  const levelFixed = !!program?.levelId;
  const subjectFixed = !!program?.subjectId;

  /*
    Which levels the group may carry (t_groups_program_consistent, Phase 3B):
      - a formation with a level system: that system's levels only;
      - otherwise (standalone group, formation with no specific level): the school levels, as
        before, plus the group's current level if it belongs to another system.
  */
  const programSystem = program?.levelSystemId ?? null;
  const levelOptions = programSystem
    ? levelsOfSystem(allLevels, programSystem, draft.levelId)
    : [
        ...schoolLevels,
        ...allLevels.filter(
          (l) => l.id === draft.levelId && !schoolLevels.some((s) => s.id === l.id),
        ),
      ];
  const programSystemRow = levelSystems.find((s) => s.id === programSystem) ?? null;

  /** A teacher who is not qualified for `subjectId` is dropped: the database would refuse it. */
  const keepTeacherFor = (subjectId: string | null): Partial<GroupInput> =>
    draft.teacherId &&
    subjectId &&
    !teachers.some((tc) => tc.id === draft.teacherId && tc.subjectIds.includes(subjectId))
      ? { teacherId: null }
      : {};

  /**
   * Choosing a formation that names a level or subject aligns the group to it, because the
   * database refuses a group whose level/subject differs from its formation's.
   */
  const pickProgram = (programId: string | null) => {
    const picked = programs.find((p) => p.id === programId) ?? null;
    const next: Partial<GroupInput> = { programId };
    if (picked?.levelId && picked.levelId !== draft.levelId) {
      next.levelId = picked.levelId;
      next.streamId = null;
    } else if (!picked?.levelId && picked?.levelSystemId && draft.levelId) {
      // A level of another system would be refused: the group starts at "every level".
      const kept = levelAfterSystemChange(allLevels, draft.levelId, picked.levelSystemId);
      if (kept !== draft.levelId) {
        next.levelId = kept;
        next.streamId = null;
      }
    }
    if (picked?.subjectId && picked.subjectId !== draft.subjectId) {
      next.subjectId = picked.subjectId;
      Object.assign(next, keepTeacherFor(picked.subjectId));
    }
    patch(next);
  };

  const submit = async () => {
    const problem = validateGroupDraft(draft, { streamRequired: levelHasStreams(draft.levelId) });
    if (problem) {
      toast.error(t(problem));
      return;
    }
    try {
      await save.mutateAsync({ ...draft, name: draft.name.trim() });
      notifySuccess("form.groups.saved");
      onClose();
    } catch (e) {
      notifyError(e);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {draft.id ? t("form.groups.editTitle") : t("form.groups.newTitle")}
          </DialogTitle>
          {lockedProgram && (
            <DialogDescription className="sr-only">
              {t("form.groups.inProgram", { program: lockedProgram.name })}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-4">
          {lockedProgram && (
            <div className="surface-row flex items-center gap-3 px-3 py-2.5">
              <Library className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{t("form.groups.programContext")}</p>
                <p className="truncate text-sm font-medium" data-testid="group-form-program">
                  {lockedProgram.name}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="group-name">{t("form.groups.name")}</Label>
            <Input
              id="group-name"
              className="h-11 rounded-xl"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>

          {!lockedProgram && (
            <div className="space-y-2">
              <Label htmlFor="group-program">{t("form.groups.program")}</Label>
              <Select
                value={draft.programId ?? UNASSIGNED}
                onValueChange={(v) => pickProgram(v === UNASSIGNED ? null : v)}
              >
                <SelectTrigger id="group-program" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>{t("form.groups.noProgram")}</SelectItem>
                  {programOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("form.groups.programHint")}</p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="group-subject">{t("form.groups.subject")}</Label>
              <Select
                value={draft.subjectId ?? UNASSIGNED}
                disabled={subjectFixed}
                onValueChange={(v) => {
                  const nextSubject = v === UNASSIGNED ? null : v;
                  patch({ subjectId: nextSubject, ...keepTeacherFor(nextSubject) });
                }}
              >
                <SelectTrigger id="group-subject" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>{t("form.common.unassigned")}</SelectItem>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {subjectFixed && (
                <p className="text-xs text-muted-foreground">{t("form.groups.setByProgram")}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="group-level">{t("form.groups.level")}</Label>
              <Select
                value={draft.levelId ?? UNASSIGNED}
                disabled={levelFixed}
                onValueChange={(v) =>
                  // Clear the stream too: it belongs to the previous level and would be
                  // rejected by the database guard.
                  patch({ levelId: v === UNASSIGNED ? null : v, streamId: null })
                }
              >
                <SelectTrigger id="group-level" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>{t("form.common.unassigned")}</SelectItem>
                  {levelOptions.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {levelFixed ? (
                <p className="text-xs text-muted-foreground">{t("form.groups.setByProgram")}</p>
              ) : (
                programSystemRow && (
                  <p className="text-xs text-muted-foreground">
                    {t("form.groups.levelsOfSystem", { system: systemLabel(programSystemRow) })}
                  </p>
                )
              )}
            </div>
          </div>

          <GroupDeliveryFields
            draft={draft}
            patch={patch}
            subjectId={draft.subjectId}
            levelId={draft.levelId}
          />
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            className="rounded-xl"
            onClick={onClose}
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
  );
}
