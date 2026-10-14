/**
 * Formation types: built-in list, selection, usage, validation and lifecycle actions.
 *
 *   node --test src/features/school/formation-type-model.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILT_IN_FORMATION_TYPES,
  formationTypeActions,
  formationTypeUsage,
  isBuiltInFormationType,
  isDuplicateFormationTypeName,
  isFormationTypeInUse,
  selectableFormationTypes,
  validateFormationTypeDraft,
} from "./formation-type-model.ts";

const type = (code: string, position: number, status = "active", name = code) => ({
  code,
  position,
  status,
  name,
});

test("the built-in types match the seeded list, and keep the historical codes", () => {
  assert.deepEqual(
    [...BUILT_IN_FORMATION_TYPES],
    [
      "formal_education",
      "academic_support",
      "exam_preparation",
      "language",
      "general_course",
      "extracurricular",
      "professional_training",
      "workshop",
      "other",
    ],
  );
  // The six codes formations used before types became data are all still built-in.
  for (const c of [
    "academic_support",
    "language",
    "exam_preparation",
    "professional_training",
    "workshop",
    "other",
  ]) {
    assert.equal(isBuiltInFormationType(c), true, c);
  }
  assert.equal(isBuiltInFormationType("custom_stage_intensif"), false);
});

test("a new formation is offered the active types in order", () => {
  const types = [
    type("b", 2),
    type("a", 1),
    type("old", 3, "inactive"),
    type("c", 2, "active", "Aa"),
  ];
  assert.deepEqual(
    selectableFormationTypes(types).map((t) => t.code),
    ["a", "c", "b"],
  );
});

test("an existing formation keeps its inactive type in the list", () => {
  const types = [type("a", 1), type("old", 3, "inactive")];
  assert.deepEqual(
    selectableFormationTypes(types, "old").map((t) => t.code),
    ["a", "old"],
  );
});

test("usage counts the formations of each type", () => {
  const usage = formationTypeUsage([
    { category: "language" },
    { category: "language" },
    { category: "workshop" },
  ]);
  assert.equal(usage.get("language"), 2);
  assert.equal(usage.get("workshop"), 1);
  assert.equal(usage.get("other"), undefined);
});

test("a custom type needs a unique name of at most 80 characters", () => {
  assert.equal(validateFormationTypeDraft({ name: "  ", description: "" }).ok, false);
  const long = validateFormationTypeDraft({ name: "n".repeat(81), description: "" });
  assert.equal(long.ok, false);
  if (!long.ok) assert.equal(long.errors.name, "formationTypes.error.nameTooLong");
  const dup = validateFormationTypeDraft({ name: " stage INTENSIF ", description: "" }, [
    "Stage intensif",
  ]);
  assert.equal(dup.ok, false);
  if (!dup.ok) assert.equal(dup.errors.name, "formationTypes.error.duplicate");
  const ok = validateFormationTypeDraft({ name: " Stage intensif ", description: "  " });
  assert.deepEqual(ok, { ok: true, values: { name: "Stage intensif", description: null } });
});

test("a description is optional and at most 500 characters", () => {
  const long = validateFormationTypeDraft({ name: "X", description: "d".repeat(501) });
  assert.equal(long.ok, false);
  if (!long.ok) assert.equal(long.errors.description, "formationTypes.error.descriptionTooLong");
});

test("built-in types cannot be edited or deleted; a used custom type cannot be deleted", () => {
  assert.deepEqual(formationTypeActions({ builtIn: true, status: "active" }, 0), {
    canEdit: false,
    canDelete: false,
    canToggle: true,
  });
  assert.deepEqual(formationTypeActions({ builtIn: false, status: "active" }, 3), {
    canEdit: true,
    canDelete: false,
    canToggle: true,
  });
  assert.equal(formationTypeActions({ builtIn: false, status: "inactive" }, 0).canDelete, true);
});

test("database refusals are recognised", () => {
  assert.equal(isDuplicateFormationTypeName({ code: "23505" }), true);
  assert.equal(isFormationTypeInUse({ code: "23503" }), true);
  assert.equal(isFormationTypeInUse({ code: "23514" }), false);
  assert.equal(isDuplicateFormationTypeName(null), false);
});
