/**
 * Desktop offline model (ADR-010): the whitelist, the refusal rule, the pending summary.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFLINE_MUTATIONS,
  isOfflineCapable,
  mustRefuseOffline,
  offlineKind,
  summarize,
  type MutationSnapshot,
} from "./offline-model.ts";

test("only the classroom actions may wait for the connection", () => {
  assert.equal(isOfflineCapable(OFFLINE_MUTATIONS.attendance), true);
  assert.equal(isOfflineCapable(OFFLINE_MUTATIONS.lessonEntry), true);
  assert.equal(isOfflineCapable(OFFLINE_MUTATIONS.scores), true);
  assert.equal(isOfflineCapable(OFFLINE_MUTATIONS.message), true);
  assert.equal(isOfflineCapable(["payments", "create"]), false);
  assert.equal(isOfflineCapable(undefined), false);
});

test("offline, every other write is refused at once; online, nothing is", () => {
  assert.equal(mustRefuseOffline(false, ["payments", "create"]), true);
  assert.equal(mustRefuseOffline(false, undefined), true);
  assert.equal(mustRefuseOffline(false, OFFLINE_MUTATIONS.sessionAttendance), false);
  assert.equal(mustRefuseOffline(true, ["payments", "create"]), false);
});

test("the kind of a queued write is read from its key", () => {
  assert.equal(offlineKind(OFFLINE_MUTATIONS.scores), "scores");
  assert.equal(offlineKind(["offline", "unknown"]), null);
  assert.equal(offlineKind(["payments"]), null);
});

test("the summary counts waiting writes by kind and the ones refused on replay", () => {
  const m = (key: readonly unknown[] | undefined, status: MutationSnapshot["status"], isPaused = false): MutationSnapshot => ({
    key,
    status,
    isPaused,
    submittedAt: 0,
  });
  const s = summarize([
    m(OFFLINE_MUTATIONS.attendance, "pending", true),
    m(OFFLINE_MUTATIONS.attendance, "pending", true),
    m(OFFLINE_MUTATIONS.message, "pending", true),
    m(OFFLINE_MUTATIONS.lessonEntry, "error"),
    m(OFFLINE_MUTATIONS.scores, "success"),
    m(["payments"], "pending"),
  ]);
  assert.deepEqual(s, { pending: 3, failed: 1, byKind: { attendance: 2, message: 1 } });
});
