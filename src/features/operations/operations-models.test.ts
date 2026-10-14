/**
 * School operations models (ADR-007): timetable layout and conflicts, room load, statistics.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  WEEK_ORDER,
  buildTimetable,
  hourRange,
  roomWeeklyHours,
  teacherConflicts,
  type TimetableGroup,
} from "./timetable-model.ts";
import { attendanceRate, buildStats } from "./stats-model.ts";

const group = (id: string, over: Partial<TimetableGroup> = {}): TimetableGroup => ({
  id,
  name: `G ${id}`,
  status: "active",
  teacherId: "t1",
  teacherName: "Karim",
  levelId: "l1",
  levelName: "3AS",
  subjectName: "Maths",
  subjectColor: null,
  programName: null,
  schedules: [],
  ...over,
});

test("the week starts on Saturday", () => {
  assert.deepEqual([...WEEK_ORDER], [6, 0, 1, 2, 3, 4, 5]);
});

test("filters by group, teacher, room and level; inactive groups are left out", () => {
  const groups = [
    group("a", {
      schedules: [
        { id: "s1", weekday: 0, startTime: "10:00", endTime: "11:00", room: "A1", roomId: "r1" },
      ],
    }),
    group("b", {
      teacherId: "t2",
      levelId: "l2",
      schedules: [
        { id: "s2", weekday: 0, startTime: "10:00", endTime: "11:00", room: "B1", roomId: "r2" },
      ],
    }),
    group("c", {
      status: "inactive",
      schedules: [{ id: "s3", weekday: 1, startTime: "08:00", endTime: "09:00", room: null }],
    }),
  ];
  assert.equal(buildTimetable(groups, { view: "all", id: null }).length, 2);
  assert.deepEqual(
    buildTimetable(groups, { view: "group", id: "b" }).map((b) => b.slotId),
    ["s2"],
  );
  assert.deepEqual(
    buildTimetable(groups, { view: "teacher", id: "t1" }).map((b) => b.slotId),
    ["s1"],
  );
  assert.deepEqual(
    buildTimetable(groups, { view: "room", id: "r2" }).map((b) => b.slotId),
    ["s2"],
  );
  assert.deepEqual(
    buildTimetable(groups, { view: "level", id: "l2" }).map((b) => b.slotId),
    ["s2"],
  );
});

test("overlapping blocks on one day share lanes; separate ones keep the full width", () => {
  const groups = [
    group("a", {
      schedules: [{ id: "s1", weekday: 2, startTime: "10:00", endTime: "12:00", room: null }],
    }),
    group("b", {
      schedules: [{ id: "s2", weekday: 2, startTime: "11:00", endTime: "13:00", room: null }],
    }),
    group("c", {
      schedules: [{ id: "s3", weekday: 2, startTime: "14:00", endTime: "15:00", room: null }],
    }),
  ];
  const blocks = buildTimetable(groups, { view: "all", id: null });
  const by = (id: string) => blocks.find((b) => b.slotId === id);
  assert.deepEqual([by("s1")?.lane, by("s1")?.lanes], [0, 2]);
  assert.deepEqual([by("s2")?.lane, by("s2")?.lanes], [1, 2]);
  assert.deepEqual([by("s3")?.lane, by("s3")?.lanes], [0, 1]);
  assert.deepEqual(hourRange(blocks), { from: 8, to: 15 });
});

test("a teacher in two places at once is a conflict", () => {
  const conflicts = teacherConflicts([
    group("a", {
      schedules: [{ id: "s1", weekday: 3, startTime: "10:00", endTime: "11:30", room: null }],
    }),
    group("b", {
      schedules: [{ id: "s2", weekday: 3, startTime: "11:00", endTime: "12:00", room: null }],
    }),
    group("c", {
      schedules: [{ id: "s3", weekday: 3, startTime: "11:30", endTime: "12:30", room: null }],
    }),
  ]);
  assert.equal(conflicts.length, 2);
  assert.ok(conflicts.every((c) => c.teacherName === "Karim"));
});

test("weekly hours per room", () => {
  const load = roomWeeklyHours([
    group("a", {
      schedules: [
        { id: "s1", weekday: 0, startTime: "10:00", endTime: "11:30", room: "A1", roomId: "r1" },
        { id: "s2", weekday: 2, startTime: "10:00", endTime: "11:00", room: "A1", roomId: "r1" },
      ],
    }),
  ]);
  assert.deepEqual(load.get("r1"), { hours: 2.5, slots: 2 });
});

test("attendance rate counts late as attended and leaves excused out", () => {
  assert.equal(attendanceRate({ present: 6, late: 2, excused: 2, total: 10 }), 100);
  assert.equal(attendanceRate({ present: 3, late: 0, excused: 0, total: 4 }), 75);
  assert.equal(attendanceRate({ present: 0, late: 0, excused: 2, total: 2 }), null);
});

test("school statistics: students, enrollments, fill rates, teacher load", () => {
  const s = buildStats(
    [
      { id: "s1", status: "active", registeredAt: "2026-10-02T00:00:00Z" },
      { id: "s2", status: "active", registeredAt: "2026-09-02T00:00:00Z" },
      { id: "s3", status: "inactive", registeredAt: "2026-01-02T00:00:00Z" },
    ],
    [
      {
        id: "r1",
        studentId: "s1",
        groupId: "g1",
        status: "approved",
        createdAt: "2026-10-03T00:00:00Z",
      },
      {
        id: "r2",
        studentId: "s2",
        groupId: "g1",
        status: "approved",
        createdAt: "2026-09-03T00:00:00Z",
      },
      {
        id: "r3",
        studentId: "s2",
        groupId: "g2",
        status: "pending",
        createdAt: "2026-10-04T00:00:00Z",
      },
    ],
    [
      {
        id: "g1",
        name: "Anglais",
        status: "active",
        maxStudents: 10,
        enrolled: 2,
        programName: "Anglais A2",
        levelName: "A2",
        teacherId: "t1",
        teacherName: "Karim",
        schedules: [
          { startTime: "10:00", endTime: "11:30" },
          { startTime: "14:00", endTime: "15:00" },
        ],
      },
      {
        id: "g2",
        name: "Maths",
        status: "active",
        maxStudents: 5,
        enrolled: 5,
        programName: null,
        levelName: "3AS",
        teacherId: "t1",
        teacherName: "Karim",
        schedules: [{ startTime: "09:00", endTime: "10:00" }],
      },
    ],
    [
      { month: "2026-09-01", groupId: "g1", present: 8, late: 1, excused: 1, absent: 0, total: 10 },
      { month: "2026-10-01", groupId: "g1", present: 3, late: 0, excused: 0, absent: 1, total: 4 },
    ],
    "2026-10-15",
  );
  assert.deepEqual(s.students, { total: 3, active: 2, newThisMonth: 1 });
  assert.deepEqual(s.enrollments, { active: 2, pending: 1, newThisMonth: 1 });
  assert.deepEqual(s.groups, { active: 2, seats: 15, enrolled: 7, fillRate: 47 });
  assert.equal(s.fill[0]?.name, "Maths");
  assert.deepEqual(s.teacherLoad, [{ name: "Karim", hours: 3.5, groups: 2 }]);
  assert.deepEqual(
    s.attendanceByMonth.map((m) => m.rate),
    [100, 75],
  );
  assert.equal(s.attendance.rate, 92);
});
