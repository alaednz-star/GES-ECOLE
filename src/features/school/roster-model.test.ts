/**
 * The roster's contents.
 *
 * A wrong roster does not throw -- it prints a child who left, omits a child who is there,
 * or numbers the class differently from the list the office was looking at. The rule that
 * matters most is that the document matches the screen exactly, so scope and search are
 * tested together rather than separately.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildRoster, rosterMeta, rosterFilename, type RosterSourceRow } from "./roster-model.ts";

const row = (over: Partial<RosterSourceRow> = {}): RosterSourceRow => ({
  studentId: "s1",
  studentName: "Ahmed Benali",
  groupId: "g1",
  groupName: "Maths A",
  subjectName: "Mathématiques",
  levelName: "3AS",
  status: "approved",
  ...over,
});

const source: RosterSourceRow[] = [
  row({ studentId: "s1", studentName: "Ahmed Benali" }),
  row({ studentId: "s2", studentName: "Yasmine Cherif" }),
  row({ studentId: "s3", studentName: "Karim Haddad", groupId: "g2", groupName: "Physique B" }),
];

/* ------------------------------------------------------------------ scope */

test("all-groups scope returns every approved registration", () => {
  const r = buildRoster(source, { scope: { groupId: null } });
  assert.equal(r.length, 3);
});

test("group scope returns only that group", () => {
  const r = buildRoster(source, { scope: { groupId: "g1" } });
  assert.equal(r.length, 2);
  assert.ok(r.every((x) => x.groupName === "Maths A"));
});

test("a group with nobody in it produces an empty roster, not a crash", () => {
  assert.deepEqual(buildRoster(source, { scope: { groupId: "empty" } }), []);
});

test("an empty or missing source produces an empty roster", () => {
  assert.deepEqual(buildRoster([], { scope: { groupId: null } }), []);
  assert.deepEqual(buildRoster(null, { scope: { groupId: null } }), []);
  assert.deepEqual(buildRoster(undefined, { scope: { groupId: null } }), []);
});

/* ------------------------------------------------------------------ status */

test("only approved registrations appear by default", () => {
  const withPending = [
    ...source,
    row({ studentId: "s9", studentName: "Pending Child", status: "pending" }),
  ];
  const r = buildRoster(withPending, { scope: { groupId: null } });
  assert.equal(r.length, 3, "a pending request is not a place in the class");
  assert.ok(!r.some((x) => x.studentName === "Pending Child"));
});

test("statuses can be widened deliberately", () => {
  const withPending = [
    ...source,
    row({ studentId: "s9", studentName: "Pending Child", status: "pending" }),
  ];
  const r = buildRoster(withPending, {
    scope: { groupId: null },
    statuses: ["approved", "pending"],
  });
  assert.equal(r.length, 4);
});

/* ------------------------------------------------------------------ search */

test("search narrows the roster, and the document matches the screen", () => {
  const r = buildRoster(source, { scope: { groupId: null }, search: "ahmed" });
  assert.equal(r.length, 1);
  assert.equal(r[0]?.studentName, "Ahmed Benali");
});

test("search matches group, subject and level too", () => {
  assert.equal(buildRoster(source, { scope: { groupId: null }, search: "physique" }).length, 1);
  assert.equal(buildRoster(source, { scope: { groupId: null }, search: "3as" }).length, 3);
});

test("search combines with scope rather than replacing it", () => {
  const r = buildRoster(source, { scope: { groupId: "g1" }, search: "karim" });
  assert.equal(r.length, 0, "Karim is in another group, so the group scope wins");
});

test("whitespace-only search is not a filter", () => {
  assert.equal(buildRoster(source, { scope: { groupId: null }, search: "   " }).length, 3);
});

/* ------------------------------------------------------------------ numbering & order */

test("rows are numbered 1..n as printed, after filtering", () => {
  const r = buildRoster(source, { scope: { groupId: "g1" } });
  assert.deepEqual(
    r.map((x) => x.index),
    [1, 2],
  );
});

test("rows are ordered by group then name, so a reader can scan", () => {
  const r = buildRoster(source, { scope: { groupId: null } });
  assert.deepEqual(
    r.map((x) => x.studentName),
    ["Ahmed Benali", "Yasmine Cherif", "Karim Haddad"],
  );
});

test("the same child in two groups appears once per group, not collapsed", () => {
  // Two subjects is two places, and each class list must show them.
  const twice = [...source, row({ studentId: "s1", groupId: "g2", groupName: "Physique B" })];
  const r = buildRoster(twice, { scope: { groupId: null } });
  assert.equal(r.filter((x) => x.studentId === "s1").length, 2);
});

test("a duplicated registration row in the same group is counted once", () => {
  const dupe = [...source, row({ studentId: "s1" })];
  const r = buildRoster(dupe, { scope: { groupId: "g1" } });
  assert.equal(r.length, 2, "the class has two children, however many rows describe them");
});

/* ------------------------------------------------------------------ document metadata */

test("rosterMeta carries the school, the scope, the count and the day", () => {
  const rows = buildRoster(source, { scope: { groupId: "g1" } });
  const meta = rosterMeta({
    schoolName: "مدرسة النجاح",
    title: "قائمة التلاميذ",
    groupName: "Maths A",
    rows,
    locale: "ar",
    today: new Date(2026, 7, 20),
  });
  assert.equal(meta.schoolName, "مدرسة النجاح");
  assert.equal(meta.groupName, "Maths A");
  assert.equal(meta.count, 2);
  assert.equal(meta.generatedOn, "2026-08-20");
});

test("rosterMeta flags RTL for Arabic only", () => {
  const base = { schoolName: "S", title: "T", groupName: null, rows: [] };
  assert.equal(rosterMeta({ ...base, locale: "ar" }).rtl, true);
  assert.equal(rosterMeta({ ...base, locale: "fr" }).rtl, false);
  assert.equal(rosterMeta({ ...base, locale: "en" }).rtl, false);
});

test("rosterMeta uses the local calendar day, not UTC", () => {
  // 23:30 local on the 20th is still the 20th, even where toISOString() says the 21st.
  const meta = rosterMeta({
    schoolName: null,
    title: "T",
    groupName: null,
    rows: [],
    locale: "fr",
    today: new Date(2026, 7, 20, 23, 30),
  });
  assert.equal(meta.generatedOn, "2026-08-20");
});

test("a blank school name or group becomes null rather than an empty heading", () => {
  const meta = rosterMeta({
    schoolName: "   ",
    title: "T",
    groupName: "  ",
    rows: [],
    locale: "fr",
  });
  assert.equal(meta.schoolName, null);
  assert.equal(meta.groupName, null);
});

/* ------------------------------------------------------------------ filename */

test("filenames survive email gateways and old shares", () => {
  const meta = rosterMeta({
    schoolName: "مدرسة النجاح",
    title: "T",
    groupName: "Maths A",
    rows: [],
    locale: "ar",
    today: new Date(2026, 7, 20),
  });
  const name = rosterFilename(meta, "docx");
  assert.ok(/^[a-z0-9-]+\.docx$/.test(name), name);
  assert.ok(name.includes("2026-08-20"), name);
});

test("a filename is never empty, even with nothing to name it after", () => {
  const meta = rosterMeta({
    schoolName: null,
    title: "T",
    groupName: null,
    rows: [],
    locale: "fr",
  });
  const name = rosterFilename(meta, "pdf");
  assert.ok(name.endsWith(".pdf"));
  assert.ok(name.length > 4);
});
