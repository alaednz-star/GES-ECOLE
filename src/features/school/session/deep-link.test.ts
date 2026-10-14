/**
 * Unit tests for deep-link parsing.
 *
 * Run with:  node --test src/features/school/session/deep-link.test.ts
 *
 * These params come from a URL, which means they are untrusted input: a stale
 * bookmark, a pasted link, a hand-edited query string. The contract is that
 * anything malformed is DROPPED and the calendar still opens -- never a thrown
 * validation error on the page whose only job is to show the schedule.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { parseAttendanceSearch, safeDate } from "./deep-link.ts";
import { sessionKey } from "./session-key.ts";

const GROUP = "3f8a1b2c-0000-4000-8000-000000000001";
const KEY = sessionKey(GROUP, "2026-08-08");

/* --------------------------------- date --------------------------------- */

test("date: a well-formed ISO date is accepted", () => {
  assert.deepEqual(parseAttendanceSearch({ date: "2026-08-08" }), { date: "2026-08-08" });
});

test("date: wrong shapes are dropped", () => {
  for (const bad of ["08-08-2026", "2026/08/08", "2026-8-8", "yesterday", "", "2026-08"]) {
    assert.deepEqual(parseAttendanceSearch({ date: bad }), {}, `expected ${bad} dropped`);
  }
});

test("date: well-formed but impossible dates are dropped", () => {
  // 2026-02-31 passes a shape test but `new Date` shifts it to 3 March, so the
  // calendar would open on a different week than the URL claims.
  for (const bad of ["2026-02-31", "2026-13-01", "2026-00-10", "2026-04-31", "2026-01-32"]) {
    assert.deepEqual(parseAttendanceSearch({ date: bad }), {}, `expected ${bad} dropped`);
  }
});

test("date: a real leap day is accepted, a fake one is not", () => {
  assert.deepEqual(parseAttendanceSearch({ date: "2028-02-29" }), { date: "2028-02-29" });
  assert.deepEqual(parseAttendanceSearch({ date: "2026-02-29" }), {});
});

test("date: non-string values are dropped", () => {
  for (const bad of [20260808, null, undefined, {}, []]) {
    assert.deepEqual(parseAttendanceSearch({ date: bad }), {});
  }
});

/* -------------------------------- session -------------------------------- */

test("session: a valid SessionKey is accepted", () => {
  assert.deepEqual(parseAttendanceSearch({ session: KEY }), { session: KEY });
});

test("session: malformed keys are dropped", () => {
  for (const bad of ["", "nopipe", "|", `${GROUP}|`, "|2026-08-08", 42, null]) {
    assert.deepEqual(parseAttendanceSearch({ session: bad }), {}, `expected ${bad} dropped`);
  }
});

test("session: validity is delegated to parseSessionKey, not re-implemented", () => {
  // Identity rules live in session-key.ts. This asserts the delegation holds, so
  // a change there cannot leave the URL layer accepting keys the app rejects.
  const odd = sessionKey("g1", "2026-08-08");
  assert.deepEqual(parseAttendanceSearch({ session: odd }), { session: odd });
});

/* --------------------------------- view --------------------------------- */

test("view: only week and month are accepted", () => {
  assert.deepEqual(parseAttendanceSearch({ view: "week" }), { view: "week" });
  assert.deepEqual(parseAttendanceSearch({ view: "month" }), { view: "month" });
  for (const bad of ["day", "agenda", "year", "", 1, true]) {
    assert.deepEqual(parseAttendanceSearch({ view: bad }), {}, `expected ${bad} dropped`);
  }
});

/* -------------------------------- toMark -------------------------------- */

test("toMark: accepts a real boolean and the string form", () => {
  // A typed <Link search> sends a boolean; a pasted URL sends "true".
  assert.deepEqual(parseAttendanceSearch({ toMark: true }), { toMark: true });
  assert.deepEqual(parseAttendanceSearch({ toMark: "true" }), { toMark: true });
});

test("toMark: anything else is absent rather than false", () => {
  // Omitted, not `false`: the object is serialised straight back into a URL, and
  // `?toMark=false` is noise that means the same as leaving it out.
  for (const bad of ["false", false, 0, 1, "yes", null, undefined]) {
    assert.deepEqual(parseAttendanceSearch({ toMark: bad }), {}, `expected ${bad} omitted`);
  }
});

/* ------------------------------- combined ------------------------------- */

test("all params together", () => {
  assert.deepEqual(
    parseAttendanceSearch({
      date: "2026-08-08",
      session: KEY,
      view: "month",
      toMark: true,
    }),
    { date: "2026-08-08", session: KEY, view: "month", toMark: true },
  );
});

test("an empty query yields an empty object", () => {
  assert.deepEqual(parseAttendanceSearch({}), {});
});

test("unknown params are ignored, not echoed back", () => {
  const out = parseAttendanceSearch({ date: "2026-08-08", evil: "<script>", page: 3 });
  assert.deepEqual(out, { date: "2026-08-08" });
});

test("one bad param does not discard the good ones", () => {
  // The whole point of dropping rather than throwing: a stale `view` should not
  // cost the user the session they were linked to.
  assert.deepEqual(parseAttendanceSearch({ session: KEY, view: "decade" }), { session: KEY });
});

test("absent keys are omitted, never set to undefined", () => {
  // `?date=undefined` in a URL would be a visible bug.
  const out = parseAttendanceSearch({ view: "week" });
  assert.deepEqual(Object.keys(out), ["view"]);
  assert.ok(!("date" in out));
  assert.ok(!("session" in out));
  assert.ok(!("toMark" in out));
});

test("parsing is idempotent -- output re-parses to itself", () => {
  const once = parseAttendanceSearch({
    date: "2026-08-08",
    session: KEY,
    view: "month",
    toMark: true,
  });
  assert.deepEqual(parseAttendanceSearch(once as Record<string, unknown>), once);
});

/* -------------------------------- safeDate -------------------------------- */

test("safeDate: passes a real date through", () => {
  assert.equal(safeDate("2026-08-08", "2026-01-01"), "2026-08-08");
});

test("safeDate: falls back for anything unusable", () => {
  for (const bad of [undefined, "", "not-a-date", "2026-02-31", "2026-13-01", "08/08/2026"]) {
    assert.equal(safeDate(bad, "2026-01-01"), "2026-01-01", `expected fallback for ${bad}`);
  }
});

test("REGRESSION: an unparseable anchor never reaches Intl", () => {
  // `?date=not-a-date` produced `RangeError: Invalid time value` from
  // Intl.DateTimeFormat and the dashboard error boundary replaced the whole
  // calendar with a load-failure message. Note `2026-02-31` did NOT crash -- it
  // parses to 3 March -- so only unparseable input exposed the gap.
  const anchor = safeDate("not-a-date", "2026-08-08");
  assert.doesNotThrow(() => {
    new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(
      new Date(anchor + "T00:00:00"),
    );
  });
  assert.equal(anchor, "2026-08-08");
});

test("safeDate agrees with parseAttendanceSearch on what a valid date is", () => {
  // Two layers, one rule. If they diverged, the router would accept a date the
  // component then rejects (or worse, the reverse).
  for (const v of ["2026-08-08", "2028-02-29", "not-a-date", "2026-02-31", "2026-13-01"]) {
    const accepted = parseAttendanceSearch({ date: v }).date !== undefined;
    const kept = safeDate(v, "FALLBACK") !== "FALLBACK";
    assert.equal(kept, accepted, `disagreement on ${v}`);
  }
});
