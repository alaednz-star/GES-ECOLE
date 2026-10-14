/**
 * Desktop offline model (ADR-010): the whitelist, the refusal rule, the pending summary.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, dehydrate, hydrate } from "@tanstack/query-core";
import {
  MAX_TIMER_DELAY,
  OFFLINE_CACHE_MAX_AGE,
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
  const m = (
    key: readonly unknown[] | undefined,
    status: MutationSnapshot["status"],
    isPaused = false,
  ): MutationSnapshot => ({
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

/* ------------------------------------------------- cache lifetime (offline restart) */

const DAY = 24 * 60 * 60 * 1000;

/** Saves five queries, restores them into a fresh client, waits, and counts what is left. */
async function restoredAfterAWhile(gcTime: number): Promise<number> {
  const before = new QueryClient();
  for (const k of ["groups", "entries", "chapters", "assessments", "periods"]) {
    before.setQueryData([k], [{ id: 1 }]);
  }
  const saved = dehydrate(before);
  const after = new QueryClient({ defaultOptions: { queries: { gcTime } } });
  hydrate(after, saved);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const left = after.getQueryCache().getAll().length;
  after.clear(); // cancels the garbage-collection timers so the test process can exit
  return left;
}

test("the offline cache lifetime fits in a browser timer", () => {
  // gcTime goes to setTimeout; a longer delay fires at once instead of waiting.
  assert.ok(
    OFFLINE_CACHE_MAX_AGE <= MAX_TIMER_DELAY,
    `${OFFLINE_CACHE_MAX_AGE} > ${MAX_TIMER_DELAY}`,
  );
});

test("queries restored after a restart survive until a screen uses them", async () => {
  // The offline restart restores the cache before any screen is mounted. With the desktop
  // gcTime, the restored queries must still be there afterwards.
  assert.equal(await restoredAfterAWhile(OFFLINE_CACHE_MAX_AGE), 5);
});

test("regression: a 30-day gcTime deletes every restored query at once", async () => {
  // The defect this replaced: 30 days overflows the timer, so garbage collection ran
  // immediately and the next save overwrote the good cache with an empty one.
  assert.equal(await restoredAfterAWhile(30 * DAY), 0);
});
