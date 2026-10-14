/**
 * Programme rules: validation, lifecycle and the figures derived from groups.
 *
 *   node --test src/features/school/program-model.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  PROGRAM_STATUSES,
  canTransition,
  createFormationPayload,
  isGroupsOutsideLevelSystem,
  isFormationWithGroups,
  defaultGroupTerm,
  groupDefaultsFromProgram,
  matchesFormationFilter,
  nextGroupLetter,
  nextStatuses,
  registrationOpenAfter,
  summariseProgramGroups,
  validateProgramDraft,
  type ProgramDraft,
} from "./program-model.ts";

const draft = (over: Partial<ProgramDraft> = {}): ProgramDraft => ({
  name: "English B1",
  category: "language",
  description: "",
  curriculum: "",
  levelSystemId: null,
  levelId: null,
  subjectId: null,
  startDate: "",
  endDate: "",
  durationHours: "",
  registrationOpen: false,
  status: "draft",
  ...over,
});

/* ------------------------------------------------------------------ vocabulary */

test("statuses match the database CHECK list; a type is any formation-type code", () => {
  // Types are data (formation_types): built-in and custom codes are both valid.
  for (const category of [
    "language",
    "formal_education",
    "extracurricular",
    "custom_stage_intensif",
  ]) {
    assert.equal(validateProgramDraft(draft({ category })).ok, true, category);
  }
  for (const category of ["", "Language", "x", "1abc"]) {
    const r = validateProgramDraft(draft({ category }));
    assert.equal(r.ok, false, category);
    if (!r.ok) assert.equal(r.errors.category, "programs.error.category");
  }
  assert.deepEqual(
    [...PROGRAM_STATUSES],
    ["draft", "active", "completed", "cancelled", "archived"],
  );
});

/* ------------------------------------------------------------------ validation */

test("a minimal programme needs only a name and a category", () => {
  const r = validateProgramDraft(
    draft({ name: "  Excel Advanced  ", category: "professional_training" }),
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.values.name, "Excel Advanced");
    assert.equal(r.values.levelId, null);
    assert.equal(r.values.subjectId, null);
    assert.equal(r.values.durationHours, null);
    assert.equal(r.values.startDate, null);
    assert.equal(r.values.description, null);
  }
});

test("academic support may carry a level and a subject", () => {
  const r = validateProgramDraft(
    draft({
      name: "BAC Maths",
      category: "exam_preparation",
      levelSystemId: "SYS",
      levelId: "L",
      subjectId: "S",
    }),
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(
      [r.values.levelSystemId, r.values.levelId, r.values.subjectId],
      ["SYS", "L", "S"],
    );
  }
});

test("level states: no system and no level, a system with every level, a system and a level", () => {
  const none = validateProgramDraft(draft());
  assert.equal(none.ok, true);
  if (none.ok) assert.deepEqual([none.values.levelSystemId, none.values.levelId], [null, null]);

  const allLevels = validateProgramDraft(draft({ levelSystemId: "cefr" }));
  assert.equal(allLevels.ok, true);
  if (allLevels.ok) {
    assert.deepEqual([allLevels.values.levelSystemId, allLevels.values.levelId], ["cefr", null]);
  }

  const one = validateProgramDraft(draft({ levelSystemId: "cefr", levelId: "b1" }), {
    systemOfLevel: () => "cefr",
  });
  assert.equal(one.ok, true);
});

test("a level needs a system, and must belong to it", () => {
  const orphan = validateProgramDraft(draft({ levelId: "b1" }));
  assert.equal(orphan.ok, false);
  if (!orphan.ok) assert.equal(orphan.errors.level, "programs.error.levelNeedsSystem");

  const outside = validateProgramDraft(draft({ levelSystemId: "cefr", levelId: "3as" }), {
    systemOfLevel: () => "school",
  });
  assert.equal(outside.ok, false);
  if (!outside.ok) assert.equal(outside.errors.level, "programs.error.levelOutsideSystem");

  // An unknown level (levels not loaded yet) is left to the database.
  const unknown = validateProgramDraft(draft({ levelSystemId: "cefr", levelId: "x" }), {
    systemOfLevel: () => null,
  });
  assert.equal(unknown.ok, true);
});

