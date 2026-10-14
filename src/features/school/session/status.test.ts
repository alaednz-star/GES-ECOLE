/**
 * Unit tests for the pure session derivations.
 *
 * Run with:  node --test src/features/school/session/status.test.ts
 *
 * No test framework is installed and none is needed: `node:test` is built in,
 * and Node 24 strips TypeScript types natively, so these import the real source
 * rather than a compiled copy.
 *
 * `status.ts` is pure precisely so this file can exist -- every state and counter
 * is checked without a database, a network, or a rendered component. `today` is
 * always an explicit argument, which is what makes "yesterday" and "tomorrow"
 * testable without faking global time.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  compareSessions,
  countersFor,
  deriveStatus,
  groupByDate,
  groupByTimeSlot,
  isActionable,
  needsAction,
  rollupTotal,
} from "./status.ts";
import { EMPTY_ROLLUP, type SessionInstance, type SessionStatus } from "./types.ts";
import { keyOf, parseSessionKey, sessionKey } from "./session-key.ts";

const TODAY = "2026-08-08";
const YESTERDAY = "2026-08-07";
const TOMORROW = "2026-08-09";
const LAST_WEEK = "2026-08-01";
const NEXT_WEEK = "2026-08-15";

/* ---------------------------- deriveStatus ---------------------------- */

test("deriveStatus: complete when every enrolled student is marked", () => {
  assert.equal(deriveStatus({ date: YESTERDAY, enrolled: 14, marked: 14 }, TODAY), "complete");
  assert.equal(deriveStatus({ date: TODAY, enrolled: 1, marked: 1 }, TODAY), "complete");
  assert.equal(deriveStatus({ date: TOMORROW, enrolled: 5, marked: 5 }, TODAY), "complete");
});

test("deriveStatus: partial when some but not all are marked", () => {
  assert.equal(deriveStatus({ date: TODAY, enrolled: 14, marked: 6 }, TODAY), "partial");
  assert.equal(deriveStatus({ date: YESTERDAY, enrolled: 10, marked: 1 }, TODAY), "partial");
  assert.equal(deriveStatus({ date: YESTERDAY, enrolled: 10, marked: 9 }, TODAY), "partial");
});

test("deriveStatus: partial beats the date -- a started past session is not overdue", () => {
  // The teacher HAS begun. Reporting this as "Non pointée" would lose that and
  // suggest no work had been done at all.
  assert.equal(deriveStatus({ date: LAST_WEEK, enrolled: 20, marked: 3 }, TODAY), "partial");
});

test("deriveStatus: overdue only when past AND nothing marked", () => {
  assert.equal(deriveStatus({ date: YESTERDAY, enrolled: 14, marked: 0 }, TODAY), "overdue");
  assert.equal(deriveStatus({ date: LAST_WEEK, enrolled: 3, marked: 0 }, TODAY), "overdue");
});

test("deriveStatus: due when today AND nothing marked", () => {
  assert.equal(deriveStatus({ date: TODAY, enrolled: 14, marked: 0 }, TODAY), "due");
});

test("deriveStatus: scheduled when future AND nothing marked", () => {
  assert.equal(deriveStatus({ date: TOMORROW, enrolled: 14, marked: 0 }, TODAY), "scheduled");
  assert.equal(deriveStatus({ date: NEXT_WEEK, enrolled: 14, marked: 0 }, TODAY), "scheduled");
});

test("deriveStatus: empty whenever nobody is enrolled", () => {
  assert.equal(deriveStatus({ date: TODAY, enrolled: 0, marked: 0 }, TODAY), "empty");
  assert.equal(deriveStatus({ date: TOMORROW, enrolled: 0, marked: 0 }, TODAY), "empty");
  assert.equal(deriveStatus({ date: LAST_WEEK, enrolled: 0, marked: 0 }, TODAY), "empty");
});

test("REGRESSION: a zero-enrolment PAST session is empty, never overdue", () => {
  // The single most important ordering rule in the module. If `empty` were
  // tested after the date, a group with no students would sit in the "en retard"
  // counter forever and that counter could never reach zero -- which is the one
  // thing it exists to do.
  assert.equal(deriveStatus({ date: YESTERDAY, enrolled: 0, marked: 0 }, TODAY), "empty");
  assert.equal(deriveStatus({ date: LAST_WEEK, enrolled: 0, marked: 0 }, TODAY), "empty");
});

