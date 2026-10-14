/**
 * Enrollment lifecycle rules shared by the screens (ADR-004 section 4). PURE (no runtime
 * imports), so `node --test` can load it. The database is the authority -- these helpers only
 * read its outcomes the same way everywhere.
 *
 *   pending    a request, awaiting the administration      (active: counts for uniqueness)
 *   approved   a place in the group ("enrolled")           (active: counts for capacity)
 *   rejected   a refused request                           (history)
 *   withdrawn  held a place, then left                     (history; terminal)
 *
 * A student may have several rows for one group over time (rejected, then accepted; enrolled,
 * withdrawn, enrolled again) -- at most ONE of them active (`registrations_one_active_per_group`).
 */

export const REGISTRATION_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type RegistrationLifecycleStatus = (typeof REGISTRATION_STATUSES)[number];

/** Statuses that occupy the (student, group) slot. */
export const ACTIVE_STATUSES: readonly string[] = ["pending", "approved"];

export function isActiveStatus(status: string): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export interface RegistrationLike {
  id: string;
  group_id?: string;
  groupId?: string;
  status: string;
  created_at?: string;
  createdAt?: string;
}

const groupOf = (r: RegistrationLike) => (r.groupId ?? r.group_id) as string;
const createdOf = (r: RegistrationLike) => r.createdAt ?? r.created_at ?? "";

/**
 * The registration that describes a student's relationship with each group NOW: the active
 * one if there is one, otherwise the most recent. Order of the input does not matter.
 */
export function currentRegistrationByGroup<T extends RegistrationLike>(
  rows: readonly T[],
): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    const g = groupOf(r);
    const held = out.get(g);
    if (!held) {
      out.set(g, r);
      continue;
    }
    const heldActive = isActiveStatus(held.status);
    const rActive = isActiveStatus(r.status);
    if (rActive && !heldActive) out.set(g, r);
    else if (rActive === heldActive && createdOf(r) > createdOf(held)) out.set(g, r);
  }
  return out;
}

/** One group's registrations, split the way the group page shows them. */
export function partitionGroupRegistrations<T extends RegistrationLike>(rows: readonly T[]) {
  const byRecent = [...rows].sort((a, b) => createdOf(b).localeCompare(createdOf(a)));
  return {
    enrolled: byRecent.filter((r) => r.status === "approved"),
    pending: byRecent.filter((r) => r.status === "pending"),
    /** Rejected requests and withdrawn places, newest first. */
    history: byRecent.filter((r) => r.status === "rejected" || r.status === "withdrawn"),
  };
}

/**
 * Why the database refused an enrollment, as an i18n key, or null when the error is something
 * else (left to the generic error mapper). Reads the stable parts the database returns:
 * the error code and the constraint / trigger wording.
 */
export function enrollmentProblem(error: unknown, groupName?: string | null): string | null {
  const e = (error ?? {}) as { code?: string; message?: string; details?: string };
  const text = `${e.message ?? ""} ${e.details ?? ""}`;
  if (e.code === "23505" && /registrations_one_active_per_group/.test(text)) {
    return "enroll.error.alreadyInGroup";
  }
  // The subject rule fires first; when the group it names IS this group, say so plainly.
  if (e.code === "23505" && groupName && subjectTakenGroup(error) === groupName) {
    return "enroll.error.alreadyInGroup";
  }
  if (
    e.code === "23505" &&
    /already enrolled in|registrations_one_active_per_subject_level/.test(text)
  ) {
    return "enroll.error.subjectTaken";
  }
  if (e.code === "23514" && /is full/.test(text)) return "enroll.error.full";
  if (e.code === "23514" && /withdrawn and is closed|Only an active enrollment/.test(text)) {
    return "enroll.error.closed";
  }
  return null;
}

/** The group the subject rule names in its message ("already enrolled in \"X\""), if any. */
export function subjectTakenGroup(error: unknown): string | null {
  const message = ((error ?? {}) as { message?: string }).message ?? "";
  const m = /already enrolled in "([^"]+)"/.exec(message);
  return m ? (m[1] as string) : null;
}
