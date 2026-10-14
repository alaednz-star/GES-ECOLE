/**
 * Programmes: vocabulary, validation, lifecycle and derived figures. PURE.
 *
 * No runtime imports, so `node --test` can load it. Every rule here is also enforced by the
 * database (20261001100000_programs.sql); this file lets the form explain a problem before a
 * request is refused, and gives the lifecycle one definition the UI reads from.
 *
 * CAPACITY AND TEACHERS ARE DERIVED. A programme stores neither: a seat exists only in a group
 * and the people teaching are the groups' teachers. `summariseProgramGroups` computes both.
 */

/**
 * A formation's type: the `code` of a row of `formation_types` (20261005100000). Types are data the
 * institution manages -- the built-in codes are listed in `formation-type-model.ts` -- so any code
 * is a valid value here; the database checks it exists (FK) and is active for a new formation.
 */
export type ProgramCategory = string;

/** Formation type codes are lowercase identifiers (the CHECK on `formation_types.code`). */
const TYPE_CODE = /^[a-z][a-z0-9_]{1,59}$/;

/** Matches the CHECK on `programs.status`. */
export const PROGRAM_STATUSES = ["draft", "active", "completed", "cancelled", "archived"] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

export const PROGRAM_NAME_MAX = 120;
export const PROGRAM_DESCRIPTION_MAX = 2000;
export const PROGRAM_CURRICULUM_MAX = 5000;
export const PROGRAM_DURATION_MAX = 10000;

/**
 * Which status a programme may move to next.
 *
 *   draft     -> active, cancelled, archived
 *   active    -> completed, cancelled
 *   completed -> archived, active (reopened, e.g. an extra session)
 *   cancelled -> archived, draft (revived)
 *   archived  -> draft (restored; its name must still be free)
 *
 * An active programme is not archived directly: it is completed or cancelled first, so the
 * archive only ever holds programmes whose outcome is recorded.
 */
const TRANSITIONS: Record<ProgramStatus, readonly ProgramStatus[]> = {
  draft: ["active", "cancelled", "archived"],
  active: ["completed", "cancelled"],
  completed: ["archived", "active"],
  cancelled: ["archived", "draft"],
  archived: ["draft"],
};

export function nextStatuses(status: ProgramStatus): readonly ProgramStatus[] {
  return TRANSITIONS[status] ?? [];
}

export function canTransition(from: ProgramStatus, to: ProgramStatus): boolean {
  return nextStatuses(from).includes(to);
}

/**
 * Registrations may only be open while the programme is active -- the database refuses
 * anything else (`programs_registration_needs_active`). Leaving `active` therefore closes them.
 */
/** A 23505 on programmes is the live-name unique index; anything else goes to the shared mapper. */
export function isDuplicateProgramName(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "23505";
}

/**
 * A 23503 on deleting a formation: it still has groups (`groups_program_id_fkey` is ON DELETE
 * RESTRICT, so a formation never takes its groups -- and their enrollments -- down with it).
 */
export function isFormationWithGroups(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "23503";
}

/**
 * A formation's new level system refused because some of its groups carry a level of another
 * system (`validate_program_groups`, 20261004120000). Recognised by the trigger's sentence, the
 * only thing that tells it apart from the other 23514s on `programs`.
 */
export function isGroupsOutsideLevelSystem(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return err?.code === "23514" && /outside the new level system/.test(err.message ?? "");
}

export function registrationOpenAfter(to: ProgramStatus, current: boolean): boolean {
  return to === "active" ? current : false;
}

export interface ProgramDraft {
  name: string;
  category: ProgramCategory;
  description: string;
  curriculum: string;
  /** NULL = no specific level (ADR-004 section 3). Set without `levelId` = every level of it. */
  levelSystemId: string | null;
  levelId: string | null;
  subjectId: string | null;
  startDate: string;
  endDate: string;
  durationHours: string;
  registrationOpen: boolean;
  status: ProgramStatus;
}

export interface ProgramValues {
  name: string;
  category: ProgramCategory;
  description: string | null;
  curriculum: string | null;
  levelSystemId: string | null;
  levelId: string | null;
  subjectId: string | null;
  startDate: string | null;
  endDate: string | null;
  durationHours: number | null;
  registrationOpen: boolean;
}

export type ProgramField =
  | "name"
  | "category"
  | "description"
  | "curriculum"
  | "subject"
  | "level"
  | "dates"
  | "durationHours"
  | "registrationOpen";

