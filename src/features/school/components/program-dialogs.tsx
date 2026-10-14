/**
 * Formation dialogs (table `programs`, ADR-004) shared by the formation list and a formation's
 * own page: the create/edit form and the lifecycle confirmation.
 *
 * Creating a formation can include its first group in the same form; both are written in one
 * transaction by `public.create_formation` (20261003110000), so either both exist afterwards or
 * neither does. Every rule is also a database rule (20261001100000_programs.sql).
 */

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAllLevels, useLevelSystems, useSubjects, useTeachers } from "@/features/school/queries";
import {
  isLevelSystemOffered,
  suggestedLevelSystemId,
  systemOfLevel,
} from "@/features/school/level-model";
import { useLevelSystemLabel } from "@/features/school/level-system-label";
import { useFormationTypeLabels } from "@/features/school/formation-types";
import { selectableFormationTypes } from "@/features/school/formation-type-model";
import {
  categoryOffersAllDomains,
  domainsForCategory,
  isSubjectCompatible,
  subjectAfterCategoryChange,
  subjectsForCategory,
} from "@/features/school/subject-domain";
import {
  LevelSystemPicker,
  type LevelChoice,
} from "@/features/school/components/level-system-picker";
import { useSubjectLabel } from "@/features/school/subject-label";
import {
  useCreateFormation,
  useDeleteProgram,
  useSaveProgram,
  useSetProgramStatus,
  type ProgramRow,
} from "@/features/school/programs";
import { useStreamOptions } from "@/features/school/streams";
import { emptyGroupDraft } from "@/features/school/group-draft";
import { validateGroupDraft } from "@/features/school/group-model";
import {
  GroupDeliveryFields,
  type GroupDeliveryDraft,
} from "@/features/school/components/group-delivery-fields";
import { todayIso } from "@/lib/format";
import {
  NEW_PROGRAM_STATUSES,
  defaultGroupTerm,
  isDuplicateProgramName,
  isFormationWithGroups,
  isGroupsOutsideLevelSystem,
  nextGroupLetter,
  registrationOpenAfter,
  validateProgramDraft,
  type FirstGroupValues,
  type NewProgramStatus,
  type ProgramCategory,
  type ProgramDraft,
  type ProgramField,
  type ProgramStatus,
} from "@/features/school/program-model";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";

const UNSET = "__none__";

export type ProgramFormState = { mode: "create" } | { mode: "edit"; program: ProgramRow };

export interface ProgramStatusChange {
  program: ProgramRow;
  to: ProgramStatus;
}

