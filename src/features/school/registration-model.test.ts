/**
 * Enrollment lifecycle helpers.
 *
 *   node --test src/features/school/registration-model.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  currentRegistrationByGroup,
  enrollmentProblem,
  isActiveStatus,
  partitionGroupRegistrations,
  subjectTakenGroup,
} from "./registration-model.ts";

const row = (id: string, group_id: string, status: string, created_at: string) => ({
  id,
  group_id,
  status,
  created_at,
});

test("pending and approved are active; rejected and withdrawn are history", () => {
  assert.equal(isActiveStatus("pending"), true);
  assert.equal(isActiveStatus("approved"), true);
  assert.equal(isActiveStatus("rejected"), false);
  assert.equal(isActiveStatus("withdrawn"), false);
});

test("the current registration of a group is the active one, whatever the order", () => {
  const rows = [
    row("old", "g1", "rejected", "2026-09-01T10:00:00Z"),
    row("now", "g1", "pending", "2026-09-10T10:00:00Z"),
  ];
  assert.equal(currentRegistrationByGroup(rows).get("g1")?.id, "now");
  assert.equal(currentRegistrationByGroup([...rows].reverse()).get("g1")?.id, "now");
});

test("an active registration wins even over a more recent history row", () => {
  const rows = [
    row("active", "g1", "approved", "2026-09-01T10:00:00Z"),
    row("later-rejected", "g1", "rejected", "2026-09-20T10:00:00Z"),
  ];
  assert.equal(currentRegistrationByGroup(rows).get("g1")?.id, "active");
});

test("without an active one, the most recent history row describes the group", () => {
  const rows = [
    row("first", "g1", "withdrawn", "2026-01-01T10:00:00Z"),
    row("second", "g1", "rejected", "2026-06-01T10:00:00Z"),
    row("other", "g2", "approved", "2026-02-01T10:00:00Z"),
  ];
  const current = currentRegistrationByGroup(rows);
  assert.equal(current.get("g1")?.id, "second");
  assert.equal(current.get("g2")?.id, "other");
});

test("camelCase rows (RegistrationRow) work too", () => {
  const rows = [
    { id: "a", groupId: "g", status: "withdrawn", createdAt: "2026-01-01" },
    { id: "b", groupId: "g", status: "approved", createdAt: "2026-02-01" },
  ];
  assert.equal(currentRegistrationByGroup(rows).get("g")?.id, "b");
});

test("a group's registrations split into enrolled, pending and history (newest first)", () => {
  const p = partitionGroupRegistrations([
    row("a", "g", "approved", "2026-09-01"),
    row("b", "g", "pending", "2026-09-02"),
    row("c", "g", "rejected", "2026-09-03"),
    row("d", "g", "withdrawn", "2026-09-04"),
    row("e", "g", "approved", "2026-09-05"),
  ]);
  assert.deepEqual(
    p.enrolled.map((r) => r.id),
    ["e", "a"],
  );
  assert.deepEqual(
    p.pending.map((r) => r.id),
    ["b"],
  );
  assert.deepEqual(
    p.history.map((r) => r.id),
    ["d", "c"],
  );
});

test("database refusals are read into specific reasons", () => {
  assert.equal(
    enrollmentProblem({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "registrations_one_active_per_group"',
    }),
    "enroll.error.alreadyInGroup",
  );
  assert.equal(
    enrollmentProblem({
      code: "23505",
      message: 'This student is already enrolled in "Maths A" for this subject and level',
    }),
    "enroll.error.subjectTaken",
  );
  assert.equal(
    enrollmentProblem({ code: "23514", message: "Group 9f1 is full (20/20 seats)" }),
    "enroll.error.full",
  );
  assert.equal(
    enrollmentProblem({
      code: "23514",
      message: "This enrollment was withdrawn and is closed. Enroll the student again instead.",
    }),
    "enroll.error.closed",
  );
  assert.equal(
    enrollmentProblem(
      { code: "23505", message: 'This student is already enrolled in "Maths A" for this subject' },
      "Maths A",
    ),
    "enroll.error.alreadyInGroup",
    "already in THIS group is not a clash with another group",
  );
  assert.equal(enrollmentProblem({ code: "42501", message: "permission denied" }), null);
  assert.equal(enrollmentProblem(null), null);
});

test("the subject rule's message names the group already held", () => {
  assert.equal(
    subjectTakenGroup({
      message: 'This student is already enrolled in "Maths A" for this subject',
    }),
    "Maths A",
  );
  assert.equal(subjectTakenGroup({ message: "other" }), null);
});