export type ProgramValidation =
  | { ok: true; values: ProgramValues }
  | { ok: false; errors: Partial<Record<ProgramField, string>> };

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * Validates the form against the same rules the database enforces. Returns i18n keys.
 *
 * `systemOfLevel` (the level system a level belongs to) lets the form refuse a level outside the
 * chosen system before the database does (`sync_program_level_system`).
 *
 * `subjectFits` (the formation-type filter, `subject-domain.ts`) keeps the form from saving a
 * subject the type does not offer. A form rule only: the database does not couple type and
 * subject, so an existing formation keeps its subject (the form passes it as fitting).
 *
 * `systemOffered` (`isLevelSystemOffered`, `level-model.ts`) does the same for the level system:
 * no CEFR for Mathematics, no school years for Marketing. The form passes an existing
 * formation's unchanged combination as offered.
 */
export function validateProgramDraft(
  draft: ProgramDraft,
  context: {
    systemOfLevel?: (levelId: string) => string | null;
    subjectFits?: (subjectId: string, category: ProgramCategory) => boolean;
    systemOffered?: (levelSystemId: string, subjectId: string | null) => boolean;
  } = {},
): ProgramValidation {
  const errors: Partial<Record<ProgramField, string>> = {};

  const name = draft.name.trim();
  if (name.length === 0) errors.name = "programs.error.nameRequired";
  else if (name.length > PROGRAM_NAME_MAX) errors.name = "programs.error.nameTooLong";

  if (!TYPE_CODE.test(draft.category)) {
    errors.category = "programs.error.category";
  }

  const description = draft.description.trim();
  if (description.length > PROGRAM_DESCRIPTION_MAX) {
    errors.description = "programs.error.descriptionTooLong";
  }
  const curriculum = draft.curriculum.trim();
  if (curriculum.length > PROGRAM_CURRICULUM_MAX) {
    errors.curriculum = "programs.error.curriculumTooLong";
  }

  if (
    draft.subjectId &&
    context.subjectFits &&
    !context.subjectFits(draft.subjectId, draft.category)
  ) {
    errors.subject = "programs.error.subjectOutsideType";
  }

  if (
    draft.levelSystemId &&
    context.systemOffered &&
    !context.systemOffered(draft.levelSystemId, draft.subjectId)
  ) {
    errors.level = "programs.error.systemNotOffered";
  }

  if (draft.levelId && !draft.levelSystemId) {
    errors.level = "programs.error.levelNeedsSystem";
  } else if (draft.levelId && draft.levelSystemId && context.systemOfLevel) {
    const system = context.systemOfLevel(draft.levelId);
    if (system !== null && system !== draft.levelSystemId) {
      errors.level = "programs.error.levelOutsideSystem";
    }
  }

  const start = draft.startDate.trim();
  const end = draft.endDate.trim();
  if ((start && !isIsoDate(start)) || (end && !isIsoDate(end))) {
    errors.dates = "programs.error.date";
  } else if (start && end && end < start) {
    errors.dates = "programs.error.endBeforeStart";
  }

  const durationText = draft.durationHours.trim();
  let durationHours: number | null = null;
  if (durationText) {
    const n = /^\d+$/.test(durationText) ? Number(durationText) : NaN;
    if (!Number.isSafeInteger(n) || n < 1 || n > PROGRAM_DURATION_MAX) {
      errors.durationHours = "programs.error.duration";
    } else {
      durationHours = n;
    }
  }

  if (draft.registrationOpen && draft.status !== "active") {
    errors.registrationOpen = "programs.error.registrationNeedsActive";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      name,
      category: draft.category,
      description: description || null,
      curriculum: curriculum || null,
      levelSystemId: draft.levelSystemId,
      levelId: draft.levelId,
      subjectId: draft.subjectId,
      startDate: start || null,
      endDate: end || null,
      durationHours,
      registrationOpen: draft.registrationOpen,
    },
  };
}

export interface ProgramGroupLike {
  status: string;
  maxStudents: number;
  enrolled: number;
  teacherId: string | null;
  teacherName: string | null;
}

export interface ProgramGroupSummary {
  groupCount: number;
  activeGroupCount: number;
  /** Seats across ACTIVE groups -- an inactive group offers no places. */
  seats: number;
  /** Approved registrations across all groups. */
  enrolled: number;
  /** Distinct teachers of the programme's groups, by name. */
  teachers: { id: string; name: string | null }[];
}

/** Capacity and teachers, derived from the programme's groups. */
export function summariseProgramGroups(
  groups: readonly ProgramGroupLike[] | null | undefined,
): ProgramGroupSummary {
  const summary: ProgramGroupSummary = {
    groupCount: 0,
    activeGroupCount: 0,
    seats: 0,
    enrolled: 0,
    teachers: [],
  };
  if (!groups) return summary;
  const seen = new Map<string, string | null>();
  for (const g of groups) {
    summary.groupCount += 1;
    const enrolled = Number(g.enrolled);
    if (Number.isFinite(enrolled)) summary.enrolled += enrolled;
    if (g.status === "active") {
      summary.activeGroupCount += 1;
      const seats = Number(g.maxStudents);
      if (Number.isFinite(seats) && seats > 0) summary.seats += seats;
    }
    if (g.teacherId && !seen.has(g.teacherId)) seen.set(g.teacherId, g.teacherName);
  }
  summary.teachers = [...seen]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  return summary;
}