test("deriveStatus: cancelled wins over every other consideration", () => {
  const cases = [
    { date: YESTERDAY, enrolled: 14, marked: 0 }, // would be overdue
    { date: TODAY, enrolled: 14, marked: 0 }, // would be due
    { date: TODAY, enrolled: 14, marked: 6 }, // would be partial
    { date: TODAY, enrolled: 14, marked: 14 }, // would be complete
    { date: TODAY, enrolled: 0, marked: 0 }, // would be empty
  ];
  for (const c of cases) {
    assert.equal(deriveStatus({ ...c, cancelled: true }, TODAY), "cancelled");
  }
});

test("deriveStatus: marked exceeding enrolled reads as complete, not partial", () => {
  // Happens when a student is unenrolled after being marked. Every CURRENT
  // student has a status, so "complete" is the honest answer; `partial` would
  // ask the teacher to finish work that does not exist.
  assert.equal(deriveStatus({ date: YESTERDAY, enrolled: 3, marked: 5 }, TODAY), "complete");
});

test("deriveStatus: negative enrolled is treated as empty, not a crash", () => {
  assert.equal(deriveStatus({ date: TODAY, enrolled: -1, marked: 0 }, TODAY), "empty");
});

test("deriveStatus: boundary -- date equality decides due vs overdue vs scheduled", () => {
  // String comparison on ISO dates is the whole mechanism; verify the three
  // adjacent days resolve distinctly.
  assert.equal(
    deriveStatus({ date: "2026-08-07", enrolled: 2, marked: 0 }, "2026-08-08"),
    "overdue",
  );
  assert.equal(deriveStatus({ date: "2026-08-08", enrolled: 2, marked: 0 }, "2026-08-08"), "due");
  assert.equal(
    deriveStatus({ date: "2026-08-09", enrolled: 2, marked: 0 }, "2026-08-08"),
    "scheduled",
  );
});

test("deriveStatus: boundary -- month and year rollovers compare correctly", () => {
  assert.equal(
    deriveStatus({ date: "2026-07-31", enrolled: 2, marked: 0 }, "2026-08-01"),
    "overdue",
  );
  assert.equal(
    deriveStatus({ date: "2026-12-31", enrolled: 2, marked: 0 }, "2027-01-01"),
    "overdue",
  );
  assert.equal(
    deriveStatus({ date: "2027-01-01", enrolled: 2, marked: 0 }, "2026-12-31"),
    "scheduled",
  );
});

test("deriveStatus: every state is reachable", () => {
  const reached = new Set<SessionStatus>([
    deriveStatus({ date: TODAY, enrolled: 0, marked: 0 }, TODAY),
    deriveStatus({ date: TODAY, enrolled: 5, marked: 5 }, TODAY),
    deriveStatus({ date: TODAY, enrolled: 5, marked: 2 }, TODAY),
    deriveStatus({ date: YESTERDAY, enrolled: 5, marked: 0 }, TODAY),
    deriveStatus({ date: TODAY, enrolled: 5, marked: 0 }, TODAY),
    deriveStatus({ date: TOMORROW, enrolled: 5, marked: 0 }, TODAY),
    deriveStatus({ date: TODAY, enrolled: 5, marked: 0, cancelled: true }, TODAY),
  ]);
  assert.deepEqual([...reached].sort(), [
    "cancelled",
    "complete",
    "due",
    "empty",
    "overdue",
    "partial",
    "scheduled",
  ]);
});

/* ------------------------- isActionable / needsAction ------------------------- */

test("isActionable: exactly due, partial and overdue", () => {
  assert.equal(isActionable("due"), true);
  assert.equal(isActionable("partial"), true);
  assert.equal(isActionable("overdue"), true);
  assert.equal(isActionable("complete"), false);
  assert.equal(isActionable("empty"), false);
  assert.equal(isActionable("scheduled"), false);
  assert.equal(isActionable("cancelled"), false);
});

test("needsAction: a zero-enrolment session is never surfaced as work", () => {
  assert.equal(needsAction("empty"), false);
  // ...and the filter still shows owed work rather than hiding it.
  assert.equal(needsAction("overdue"), true);
});

