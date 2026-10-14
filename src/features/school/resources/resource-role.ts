/**
 * Pedagogical role presentation. PURE.
 *
 * Separate from `resource-icon.ts` on purpose: that file answers "what format is
 * this?" from the MIME type, this one answers "what is it FOR?" from the teacher's
 * declaration. A resource carries both, and the row shows both -- [COURS] [PDF] --
 * because a PDF can be a lesson, an exercise sheet or its answers, and a student
 * scanning a chapter needs the pedagogical answer first.
 *
 * No colour of its own. Roles reuse the existing token palette rather than opening
 * a second colour system next to `subjectColor`.
 */

// Extension-explicit: `RESOURCE_ROLES` is a VALUE, so this import survives type
// stripping and must resolve at runtime -- which is what lets `node --test` load this
// module. The type-only imports elsewhere in the feature are erased and need no extension.
import { RESOURCE_ROLES, type ResourceRole } from "./types.ts";

export interface RoleFace {
  /** i18n key for the full name, used in the selector. */
  labelKey: string;
  /** i18n key for the compact badge, used on rows where space is tight. */
  shortKey: string;
  /** Tailwind classes over existing tokens. */
  className: string;
}

/**
 * Only tokens that already exist. Notes, exercises and video are the everyday case
 * and stay quiet on `muted`. Solutions borrow `accent` -- the same tint the module
 * already uses for "scheduled", because both mean "careful when this becomes
 * visible". Homework leans on `primary` because it is the one a student must act on.
 * `extra` is deliberately the faintest.
 */
const FACES: Record<ResourceRole, RoleFace> = {
  notes: {
    labelKey: "resources.role.notes",
    shortKey: "resources.role.notesShort",
    className: "border-border bg-muted text-secondary-foreground",
  },
  exercises: {
    labelKey: "resources.role.exercises",
    shortKey: "resources.role.exercisesShort",
    className: "border-border bg-muted text-secondary-foreground",
  },
  solutions: {
    labelKey: "resources.role.solutions",
    shortKey: "resources.role.solutionsShort",
    className: "border-accent/30 bg-accent/10 text-accent",
  },
  video: {
    labelKey: "resources.role.video",
    shortKey: "resources.role.videoShort",
    className: "border-border bg-muted text-secondary-foreground",
  },
  homework: {
    labelKey: "resources.role.homework",
    shortKey: "resources.role.homeworkShort",
    className: "border-primary/25 bg-primary/10 text-primary",
  },
  extra: {
    labelKey: "resources.role.extra",
    shortKey: "resources.role.extraShort",
    className: "border-border bg-transparent text-muted-foreground",
  },
};

export function roleFace(role: ResourceRole): RoleFace {
  return FACES[role] ?? FACES.extra;
}

/** The six roles in pedagogical order, for a selector. */
export const roleOptions: readonly { value: ResourceRole; labelKey: string }[] = RESOURCE_ROLES.map(
  (value) => ({ value, labelKey: FACES[value].labelKey }),
);
