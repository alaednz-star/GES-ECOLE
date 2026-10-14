import { useMemo } from "react";
import { useMyRegistrations, useTeachers } from "@/features/school/queries";
import { useStreamOptions } from "@/features/school/streams";
import type { RegistrationStatus, ScheduleSlot } from "@/features/school/types";

/** One registration, flattened into everything a card needs to render. */
export interface MyRegistration {
  id: string;
  status: RegistrationStatus;
  createdAt: string;
  decidedAt: string | null;
  groupId: string;
  /** Term window, needed to clamp generated occurrences. */
  startDate: string | null;
  endDate: string | null;
  groupName: string;
  subjectKey: string | null;
  subjectName: string | null;
  subjectColor: string | null;
  teacherName: string | null;
  /** The teacher's photo, so the same face appears here as in the catalogue. */
  teacherAvatarUrl: string | null;
  levelName: string | null;
  streamName: string | null;
  priceDzd: number;
  /** Class size. Already in the existing select; the shared card shows it as capacity. */
  maxStudents: number;
  room: string | null;
  schedules: ScheduleSlot[];
  /** True when the linked group is no longer visible to this student. */
  groupUnavailable: boolean;
  /**
   * The administration's note on the decision, shown on a rejection.
   *
   * Only surfaced for `rejected`: on a pending row it is an internal remark the student
   * has no context for, and on an approved one it has nothing to explain.
   */
  rejectionReason: string | null;
  /** The administration's reason when a place was withdrawn (status `withdrawn`). */
  withdrawalReason: string | null;
}

/**
 * The student's own registrations, shaped for display.
 *
 * The confirmation page and the registrations list both read from here, so a
 * card can never show one thing in one place and something else in the other.
 * Teacher and stream names are resolved client-side: `registrations` embeds a
 * `teacher_id` only, and stream names are already cached by `useStreamOptions`.
 */
export function useMyRegistrationCards(studentId: string | undefined) {
  const registrationsQuery = useMyRegistrations(studentId);
  const { data: teachers = [] } = useTeachers();
  const { nameOf: streamNameOf } = useStreamOptions();

  const items = useMemo<MyRegistration[]>(() => {
    const teacherName = new Map(teachers.map((t) => [t.id, t.fullName]));
    const teacherPhoto = new Map(teachers.map((t) => [t.id, t.avatarUrl]));

    return (registrationsQuery.data ?? []).map((r) => {
      // `groups` can be null even though the registration exists: RLS hides
      // groups outside the student's level/stream (Task 2C), and a student may
      // hold an older registration from before they were assigned their current
      // level. Render it honestly as an unavailable class rather than "?".
      const group = r.groups;
      const schedules: ScheduleSlot[] = (group?.group_schedules ?? [])
        .map((s) => ({
          id: s.id,
          weekday: s.weekday,
          startTime: s.start_time,
          endTime: s.end_time,
          room: s.room,
        }))
        .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));

      return {
        id: r.id,
        status: r.status as RegistrationStatus,
        createdAt: r.created_at,
        decidedAt: r.decided_at ?? null,
        groupId: r.group_id,
        startDate: group?.start_date ?? null,
        endDate: group?.end_date ?? null,
        groupName: group?.name ?? "",
        groupUnavailable: !group,
        subjectKey: group?.subjects?.key ?? null,
        subjectName: group?.subjects?.name ?? null,
        subjectColor: group?.subjects?.color ?? null,
        teacherName: group?.teacher_id ? (teacherName.get(group.teacher_id) ?? null) : null,
        teacherAvatarUrl: group?.teacher_id ? (teacherPhoto.get(group.teacher_id) ?? null) : null,
        rejectionReason: r.status === "rejected" ? (r.note ?? null) : null,
        withdrawalReason: r.status === "withdrawn" ? (r.withdrawal_reason ?? null) : null,
        levelName: group?.levels?.name ?? null,
        streamName: streamNameOf(group?.stream_id),
        priceDzd: group?.price_dzd ?? 0,
        maxStudents: group?.max_students ?? 0,
        room: schedules.find((s) => s.room)?.room ?? null,
        schedules,
      };
    });
  }, [registrationsQuery.data, teachers, streamNameOf]);

  return {
    items,
    byId: (id: string) => items.find((i) => i.id === id) ?? null,
    isLoading: registrationsQuery.isLoading,
    isFetching: registrationsQuery.isFetching,
    error: registrationsQuery.error,
    refetch: () => void registrationsQuery.refetch(),
  };
}
