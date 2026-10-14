/**
 * Level systems in the formation and group forms (ADR-004 section 3, Phase 3B). PURE.
 *
 * No runtime imports, so `node --test` can load it. The database enforces every rule here
 * (20261004110000_level_systems.sql, 20261004120000_group_level_system.sql); this file lets the
 * forms offer only valid choices.
 *
 * THREE LEVEL STATES OF A FORMATION -- never a fake "none" system or level:
 *
 *   none    no system, no level        (`level_system_id` NULL, `level_id` NULL)
 *   system  a system, every level      ("English", CEFR, groups at A1 and at B1)
 *   level   a system and one level     ("BAC Maths", Algerian school, 3AS)
 */

import type { ProgramCategory } from "./program-model";
import type { SubjectDomain } from "./subject-domain";

export type LevelSystemKind = "school" | "cefr" | "training" | "custom";
export type SchoolStage = "primary" | "middle" | "high";

/** School stages in teaching order (the `level_stage` enum). */
export const SCHOOL_STAGES: readonly SchoolStage[] = ["primary", "middle", "high"];

export interface LevelSystemOption {
  id: string;
  code: string;
  kind: LevelSystemKind;
  name: string;
  position: number;
  status: string;
}

export interface LevelOption {
  id: string;
  systemId: string;
  code: string | null;
  name: string;
  /** School stage; NULL for every non-school level. */
  stage: SchoolStage | null;
  position: number;
  status: string;
}

/**
 * The level system a BUILT-IN formation type proposes. A suggestion only: the administrator may
 * pick any offered system, or none, and the proposal is dropped when it does not fit the subject
 * (`suggestedLevelSystemId`): a general course in mathematics proposes nothing, in programming
 * Training. Workshops, "other" and custom types propose none.
 */
export const DEFAULT_LEVEL_SYSTEM_BY_CATEGORY: Partial<Record<ProgramCategory, string | null>> = {
  formal_education: "algerian_school",
  academic_support: "algerian_school",
  exam_preparation: "algerian_school",
  language: "cefr",
  general_course: "training",
  extracurricular: "training",
  professional_training: "training",
  workshop: null,
  other: null,
};

/**
 * The subject domains each kind of level system can measure. A system is offered for a formation
 * only when it fits:
 *   - the subject's domain, when a subject is chosen (Mathematics: school levels, never A1..C2);
 *   - otherwise one of the domains the formation TYPE offers (`SUBJECT_DOMAINS_BY_CATEGORY`).
 *
 *   school    school subjects, languages (Arabic, French, English are school subjects too)
 *   cefr      languages only (the CEFR is a scale for languages)
 *   training  computing, professional, other (beginner / intermediate / advanced)
 *   custom    any domain: a system the institution defined for its own progression
 *
 * A form rule, not a database constraint: an existing formation keeps what it holds (the form
 * shows a notice instead of rewriting it).
 */
export const LEVEL_SYSTEM_DOMAINS: Record<LevelSystemKind, readonly SubjectDomain[] | null> = {
  school: ["school_subjects", "languages"],
  cefr: ["languages"],
  training: ["computing", "professional", "other"],
  custom: null,
};

/**
 * Whether a level system fits at least one of `domains`. `null` (a subject not loaded yet) withholds
 * nothing.
 */
export function isLevelSystemOffered(
  system: { kind: string },
  domains: readonly string[] | null,
): boolean {
  if (domains === null) return true;
  const fits = LEVEL_SYSTEM_DOMAINS[system.kind as LevelSystemKind];
  if (fits === undefined || fits === null) return true;
  return domains.some((d) => (fits as readonly string[]).includes(d));
}

/**
 * The id of the system a formation type proposes, or null: none proposed, not available, or not
 * offered for `domains` (e.g. Training proposed by professional training, but the subject is a
 * language).
 */
export function suggestedLevelSystemId(
  category: ProgramCategory,
  systems: readonly LevelSystemOption[],
  domains: readonly string[] | null = null,
): string | null {
  const code = DEFAULT_LEVEL_SYSTEM_BY_CATEGORY[category] ?? null;
  if (!code) return null;
  const system = systems.find((s) => s.code === code && s.status === "active");
  return system && isLevelSystemOffered(system, domains) ? system.id : null;
}

export type LevelChoiceState = "none" | "system" | "level";

export function levelChoiceState(
  levelSystemId: string | null,
  levelId: string | null,
): LevelChoiceState {
  if (levelId) return "level";
  return levelSystemId ? "system" : "none";
}

/**
 * The systems the picker offers: the active ones, plus the currently selected one even if it was
 * deactivated since (an existing formation must still show what it holds).
 */
export function selectableSystems(
  systems: readonly LevelSystemOption[],
  selectedId: string | null,
): LevelSystemOption[] {
  return systems
    .filter((s) => s.status === "active" || s.id === selectedId)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/**
 * The levels of one system, in order: the active ones, plus `keepId` (the current value) even if
 * it was deactivated since. No system -> no levels.
 */
export function levelsOfSystem(
  levels: readonly LevelOption[],
  systemId: string | null,
  keepId: string | null = null,
): LevelOption[] {
  if (!systemId) return [];
  return levels
    .filter((l) => l.systemId === systemId && (l.status === "active" || l.id === keepId))
    .sort(
      (a, b) =>
        stageRank(a.stage) - stageRank(b.stage) ||
        a.position - b.position ||
        a.name.localeCompare(b.name),
    );
}

function stageRank(stage: SchoolStage | null): number {
  return stage ? SCHOOL_STAGES.indexOf(stage) : -1;
}

/** The stages that have at least one of these levels, in teaching order. */
export function stagesOf(levels: readonly LevelOption[]): SchoolStage[] {
  return SCHOOL_STAGES.filter((s) => levels.some((l) => l.stage === s));
}

/**
 * The level to keep after the system changes: the current one if it belongs to the new system,
 * otherwise none ("every level of the new system"). The database would refuse the mismatch.
 */
export function levelAfterSystemChange(
  levels: readonly LevelOption[],
  levelId: string | null,
  systemId: string | null,
): string | null {
  if (!levelId || !systemId) return null;
  return levels.some((l) => l.id === levelId && l.systemId === systemId) ? levelId : null;
}

/** The system a level belongs to, or null when the level is unknown. */
export function systemOfLevel(
  levels: readonly LevelOption[],
  levelId: string | null,
): string | null {
  if (!levelId) return null;
  return levels.find((l) => l.id === levelId)?.systemId ?? null;
}
