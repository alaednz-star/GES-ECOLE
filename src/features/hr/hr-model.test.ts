/**
 * HR rules: validation mirroring the database, the availability/timetable comparison, and
 * the dashboard figures.
 *
 *   node --test src/features/hr/hr-model.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  availabilityOverlaps,
  formatMinutes,
  nextLeaveStatuses,
  slotsOutsideAvailability,
  summariseHr,
  validateAvailabilityDraft,
  validateContractDraft,
  validateEmployeeDraft,
  validateLeaveDraft,
  validateStaffAttendanceDraft,
  weekdayOf,
  weeklyTeachingMinutes,
  workedMinutes,
  type EmployeeDraft,
  type TeachingSlot,
} from "./hr-model.ts";

const TODAY = "2026-10-01";

const employee = (over: Partial<EmployeeDraft> = {}): EmployeeDraft => ({
  staffType: "teacher",
  employmentStatus: "active",
  position: "",
  department: "",
  employeeCode: "",
  startDate: "2026-09-01",
  endDate: "",
  address: "",
  dateOfBirth: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  notes: "",
  ...over,
});

/* ------------------------------------------------------------------ employee */

test("employee: a minimal file needs only a type, a status and a start date", () => {
  const r = validateEmployeeDraft(employee({ position: "  Enseignant de maths " }));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.values.position, "Enseignant de maths");
    assert.equal(r.values.endDate, null);
    assert.equal(r.values.notes, null);
  }
});

test("employee: dates must be real and ordered; ended needs an end date", () => {
  const inverted = validateEmployeeDraft(employee({ endDate: "2026-08-01" }));
  assert.equal(!inverted.ok && inverted.errors.dates, "hr.error.endBeforeStart");
  const ended = validateEmployeeDraft(employee({ employmentStatus: "ended" }));
  assert.equal(!ended.ok && ended.errors.dates, "hr.error.endedNeedsEnd");
  assert.equal(
    validateEmployeeDraft(employee({ employmentStatus: "ended", endDate: "2026-12-31" })).ok,
    true,
  );
  const bogus = validateEmployeeDraft(employee({ startDate: "2026-02-30" }));
  assert.equal(!bogus.ok && bogus.errors.dates, "hr.error.date");
});

test("employee: lengths and date of birth are bounded", () => {
  assert.equal(validateEmployeeDraft(employee({ position: "p".repeat(121) })).ok, false);
  assert.equal(validateEmployeeDraft(employee({ employeeCode: "c".repeat(41) })).ok, false);
  assert.equal(validateEmployeeDraft(employee({ notes: "n".repeat(2001) })).ok, false);
  assert.equal(validateEmployeeDraft(employee({ dateOfBirth: "1850-01-01" })).ok, false);
  assert.equal(validateEmployeeDraft(employee({ dateOfBirth: "1990-05-12" })).ok, true);
});

test("employee: unknown type or status is refused", () => {
  assert.equal(validateEmployeeDraft(employee({ staffType: "janitor" as never })).ok, false);
  assert.equal(validateEmployeeDraft(employee({ employmentStatus: "fired" as never })).ok, false);
});

/* ------------------------------------------------------------------ contract */

test("contract: fixed-term needs an end date; permanent does not", () => {
  const base = {
    workingTime: null,
    startDate: "2026-09-01",
    endDate: "",
    status: "active" as const,
    notes: "",
  };
  const fixed = validateContractDraft({ ...base, contractType: "fixed_term" });
  assert.equal(!fixed.ok && fixed.errors.dates, "hr.error.fixedTermNeedsEnd");
  assert.equal(
    validateContractDraft({ ...base, contractType: "fixed_term", endDate: "2027-06-30" }).ok,
    true,
  );
  assert.equal(validateContractDraft({ ...base, contractType: "permanent" }).ok, true);
});

test("contract: end before start and ended-without-end are refused", () => {
  const base = { contractType: "permanent" as const, workingTime: "part_time" as const, notes: "" };
  const inv = validateContractDraft({
    ...base,
    startDate: "2026-09-01",
    endDate: "2026-08-01",
    status: "active",
  });
  assert.equal(!inv.ok && inv.errors.dates, "hr.error.endBeforeStart");
  const ended = validateContractDraft({
    ...base,
    startDate: "2026-09-01",
    endDate: "",
    status: "ended",
  });
  assert.equal(!ended.ok && ended.errors.dates, "hr.error.endedNeedsEnd");
});

