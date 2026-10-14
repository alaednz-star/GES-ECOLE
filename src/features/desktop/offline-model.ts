/**
 * Desktop offline mode (ADR-010): which writes may wait for the connection, and what is waiting.
 * PURE -- no React, no Supabase.
 *
 * Only classroom actions queue offline: they are idempotent or keyed so that replaying them later
 * is safe (attendance upserts on group/student/date; one lesson entry per session; one score per
 * assessment and student; a message is just appended). Everything that needs the server's
 * authority right now -- accounts, payments and their receipt numbers, invoices, official
 * documents, enrollment decisions -- is refused offline rather than queued, because a later replay
 * could not be made correct.
 */

/** Mutation keys of the writes allowed to wait offline. The first segment marks them. */
export const OFFLINE_MUTATIONS = {
  attendance: ["offline", "attendance"],
  sessionAttendance: ["offline", "session-attendance"],
  lessonEntry: ["offline", "lesson-entry"],
  scores: ["offline", "scores"],
  message: ["offline", "message"],
} as const;

export type OfflineKind = keyof typeof OFFLINE_MUTATIONS;

export function isOfflineCapable(key: readonly unknown[] | undefined): boolean {
  return Array.isArray(key) && key[0] === "offline";
}

export function offlineKind(key: readonly unknown[] | undefined): OfflineKind | null {
  if (!isOfflineCapable(key)) return null;
  const found = (Object.keys(OFFLINE_MUTATIONS) as OfflineKind[]).find(
    (k) => OFFLINE_MUTATIONS[k][1] === key?.[1],
  );
  return found ?? null;
}

/** The error a refused offline write carries (mapped to a message by lib/errors.ts). */
export const OFFLINE_REFUSED = "OFFLINE_REFUSED";

export function offlineRefusal(): { code: string; message: string } {
  return { code: OFFLINE_REFUSED, message: "This action needs a connection." };
}

/** True when a write must be refused right away instead of waiting. */
export function mustRefuseOffline(isOnline: boolean, key: readonly unknown[] | undefined): boolean {
  return !isOnline && !isOfflineCapable(key);
}

export interface MutationSnapshot {
  key: readonly unknown[] | undefined;
  status: "idle" | "pending" | "success" | "error";
  isPaused: boolean;
  submittedAt: number;
}

export interface PendingSummary {
  /** Writes waiting for the connection (or being sent). */
  pending: number;
  /** Writes the server refused on replay: shown in « Synchronisation » for retry or discard. */
  failed: number;
  byKind: Partial<Record<OfflineKind, number>>;
}

/** What the status badge and the « Synchronisation » panel show. Offline-capable writes only. */
export function summarize(mutations: MutationSnapshot[]): PendingSummary {
  const out: PendingSummary = { pending: 0, failed: 0, byKind: {} };
  for (const m of mutations) {
    const kind = offlineKind(m.key);
    if (!kind) continue;
    if (m.status === "pending") {
      out.pending += 1;
      out.byKind[kind] = (out.byKind[kind] ?? 0) + 1;
    } else if (m.status === "error") {
      out.failed += 1;
    }
  }
  return out;
}

/** How long the offline cache is kept (also the queries' gcTime in the desktop app). */
export const OFFLINE_CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
