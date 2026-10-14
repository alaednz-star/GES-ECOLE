/**
 * Unit tests for the drawer's keyboard rules.
 *
 * Run with:  node --test src/features/school/session/keyboard.test.ts
 *
 * These decide what happens to real attendance data on a keypress, so the edge
 * cases matter more than they look: wrapping instead of clamping would re-mark a
 * student who was already done, and a locale stealing a Latin shortcut would set
 * the wrong status entirely.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildKeyMap, nextRow, targetRow, LATIN_KEYS, STATUS_ORDER } from "./keyboard.ts";

/** Stand-ins for the real dictionaries. */
const FR = { present: "P", absent: "A", late: "R", excused: "E" } as const;
const EN = { present: "P", absent: "A", late: "L", excused: "E" } as const;
const AR = { present: "ح", absent: "غ", late: "م", excused: "ع" } as const;

/* ------------------------------- buildKeyMap ------------------------------- */

test("Latin shortcuts work in every locale", () => {
  // A teacher on an Arabic UI is still on a Latin keyboard.
  for (const codes of [FR, EN, AR]) {
    const map = buildKeyMap((s) => codes[s]);
    assert.equal(map.get("p"), "present");
    assert.equal(map.get("a"), "absent");
    assert.equal(map.get("r"), "late");
    assert.equal(map.get("e"), "excused");
  }
});

test("localised codes are accepted IN ADDITION, not instead", () => {
  const ar = buildKeyMap((s) => AR[s]);
  assert.equal(ar.get("ح"), "present");
  assert.equal(ar.get("غ"), "absent");
  assert.equal(ar.get("م"), "late");
  assert.equal(ar.get("ع"), "excused");
  // ...and the Latin ones still resolve.
  assert.equal(ar.get("p"), "present");
});

test("English 'L' for late is accepted alongside the Latin 'r'", () => {
  const en = buildKeyMap((s) => EN[s]);
  assert.equal(en.get("l"), "late");
  assert.equal(en.get("r"), "late");
});

test("a locale cannot steal a Latin shortcut from another status", () => {
  // Pathological dictionary: `excused` claims "a", already owned by `absent`.
  const map = buildKeyMap((s) => (s === "excused" ? "A" : LATIN_KEYS[s].toUpperCase()));
  assert.equal(map.get("a"), "absent", "absent must keep its shortcut");
  assert.equal(map.get("e"), "excused", "excused keeps its own Latin key");
});

test("codes are matched case-insensitively", () => {
  const map = buildKeyMap((s) => FR[s]);
  // The handler lowercases the pressed key; the map must be keyed to match.
  assert.equal(map.get("p"), "present");
  assert.equal(map.get("P"), undefined, "map is lowercase-keyed by design");
});

test("an empty or whitespace code is ignored rather than mapped", () => {
  const map = buildKeyMap((s) => (s === "late" ? "   " : FR[s]));
  assert.equal(map.get("r"), "late", "falls back to the Latin key");
  assert.equal(map.get(""), undefined);
  assert.equal(map.get(" "), undefined);
});

test("every status is reachable", () => {
  const map = buildKeyMap((s) => FR[s]);
  const reached = new Set([...map.values()]);
  assert.equal(reached.size, STATUS_ORDER.length);
  for (const s of STATUS_ORDER) assert.ok(reached.has(s), `${s} unreachable`);
});

test("an unbound key maps to nothing", () => {
  const map = buildKeyMap((s) => FR[s]);
  for (const k of ["z", "1", "enter", "", "?"]) {
    assert.equal(map.get(k), undefined, `${k} should not map`);
  }
});

/* -------------------------------- nextRow -------------------------------- */

test("nextRow advances and retreats", () => {
  assert.equal(nextRow(0, 1, 5), 1);
  assert.equal(nextRow(3, -1, 5), 2);
});

test("REGRESSION: nextRow CLAMPS, never wraps", () => {
  // Wrapping from the last student to the first would silently re-mark someone
  // already done -- a data error, not a navigation quirk.
  assert.equal(nextRow(4, 1, 5), 4, "does not wrap past the end");
  assert.equal(nextRow(0, -1, 5), 0, "does not wrap before the start");
});

test("nextRow: an unfocused list starts at row 0 in either direction", () => {
  assert.equal(nextRow(-1, 1, 5), 0);
  assert.equal(nextRow(-1, -1, 5), 0);
});

test("nextRow on an empty roster stays unfocused", () => {
  assert.equal(nextRow(-1, 1, 0), -1);
  assert.equal(nextRow(0, 1, 0), -1);
});

test("nextRow handles a single-student roster", () => {
  assert.equal(nextRow(-1, 1, 1), 0);
  assert.equal(nextRow(0, 1, 1), 0);
  assert.equal(nextRow(0, -1, 1), 0);
});

/* -------------------------------- targetRow -------------------------------- */

test("targetRow defaults to the first row when nothing is focused", () => {
  assert.equal(targetRow(-1, 5), 0);
});

test("targetRow returns the focused row", () => {
  assert.equal(targetRow(2, 5), 2);
});

test("targetRow clamps a stale index after the roster shrinks", () => {
  // The roster can change under the drawer (a student unenrolled while it is
  // open); a stale index must not read past the end.
  assert.equal(targetRow(9, 3), 2);
});

test("targetRow on an empty roster marks nothing", () => {
  assert.equal(targetRow(-1, 0), -1);
  assert.equal(targetRow(3, 0), -1);
});

/* ------------------------------- integration ------------------------------- */

test("a full keyboard run marks every student exactly once", () => {
  // The core interaction: press P four times down a roster of four.
  const roster = ["s1", "s2", "s3", "s4"];
  const marks: Record<string, string> = {};
  let focus = -1;
  for (let i = 0; i < roster.length; i++) {
    const idx = targetRow(focus, roster.length);
    marks[roster[idx] as string] = "present";
    focus = nextRow(idx, 1, roster.length);
  }
  assert.deepEqual(marks, { s1: "present", s2: "present", s3: "present", s4: "present" });
});

test("pressing past the end re-marks only the last student, never the first", () => {
  const roster = ["s1", "s2"];
  const order: string[] = [];
  let focus = -1;
  for (let i = 0; i < 4; i++) {
    const idx = targetRow(focus, roster.length);
    order.push(roster[idx] as string);
    focus = nextRow(idx, 1, roster.length);
  }
  assert.deepEqual(order, ["s1", "s2", "s2", "s2"]);
  assert.ok(!order.slice(2).includes("s1"), "must not cycle back to the first student");
});
