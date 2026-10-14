/**
 * Pédagogie models (ADR-008): averages, ranks, statistics, periods; sessions held, lesson log,
 * chapter coverage, form validation.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  assessmentStats,
  generalAverage,
  groupMatrix,
  inPeriod,
  mentionOf,
  parseScore,
  periodOf,
  periodTrend,
  rankAverages,
  scoreError,
  studentAverage,
  indexScores,
} from "./grades-model.ts";
import {
  chapterCoverage,
  coverageRate,
  heldSessions,
  isSessionDay,
  lessonEntryErrors,
  lessonLog,
  logCounters,
} from "./lesson-model.ts";
import type { Assessment, LessonEntry, PedChapter, Period, RosterStudent, Score } from "./types.ts";

const a = (id: string, over: Partial<Assessment> = {}): Assessment => ({
  id,
  groupId: "g",
  title: id,
  kind: "test",
  heldOn: "2026-10-10",
  maxScore: 20,
  coefficient: 1,
  published: true,
  ...over,
});
const s = (
  assessmentId: string,
  studentId: string,
  score: number | null,
  absent = false,
): Score => ({
  assessmentId,
  studentId,
  score,
  absent,
  comment: null,
});
const roster: RosterStudent[] = [
  { studentId: "s1", fullName: "Amina" },
  { studentId: "s2", fullName: "Bilal" },
  { studentId: "s3", fullName: "Chahra" },
  { studentId: "s4", fullName: "Djamel" },
];
const periods: Period[] = [
  {
    id: "t2",
    name: "T2",
    academicYear: null,
    startsOn: "2026-12-01",
    endsOn: "2027-02-28",
    position: 2,
  },
  {
    id: "t1",
    name: "T1",
    academicYear: null,
    startsOn: "2026-09-01",
    endsOn: "2026-11-30",
    position: 1,
  },
];

test("an average brings every score to /20 and weighs it by its coefficient", () => {
  const list = [
    a("a1", { maxScore: 10, coefficient: 2 }),
    a("a2", { maxScore: 40, coefficient: 1 }),
  ];
  const idx = indexScores([s("a1", "s1", 8), s("a2", "s1", 20)]);
  // a1: 16/20 x2, a2: 10/20 x1 -> (32 + 10) / 3 = 14
  assert.deepEqual(studentAverage(list, idx, "s1"), { average: 14, counted: 2 });
});

test("absences and missing scores are left out, not counted as zero", () => {
  const list = [a("a1"), a("a2"), a("a3")];
  const idx = indexScores([s("a1", "s1", 12), s("a2", "s1", null, true)]);
  assert.deepEqual(studentAverage(list, idx, "s1"), { average: 12, counted: 1 });
  assert.deepEqual(studentAverage(list, idx, "s2"), { average: null, counted: 0 });
});

test("averages are rounded to two decimals", () => {
  const idx = indexScores([s("a1", "s1", 10), s("a2", "s1", 11), s("a3", "s1", 11)]);
  assert.equal(studentAverage([a("a1"), a("a2"), a("a3")], idx, "s1").average, 10.67);
});

test("ranks are competition ranks and skip students without an average", () => {
  assert.deepEqual(rankAverages([12, 15, null, 15, 9]), [3, 1, null, 1, 4]);
});

test("the group matrix gives each student an average and a rank, and the class figures", () => {
  const list = [a("a1")];
  const m = groupMatrix(
    list,
    [s("a1", "s1", 16), s("a1", "s2", 10), s("a1", "s3", null, true)],
    roster,
  );
  assert.deepEqual(
    m.rows.map((r) => [r.student.studentId, r.average, r.rank]),
    [
      ["s1", 16, 1],
      ["s2", 10, 2],
      ["s3", null, null],
      ["s4", null, null],
    ],
  );
  assert.deepEqual(m.classStats, { average: 13, min: 10, max: 16, count: 2 });
});

test("assessment figures stay on the assessment's own scale and count absences and blanks", () => {
  const st = assessmentStats(
    a("a1", { maxScore: 40 }),
    [s("a1", "s1", 30), s("a1", "s2", 20), s("a1", "s3", null, true)],
    roster,
  );
  assert.deepEqual(st, { average: 25, min: 20, max: 30, count: 2, absent: 1, missing: 1 });
});

test("an assessment belongs to the period containing its date", () => {
  assert.equal(periodOf("2026-11-30", periods)?.id, "t1");
  assert.equal(periodOf("2026-12-01", periods)?.id, "t2");
  assert.equal(periodOf("2026-08-01", periods), null);
  const list = [a("x", { heldOn: "2026-10-01" }), a("y", { heldOn: "2027-01-10" })];
  assert.deepEqual(
    inPeriod(list, periods[0] ?? null).map((r) => r.id),
    ["y"],
  );
  assert.equal(inPeriod(list, null).length, 2);
});

test("the general average is the mean of the available group averages", () => {
  assert.equal(generalAverage([12, 15, null]), 13.5);
  assert.equal(generalAverage([null]), null);
});

test("mentions follow the usual thresholds", () => {
  assert.equal(mentionOf(16), "excellent");
  assert.equal(mentionOf(14.5), "veryGood");
  assert.equal(mentionOf(12), "good");
  assert.equal(mentionOf(10), "fair");
  assert.equal(mentionOf(9.99), "insufficient");
  assert.equal(mentionOf(null), null);
});

test("the trend gives the class average per period, in period order", () => {
  const list = [a("x", { heldOn: "2026-10-01" }), a("y", { heldOn: "2027-01-10" })];
  const trend = periodTrend(
    periods,
    list,
    [s("x", "s1", 10), s("x", "s2", 14), s("y", "s1", 16)],
    roster,
  );
  assert.deepEqual(
    trend.map((r) => [r.period.id, r.classAverage, r.assessments]),
    [
      ["t1", 12, 1],
      ["t2", 16, 1],
    ],
  );
});

test("a score line accepts blanks, commas and two decimals within the maximum", () => {
  assert.equal(scoreError("", false, 20), null);
  assert.equal(scoreError("12,5", false, 20), null);
  assert.equal(scoreError("12.35", false, 20), null);
  assert.equal(parseScore("12,5"), 12.5);
  assert.equal(parseScore(" "), null);
  assert.equal(scoreError("21", false, 20), "assessments.error.range");
  assert.equal(scoreError("-1", false, 20), "assessments.error.range");
  assert.equal(scoreError("abc", false, 20), "assessments.error.range");
  assert.equal(scoreError("12.345", false, 20), "assessments.error.decimals");
  assert.equal(scoreError("12", true, 20), "assessments.error.absentWithScore");
});

const pattern = { startDate: "2026-09-01", endDate: "2026-09-30", weekdays: [2, 0] };

test("sessions held are the slot weekdays from the start to today, newest first", () => {
  // 2026-09-01 is a Tuesday; Sundays 6, 13; Tuesdays 1, 8, 15.
  assert.deepEqual(heldSessions(pattern, "2026-09-15"), [
    "2026-09-15",
    "2026-09-13",
    "2026-09-08",
    "2026-09-06",
    "2026-09-01",
  ]);
});

test("sessions stop at the group's end and do not exist before it starts or without slots", () => {
  assert.equal(heldSessions(pattern, "2027-01-01")[0], "2026-09-29");
  assert.deepEqual(heldSessions(pattern, "2026-08-01"), []);
  assert.deepEqual(heldSessions({ ...pattern, weekdays: [] }, "2026-09-15"), []);
  assert.deepEqual(heldSessions({ ...pattern, startDate: null }, "2026-09-15"), []);
});

test("a session day must be in the term and on a slot weekday", () => {
  assert.equal(isSessionDay(pattern, "2026-09-08"), true);
  assert.equal(isSessionDay(pattern, "2026-09-07"), false);
  assert.equal(isSessionDay(pattern, "2026-10-04"), false);
  assert.equal(isSessionDay({ ...pattern, weekdays: [] }, "2026-09-07"), true);
});

const entry = (date: string, over: Partial<LessonEntry> = {}): LessonEntry => ({
  id: date,
  groupId: "g",
  sessionDate: date,
  chapterId: null,
  summary: "x",
  homework: null,
  homeworkDue: null,
  updatedAt: date,
  ...over,
});

test("the lesson log lists held sessions with or without entries, and entries written ahead", () => {
  const rows = lessonLog(
    ["2026-09-08", "2026-09-06"],
    [entry("2026-09-06", { homework: "ex" }), entry("2026-09-13")],
  );
  assert.deepEqual(
    rows.map((r) => [r.date, !!r.entry, r.held]),
    [
      ["2026-09-13", true, false],
      ["2026-09-08", false, true],
      ["2026-09-06", true, true],
    ],
  );
  assert.deepEqual(logCounters(rows), { held: 2, logged: 1, missing: 1, homework: 1, rate: 50 });
  assert.equal(logCounters([]).rate, null);
});

test("a chapter is covered when an entry references it or it is marked done", () => {
  const chapters: PedChapter[] = [
    { id: "c2", groupId: "g", title: "Deux", position: 2, completedOn: "2026-09-20" },
    { id: "c1", groupId: "g", title: "Un", position: 1, completedOn: null },
    { id: "c3", groupId: "g", title: "Trois", position: 3, completedOn: null },
  ];
  const rows = chapterCoverage(chapters, [
    entry("2026-09-08", { chapterId: "c1" }),
    entry("2026-09-01", { chapterId: "c1" }),
  ]);
  assert.deepEqual(
    rows.map((r) => [r.chapter.id, r.sessions, r.firstDate, r.lastDate, r.covered, r.done]),
    [
      ["c1", 2, "2026-09-01", "2026-09-08", true, false],
      ["c2", 0, null, null, true, true],
      ["c3", 0, null, null, false, false],
    ],
  );
  assert.equal(coverageRate(rows), 67);
  assert.equal(coverageRate([]), null);
});

test("the lesson-entry form requires a summary and keeps homework coherent", () => {
  const ok = { date: "2026-09-08", summary: "Cours", homework: "", homeworkDue: "" };
  assert.deepEqual(lessonEntryErrors(ok), {});
  assert.equal(lessonEntryErrors({ ...ok, summary: "  " }).summary, "lessonLog.error.summary");
  assert.equal(
    lessonEntryErrors({ ...ok, homeworkDue: "2026-09-10" }).homeworkDue,
    "lessonLog.error.dueWithoutHomework",
  );
  assert.equal(
    lessonEntryErrors({ ...ok, homework: "ex", homeworkDue: "2026-09-01" }).homeworkDue,
    "lessonLog.error.dueBefore",
  );
  assert.equal(lessonEntryErrors({ ...ok, date: "" }).date, "lessonLog.error.date");
});