/* ------------------------------------------------------------------ availability */

test("availability: end must be after start", () => {
  const r = validateAvailabilityDraft(
    {
      weekday: 1,
      startTime: "12:00",
      endTime: "09:00",
      effectiveFrom: "",
      effectiveUntil: "",
      note: "",
    },
    [],
  );
  assert.equal(!r.ok && r.errors.times, "hr.error.endBeforeStartTime");
});

test("availability: overlapping ranges on the same day are refused, adjacent ones allowed", () => {
  const existing = [
    {
      id: "a",
      weekday: 1,
      startTime: "09:00",
      endTime: "12:00",
      effectiveFrom: null,
      effectiveUntil: null,
    },
  ];
  const overlap = validateAvailabilityDraft(
    {
      weekday: 1,
      startTime: "11:00",
      endTime: "13:00",
      effectiveFrom: "",
      effectiveUntil: "",
      note: "",
    },
    existing,
  );
  assert.equal(!overlap.ok && overlap.errors.overlap, "hr.error.availabilityOverlap");
  const adjacent = validateAvailabilityDraft(
    {
      weekday: 1,
      startTime: "12:00",
      endTime: "14:00",
      effectiveFrom: "",
      effectiveUntil: "",
      note: "",
    },
    existing,
  );
  assert.equal(adjacent.ok, true);
  const otherDay = validateAvailabilityDraft(
    {
      weekday: 2,
      startTime: "09:00",
      endTime: "12:00",
      effectiveFrom: "",
      effectiveUntil: "",
      note: "",
    },
    existing,
  );
  assert.equal(otherDay.ok, true);
});

test("availability: disjoint effective windows do not overlap; editing a slot ignores itself", () => {
  const existing = [
    {
      id: "a",
      weekday: 1,
      startTime: "09:00",
      endTime: "12:00",
      effectiveFrom: "2026-01-01",
      effectiveUntil: "2026-06-30",
    },
  ];
  assert.equal(
    availabilityOverlaps(
      {
        weekday: 1,
        startTime: "09:00",
        endTime: "12:00",
        effectiveFrom: "2026-09-01",
        effectiveUntil: null,
      },
      existing,
    ),
    false,
  );
  assert.equal(
    availabilityOverlaps(
      {
        id: "a",
        weekday: 1,
        startTime: "09:30",
        endTime: "12:00",
        effectiveFrom: "2026-01-01",
        effectiveUntil: "2026-06-30",
      },
      existing,
    ),
    false,
  );
});

/* ------------------------------------------------------------------ staff attendance */

test("attendance: present needs a check-in; check-out must follow it", () => {
  const base = { workDate: TODAY, note: "" };
  const noIn = validateStaffAttendanceDraft(
    { ...base, status: "present", checkIn: "", checkOut: "" },
    TODAY,
  );
  assert.equal(!noIn.ok && noIn.errors.times, "hr.error.checkInRequired");
  const backwards = validateStaffAttendanceDraft(
    { ...base, status: "present", checkIn: "12:00", checkOut: "08:30" },
    TODAY,
  );
  assert.equal(!backwards.ok && backwards.errors.times, "hr.error.checkOutBeforeIn");
  const open = validateStaffAttendanceDraft(
    { ...base, status: "late", checkIn: "08:45", checkOut: "" },
    TODAY,
  );
  assert.equal(open.ok && open.values.checkOut, null);
});

test("attendance: absent or leave carries no times; future dates are refused", () => {
  const away = validateStaffAttendanceDraft(
    { workDate: TODAY, status: "absent", checkIn: "08:00", checkOut: "", note: "" },
    TODAY,
  );
  assert.equal(!away.ok && away.errors.times, "hr.error.noTimesWhenAway");
  assert.equal(
    validateStaffAttendanceDraft(
      { workDate: TODAY, status: "leave", checkIn: "", checkOut: "", note: "" },
      TODAY,
    ).ok,
    true,
  );
  const future = validateStaffAttendanceDraft(
    { workDate: "2026-10-02", status: "absent", checkIn: "", checkOut: "", note: "" },
    TODAY,
  );
  assert.equal(!future.ok && future.errors.workDate, "hr.error.future");
});

test("worked minutes mirror the generated column", () => {
  assert.equal(workedMinutes("08:30", "12:00"), 210);
  assert.equal(workedMinutes("08:30", null), null);
  assert.equal(workedMinutes("12:00", "08:00"), null);
});

