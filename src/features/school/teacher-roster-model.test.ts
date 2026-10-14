/**
 * The teacher list's contents.
 *
 * A wrong staff list does not throw -- it prints a colleague who left as though they still
 * taught here, drops one who does, or shows a phone number against the wrong name. The rule
 * that matters most is the same as the student roster's: the document matches the screen, so
 * scope and search are tested together rather than separately.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildTeacherRoster, type TeacherRosterSourceRow } from "./teacher-roster-model.ts";
import { rosterFilename, rosterMeta } from "./roster-model.ts";

const row = (over: Partial<TeacherRosterSourceRow> = {}): TeacherRosterSourceRow => ({
  teacherId: "t1",
  teacherName: "Ahmed Benali",
  email: "ahmed@example.dz",
  phone: "0555000001",
  subjects: ["Mathématiques"],
  groupCount: 2,
  status: "active",
  ...over,
});

const source: TeacherRosterSourceRow[] = [
  row({ teacherId: "t1", teacherName: "Yasmine Cherif" }),
  row({ teacherId: "t2", teacherName: "Ahmed Benali" }),
  row({ teacherId: "t3", teacherName: "Karim Haddad", status: "inactive" }),
];

/* ------------------------------------------------------------------------------ scope */

test("no scope lists every teacher, whatever their status", () => {
  const rows = buildTeacherRoster(source, { scope: { status: null } });
  assert.equal(rows.length, 3);
});

test("scoping to active excludes a teacher who has left", () => {
  const rows = buildTeacherRoster(source, { scope: { status: "active" } });
  assert.deepEqual(
    rows.map((r) => r.teacherId),
    ["t2", "t1"],
  );
});

test("scoping to inactive keeps only the teacher who has left", () => {
  const rows = buildTeacherRoster(source, { scope: { status: "inactive" } });
  assert.deepEqual(
    rows.map((r) => r.teacherName),
    ["Karim Haddad"],
  );
});

/* -------------------------------------------------------------------- numbering & order */

test("the list is numbered as printed, not as queried", () => {
  const rows = buildTeacherRoster(source, { scope: { status: "active" } });
  assert.deepEqual(
    rows.map((r) => r.index),
    [1, 2],
  );
});

test("teachers are sorted by name so a reader can find a person", () => {
  const rows = buildTeacherRoster(source, { scope: { status: null } });
  assert.deepEqual(
    rows.map((r) => r.teacherName),
    ["Ahmed Benali", "Karim Haddad", "Yasmine Cherif"],
  );
});

test("Arabic names collate as Arabic rather than by code point", () => {
  const rows = buildTeacherRoster(
    [row({ teacherId: "a", teacherName: "يوسف" }), row({ teacherId: "b", teacherName: "أحمد" })],
    { scope: { status: null } },
  );
  assert.deepEqual(
    rows.map((r) => r.teacherName),
    ["أحمد", "يوسف"],
  );
});

/* ----------------------------------------------------------------------------- search */

test("search matches a name", () => {
  const rows = buildTeacherRoster(source, { scope: { status: null }, search: "cherif" });
  assert.deepEqual(
    rows.map((r) => r.teacherId),
    ["t1"],
  );
});

test("search matches an email address", () => {
  const rows = buildTeacherRoster(
    [
      row({ email: "rare.address@example.dz" }),
      row({ teacherId: "t9", email: "other@example.dz" }),
    ],
    { scope: { status: null }, search: "rare.address" },
  );
  assert.equal(rows.length, 1);
});

test("search matches a phone number", () => {
  const rows = buildTeacherRoster(source, { scope: { status: null }, search: "0555000001" });
  assert.equal(rows.length, 3);
});

test("search matches a subject taught", () => {
  const rows = buildTeacherRoster(
    [row({ subjects: ["Physique"] }), row({ teacherId: "t9", subjects: ["Mathématiques"] })],
    { scope: { status: null }, search: "physique" },
  );
  assert.deepEqual(
    rows.map((r) => r.subjects),
    ["Physique"],
  );
});

test("search and scope narrow together, never one instead of the other", () => {
  const rows = buildTeacherRoster(source, { scope: { status: "active" }, search: "karim" });
  assert.equal(rows.length, 0, "Karim is inactive, so the active scope must still exclude him");
});

