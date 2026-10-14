/**
 * Group form rules.
 *
 *   node --test src/features/school/group-model.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { placesLeft, validateGroupDraft } from "./group-model.ts";

const draft = (over = {}) => ({
  name: "English C1 — Groupe A",
  startDate: "2026-11-01",
  endDate: "2026-11-30",
  streamId: null,
  schedules: [{ weekday: 6 }, { weekday: 1 }],
  ...over,
});
const noStream = { streamRequired: false };

test("a complete group draft is valid", () => {
  assert.equal(validateGroupDraft(draft(), noStream), null);
});

test("the name is required", () => {
  assert.equal(validateGroupDraft(draft({ name: "   " }), noStream), "form.groups.nameRequired");
});

test("a stream is required only when the level offers streams", () => {
  assert.equal(validateGroupDraft(draft(), { streamRequired: true }), "form.groups.streamRequired");
  assert.equal(validateGroupDraft(draft({ streamId: "s1" }), { streamRequired: true }), null);
});

test("the term needs a start, and its end cannot precede it", () => {
  assert.equal(
    validateGroupDraft(draft({ startDate: "" }), noStream),
    "form.groups.startDateRequired",
  );
  assert.equal(
    validateGroupDraft(draft({ endDate: "2026-10-01" }), noStream),
    "form.groups.endBeforeStart",
  );
  assert.equal(validateGroupDraft(draft({ endDate: null }), noStream), null);
});

test("a group meets at most once per weekday", () => {
  assert.equal(
    validateGroupDraft(draft({ schedules: [{ weekday: 2 }, { weekday: 2 }] }), noStream),
    "form.groups.oneSessionPerDay",
  );
  assert.equal(validateGroupDraft(draft({ schedules: [] }), noStream), null);
});

test("places left never go negative", () => {
  assert.equal(placesLeft({ maxStudents: 20, enrolled: 12 }), 8);
  assert.equal(placesLeft({ maxStudents: 10, enrolled: 12 }), 0);
});