test("the name is required and at most 120 characters", () => {
  const empty = validateProgramDraft(draft({ name: "   " }));
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.errors.name, "programs.error.nameRequired");
  assert.equal(validateProgramDraft(draft({ name: "n".repeat(120) })).ok, true);
  const long = validateProgramDraft(draft({ name: "n".repeat(121) }));
  if (!long.ok) assert.equal(long.errors.name, "programs.error.nameTooLong");
  else assert.fail("121 characters should be refused");
});

test("a malformed type code is refused; whether a type exists is the database's (FK)", () => {
  const r = validateProgramDraft(draft({ category: "Karaoké !" }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.errors.category, "programs.error.category");
  // Well-formed: accepted here, checked against formation_types by the foreign key.
  assert.equal(validateProgramDraft(draft({ category: "karaoke" })).ok, true);
});

test("dates are optional, must be real, and must not be inverted", () => {
  assert.equal(validateProgramDraft(draft({ startDate: "2026-10-01" })).ok, true);
  assert.equal(
    validateProgramDraft(draft({ startDate: "2026-10-01", endDate: "2026-12-31" })).ok,
    true,
  );
  const inverted = validateProgramDraft(draft({ startDate: "2026-12-31", endDate: "2026-10-01" }));
  if (!inverted.ok) assert.equal(inverted.errors.dates, "programs.error.endBeforeStart");
  else assert.fail("an end before the start should be refused");
  const bogus = validateProgramDraft(draft({ startDate: "2026-02-30" }));
  if (!bogus.ok) assert.equal(bogus.errors.dates, "programs.error.date");
  else assert.fail("an impossible date should be refused");
});

test("duration is an optional whole number of hours, 1..10000", () => {
  const ok = validateProgramDraft(draft({ durationHours: " 30 " }));
  assert.equal(ok.ok && ok.values.durationHours, 30);
  for (const bad of ["0", "-5", "2.5", "abc", "10001"]) {
    const r = validateProgramDraft(draft({ durationHours: bad }));
    assert.equal(r.ok, false, `duration ${bad} should be refused`);
    if (!r.ok) assert.equal(r.errors.durationHours, "programs.error.duration");
  }
});

test("description and curriculum respect their limits", () => {
  assert.equal(validateProgramDraft(draft({ description: "d".repeat(2000) })).ok, true);
  const d = validateProgramDraft(draft({ description: "d".repeat(2001) }));
  if (!d.ok) assert.equal(d.errors.description, "programs.error.descriptionTooLong");
  else assert.fail();
  const c = validateProgramDraft(draft({ curriculum: "c".repeat(5001) }));
  if (!c.ok) assert.equal(c.errors.curriculum, "programs.error.curriculumTooLong");
  else assert.fail();
});

test("registrations can only be open on an active programme", () => {
  const r = validateProgramDraft(draft({ status: "draft", registrationOpen: true }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.errors.registrationOpen, "programs.error.registrationNeedsActive");
  assert.equal(validateProgramDraft(draft({ status: "active", registrationOpen: true })).ok, true);
});

/* ------------------------------------------------------------------ lifecycle */

test("lifecycle: allowed transitions", () => {
  assert.deepEqual([...nextStatuses("draft")], ["active", "cancelled", "archived"]);
  assert.equal(canTransition("active", "completed"), true);
  assert.equal(canTransition("completed", "archived"), true);
  assert.equal(canTransition("archived", "draft"), true);
});

test("lifecycle: an active programme is not archived directly, nor reopened from archive", () => {
  assert.equal(canTransition("active", "archived"), false);
  assert.equal(canTransition("archived", "active"), false);
  assert.equal(canTransition("draft", "completed"), false);
  assert.equal(canTransition("active", "active"), false);
});

test("leaving active closes registrations; staying active keeps the choice", () => {
  assert.equal(registrationOpenAfter("completed", true), false);
  assert.equal(registrationOpenAfter("cancelled", true), false);
  assert.equal(registrationOpenAfter("active", true), true);
  assert.equal(registrationOpenAfter("active", false), false);
});

/* ------------------------------------------------------------------ derived figures */

test("capacity counts active groups only; enrolment counts every group", () => {
  const s = summariseProgramGroups([
    { status: "active", maxStudents: 20, enrolled: 12, teacherId: "t1", teacherName: "Sara" },
    { status: "active", maxStudents: 15, enrolled: 15, teacherId: "t2", teacherName: "Amine" },
    { status: "inactive", maxStudents: 18, enrolled: 3, teacherId: "t1", teacherName: "Sara" },
  ]);
  assert.equal(s.groupCount, 3);
  assert.equal(s.activeGroupCount, 2);
  assert.equal(s.seats, 35);
  assert.equal(s.enrolled, 30);
});

test("teachers are distinct, sorted by name, and groups without a teacher are skipped", () => {
  const s = summariseProgramGroups([
    { status: "active", maxStudents: 10, enrolled: 0, teacherId: "t2", teacherName: "Yacine" },
    { status: "active", maxStudents: 10, enrolled: 0, teacherId: "t1", teacherName: "Amel" },
    { status: "active", maxStudents: 10, enrolled: 0, teacherId: "t2", teacherName: "Yacine" },
    { status: "active", maxStudents: 10, enrolled: 0, teacherId: null, teacherName: null },
  ]);
  assert.deepEqual(
    s.teachers.map((t) => t.name),
    ["Amel", "Yacine"],
  );
});

test("a programme without groups has zero capacity and no teachers", () => {
  assert.deepEqual(summariseProgramGroups([]), {
    groupCount: 0,
    activeGroupCount: 0,
    seats: 0,
    enrolled: 0,
    teachers: [],
  });
  assert.equal(summariseProgramGroups(null).groupCount, 0);
});

/* ----------------------------------------------------- creating a group from its programme */

const program = {
  id: "p1",
  levelId: "lvl",
  subjectId: "sub",
  startDate: "2026-11-01",
  endDate: "2026-11-30",
};

test("a group created from a programme starts with its level, subject and period", () => {
  assert.deepEqual(groupDefaultsFromProgram(program, "2026-10-03"), {
    programId: "p1",
    levelId: "lvl",
    subjectId: "sub",
    startDate: "2026-11-01",
    endDate: "2026-11-30",
  });
});

test("a level-less, subject-less programme leaves those fields open on its groups", () => {
  const d = groupDefaultsFromProgram({ ...program, levelId: null, subjectId: null }, "2026-10-03");
  assert.equal(d.levelId, null);
  assert.equal(d.subjectId, null);
});

test("a programme without a start date: the group starts today (its start is required)", () => {
  const d = groupDefaultsFromProgram({ ...program, startDate: null, endDate: null }, "2026-10-03");
  assert.equal(d.startDate, "2026-10-03");
  assert.equal(d.endDate, null);
});

test("never a start after the end: an ended programme without a start uses its end date", () => {
  const d = groupDefaultsFromProgram(
    { ...program, startDate: null, endDate: "2026-06-30" },
    "2026-10-03",
  );
  assert.equal(d.startDate, "2026-06-30");
  assert.ok(d.endDate === null || d.startDate <= d.endDate);
});

test("group letters run A..Z, then numbers", () => {
  assert.equal(nextGroupLetter(0), "A");
  assert.equal(nextGroupLetter(1), "B");
  assert.equal(nextGroupLetter(25), "Z");
  assert.equal(nextGroupLetter(26), "27");
  assert.equal(nextGroupLetter(-3), "A");
});

test("the formation filter: all, groups without a formation, or one formation's groups", () => {
  const standalone = { programId: null };
  const english = { programId: "p1" };
  const excel = { programId: "p2" };
  assert.equal(
    matchesFormationFilter(standalone, "all") && matchesFormationFilter(english, "all"),
    true,
  );
  assert.equal(matchesFormationFilter(standalone, "none"), true);
  assert.equal(matchesFormationFilter(english, "none"), false);
  assert.equal(matchesFormationFilter(english, "p1"), true);
  assert.equal(matchesFormationFilter(excel, "p1"), false);
  assert.equal(matchesFormationFilter(standalone, "p1"), false);
});

test("a group's default term follows the formation's planned period", () => {
  assert.deepEqual(defaultGroupTerm("2026-11-01", "2026-11-30", "2026-10-03"), {
    startDate: "2026-11-01",
    endDate: "2026-11-30",
  });
  assert.deepEqual(defaultGroupTerm("", "", "2026-10-03"), {
    startDate: "2026-10-03",
    endDate: null,
  });
  assert.equal(defaultGroupTerm(null, "2026-06-30", "2026-10-03").startDate, "2026-06-30");
});

const formationValues = {
  name: "English C1",
  category: "language" as const,
  description: null,
  curriculum: null,
  levelSystemId: "sys-cefr",
  levelId: null,
  subjectId: "sub-en",
  startDate: "2026-11-01",
  endDate: null,
  durationHours: 60,
  registrationOpen: false,
};

test("create_formation payload: a formation alone sends no group", () => {
  const p = createFormationPayload(formationValues, "draft", null);
  assert.equal(p.first_group, null);
  assert.deepEqual(p.formation, {
    name: "English C1",
    category: "language",
    status: "draft",
    description: null,
    curriculum: null,
    level_system_id: "sys-cefr",
    level_id: null,
    subject_id: "sub-en",
    start_date: "2026-11-01",
    end_date: null,
    duration_hours: 60,
  });
});

test("create_formation payload: the first group carries delivery facts, never subject or level", () => {
  const p = createFormationPayload(formationValues, "active", {
    name: "  English C1 — Groupe A ",
    teacherId: "t1",
    streamId: null,
    maxStudents: 15,
    startDate: "2026-11-01",
    endDate: null,
    schedules: [{ weekday: 6, startTime: "09:00", endTime: "11:00", room: "Salle 2" }],
  });
  assert.equal(p.formation["status"], "active");
  assert.deepEqual(p.first_group, {
    name: "English C1 — Groupe A",
    teacher_id: "t1",
    stream_id: null,
    max_students: 15,
    status: "active",
    start_date: "2026-11-01",
    end_date: null,
    schedules: [{ weekday: 6, start_time: "09:00", end_time: "11:00", room: "Salle 2" }],
  });
  assert.equal("subject_id" in (p.first_group ?? {}), false);
  assert.equal("level_id" in (p.first_group ?? {}), false);
});

test("a system change refused by the formation's groups is recognised", () => {
  assert.equal(
    isGroupsOutsideLevelSystem({
      code: "23514",
      message: "1 group(s) of this programme have a level outside the new level system.",
    }),
    true,
  );
  assert.equal(
    isGroupsOutsideLevelSystem({ code: "23514", message: "do not match the new level or subject" }),
    false,
  );
  assert.equal(isGroupsOutsideLevelSystem({ code: "23505", message: "" }), false);
  assert.equal(isGroupsOutsideLevelSystem(null), false);
});

test("a subject the formation type does not offer is refused by the form rule", () => {
  const fits = (subjectId: string, category: string) =>
    !(subjectId === "maths" && category === "language");
  const refused = validateProgramDraft(draft({ category: "language", subjectId: "maths" }), {
    subjectFits: fits,
  });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.errors.subject, "programs.error.subjectOutsideType");
  assert.equal(
    validateProgramDraft(draft({ category: "academic_support", subjectId: "maths" }), {
      subjectFits: fits,
    }).ok,
    true,
  );
  // No subject, or no filter given: nothing to check.
  assert.equal(
    validateProgramDraft(draft({ subjectId: null }), { subjectFits: () => false }).ok,
    true,
  );
  assert.equal(validateProgramDraft(draft({ subjectId: "maths" })).ok, true);
});

test("a level system the subject does not fit is refused by the form rule", () => {
  const offered = (systemId: string, subjectId: string | null) =>
    !(systemId === "cefr" && subjectId === "maths");
  const refused = validateProgramDraft(draft({ subjectId: "maths", levelSystemId: "cefr" }), {
    systemOffered: offered,
  });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.errors.level, "programs.error.systemNotOffered");
  assert.equal(
    validateProgramDraft(draft({ subjectId: "english", levelSystemId: "cefr" }), {
      systemOffered: offered,
    }).ok,
    true,
  );
  assert.equal(
    validateProgramDraft(draft({ subjectId: "maths" }), { systemOffered: () => false }).ok,
    true,
  );
});

test("a delete refused because the formation still has groups is recognised (23503)", () => {
  assert.equal(isFormationWithGroups({ code: "23503", message: "violates foreign key" }), true);
  assert.equal(isFormationWithGroups({ code: "23505" }), false);
  assert.equal(isFormationWithGroups(null), false);
});
