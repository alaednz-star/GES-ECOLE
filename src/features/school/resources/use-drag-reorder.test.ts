/**
 * The reorder maths, which is the part of drag-and-drop that can be wrong silently.
 *
 * `moveWithin` and `insertRelative` are exported from the hook file precisely so they can
 * be tested without a DOM: the hook holds the pointer bookkeeping, these two decide where
 * an item lands. A mistake here does not throw -- it writes a plausible-looking order to
 * the database, which is the kind of bug you only notice a week later when a chapter is
 * in the wrong place for everyone.
 *
 * The identity guarantee is tested as carefully as the ordering: both functions return the
 * SAME ARRAY REFERENCE when nothing moves, and `use-drag-reorder`'s callers rely on that to
 * skip a pointless write.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { moveWithin, insertRelative, type DropEdge } from "./use-drag-reorder.ts";

const ids = () => ["a", "b", "c", "d"];

/* ------------------------------------------------------------------ moveWithin */

test("moveWithin: forward, dropping after a later item", () => {
  assert.deepEqual(moveWithin(ids(), "a", "c", "after"), ["b", "c", "a", "d"]);
});

test("moveWithin: forward, dropping before a later item", () => {
  assert.deepEqual(moveWithin(ids(), "a", "c", "before"), ["b", "a", "c", "d"]);
});

test("moveWithin: backward, dropping before an earlier item", () => {
  assert.deepEqual(moveWithin(ids(), "d", "b", "before"), ["a", "d", "b", "c"]);
});

test("moveWithin: backward, dropping after an earlier item", () => {
  assert.deepEqual(moveWithin(ids(), "d", "b", "after"), ["a", "b", "d", "c"]);
});

test("moveWithin: to the very first position", () => {
  assert.deepEqual(moveWithin(ids(), "c", "a", "before"), ["c", "a", "b", "d"]);
});

test("moveWithin: to the very last position", () => {
  assert.deepEqual(moveWithin(ids(), "a", "d", "after"), ["b", "c", "d", "a"]);
});

test("moveWithin: a no-op move returns the SAME array reference", () => {
  // The caller skips the database write on reference equality, so this is behaviour,
  // not an optimisation detail.
  const list = ids();
  assert.equal(moveWithin(list, "a", "a", "before"), list);
  assert.equal(moveWithin(list, "b", "a", "after"), list, "dropping after its own predecessor");
  assert.equal(moveWithin(list, "a", "b", "before"), list, "dropping before its own successor");
});

test("moveWithin: an unknown active id changes nothing", () => {
  const list = ids();
  assert.equal(moveWithin(list, "zzz", "b", "before"), list);
});

test("moveWithin: an unknown target id changes nothing", () => {
  const list = ids();
  assert.equal(moveWithin(list, "a", "zzz", "before"), list);
});

test("moveWithin: never loses, duplicates or invents an item", () => {
  for (const active of ids()) {
    for (const over of ids()) {
      for (const edge of ["before", "after"] as DropEdge[]) {
        const next = moveWithin(ids(), active, over, edge);
        assert.deepEqual([...next].sort(), ids().sort(), `${active}->${over}/${edge}`);
      }
    }
  }
});

test("moveWithin: a single-item list cannot move", () => {
  const list = ["only"];
  assert.equal(moveWithin(list, "only", "only", "after"), list);
});

/* --------------------------------------------------------------- insertRelative */

test("insertRelative: inserts before the target", () => {
  assert.deepEqual(insertRelative(["a", "b"], "x", "b", "before"), ["a", "x", "b"]);
});

test("insertRelative: inserts after the target", () => {
  assert.deepEqual(insertRelative(["a", "b"], "x", "b", "after"), ["a", "b", "x"]);
});

test("insertRelative: a null target appends -- this is the empty-chapter drop", () => {
  // Dropping into a chapter that has no resources yet has nothing to aim at.
  assert.deepEqual(insertRelative([], "x", null, "before"), ["x"]);
  assert.deepEqual(insertRelative(["a"], "x", null, "before"), ["a", "x"]);
});

test("insertRelative: an unknown target appends rather than dropping the item", () => {
  // Losing the resource would be the worst outcome; the end of the list is recoverable.
  assert.deepEqual(insertRelative(["a", "b"], "x", "zzz", "before"), ["a", "b", "x"]);
});

test("insertRelative: moving an item already in the list does not duplicate it", () => {
  assert.deepEqual(insertRelative(["a", "b", "c"], "a", "c", "after"), ["b", "c", "a"]);
  assert.deepEqual(insertRelative(["a", "b", "c"], "c", "a", "before"), ["c", "a", "b"]);
});

test("insertRelative: the item always ends up present exactly once", () => {
  for (const over of ["a", "b", null, "zzz"]) {
    for (const edge of ["before", "after"] as DropEdge[]) {
      const next = insertRelative(["a", "b"], "x", over, edge);
      assert.equal(next.filter((id) => id === "x").length, 1, `${over}/${edge}`);
    }
  }
});