/* ------------------------------------------------------------------ leave */

test("leave: dates required and ordered; decisions only from pending", () => {
  assert.equal(
    validateLeaveDraft({
      leaveType: "annual",
      startDate: "2026-10-10",
      endDate: "2026-10-05",
      note: "",
    }).ok,
    false,
  );
  assert.equal(
    validateLeaveDraft({
      leaveType: "sick",
      startDate: "2026-10-10",
      endDate: "2026-10-10",
      note: "",
    }).ok,
    true,
  );
  assert.equal(
    validateLeaveDraft({
      leaveType: "vacation" as never,
      startDate: "2026-10-10",
      endDate: "2026-10-11",
      note: "",
    }).ok,
    false,
  );
  assert.deepEqual([...nextLeaveStatuses("pending")], ["approved", "rejected", "cancelled"]);
  assert.deepEqual([...nextLeaveStatuses("approved")], ["cancelled"]);
  assert.deepEqual([...nextLeaveStatuses("rejected")], []);
});

/* ------------------------------------------------------------------ timetable */

const slot = (
  weekday: number,
  startTime: string,
  endTime: string,
  groupStatus = "active",
): TeachingSlot => ({
  groupId: `g${weekday}${startTime}`,
  groupName: "G",
  groupStatus,
  weekday,
  startTime,
  endTime,
});

test("weekly teaching minutes count active groups only", () => {
  assert.equal(
    weeklyTeachingMinutes([
      slot(1, "14:00", "16:00"),
      slot(3, "09:00", "10:30"),
      slot(4, "08:00", "12:00", "inactive"),
    ]),
    210,
  );
});

test("slots outside availability are reported; no availability declared means no conflict", () => {
  const slots = [slot(1, "14:00", "16:00"), slot(2, "09:00", "11:00")];
  const availability = [
    { weekday: 1, startTime: "13:00", endTime: "18:00", effectiveFrom: null, effectiveUntil: null },
  ];
  const out = slotsOutsideAvailability(slots, availability, TODAY);
  assert.deepEqual(
    out.map((s) => s.weekday),
    [2],
  );
  assert.deepEqual(slotsOutsideAvailability(slots, [], TODAY), []);
});

test("availability that is not yet effective does not count", () => {
  const slots = [slot(1, "14:00", "16:00")];
  const future = [
    {
      weekday: 1,
      startTime: "13:00",
      endTime: "18:00",
      effectiveFrom: "2027-01-01",
      effectiveUntil: null,
    },
  ];
  assert.deepEqual(slotsOutsideAvailability(slots, future, TODAY), []);
});

/* ------------------------------------------------------------------ dashboard */

test("summary: counts only what the records say", () => {
  const s = summariseHr(
    {
      employees: [
        { id: "e1", staffType: "teacher", employmentStatus: "active" },
        { id: "e2", staffType: "trainer", employmentStatus: "on_leave" },
        { id: "e3", staffType: "administrative", employmentStatus: "active" },
        { id: "e4", staffType: "teacher", employmentStatus: "ended" },
      ],
      activeContracts: [
        { employeeId: "e1", endDate: addDays(TODAY, 10) },
        { employeeId: "e2", endDate: addDays(TODAY, 45) },
        { employeeId: "e3", endDate: null },
      ],
      approvedLeaves: [
        { employeeId: "e3", startDate: "2026-09-30", endDate: "2026-10-03" },
        { employeeId: "e4", startDate: "2026-09-30", endDate: "2026-10-03" },
      ],
      attendanceThisMonth: [
        { employeeId: "e1", workDate: TODAY, status: "present", workedMinutes: 210 },
        { employeeId: "e3", workDate: TODAY, status: "late", workedMinutes: null },
        { employeeId: "e1", workDate: "2026-09-30", status: "present", workedMinutes: 480 },
      ],
    },
    TODAY,
  );
  assert.deepEqual(s, {
    activeEmployees: 3,
    teachers: 1,
    trainers: 1,
    onLeaveToday: 2,
    contractsExpiringSoon: 1,
    attendanceRecordedToday: 2,
    minutesWorkedThisMonth: 210,
  });
});

test("helpers: weekday, date arithmetic and duration formatting", () => {
  assert.equal(weekdayOf("2026-10-01"), 4);
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(formatMinutes(210), "3h30");
  assert.equal(formatMinutes(480), "8h");
  assert.equal(formatMinutes(-5), "0h");
});