test("a blank search is not a filter", () => {
  assert.equal(buildTeacherRoster(source, { scope: { status: null }, search: "   " }).length, 3);
});

/* ------------------------------------------------------------------------------ shape */

test("one row per person, even if a join produced duplicates", () => {
  const rows = buildTeacherRoster([row(), row(), row()], { scope: { status: null } });
  assert.equal(rows.length, 1, "three copies of one teacher are one member of staff");
});

test("subjects are joined for the document, and an empty list becomes an empty string", () => {
  const [many] = buildTeacherRoster([row({ subjects: ["Maths", "Physique"] })], {
    scope: { status: null },
  });
  assert.ok(many);
  assert.equal(many.subjects, "Maths, Physique");
  const [none] = buildTeacherRoster([row({ subjects: [] })], { scope: { status: null } });
  assert.ok(none);
  assert.equal(none.subjects, "");
});

test("blank contact details become null rather than a whitespace cell", () => {
  const [r] = buildTeacherRoster([row({ email: "  ", phone: null })], { scope: { status: null } });
  assert.ok(r);
  assert.equal(r.email, null);
  assert.equal(r.phone, null);
});

test("a missing group count reads as none, not as undefined", () => {
  const [r] = buildTeacherRoster([row({ groupCount: null })], { scope: { status: null } });
  assert.ok(r);
  assert.equal(r.groupCount, 0);
});

test("a missing source is an empty list, not a crash", () => {
  assert.deepEqual(buildTeacherRoster(null, { scope: { status: null } }), []);
  assert.deepEqual(buildTeacherRoster(undefined, { scope: { status: null } }), []);
});

/* -------------------------------------------------------------------- document header */

test("the header counts the teachers actually on the document", () => {
  const rows = buildTeacherRoster(source, { scope: { status: "active" } });
  const meta = rosterMeta({
    schoolName: "مدرسة النجاح",
    title: "Liste des enseignants",
    groupName: "Actifs",
    rows,
    locale: "fr",
    today: new Date(2026, 7, 20),
  });
  assert.equal(meta.count, 2);
  assert.equal(meta.groupName, "Actifs");
  assert.equal(meta.generatedOn, "2026-08-20");
  assert.equal(meta.rtl, false);
});

test("an Arabic locale makes the document right-to-left", () => {
  const meta = rosterMeta({
    schoolName: "مدرسة النجاح",
    title: "قائمة الأساتذة",
    groupName: "كل الحالات",
    rows: [],
    locale: "ar",
    today: new Date(2026, 7, 20),
  });
  assert.equal(meta.rtl, true);
});

/* ---------------------------------------------------------------------------- filename */

test("the teacher list names itself, so it cannot be mistaken for a student roster", () => {
  const meta = rosterMeta({
    schoolName: "Ecole Ennadjah",
    title: "Liste des enseignants",
    groupName: "Actifs",
    rows: [],
    locale: "fr",
    today: new Date(2026, 7, 20),
  });
  assert.equal(
    rosterFilename(meta, "docx", "teachers"),
    "ecole-ennadjah-teachers-actifs-2026-08-20.docx",
  );
});

test("an Arabic scope still yields a distinguishable filename", () => {
  // Every character of the Arabic scope is stripped by the slug rules, which is exactly why
  // the kind token exists: without it this document and a student roster would collide.
  const meta = rosterMeta({
    schoolName: "Ecole Ennadjah",
    title: "قائمة الأساتذة",
    groupName: "كل الحالات",
    rows: [],
    locale: "ar",
    today: new Date(2026, 7, 20),
  });
  assert.equal(rosterFilename(meta, "docx", "teachers"), "ecole-ennadjah-teachers-2026-08-20.docx");
});

test("the student roster's filenames are unchanged by the shared helper", () => {
  const meta = rosterMeta({
    schoolName: "Ecole Ennadjah",
    title: "Liste des élèves",
    groupName: null,
    rows: [],
    locale: "fr",
    today: new Date(2026, 7, 20),
  });
  assert.equal(rosterFilename(meta, "docx"), "ecole-ennadjah-all-2026-08-20.docx");
});
