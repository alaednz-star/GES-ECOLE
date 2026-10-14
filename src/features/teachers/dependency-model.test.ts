/**
 * What may be deleted, and what may not.
 *
 * These are the rules that decide whether a real account is destroyed, so the tests are
 * written around the two ways of being wrong: refusing a deletion that should be allowed
 * (the reported bug -- an unused account made undeletable by its own creation record), and
 * allowing one that would take history with it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  canDelete,
  deletionBlockers,
  describeBlockers,
  preservedRecords,
  type DependencyLike,
} from "./dependency-model.ts";

const dep = (over: Partial<DependencyLike> = {}): DependencyLike => ({
  sourceTable: "groups",
  relationship: "teaches",
  rowCount: 1,
  severity: "blocking",
  ...over,
});

/** Exactly what the database reports for a teacher created and never used. */
const NEVER_USED = [
  dep({ sourceTable: "groups", severity: "reassignable", rowCount: 0 }),
  dep({ sourceTable: "attendance", severity: "blocking", rowCount: 0 }),
  dep({ sourceTable: "student_notes", severity: "blocking", rowCount: 0 }),
  dep({ sourceTable: "audit_log", severity: "preserved", rowCount: 2 }),
  dep({ sourceTable: "teacher_subjects", severity: "incidental", rowCount: 1 }),
];

/* ------------------------------------------------------------------------ the reported bug */

test("an account whose only records are audit entries can be deleted", () => {
  assert.equal(canDelete(NEVER_USED), true);
  assert.deepEqual(deletionBlockers(NEVER_USED), []);
});

test("the audit entries are reported rather than silently dropped from view", () => {
  const kept = preservedRecords(NEVER_USED);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.sourceTable, "audit_log");
  assert.equal(kept[0]?.rowCount, 2);
});

test("the old rule would have refused this account, which is why it is not used", () => {
  // "anything that is not incidental blocks" -- the exclusion the fix replaced.
  const byExclusion = NEVER_USED.filter((d) => d.rowCount > 0 && d.severity !== "incidental");
  assert.equal(byExclusion.length, 1, "the audit entries alone blocked the deletion");
  assert.equal(canDelete(NEVER_USED), true, "and the rule now in force allows it");
});

/* --------------------------------------------------------------- history still protects */

test("a teacher who has taught is still refused", () => {
  const taught = [...NEVER_USED, dep({ sourceTable: "attendance", rowCount: 14 })];
  assert.equal(canDelete(taught), false);
  assert.deepEqual(
    deletionBlockers(taught).map((d) => d.sourceTable),
    ["attendance"],
  );
});

test("notes that would cascade away with their author block the deletion", () => {
  const authored = [dep({ sourceTable: "student_notes", severity: "blocking", rowCount: 3 })];
  assert.equal(canDelete(authored), false);
});

test("groups must be handed to somebody else first", () => {
  const teaching = [dep({ sourceTable: "groups", severity: "reassignable", rowCount: 2 })];
  assert.equal(canDelete(teaching), false, "reassignable is a blocker until it is reassigned");
});

test("a student's enrolments block their deletion too", () => {
  const enrolled = [
    dep({ sourceTable: "registrations", severity: "blocking", rowCount: 1 }),
    dep({ sourceTable: "audit_log", severity: "preserved", rowCount: 9 }),
  ];
  assert.equal(canDelete(enrolled), false);
  assert.equal(preservedRecords(enrolled).length, 1);
});

/* ----------------------------------------------------------------------------- counting */

test("a dependency with no rows is not a dependency", () => {
  assert.equal(canDelete([dep({ rowCount: 0 })]), true);
  assert.equal(preservedRecords([dep({ severity: "preserved", rowCount: 0 })]).length, 0);
});

test("incidental records cascade away and never block", () => {
  assert.equal(canDelete([dep({ severity: "incidental", rowCount: 40 })]), true);
});

test("preserved records never block, however many there are", () => {
  assert.equal(canDelete([dep({ severity: "preserved", rowCount: 5000 })]), true);
});

/* ------------------------------------------------------------------------------- absence */

test("no dependencies at all is deletable", () => {
  assert.equal(canDelete([]), true);
  assert.equal(canDelete(null), true);
  assert.equal(canDelete(undefined), true);
  assert.deepEqual(deletionBlockers(null), []);
  assert.deepEqual(preservedRecords(undefined), []);
});

/* ---------------------------------------------------------------- what the admin is told */

test("the refusal names the tables and their counts", () => {
  const taught = [
    dep({ sourceTable: "groups", severity: "reassignable", rowCount: 2 }),
    dep({ sourceTable: "attendance", severity: "blocking", rowCount: 14 }),
    dep({ sourceTable: "audit_log", severity: "preserved", rowCount: 7 }),
  ];
  assert.equal(describeBlockers(taught), "groups (2), attendance (14)");
});

test("the refusal never cites something that is being kept", () => {
  assert.equal(describeBlockers(NEVER_USED), "");
});

/* -------------------------------------------------------------- an unrecognised severity */

test("a severity nobody has taught this rule about does not block", () => {
  // The database is the authority on severities. If it grows one, deletion is decided by the
  // named blockers alone, so a new label cannot quietly make every account undeletable --
  // which is precisely how the reported bug behaved.
  const future = [
    dep({ sourceTable: "certificates", severity: "archived_elsewhere", rowCount: 3 }),
  ];
  assert.equal(canDelete(future), true);
  assert.deepEqual(deletionBlockers(future), []);
});
