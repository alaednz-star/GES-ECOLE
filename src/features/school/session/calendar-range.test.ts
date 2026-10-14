/**
 * Unit tests for the calendar window arithmetic.
 *
 * Run with:  node --test src/features/school/session/calendar-range.test.ts
 *
 * These are the cases that break silently in a calendar: month rollovers, leap
 * days, 31st→30th clamping, and the 6-week grid that must span beyond the month
 * edges or sessions on trailing/leading days vanish.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  addDays,
  addMonths,
  endOfMonth,
  fromIso,
  isSameMonth,
  monthGrid,
  startOfMonth,
  startOfWeek,
  step,
  toIso,
  weekDays,
  windowFor,
} from "./calendar-range.ts";

/* ------------------------------ conversions ------------------------------ */

test("toIso / fromIso round-trip in LOCAL time", () => {
  const iso = "2026-08-08";
  assert.equal(toIso(fromIso(iso)), iso);
});

test("fromIso parses local midnight, not UTC", () => {
  // The bug this guards: `new Date("2026-08-08")` is UTC midnight, which is the
  // 7th in any timezone west of Greenwich. Explicit local construction avoids
  // the whole class of off-by-one-day errors.
  const d = fromIso("2026-08-08");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7);
  assert.equal(d.getDate(), 8);
  assert.equal(d.getHours(), 0);
});

/* -------------------------------- addDays -------------------------------- */

test("addDays crosses month boundaries", () => {
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(addDays("2026-09-01", -1), "2026-08-31");
});

test("addDays crosses year boundaries", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2027-01-01", -1), "2026-12-31");
});

test("addDays handles a leap day", () => {
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2028-02-29", 1), "2028-03-01");
  // 2026 is not a leap year.
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
});

/* ------------------------------- addMonths ------------------------------- */

test("addMonths clamps the day instead of overflowing", () => {
  // Naive month arithmetic turns 31 Jan + 1 month into 3 March.
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(addMonths("2026-05-31", 1), "2026-06-30");
});

test("addMonths crosses years", () => {
  assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
  assert.equal(addMonths("2026-01-15", -1), "2025-12-15");
});

/* ------------------------------ week bounds ------------------------------ */

test("startOfWeek returns Monday by default", () => {
  // 2026-08-08 is a Saturday.
  assert.equal(fromIso("2026-08-08").getDay(), 6);
  assert.equal(startOfWeek("2026-08-08"), "2026-08-03");
  // Monday maps to itself.
  assert.equal(startOfWeek("2026-08-03"), "2026-08-03");
  // Sunday belongs to the week that began the previous Monday.
  assert.equal(startOfWeek("2026-08-09"), "2026-08-03");
});

test("startOfWeek honours a different week start", () => {
  // Sunday-start (0): the Saturday belongs to the week beginning 2026-08-02.
  assert.equal(startOfWeek("2026-08-08", 0), "2026-08-02");
  // Saturday-start (6): the Saturday IS the start.
  assert.equal(startOfWeek("2026-08-08", 6), "2026-08-08");
});

test("weekDays returns seven consecutive dates from the week start", () => {
  const days = weekDays("2026-08-08");
  assert.equal(days.length, 7);
  assert.equal(days[0], "2026-08-03");
  assert.equal(days[6], "2026-08-09");
  for (let i = 1; i < days.length; i++) {
    assert.equal(days[i], addDays(days[i - 1] as string, 1));
  }
});

/* ----------------------------- month bounds ----------------------------- */

test("startOfMonth and endOfMonth", () => {
  assert.equal(startOfMonth("2026-08-08"), "2026-08-01");
  assert.equal(endOfMonth("2026-08-08"), "2026-08-31");
  assert.equal(endOfMonth("2026-02-10"), "2026-02-28");
  assert.equal(endOfMonth("2028-02-10"), "2028-02-29");
  assert.equal(endOfMonth("2026-04-10"), "2026-04-30");
});

/* ------------------------------- windowFor ------------------------------- */

