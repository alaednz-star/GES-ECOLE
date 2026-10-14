/**
 * Which lifecycle actions an administrator is offered.
 *
 * The failure that matters is not an exception. It is a school with nobody able to sign in,
 * caused by one click on the wrong row, so the two protections -- the last administrator and
 * the caller's own account -- are tested from both directions: that they refuse when they
 * must, and that they do not refuse when they must not, because a rule that blocks everything
 * is also a broken rule.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  blockReason,
  isAllowed,
  offeredActions,
  type LifecycleContext,
  type LifecycleTarget,
} from "./admin-lifecycle-model.ts";

const ME = "viewer-1";

const target = (over: Partial<LifecycleTarget> = {}): LifecycleTarget => ({
  id: "other-admin",
  role: "admin",
  active: true,
  ...over,
});

const ctx = (over: Partial<LifecycleContext> = {}): LifecycleContext => ({
  viewerId: ME,
  activeAdminCount: 3,
  ...over,
});

/* ------------------------------------------------------ 1. the ordinary, allowed case */

test("another active administrator can be deactivated when others remain", () => {
  assert.equal(isAllowed(target(), "deactivate", ctx()), true);
  assert.equal(blockReason(target(), "deactivate", ctx()), null);
});

test("another administrator can be deleted when others remain", () => {
  assert.equal(isAllowed(target(), "delete", ctx()), true);
});

/* ---------------------------------------------------------- 2. self-action is refused */

test("an administrator cannot deactivate their own account", () => {
  assert.equal(blockReason(target({ id: ME }), "deactivate", ctx()), "self");
});

test("an administrator cannot delete their own account", () => {
  assert.equal(blockReason(target({ id: ME }), "delete", ctx()), "self");
});

test("the self rule holds even when the school has plenty of administrators", () => {
  assert.equal(blockReason(target({ id: ME }), "delete", ctx({ activeAdminCount: 9 })), "self");
});

/* ------------------------------------------------------- 3. the last administrator */

test("the last active administrator cannot be deactivated", () => {
  assert.equal(blockReason(target(), "deactivate", ctx({ activeAdminCount: 1 })), "lastAdmin");
});

test("the last active administrator cannot be deleted", () => {
  assert.equal(blockReason(target(), "delete", ctx({ activeAdminCount: 1 })), "lastAdmin");
});

test("two administrators means either one may go", () => {
  assert.equal(isAllowed(target(), "deactivate", ctx({ activeAdminCount: 2 })), true);
});

test("a deactivated administrator does not count towards the protection", () => {
  // The account is already unable to sign in, so removing it takes nobody away.
  assert.equal(isAllowed(target({ active: false }), "delete", ctx({ activeAdminCount: 1 })), true);
});

test("a teacher is never the last administrator, whatever the count", () => {
  const teacher = target({ role: "teacher" });
  assert.equal(isAllowed(teacher, "deactivate", ctx({ activeAdminCount: 1 })), true);
  assert.equal(isAllowed(teacher, "delete", ctx({ activeAdminCount: 1 })), true);
});

/* --------------------------------------------------------------- 4. reactivation */

test("reactivation is never blocked -- it can only add someone who can get in", () => {
  assert.equal(
    blockReason(target({ active: false }), "reactivate", ctx({ activeAdminCount: 0 })),
    null,
  );
  assert.equal(
    blockReason(target({ active: false, id: ME }), "reactivate", ctx({ activeAdminCount: 0 })),
    null,
    "not even the self rule applies: nothing is taken away",
  );
});

test("reactivating an account that is already active is meaningless, not forbidden", () => {
  assert.equal(blockReason(target({ active: true }), "reactivate", ctx()), "notApplicable");
});

test("deactivating an account that is already deactivated is meaningless too", () => {
  assert.equal(blockReason(target({ active: false }), "deactivate", ctx()), "notApplicable");
});

/* ------------------------------------------------------------ 5. what the menu shows */

test("an active administrator is offered deactivation and deletion, not reactivation", () => {
  assert.deepEqual(
    offeredActions(target(), ctx()).map((a) => a.action),
    ["deactivate", "delete"],
  );
});

test("a deactivated administrator is offered reactivation and deletion", () => {
  assert.deepEqual(
    offeredActions(target({ active: false }), ctx()).map((a) => a.action),
    ["reactivate", "delete"],
  );
});

test("a blocked action is still listed, carrying its reason", () => {
  const offered = offeredActions(target(), ctx({ activeAdminCount: 1 }));
  assert.deepEqual(offered, [
    { action: "deactivate", block: "lastAdmin" },
    { action: "delete", block: "lastAdmin" },
  ]);
});

test("your own row offers the actions, refusing both", () => {
  const offered = offeredActions(target({ id: ME }), ctx());
  assert.deepEqual(
    offered.map((a) => a.block),
    ["self", "self"],
  );
});

/* ------------------------------------------------------------------- 6. odd inputs */

test("a count that has already reached zero still refuses to go lower", () => {
  // Should not arise -- somebody is signed in to be asking -- but the arithmetic must not
  // wrap around into permitting the very thing it exists to prevent.
  assert.equal(blockReason(target(), "deactivate", ctx({ activeAdminCount: 0 })), "lastAdmin");
});
