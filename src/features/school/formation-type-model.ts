/**
 * Formation types: the PURPOSE / educational context of a formation (ADR-004 section 1). PURE.
 *
 * No runtime imports, so `node --test` can load it. The database enforces every rule here
 * (20261005100000_formation_types.sql); this file lets the screens explain a problem before a
 * request is refused.
 *
 * A type is data the institution manages (`formation_types`). `programs.category` holds its stable
 * `code`, so a formation keeps its type whatever happens to the type's name or status.
 *
 *   built-in   provided by Gestion École, translated by code (fr/ar/en); cannot be deleted, renamed or
 *              re-described -- an institution that uses other words creates its own type and
 *              deactivates the built-in one
 *   custom     created by the institution, shown with its own name; deletable while unused
 *   inactive   still valid on the formations that use it, but not offered to a new formation
 */

/** The built-in types (seeded by 20261005100000), in their default order. */
export const BUILT_IN_FORMATION_TYPES = [
  "formal_education",
  "academic_support",
  "exam_preparation",
  "language",
  "general_course",
  "extracurricular",
  "professional_training",
  "workshop",
  "other",
] as const;
export type BuiltInFormationType = (typeof BUILT_IN_FORMATION_TYPES)[number];

export function isBuiltInFormationType(code: string): code is BuiltInFormationType {
  return (BUILT_IN_FORMATION_TYPES as readonly string[]).includes(code);
}

export interface FormationTypeRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  builtIn: boolean;
  status: "active" | "inactive";
  position: number;
}

export const FORMATION_TYPE_NAME_MAX = 80;
export const FORMATION_TYPE_DESCRIPTION_MAX = 500;

/**
 * The types a formation may choose, in order: the active ones, plus `currentCode` (the type an
 * existing formation holds) even if it was deactivated since.
 */
export function selectableFormationTypes<
  T extends { code: string; status: string; position: number; name: string },
>(types: readonly T[], currentCode: string | null = null): T[] {
  return types
    .filter((t) => t.status === "active" || t.code === currentCode)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/** How many formations use each type code. */
export function formationTypeUsage(
  formations: readonly { category: string }[],
): Map<string, number> {
  const usage = new Map<string, number>();
  for (const f of formations) usage.set(f.category, (usage.get(f.category) ?? 0) + 1);
  return usage;
}

export type FormationTypeField = "name" | "description";

export type FormationTypeValidation =
  | { ok: true; values: { name: string; description: string | null } }
  | { ok: false; errors: Partial<Record<FormationTypeField, string>> };

/**
 * Validates a custom type's name and description. `existingNames` are the other types' names
 * (case- and space-insensitive uniqueness, like the database index); returns i18n keys.
 */
export function validateFormationTypeDraft(
  draft: { name: string; description: string },
  existingNames: readonly string[] = [],
): FormationTypeValidation {
  const errors: Partial<Record<FormationTypeField, string>> = {};
  const name = draft.name.trim();
  if (!name) errors.name = "formationTypes.error.nameRequired";
  else if (name.length > FORMATION_TYPE_NAME_MAX) errors.name = "formationTypes.error.nameTooLong";
  else if (existingNames.some((n) => n.trim().toLowerCase() === name.toLowerCase())) {
    errors.name = "formationTypes.error.duplicate";
  }
  const description = draft.description.trim();
  if (description.length > FORMATION_TYPE_DESCRIPTION_MAX) {
    errors.description = "formationTypes.error.descriptionTooLong";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { name, description: description || null } };
}

/** What may be done with a type, given how many formations use it. */
export function formationTypeActions(
  type: { builtIn: boolean; status: string },
  usage: number,
): { canEdit: boolean; canDelete: boolean; canToggle: boolean } {
  return {
    canEdit: !type.builtIn,
    canDelete: !type.builtIn && usage === 0,
    canToggle: true,
  };
}

/** A 23505 on formation types is the unique-name index. */
export function isDuplicateFormationTypeName(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "23505";
}

/** A 23503 on deleting a type: formations still use it. */
export function isFormationTypeInUse(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "23503";
}