test("windowFor week spans exactly seven days, inclusive", () => {
  const w = windowFor("2026-08-08", "week");
  assert.deepEqual(w, { from: "2026-08-03", to: "2026-08-09" });
});

test("windowFor month spans the whole 6-week grid, not just the month", () => {
  // August 2026 starts on a Saturday, so the grid must reach back into July.
  // Stopping at the month edge would hide sessions on the visible trailing days.
  const w = windowFor("2026-08-08", "month");
  assert.equal(w.from, "2026-07-27", "grid starts on the Monday before 1 August");
  assert.equal(w.to, addDays(w.from, 41), "grid covers 42 days");
  assert.ok(w.from < "2026-08-01", "window reaches before the month starts");
  assert.ok(w.to > "2026-08-31", "window reaches past the month end");
});

test("windowFor month always covers every day of the month", () => {
  // Any month, any start weekday: the 6-week grid must contain the whole month.
  for (const anchor of [
    "2026-01-15",
    "2026-02-15",
    "2026-03-15",
    "2026-08-15",
    "2026-11-15",
    "2028-02-15",
  ]) {
    const w = windowFor(anchor, "month");
    assert.ok(w.from <= startOfMonth(anchor), `${anchor}: grid starts before the 1st`);
    assert.ok(w.to >= endOfMonth(anchor), `${anchor}: grid ends after the last day`);
  }
});

/* ------------------------------- monthGrid ------------------------------- */

test("monthGrid is always exactly 42 consecutive cells", () => {
  for (const anchor of ["2026-02-01", "2026-08-08", "2028-02-29"]) {
    const cells = monthGrid(anchor);
    assert.equal(cells.length, 42, `${anchor}: fixed height`);
    for (let i = 1; i < cells.length; i++) {
      assert.equal(cells[i], addDays(cells[i - 1] as string, 1), `${anchor}: consecutive`);
    }
  }
});

test("monthGrid begins on the configured week start", () => {
  const cells = monthGrid("2026-08-08");
  assert.equal(fromIso(cells[0] as string).getDay(), 1, "first cell is a Monday");
});

test("isSameMonth distinguishes in-month from adjacent-month cells", () => {
  assert.equal(isSameMonth("2026-08-01", "2026-08-08"), true);
  assert.equal(isSameMonth("2026-07-31", "2026-08-08"), false);
  assert.equal(isSameMonth("2026-09-01", "2026-08-08"), false);
  // Same month number, different year, must not match.
  assert.equal(isSameMonth("2025-08-08", "2026-08-08"), false);
});

/* --------------------------------- step --------------------------------- */

test("step moves a week at a time in week view", () => {
  assert.equal(step("2026-08-08", "week", 1), "2026-08-15");
  assert.equal(step("2026-08-08", "week", -1), "2026-08-01");
});

test("step moves a month at a time in month view", () => {
  assert.equal(step("2026-08-08", "month", 1), "2026-09-08");
  assert.equal(step("2026-08-08", "month", -1), "2026-07-08");
});

test("step is reversible across boundaries", () => {
  for (const [anchor, view] of [
    ["2026-12-28", "week"],
    ["2026-01-04", "week"],
    ["2026-12-15", "month"],
    ["2026-06-15", "month"],
  ] as const) {
    assert.equal(step(step(anchor, view, 1), view, -1), anchor, `${anchor} ${view}`);
  }
});

test("step in month view stays within the intended month after clamping", () => {
  // 31 Aug -> Sep has only 30 days. Stepping forward then back must not drift
  // further than the clamp itself, and must never land in the wrong month.
  const fwd = step("2026-08-31", "month", 1);
  assert.equal(fwd, "2026-09-30");
  assert.equal(fwd.slice(0, 7), "2026-09");
});

test("stepping a week never changes the weekday", () => {
  const anchor = "2026-08-08";
  const start = fromIso(anchor).getDay();
  let cursor = anchor;
  for (let i = 0; i < 10; i++) {
    cursor = step(cursor, "week", 1);
    assert.equal(fromIso(cursor).getDay(), start, `after ${i + 1} weeks`);
  }
});
