import { useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useGroups, useMyRegistrations } from "@/features/school/queries";
import { useStudentStream } from "@/features/school/streams";
import { groupMatchesStream } from "@/features/school/streams";
import type { GroupRow, RegistrationStatus } from "@/features/school/types";
import { currentRegistrationByGroup } from "@/features/school/registration-model";

/**
 * Why a group cannot be joined right now, or `null` when it can.
 *
 * `takenSubject` -- the student already holds an active enrolment for this
 * subject and level in a DIFFERENT group. The database enforces one active
 * enrolment per (subject, level); surfacing it here means the student is told
 * before they apply rather than by a rejected write.
 */
export type GroupBlockReason = RegistrationStatus | "full" | "takenSubject";

export interface EligibleGroup {
  group: GroupRow;
  /** Existing decision on this group, if the student already applied. */
  registrationStatus: RegistrationStatus | null;
  /** The row id, so a pending request can be withdrawn from the card. */
  registrationId: string | null;
  /** The administration's note on a decision. Null unless one was written. */
  rejectionReason: string | null;
  seatsLeft: number;
  isFull: boolean;
  /**
   * Whether the seat figures above mean anything to THIS caller.
   *
   * `group.enrolled` is counted from the `registrations` rows the browser could read, and
   * `registrations read` restricts a student to their own. So a student reading this hook
   * gets `enrolled = 0` for every group -- verified against the local stack: a group with
   * 8 of 10 seats taken reports 0 both through `registrations` and through the
   * `group_enrollment_counts` view, which is `security_invoker` and therefore inherits the
   * same policy.
   *
   * The number is not "approximate", it is unavailable. Rather than render 0/20 as though
   * it were measured, callers must check this flag and show capacity instead of occupancy.
   * Making it available means adding one aggregate server object; see
   * `docs/enrollment-seat-counts.md`.
   */
  seatsKnown: boolean;
  /** `null` means the Register button should be shown. */
  blockedBy: GroupBlockReason | null;
}

/**
 * The groups a student may actually see and join.
 *
 * Row-level security already restricts `groups` to the student's own level and
 * stream (Task 2C migration), so this is defence in depth rather than the only
 * gate: if the policy were ever loosened, the client would still not offer an
 * ineligible group. The stream rule itself is not re-expressed here -- it comes
 * from `groupMatchesStream`, shared with the rest of the app.
 */
export function useEligibleGroups(studentId: string | undefined) {
  const { user } = useAuth();
  const groupsQuery = useGroups();
  const registrationsQuery = useMyRegistrations(studentId);
  const identityQuery = useStudentStream(studentId);

  // Staff read every registration, so their counts are real. A student reads only their
  // own, so theirs are not. This is the caller's authorisation, not a feature flag.
  const seatsKnown = user?.role === "admin" || user?.role === "teacher";

  const items = useMemo<EligibleGroup[]>(() => {
    const identity = identityQuery.data;
    if (!identity?.levelId) return [];

    const decisions = new Map<string, RegistrationStatus>();
    const rows = new Map<string, { id: string; note: string | null }>();
    // Which (subject, level) pairs the student already occupies, and in which
    // group. Mirrors the database rule: one active enrolment per subject+level.
    const takenSubjects = new Map<string, string>();

    const allGroups = groupsQuery.data ?? [];
    // A student can have several registrations for one group over time (refused, then
    // accepted; enrolled, withdrawn, enrolled again). What the card shows is the CURRENT one:
    // the active registration, else the most recent.
    const current = currentRegistrationByGroup(registrationsQuery.data ?? []);
    for (const r of current.values()) {
      decisions.set(r.group_id, r.status as RegistrationStatus);
      rows.set(r.group_id, { id: r.id, note: r.note ?? null });
      if (r.status !== "pending" && r.status !== "approved") continue;
      const g = allGroups.find((x) => x.id === r.group_id);
      if (g?.subjectId && g.levelId) {
        takenSubjects.set(`${g.subjectId}|${g.levelId}`, r.group_id);
      }
    }

    return (groupsQuery.data ?? [])
      .filter(
        (g) =>
          g.status === "active" &&
          g.levelId === identity.levelId &&
          groupMatchesStream(g.streamId, identity.streamId),
      )
      .map((group) => {
        const seatsLeft = Math.max(0, group.maxStudents - group.enrolled);
        // `full` must not be asserted from a count we could not read: for a student
        // `enrolled` is always 0, so this would be permanently false anyway -- being
        // explicit stops a future reader from trusting it.
        const isFull = seatsKnown && group.maxStudents > 0 && seatsLeft === 0;
        const registrationStatus = decisions.get(group.id) ?? null;

        // Already holds this subject+level in another group?
        const holder =
          group.subjectId && group.levelId
            ? takenSubjects.get(`${group.subjectId}|${group.levelId}`)
            : undefined;
        const takenElsewhere = !!holder && holder !== group.id;

        // Precedence: a decision on THIS group is the most specific fact, then
        // the subject already being taken, then capacity. A student enrolled
        // here should read "Enrolled", never "Full".
        const blockedBy: GroupBlockReason | null =
          registrationStatus ?? (takenElsewhere ? "takenSubject" : isFull ? "full" : null);

        const row = rows.get(group.id);
        return {
          group,
          registrationStatus,
          registrationId: row?.id ?? null,
          // Only meaningful on a rejection; the note is the administration's words.
          rejectionReason: registrationStatus === "rejected" ? (row?.note ?? null) : null,
          seatsLeft,
          isFull,
          seatsKnown,
          blockedBy,
        };
      })
      .sort((a, b) => a.group.name.localeCompare(b.group.name));
  }, [groupsQuery.data, registrationsQuery.data, identityQuery.data, seatsKnown]);

  return {
    items,
    /** The student's own academic identity, for the read-only context banner. */
    identity: identityQuery.data ?? null,
    isLoading: groupsQuery.isLoading || registrationsQuery.isLoading || identityQuery.isLoading,
    isFetching: groupsQuery.isFetching || registrationsQuery.isFetching || identityQuery.isFetching,
    error: groupsQuery.error ?? registrationsQuery.error ?? identityQuery.error,
    refetch: () => {
      void groupsQuery.refetch();
      void registrationsQuery.refetch();
      void identityQuery.refetch();
    },
  };
}