/* ----------------------------- countersFor ----------------------------- */

/** Minimal SessionInstance for counter tests. Only the status field is read. */
function fixture(status: SessionStatus, over: Partial<SessionInstance> = {}): SessionInstance {
  const date = over.date ?? TODAY;
  const groupId = over.groupId ?? "g1";
  return {
    key: sessionKey(groupId, date),
    groupId,
    groupName: over.groupName ?? "3AS Sciences",
    subjectId: "s1",
    subjectKey: "mathematics",
    subjectName: "Mathématiques",
    subjectColor: "#2f6fed",
    teacherId: "t1",
    teacherName: "M. Bensaïd",
    room: "A1",
    date,
    startTime: over.startTime ?? "08:00",
    endTime: over.endTime ?? "10:00",
    startsAt: new Date(`${date}T${over.startTime ?? "08:00"}:00`),
    enrolled: over.enrolled ?? 14,
    attendance: over.attendance ?? EMPTY_ROLLUP,
    status,
    ...over,
  } as SessionInstance;
}

test("countersFor: empty input yields three zeros", () => {
  assert.deepEqual(countersFor([]), { total: 0, toMark: 0, overdue: 0 });
});

test("countersFor: toMark is due + partial", () => {
  const c = countersFor([
    fixture("due"),
    fixture("due"),
    fixture("partial"),
    fixture("complete"),
    fixture("scheduled"),
  ]);
  assert.equal(c.toMark, 3);
});

test("countersFor: overdue counts only overdue", () => {
  const c = countersFor([
    fixture("overdue"),
    fixture("overdue"),
    fixture("due"),
    fixture("partial"),
    fixture("complete"),
  ]);
  assert.equal(c.overdue, 2);
});

test("countersFor: total counts every non-cancelled session", () => {
  const c = countersFor([
    fixture("due"),
    fixture("complete"),
    fixture("empty"),
    fixture("scheduled"),
    fixture("overdue"),
    fixture("partial"),
  ]);
  assert.equal(c.total, 6);
});

test("countersFor: cancelled is excluded from ALL three counters", () => {
  const c = countersFor([fixture("cancelled"), fixture("cancelled"), fixture("due")]);
  assert.deepEqual(c, { total: 1, toMark: 1, overdue: 0 });
});

test("countersFor: zero-enrolment sessions count in total but not as work", () => {
  // They are real scheduled lessons, so they belong in "séances"; they are not
  // work, so they must not appear in "à pointer" or "en retard".
  const c = countersFor([fixture("empty"), fixture("empty"), fixture("empty")]);
  assert.deepEqual(c, { total: 3, toMark: 0, overdue: 0 });
});

test("countersFor: a realistic mixed period", () => {
  const c = countersFor([
    fixture("complete"),
    fixture("complete"),
    fixture("partial"),
    fixture("due"),
    fixture("due"),
    fixture("due"),
    fixture("overdue"),
    fixture("overdue"),
    fixture("scheduled"),
    fixture("scheduled"),
    fixture("empty"),
    fixture("cancelled"),
  ]);
  // 12 fixtures, 1 cancelled -> 11 total; due(3) + partial(1) = 4; overdue = 2.
  assert.deepEqual(c, { total: 11, toMark: 4, overdue: 2 });
});

test("countersFor: overdue reaching zero is achievable by marking everything", () => {
  // The acceptance criterion, expressed as a test: a period whose past sessions
  // are all complete has overdue = 0 even with an empty group present.
  const c = countersFor([
    fixture("complete", { date: YESTERDAY }),
    fixture("complete", { date: LAST_WEEK }),
    fixture("empty", { date: LAST_WEEK }),
    fixture("scheduled", { date: TOMORROW }),
  ]);
  assert.equal(c.overdue, 0);
});

/* ----------------------------- rollupTotal ----------------------------- */

test("rollupTotal: sums the four statuses", () => {
  assert.equal(
    rollupTotal({ marked: 9, present: 5, absent: 2, late: 1, excused: 1, lastMarkedAt: null }),
    9,
  );
  assert.equal(rollupTotal(EMPTY_ROLLUP), 0);
});

/* --------------------------- compareSessions --------------------------- */