/* ------------------------------------------------------------------------------------------ */
/* Creating a group from its programme                                                         */
/* ------------------------------------------------------------------------------------------ */

/** The programme facts a new group can start from. Nothing else on a programme is a group fact. */
export interface ProgramForGroup {
  id: string;
  levelId: string | null;
  subjectId: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface GroupDefaultsFromProgram {
  programId: string;
  levelId: string | null;
  subjectId: string | null;
  startDate: string;
  endDate: string | null;
}

/**
 * Initial values for a group created inside a programme.
 *
 *   level, subject  copied when the programme names them -- the database refuses a group
 *                   that differs (t_groups_program_consistent), so these are not defaults
 *                   but the only valid values.
 *   start, end      the programme's period, the natural term window of its groups; still
 *                   editable on the group (`groups.start_date` is required, so a programme
 *                   without a start falls back to `today`, unless that is after its end).
 *
 * Description, curriculum, category and duration describe the OFFER and stay on the
 * programme. Teacher, capacity, schedule, room and stream are how ONE group delivers it and
 * are never inherited.
 */
export function groupDefaultsFromProgram(
  program: ProgramForGroup,
  today: string,
): GroupDefaultsFromProgram {
  return {
    programId: program.id,
    levelId: program.levelId,
    subjectId: program.subjectId,
    ...defaultGroupTerm(program.startDate, program.endDate, today),
  };
}

/**
 * A group's term from its formation's planned period. `groups.start_date` is required, so a
 * formation without a start falls back to `today`, unless that is after its end.
 */
export function defaultGroupTerm(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  today: string,
): { startDate: string; endDate: string | null } {
  const end = endDate || null;
  const start = startDate || (end && today > end ? end : today);
  return { startDate: start, endDate: end };
}

/**
 * The letter of the next group of a programme: A for the first, B for the second... After Z
 * the position is written as a number. Used only to suggest a name the admin can change.
 */
export function nextGroupLetter(existingGroups: number): string {
  const n = Math.max(0, Math.floor(existingGroups));
  return n < 26 ? String.fromCharCode(65 + n) : String(n + 1);
}

/**
 * Groups page filter. A group either delivers a formation (`program_id`) or stands alone --
 * "standalone" says nothing about the kind of teaching (ADR-004: there is no stored group type).
 *
 *   "all"   every group
 *   "none"  groups not attached to any formation
 *   <id>    the groups of one formation
 */
export type FormationFilter = "all" | "none" | (string & {});

export function matchesFormationFilter(
  group: { programId: string | null },
  filter: FormationFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "none") return group.programId === null;
  return group.programId === filter;
}

/* ------------------------------------------------------------------------------------------ */
/* Creating a formation, optionally with its first group (public.create_formation)            */
/* ------------------------------------------------------------------------------------------ */

/** The statuses a formation may be created in (the function refuses any other). */
export const NEW_PROGRAM_STATUSES = ["draft", "active"] as const;
export type NewProgramStatus = (typeof NEW_PROGRAM_STATUSES)[number];

export interface FirstGroupValues {
  name: string;
  teacherId: string | null;
  streamId: string | null;
  maxStudents: number;
  startDate: string;
  endDate: string | null;
  schedules: readonly {
    weekday: number;
    startTime: string;
    endTime: string;
    room: string | null;
  }[];
}

/**
 * The two jsonb arguments of `create_formation`. The group carries no subject or level: the
 * function copies the formation's (ADR-004 section 3), so the two cannot disagree at creation.
 */
export function createFormationPayload(
  values: ProgramValues,
  status: NewProgramStatus,
  firstGroup: FirstGroupValues | null,
): { formation: Record<string, unknown>; first_group: Record<string, unknown> | null } {
  return {
    formation: {
      name: values.name,
      category: values.category,
      status,
      description: values.description,
      curriculum: values.curriculum,
      level_system_id: values.levelSystemId,
      level_id: values.levelId,
      subject_id: values.subjectId,
      start_date: values.startDate,
      end_date: values.endDate,
      duration_hours: values.durationHours,
    },
    first_group: firstGroup
      ? {
          name: firstGroup.name.trim(),
          teacher_id: firstGroup.teacherId,
          stream_id: firstGroup.streamId,
          max_students: firstGroup.maxStudents,
          status: "active",
          start_date: firstGroup.startDate,
          end_date: firstGroup.endDate,
          schedules: firstGroup.schedules.map((s) => ({
            weekday: s.weekday,
            start_time: s.startTime,
            end_time: s.endTime,
            room: s.room,
          })),
        }
      : null,
  };
}