export function ProgramFormDialog({
  state,
  onClose,
  onSaved,
}: {
  state: ProgramFormState;
  onClose: () => void;
  /** Called with the formation id after a successful save (`created` for a new one). */
  onSaved?: (id: string, created: boolean) => void;
}) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const subjectLabel = useSubjectLabel();
  const systemLabel = useLevelSystemLabel();
  const typeLabels = useFormationTypeLabels();
  const { data: levelSystems = [] } = useLevelSystems();
  const { data: allLevels = [] } = useAllLevels();
  const { data: subjects = [] } = useSubjects();
  const { data: teachers = [] } = useTeachers();
  const { levelHasStreams } = useStreamOptions();
  const save = useSaveProgram();
  const create = useCreateFormation();
  const editing = state.mode === "edit" ? state.program : null;
  const pending = save.isPending || create.isPending;

  const [draft, setDraft] = useState<ProgramDraft>(() => ({
    name: editing?.name ?? "",
    category: editing?.category ?? "academic_support",
    description: editing?.description ?? "",
    curriculum: editing?.curriculum ?? "",
    levelSystemId: editing?.levelSystemId ?? null,
    levelId: editing?.levelId ?? null,
    subjectId: editing?.subjectId ?? null,
    startDate: editing?.startDate ?? "",
    endDate: editing?.endDate ?? "",
    durationHours: editing?.durationHours != null ? String(editing.durationHours) : "",
    registrationOpen: editing?.registrationOpen ?? false,
    status: editing?.status ?? "draft",
  }));
  // A new formation starts on an ACTIVE type: the default may have been deactivated by the
  // institution (the database refuses an inactive type on a new formation).
  useEffect(() => {
    if (editing || typeLabels.types.length === 0) return;
    const active = selectableFormationTypes(typeLabels.types);
    const first = active[0];
    if (first && !active.some((ft) => ft.code === draft.category)) {
      setDraft((d) => ({ ...d, category: first.code }));
    }
  }, [editing, typeLabels.types, draft.category]);
  const [submitted, setSubmitted] = useState(false);

  /*
    The formation type PROPOSES a level system (language -> CEFR, academic support -> Algerian
    school...) until the administrator picks a system or a level themselves; from then on the
    type no longer changes it. An existing formation keeps what it holds.
  */
  const [levelTouched, setLevelTouched] = useState(editing !== null);
  /*
    Level systems follow the subject (or, without a subject, the type): CEFR only for languages,
    school years for school subjects and languages, training levels for computing, professional
    and other subjects; custom systems for anything (`isLevelSystemOffered`). An existing
    formation keeps its stored system while its subject and type are unchanged, with a notice if
    that combination is no longer offered (`legacySystem`).
  */
  const domainsFor = (subjectId: string | null, cat: ProgramCategory): readonly string[] | null => {
    if (!subjectId) return domainsForCategory(cat);
    const subject = subjects.find((s) => s.id === subjectId);
    return subject ? [subject.domain] : null;
  };
  const offeredDomains = domainsFor(draft.subjectId, draft.category);
  const suggestedSystem = suggestedLevelSystemId(draft.category, levelSystems, offeredDomains);
  const effective: ProgramDraft = levelTouched
    ? draft
    : { ...draft, levelSystemId: suggestedSystem, levelId: null };

  /*
    Creation only: the optional first group. Its name and term follow the formation (name
    "<formation> — Groupe A", term = the formation's period) until the administrator changes
    them, so nothing is typed twice. Subject and level are never asked: the group takes the
    formation's (create_formation copies them).
  */
  const [withGroup, setWithGroup] = useState(false);
  const [group, setGroup] = useState<GroupDeliveryDraft>(() => {
    const blank = emptyGroupDraft();
    return {
      teacherId: blank.teacherId,
      streamId: blank.streamId,
      status: "active",
      maxStudents: blank.maxStudents,
      startDate: blank.startDate,
      endDate: blank.endDate,
      schedules: [],
    };
  });
  const [groupName, setGroupName] = useState<string | null>(null);
  const [termEdited, setTermEdited] = useState(false);

  const suggestedGroupName = t("programs.page.groupName", {
    program: draft.name.trim() || t("programs.form.newTitle"),
    letter: nextGroupLetter(0),
  });
  const effectiveGroupName = groupName ?? suggestedGroupName;
  const term = termEdited
    ? { startDate: group.startDate ?? "", endDate: group.endDate ?? null }
    : defaultGroupTerm(draft.startDate, draft.endDate, todayIso());
  const groupForFields: GroupDeliveryDraft = { ...group, ...term };

  const patchGroup = (values: Partial<GroupDeliveryDraft>) => {
    if ("startDate" in values || "endDate" in values) setTermEdited(true);
    setGroup((g) => ({ ...g, ...term, ...values }));
  };

  /*
    Subjects follow the formation TYPE (subject-domain.ts): only the subjects whose domain suits
    the type are offered. An existing formation's saved subject is always offered while its type
    is unchanged, so existing data loads as it is. Changing the type keeps a subject that still
    fits and clears one that does not, saying why (`subjectNotice`).
  */
  const keptSubjectId = editing && draft.category === editing.category ? editing.subjectId : null;
  const subjectOptions = subjectsForCategory(subjects, draft.category, keptSubjectId);
  const subjectFits = (subjectId: string, category: ProgramCategory) =>
    subjectId === keptSubjectId ||
    isSubjectCompatible(
      category,
      subjects.find((s) => s.id === subjectId),
    );
  const [subjectNotice, setSubjectNotice] = useState<string | null>(null);
  const domainList = (category: ProgramCategory) =>
    domainsForCategory(category)
      .map((d) => t(`subjectDomain.${d}`))
      .join(", ");

  const pickCategory = (category: ProgramCategory) => {
    const kept = editing && category === editing.category ? editing.subjectId : null;
    const next =
      draft.subjectId && draft.subjectId === kept
        ? { subjectId: draft.subjectId, cleared: false }
        : subjectAfterCategoryChange(subjects, draft.subjectId, category);
    if (next.cleared) {
      const removed = subjects.find((s) => s.id === draft.subjectId);
      setSubjectNotice(
        t("programs.form.subjectCleared", {
          subject: removed ? subjectLabel(removed.key, removed.name) : "",
          domain: removed ? t(`subjectDomain.${removed.domain}`) : "",
          type: typeLabels.labelOf(category),
        }),
      );
    } else {
      setSubjectNotice(null);
    }
    const systemPatch = systemAfterChange(next.subjectId, category);
    setDraft((d) => ({ ...d, category, subjectId: next.subjectId, ...systemPatch }));
  };

  const keptSystemId =
    editing && draft.subjectId === editing.subjectId && draft.category === editing.category
      ? editing.levelSystemId
      : null;
  const systemOffered = (system: { id: string; kind: string }, domains = offeredDomains) =>
    system.id === keptSystemId || isLevelSystemOffered(system, domains);
  const currentSystem = levelSystems.find((s) => s.id === effective.levelSystemId) ?? null;
  const [systemNotice, setSystemNotice] = useState<string | null>(null);
  const legacySystem =
    currentSystem &&
    currentSystem.id === keptSystemId &&
    !isLevelSystemOffered(currentSystem, offeredDomains)
      ? t("programs.form.systemLegacy", { system: systemLabel(currentSystem) })
      : null;

  /**
   * After the subject or the type changes: a CHOSEN system that no longer fits is cleared, with the
   * reason. An untouched system simply follows the new proposal.
   */
  const systemAfterChange = (
    subjectId: string | null,
    cat: ProgramCategory,
  ): Partial<ProgramDraft> => {
    setSystemNotice(null);
    if (!levelTouched || !currentSystem) return {};
    const keeps =
      editing !== null &&
      subjectId === editing.subjectId &&
      cat === editing.category &&
      currentSystem.id === editing.levelSystemId;
    if (keeps || isLevelSystemOffered(currentSystem, domainsFor(subjectId, cat))) return {};
    const subject = subjects.find((s) => s.id === subjectId);
    setSystemNotice(
      subject
        ? t("programs.form.systemClearedSubject", {
            system: systemLabel(currentSystem),
            subject: subjectLabel(subject.key, subject.name),
          })
        : t("programs.form.systemClearedType", {
            system: systemLabel(currentSystem),
            type: typeLabels.labelOf(cat),
          }),
    );
    setGroup((g) => ({ ...g, streamId: null }));
    return { levelSystemId: null, levelId: null };
  };

  const set = <K extends keyof ProgramDraft>(key: K, value: ProgramDraft[K]) => {
    const systemPatch =
      key === "subjectId" ? systemAfterChange(value as string | null, draft.category) : {};
    setDraft((d) => ({ ...d, [key]: value, ...systemPatch }));
    if (key === "subjectId") setSubjectNotice(null);
    // The first group follows the formation's subject and level: a teacher no longer
    // qualified, or a stream of the previous level, would be refused by the database.
    if (key === "subjectId") {
      const subjectId = value as string | null;
      if (
        group.teacherId &&
        subjectId &&
        !teachers.some((tc) => tc.id === group.teacherId && tc.subjectIds.includes(subjectId))
      ) {
        setGroup((g) => ({ ...g, teacherId: null }));
      }
    }
  };

  const pickLevel = (next: LevelChoice) => {
    setLevelTouched(true);
    setSystemNotice(null);
    // A stream belongs to one level: the first group's would be refused under another.
    if (next.levelId !== effective.levelId) setGroup((g) => ({ ...g, streamId: null }));
    setDraft((d) => ({ ...d, levelSystemId: next.levelSystemId, levelId: next.levelId }));
  };

  const validation = validateProgramDraft(effective, {
    systemOfLevel: (id) => systemOfLevel(allLevels, id),
    subjectFits,
    systemOffered: (systemId, subjectId) => {
      const system = levelSystems.find((s) => s.id === systemId);
      return !system || systemOffered(system, domainsFor(subjectId, draft.category));
    },
  });
  const errors: Partial<Record<ProgramField, string>> = validation.ok ? {} : validation.errors;
  const show = (field: ProgramField) =>
    errors[field] && submitted ? t(errors[field] as string) : null;

  const submit = async () => {
    setSubmitted(true);
    if (!validation.ok) return;
    try {
      if (editing) {
        await save.mutateAsync({ ...validation.values, id: editing.id });
        notifySuccess("programs.saved");
        onClose();
        onSaved?.(editing.id, false);
        return;
      }

      let firstGroup: FirstGroupValues | null = null;
      if (withGroup) {
        const candidate = {
          name: effectiveGroupName,
          teacherId: groupForFields.teacherId,
          streamId: groupForFields.streamId ?? null,
          maxStudents: groupForFields.maxStudents,
          startDate: groupForFields.startDate ?? "",
          endDate: groupForFields.endDate ?? null,
          schedules: groupForFields.schedules,
        };
        const problem = validateGroupDraft(candidate, {
          streamRequired: levelHasStreams(effective.levelId),
        });
        if (problem) {
          toast.error(t(problem));
          return;
        }
        firstGroup = candidate;
      }

      const status = effective.status === "active" ? "active" : "draft";
      const result = await create.mutateAsync({ values: validation.values, status, firstGroup });
      notifySuccess(firstGroup ? "programs.createdWithGroup" : "programs.created");
      onClose();
      onSaved?.(result.programId, true);
    } catch (e) {
      if (isDuplicateProgramName(e)) toast.error(t("programs.error.duplicate"));
      else if (isGroupsOutsideLevelSystem(e)) toast.error(t("programs.error.groupsOutsideSystem"));
      else notifyError(e);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-start">
            {t(editing ? "programs.form.editTitle" : "programs.form.newTitle")}
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="prog-name" label={t("programs.form.name")} error={show("name")}>
              <Input
                id="prog-name"
                className="h-11 rounded-xl"
                value={draft.name}
                aria-invalid={!!show("name")}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
            <Field id="prog-category" label={t("programs.form.category")} error={show("category")}>
              <Select
                value={draft.category}
                onValueChange={(v) => v && pickCategory(v as ProgramCategory)}
              >
                <SelectTrigger id="prog-category" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* Active types, plus an existing formation's type even if deactivated since. */}
                  {selectableFormationTypes(typeLabels.types, editing?.category ?? null).map(
                    (ft) => (
                      <SelectItem key={ft.code} value={ft.code}>
                        {typeLabels.label(ft)}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              {(() => {
                const current = typeLabels.byCode.get(draft.category);
                if (!current) return null;
                const text =
                  current.status === "inactive"
                    ? t("programs.form.typeInactive")
                    : typeLabels.description(current);
                return text ? (
                  <p className="text-xs text-muted-foreground" data-testid="type-description">
                    {text}
                  </p>
                ) : null;
              })()}
            </Field>
          </div>

          <div className="space-y-2">
            <LevelSystemPicker
              systems={levelSystems}
              levels={allLevels}
              value={{ levelSystemId: effective.levelSystemId, levelId: effective.levelId }}
              onChange={pickLevel}
              suggested={!levelTouched}
              error={show("level")}
              isOffered={(system) => systemOffered(system)}
              notice={systemNotice ?? legacySystem}
              leading={
                <Field id="prog-subject" label={t("programs.form.subject")} error={show("subject")}>
                  <Select
                    value={draft.subjectId ?? UNSET}
                    onValueChange={(v) => {
                      // The options follow the type; Radix may report "" while they change.
                      if (v) set("subjectId", v === UNSET ? null : v);
                    }}
                  >
                    <SelectTrigger id="prog-subject" className="h-11 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>{t("programs.form.none")}</SelectItem>
                      {subjectOptions.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {subjectLabel(s.key, s.name)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {subjectNotice ? (
                    <p
                      className="text-xs text-muted-foreground"
                      role="status"
                      data-testid="subject-notice"
                    >
                      {subjectNotice}
                    </p>
                  ) : subjectOptions.length === 0 ? (
                    <p className="text-xs text-muted-foreground" data-testid="subject-hint">
                      {t("programs.form.subjectNoneForType")}
                    </p>
                  ) : (
                    !categoryOffersAllDomains(draft.category) && (
                      <p className="text-xs text-muted-foreground" data-testid="subject-hint">
                        {t("programs.form.subjectFiltered", {
                          domains: domainList(draft.category),
                        })}
                      </p>
                    )
                  )}
                </Field>
              }
            />
            <p className="text-xs text-muted-foreground">{t("programs.form.optionalHint")}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="prog-start" label={t("programs.form.startDate")}>
              <Input
                id="prog-start"
                type="date"
                dir="ltr"
                className="h-11 rounded-xl"
                value={draft.startDate}
                onChange={(e) => set("startDate", e.target.value)}
              />
            </Field>
            <Field id="prog-end" label={t("programs.form.endDate")}>
              <Input
                id="prog-end"
                type="date"
                dir="ltr"
                className="h-11 rounded-xl"
                value={draft.endDate}
                min={draft.startDate || undefined}
                onChange={(e) => set("endDate", e.target.value)}
              />
            </Field>
            <Field
              id="prog-duration"
              label={t("programs.form.duration")}
              error={show("durationHours")}
            >
              <Input
                id="prog-duration"
                inputMode="numeric"
                dir="ltr"
                className="h-11 rounded-xl"
                value={draft.durationHours}
                aria-invalid={!!show("durationHours")}
                onChange={(e) => set("durationHours", e.target.value)}
              />
            </Field>
          </div>
          {show("dates") && <p className="text-xs text-destructive">{show("dates")}</p>}

          <Field
            id="prog-description"
            label={t("programs.form.description")}
            error={show("description")}
          >
            <Textarea
              id="prog-description"
              rows={3}
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>
          <Field
            id="prog-curriculum"
            label={t("programs.form.curriculum")}
            error={show("curriculum")}
          >
            <Textarea
              id="prog-curriculum"
              rows={4}
              value={draft.curriculum}
              onChange={(e) => set("curriculum", e.target.value)}
            />
          </Field>

          {editing ? (
            <div className="surface-row flex items-start justify-between gap-4 px-3 py-3">
              <div className="space-y-1">
                <Label htmlFor="prog-open">{t("programs.form.registrationOpen")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("programs.form.registrationHint")}
                </p>
                {show("registrationOpen") && (
                  <p className="text-xs text-destructive">{show("registrationOpen")}</p>
                )}
              </div>
              <Switch
                id="prog-open"
                checked={draft.registrationOpen}
                disabled={draft.status !== "active"}
                onCheckedChange={(v) => set("registrationOpen", v)}
              />
            </div>
          ) : (
            <Field id="prog-status" label={t("programs.form.initialStatus")}>
              <Select
                value={draft.status === "active" ? "active" : "draft"}
                onValueChange={(v) => set("status", v as NewProgramStatus)}
              >
                <SelectTrigger id="prog-status" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NEW_PROGRAM_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`programs.form.initialStatus.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("programs.form.initialStatusHint")}
              </p>
            </Field>
          )}

          {!editing && (
            <section
              className="space-y-4 rounded-xl border border-border p-4"
              aria-labelledby="prog-first-group-title"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h3 id="prog-first-group-title" className="text-sm font-semibold">
                    {t("programs.form.firstGroup")}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {t("programs.form.firstGroupHint")}
                  </p>
                </div>
                <Switch
                  id="prog-with-group"
                  aria-labelledby="prog-first-group-title"
                  checked={withGroup}
                  onCheckedChange={setWithGroup}
                />
              </div>

              {withGroup && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="group-name">{t("form.groups.name")}</Label>
                    <Input
                      id="group-name"
                      className="h-11 rounded-xl"
                      value={effectiveGroupName}
                      onChange={(e) => setGroupName(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("programs.form.groupNameHint")}
                    </p>
                  </div>
                  <GroupDeliveryFields
                    draft={groupForFields}
                    patch={patchGroup}
                    subjectId={draft.subjectId}
                    levelId={effective.levelId}
                    showStatus={false}
                  />
                </div>
              )}
            </section>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              {t("ui.cancel")}
            </Button>
            <Button type="submit" className="rounded-xl" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t(
                editing
                  ? "programs.form.save"
                  : withGroup
                    ? "programs.form.createWithGroup"
                    : "programs.form.create",
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Confirms and applies one lifecycle move. Open while `change` is set. */
export function ProgramStatusDialog({
  change,
  onClose,
}: {
  change: ProgramStatusChange | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const setStatus = useSetProgramStatus();

  const confirmChange = async () => {
    if (!change) return;
    try {
      await setStatus.mutateAsync({
        id: change.program.id,
        status: change.to,
        registrationOpen: registrationOpenAfter(change.to, change.program.registrationOpen),
      });
      notifySuccess("programs.statusChanged");
      onClose();
    } catch (e) {
      // Restoring an archived programme whose name is now used by a live one.
      if (isDuplicateProgramName(e)) toast.error(t("programs.error.duplicate"));
      else notifyError(e);
    }
  };

  return (
    <AlertDialog
      open={change !== null}
      onOpenChange={(open) => {
        if (setStatus.isPending) return;
        if (!open) onClose();
      }}
    >
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-start">
            {change && t("programs.confirmTitle", { action: t(`programs.action.${change.to}`) })}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-start">
            {change &&
              t("programs.confirmBody", {
                name: change.program.name,
                status: t(`ui.status.${change.to}`),
              })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 rounded-xl" disabled={setStatus.isPending}>
            {t("ui.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            className="h-11 rounded-xl"
            disabled={setStatus.isPending}
            onClick={(e) => {
              e.preventDefault();
              void confirmChange();
            }}
          >
            {setStatus.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {change && t(`programs.action.${change.to}`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Deletes a formation, after confirmation. Open while `program` is set.
 *
 * Only a formation without groups can be deleted: the database keeps a formation's groups, their
 * enrollments and payments (ON DELETE RESTRICT). With groups, the dialog says so and offers no
 * delete button; cancelling or archiving keeps the history instead.
 */
export function ProgramDeleteDialog({
  program,
  onClose,
}: {
  program: ProgramRow | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const remove = useDeleteProgram();
  const groupCount = program?.groups.length ?? 0;
  const blocked = groupCount > 0;

  const confirmDelete = async () => {
    if (!program) return;
    try {
      await remove.mutateAsync(program.id);
      notifySuccess("programs.deleted");
      onClose();
    } catch (e) {
      // Groups added meanwhile (another tab): the database refused the delete.
      if (isFormationWithGroups(e)) toast.error(t("programs.delete.hasGroups"));
      else notifyError(e);
    }
  };

  return (
    <AlertDialog
      open={program !== null}
      onOpenChange={(open) => {
        if (remove.isPending) return;
        if (!open) onClose();
      }}
    >
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-start">
            {t(blocked ? "programs.delete.blockedTitle" : "programs.delete.title")}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-start">
            {program &&
              (blocked
                ? t("programs.delete.blockedBody", { name: program.name, count: groupCount })
                : t("programs.delete.body", { name: program.name }))}
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
                void confirmDelete();
              }}
            >
              {remove.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("programs.delete.confirm")}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