test("compareSessions: date first, then start time, then group name", () => {
  const a = fixture("due", { date: "2026-08-07", startTime: "10:00", groupName: "Z" });
  const b = fixture("due", { date: "2026-08-08", startTime: "08:00", groupName: "A" });
  assert.ok(compareSessions(a, b) < 0, "earlier date sorts first");

  const c = fixture("due", { date: TODAY, startTime: "08:00", groupName: "Z" });
  const d = fixture("due", { date: TODAY, startTime: "10:00", groupName: "A" });
  assert.ok(compareSessions(c, d) < 0, "earlier time sorts first within a day");

  const e = fixture("due", { date: TODAY, startTime: "08:00", groupName: "1AM Groupe 1" });
  const f = fixture("due", { date: TODAY, startTime: "08:00", groupName: "3AS Sciences" });
  assert.ok(compareSessions(e, f) < 0, "group name breaks the tie");
});

test("compareSessions: sorting is stable and total", () => {
  const list = [
    fixture("due", { date: TOMORROW, startTime: "08:00", groupName: "B" }),
    fixture("due", { date: YESTERDAY, startTime: "14:00", groupName: "A" }),
    fixture("due", { date: TODAY, startTime: "08:00", groupName: "C" }),
    fixture("due", { date: TODAY, startTime: "08:00", groupName: "A" }),
  ];
  const sorted = [...list].sort(compareSessions);
  assert.deepEqual(
    sorted.map((s) => `${s.date} ${s.startTime} ${s.groupName}`),
    [`${YESTERDAY} 14:00 A`, `${TODAY} 08:00 A`, `${TODAY} 08:00 C`, `${TOMORROW} 08:00 B`],
  );
});

/* ----------------------- grouping (parallel sessions) ----------------------- */

test("groupByDate: one bucket per date, insertion order preserved", () => {
  const g = groupByDate([
    fixture("due", { date: YESTERDAY }),
    fixture("due", { date: TODAY, groupId: "g1" }),
    fixture("due", { date: TODAY, groupId: "g2" }),
  ]);
  assert.deepEqual([...g.keys()], [YESTERDAY, TODAY]);
  assert.equal(g.get(TODAY)?.length, 2);
});

test("groupByTimeSlot: parallel sessions stay separate, never collapsed", () => {
  // Three different groups at 08:00. Merging them would hide two lessons
  // entirely -- the exact failure the calendar must not have.
  const slots = groupByTimeSlot([
    fixture("due", { groupId: "g1", groupName: "3AS Sciences", startTime: "08:00" }),
    fixture("due", { groupId: "g2", groupName: "2AS Sciences", startTime: "08:00" }),
    fixture("due", { groupId: "g3", groupName: "1AM Groupe 1", startTime: "08:00" }),
    fixture("due", { groupId: "g4", groupName: "Autre", startTime: "10:00", endTime: "12:00" }),
  ]);
  assert.equal(slots.size, 2, "two distinct time slots");
  assert.equal(slots.get("08:00-10:00")?.length, 3, "all three parallel groups retained");
  assert.equal(slots.get("10:00-12:00")?.length, 1);

  const ids = slots.get("08:00-10:00")?.map((s) => s.groupId);
  assert.deepEqual(ids, ["g1", "g2", "g3"], "each parallel session individually identifiable");
});

/* ------------------------------ session key ------------------------------ */

test("sessionKey: encodes and round-trips", () => {
  const id = "3f8a1b2c-0000-4000-8000-000000000001";
  const k = sessionKey(id, TODAY);
  assert.equal(k, `${id}|${TODAY}`);
  assert.deepEqual(parseSessionKey(k), { groupId: id, date: TODAY });
});

test("keyOf: matches sessionKey", () => {
  assert.equal(keyOf({ groupId: "g1", date: TODAY }), sessionKey("g1", TODAY));
});

test("parseSessionKey: returns null on malformed input rather than throwing", () => {
  for (const bad of ["", "nopipe", "|", "|2026-08-08", "g1|", "|x|"]) {
    assert.equal(parseSessionKey(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("parseSessionKey: a key is uniquely identifying per (group, date)", () => {
  assert.notEqual(sessionKey("g1", TODAY), sessionKey("g2", TODAY));
  assert.notEqual(sessionKey("g1", TODAY), sessionKey("g1", TOMORROW));
});
