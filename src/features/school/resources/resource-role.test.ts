/**
 * The pedagogical role: its presentation and, more importantly, its ORDER.
 *
 * `roleWeight` decides what a student sees first inside a chapter, and the order is a
 * teaching decision rather than an arbitrary one -- notes before exercises before
 * solutions. A regression here would reorder every chapter in the product without
 * throwing anything, so the sequence is asserted explicitly rather than inferred.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { roleFace, roleOptions } from "./resource-role.ts";
import { RESOURCE_ROLES, roleWeight, type ResourceRole } from "./types.ts";

test("every role has a face, and none falls through to the default by accident", () => {
  for (const role of RESOURCE_ROLES) {
    const face = roleFace(role);
    assert.ok(face.labelKey.startsWith("resources.role."), role);
    assert.ok(face.shortKey.startsWith("resources.role."), role);
    assert.ok(face.className.length > 0, role);
    assert.equal(face.labelKey, `resources.role.${role}`, role);
  }
});

test("an unknown role degrades to `extra` rather than crashing", () => {
  // A row written by an older client, or a future enum value this build predates.
  const face = roleFace("not-a-role" as ResourceRole);
  assert.equal(face.labelKey, "resources.role.extra");
});

test("roleOptions offers all six roles, in the declared pedagogical order", () => {
  assert.equal(roleOptions.length, RESOURCE_ROLES.length);
  assert.deepEqual(
    roleOptions.map((o) => o.value),
    [...RESOURCE_ROLES],
  );
});

test("roleOptions labels agree with roleFace -- one source of truth", () => {
  for (const option of roleOptions) {
    assert.equal(option.labelKey, roleFace(option.value).labelKey, option.value);
  }
});

test("roleWeight orders a chapter the way it is taught", () => {
  // Notes first, then practice, then the answers; homework and extras last.
  const sorted = [...RESOURCE_ROLES].sort((a, b) => roleWeight(a) - roleWeight(b));
  assert.deepEqual(sorted, [...RESOURCE_ROLES], "declaration order IS the teaching order");
});

test("roleWeight is strictly increasing -- no two roles tie", () => {
  const weights = RESOURCE_ROLES.map(roleWeight);
  assert.equal(new Set(weights).size, weights.length, JSON.stringify(weights));
  for (let i = 1; i < weights.length; i++) {
    const previous = weights[i - 1] ?? -Infinity;
    const current = weights[i] ?? -Infinity;
    assert.ok(current > previous, `${RESOURCE_ROLES[i]} must sort after its predecessor`);
  }
});

test("roleWeight: solutions never sort above the exercises they answer", () => {
  // The one ordering rule a teacher would actually notice.
  assert.ok(roleWeight("exercises") < roleWeight("solutions"));
  assert.ok(roleWeight("notes") < roleWeight("exercises"));
});

test("roleWeight tolerates null and unknown values, and sorts them last", () => {
  const known = Math.max(...RESOURCE_ROLES.map(roleWeight));
  for (const bad of [null, undefined, "invented" as ResourceRole]) {
    assert.ok(roleWeight(bad) >= known, JSON.stringify(bad));
  }
});
