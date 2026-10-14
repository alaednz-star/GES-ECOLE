/**
 * Level systems in the formation and group forms (Phase 3B).
 *
 *   node --test src/features/school/level-model.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LEVEL_SYSTEM_BY_CATEGORY,
  isLevelSystemOffered,
  levelAfterSystemChange,
  levelChoiceState,
  levelsOfSystem,
  selectableSystems,
  stagesOf,
  suggestedLevelSystemId,
  systemOfLevel,
  type LevelOption,
  type LevelSystemOption,
} from "./level-model.ts";
import { BUILT_IN_FORMATION_TYPES } from "./formation-type-model.ts";

const systems: LevelSystemOption[] = [
  { id: "s-cefr", code: "cefr", kind: "cefr", name: "CECRL", position: 2, status: "active" },
  {
    id: "s-school",
    code: "algerian_school",
    kind: "school",
    name: "École",
    position: 1,
    status: "active",
  },
  {
    id: "s-train",
    code: "training",
    kind: "training",
    name: "Formation",
    position: 3,
    status: "active",
  },
  { id: "s-custom", code: "custom", kind: "custom", name: "Perso", position: 4, status: "active" },
  { id: "s-old", code: "quran", kind: "custom", name: "Ancien", position: 5, status: "inactive" },
];

const lv = (
  id: string,
  systemId: string,
  position: number,
  stage: LevelOption["stage"] = null,
  status = "active",
): LevelOption => ({ id, systemId, code: id, name: id.toUpperCase(), stage, position, status });

const levels: LevelOption[] = [
  lv("1as", "s-school", 1, "high"),
  lv("3as", "s-school", 3, "high"),
  lv("1ap", "s-school", 1, "primary"),
  lv("1am", "s-school", 1, "middle"),
  lv("b1", "s-cefr", 3),
  lv("a1", "s-cefr", 1),
  lv("c2", "s-cefr", 6, null, "inactive"),
  lv("beginner", "s-train", 1),
];

test("every built-in formation type has a proposal decision; the expected ones", () => {
  for (const c of BUILT_IN_FORMATION_TYPES) assert.ok(c in DEFAULT_LEVEL_SYSTEM_BY_CATEGORY, c);
  assert.equal(suggestedLevelSystemId("formal_education", systems), "s-school");
  assert.equal(suggestedLevelSystemId("general_course", systems), "s-train");
  assert.equal(suggestedLevelSystemId("extracurricular", systems), "s-train");
  // A custom type proposes nothing.
  assert.equal(suggestedLevelSystemId("custom_stage_intensif", systems), null);
  assert.equal(suggestedLevelSystemId("academic_support", systems), "s-school");
  assert.equal(suggestedLevelSystemId("exam_preparation", systems), "s-school");
  assert.equal(suggestedLevelSystemId("language", systems), "s-cefr");
  assert.equal(suggestedLevelSystemId("professional_training", systems), "s-train");
  assert.equal(suggestedLevelSystemId("workshop", systems), null);
  assert.equal(suggestedLevelSystemId("other", systems), null);
});

test("no proposal when the proposed system is missing or inactive", () => {
  assert.equal(suggestedLevelSystemId("language", []), null);
  const inactive = systems.map((s) => (s.code === "cefr" ? { ...s, status: "inactive" } : s));
  assert.equal(suggestedLevelSystemId("language", inactive), null);
});

test("three level states, never a fake none", () => {
  assert.equal(levelChoiceState(null, null), "none");
  assert.equal(levelChoiceState("s-cefr", null), "system");
  assert.equal(levelChoiceState("s-cefr", "b1"), "level");
});

test("selectable systems: active ones in order, plus the selected one", () => {
  assert.deepEqual(
    selectableSystems(systems, null).map((s) => s.id),
    ["s-school", "s-cefr", "s-train", "s-custom"],
  );
  assert.equal(
    selectableSystems(systems, "s-old").some((s) => s.id === "s-old"),
    true,
  );
});

test("levels are scoped to one system, ordered by stage then position", () => {
  assert.deepEqual(
    levelsOfSystem(levels, "s-school").map((l) => l.id),
    ["1ap", "1am", "1as", "3as"],
  );
  assert.deepEqual(
    levelsOfSystem(levels, "s-cefr").map((l) => l.id),
    ["a1", "b1"],
  );
  assert.deepEqual(levelsOfSystem(levels, null), []);
  // An inactive level is kept only when it is the current value.
  assert.deepEqual(
    levelsOfSystem(levels, "s-cefr", "c2").map((l) => l.id),
    ["a1", "b1", "c2"],
  );
});

test("school stages present, in teaching order; none outside the school system", () => {
  assert.deepEqual(stagesOf(levelsOfSystem(levels, "s-school")), ["primary", "middle", "high"]);
  assert.deepEqual(stagesOf(levelsOfSystem(levels, "s-cefr")), []);
});

test("changing system keeps the level only if it belongs to the new system", () => {
  assert.equal(levelAfterSystemChange(levels, "b1", "s-cefr"), "b1");
  assert.equal(levelAfterSystemChange(levels, "3as", "s-cefr"), null);
  assert.equal(levelAfterSystemChange(levels, "3as", null), null);
  assert.equal(levelAfterSystemChange(levels, null, "s-school"), null);
});

test("system of a level", () => {
  assert.equal(systemOfLevel(levels, "beginner"), "s-train");
  assert.equal(systemOfLevel(levels, "unknown"), null);
  assert.equal(systemOfLevel(levels, null), null);
});

test("each level system is offered only for the subjects it can measure", () => {
  const school = { kind: "school" };
  const cefr = { kind: "cefr" };
  const training = { kind: "training" };
  const custom = { kind: "custom" };
  // Mathematics (school subject): school years, never A1..C2 or training levels.
  assert.equal(isLevelSystemOffered(school, ["school_subjects"]), true);
  assert.equal(isLevelSystemOffered(cefr, ["school_subjects"]), false);
  assert.equal(isLevelSystemOffered(training, ["school_subjects"]), false);
  // English (language): CEFR or school years, not training levels.
  assert.equal(isLevelSystemOffered(cefr, ["languages"]), true);
  assert.equal(isLevelSystemOffered(school, ["languages"]), true);
  assert.equal(isLevelSystemOffered(training, ["languages"]), false);
  // Marketing (professional), Python (computing), Soroban (other): training levels only.
  for (const d of ["professional", "computing", "other"]) {
    assert.equal(isLevelSystemOffered(training, [d]), true, d);
    assert.equal(isLevelSystemOffered(school, [d]), false, d);
    assert.equal(isLevelSystemOffered(cefr, [d]), false, d);
  }
  // A custom system fits anything; an unknown subject withholds nothing.
  assert.equal(isLevelSystemOffered(custom, ["school_subjects"]), true);
  assert.equal(isLevelSystemOffered(cefr, null), true);
  // Without a subject, the type's domains decide (language type: no training levels).
  assert.equal(isLevelSystemOffered(training, ["languages"]), false);
  assert.equal(isLevelSystemOffered(training, ["professional", "computing", "languages"]), true);
});

test("a proposal the subject does not fit is not made", () => {
  // Professional training proposes Training, but not for a language subject.
  assert.equal(suggestedLevelSystemId("professional_training", systems, ["languages"]), null);
  assert.equal(suggestedLevelSystemId("professional_training", systems, ["computing"]), "s-train");
  assert.equal(suggestedLevelSystemId("language", systems, ["languages"]), "s-cefr");
  assert.equal(
    suggestedLevelSystemId("academic_support", systems, ["school_subjects"]),
    "s-school",
  );
});

test("the type only proposes: a proposal the subject does not fit is dropped", () => {
  // General course in mathematics: Training does not fit a school subject -> nothing proposed.
  assert.equal(suggestedLevelSystemId("general_course", systems, ["school_subjects"]), null);
  // General course in programming, extracurricular Soroban: Training fits.
  assert.equal(suggestedLevelSystemId("general_course", systems, ["computing"]), "s-train");
  assert.equal(suggestedLevelSystemId("extracurricular", systems, ["other"]), "s-train");
  // English: CEFR for a language course; school years for academic support.
  assert.equal(suggestedLevelSystemId("language", systems, ["languages"]), "s-cefr");
  assert.equal(suggestedLevelSystemId("academic_support", systems, ["languages"]), "s-school");
  // A workshop proposes no level at all.
  assert.equal(suggestedLevelSystemId("workshop", systems, ["computing"]), null);
});
