import { useMemo } from "react";
import { useGroupRegistrations, useGroups } from "@/features/school/queries";
import { partitionGroupRegistrations } from "@/features/school/registration-model";
import { occurrencesForGroup, type SessionOccurrence } from "@/features/school/schedule";
import type { GroupRow, RegistrationRow } from "@/features/school/types";

export interface GroupDetail {
  group: GroupRow | null;
  /** Approved enrolments -- the roster. */
  enrolled: RegistrationRow[];
  /** Awaiting an admin decision. */
  pending: RegistrationRow[];
  /** Refused requests and withdrawn places, newest first -- the group's enrollment history. */
  history: RegistrationRow[];
  /** More registrations exist than were read (see BoundedRegistrations). */
  truncated: boolean;
  occupancy: number;
  seatsLeft: number;
  weeklyMinutes: number;
  next: SessionOccurrence | null;
}

function minutesOf(slot: { startTime: string; endTime: string }): number {
  const [sh, sm] = slot.startTime.split(":").map(Number);
  const [eh, em] = slot.endTime.split(":").map(Number);
  return Math.max(0, (eh ?? 0) * 60 + (em ?? 0) - ((sh ?? 0) * 60 + (sm ?? 0)));
}

/**
 * Everything one group's detail page needs, derived once.
 *
 * The page previously re-derived enrolled/pending/occupancy inline AND called
 * `useStudents()` -- fetching every student in the school to render one roster.
 * Centralising it here means the detail page, My Groups and the workspace all
 * count a group the same way; a figure cannot differ between screens because
 * only one place computes it.
 *
 * Not folded into `useTeacherWorkspace`: that hook is scoped to the signed-in
 * teacher's own groups, while this page also serves admins looking at any group.
 */
export function useGroupDetail(groupId: string | undefined) {
  const groupsQuery = useGroups();
  // BOUNDED (BUG-01): only this group's registrations, not the whole school's.
  const registrationsQuery = useGroupRegistrations(groupId);

  const value = useMemo<GroupDetail>(() => {
    const group = (groupsQuery.data ?? []).find((g) => g.id === groupId) ?? null;
    const { enrolled, pending, history } = partitionGroupRegistrations(
      registrationsQuery.data?.rows ?? [],
    );

    const capacity = group?.maxStudents ?? 0;
    const upcoming = group
      ? (occurrencesForGroup(group, { limit: 1 }).find((o) => o.startsAt >= new Date()) ?? null)
      : null;

    return {
      group,
      enrolled,
      pending,
      history,
      truncated: registrationsQuery.data?.truncated ?? false,
      occupancy: capacity > 0 ? Math.round((enrolled.length / capacity) * 100) : 0,
      seatsLeft: Math.max(0, capacity - enrolled.length),
      weeklyMinutes: (group?.schedules ?? []).reduce((sum, s) => sum + minutesOf(s), 0),
      next: upcoming,
    };
  }, [groupsQuery.data, registrationsQuery.data, groupId]);

  return {
    ...value,
    isLoading: groupsQuery.isLoading || registrationsQuery.isLoading,
    isFetching: groupsQuery.isFetching || registrationsQuery.isFetching,
    error: groupsQuery.error ?? registrationsQuery.error,
    refetch: () => {
      void groupsQuery.refetch();
      void registrationsQuery.refetch();
    },
  };
}
