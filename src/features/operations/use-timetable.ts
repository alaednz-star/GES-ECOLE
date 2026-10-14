/**
 * The timetable's data for a view: the groups (with slots), the options of each view (groups,
 * teachers, rooms, levels), the blocks, and the teachers' conflicts. Shared by the page and the
 * printable document.
 */

import { useMemo } from "react";
import { useGroups } from "@/features/school/queries";
import { useRooms } from "./queries";
import {
  buildTimetable,
  teacherConflicts,
  type TimetableFilter,
  type TimetableGroup,
} from "./timetable-model";

export interface TimetableOption {
  id: string;
  label: string;
}

export function useTimetable(filter: TimetableFilter) {
  const groupsQuery = useGroups();
  const roomsQuery = useRooms();

  const groups = useMemo<TimetableGroup[]>(
    () =>
      (groupsQuery.data ?? []).map((g) => ({
        id: g.id,
        name: g.name,
        status: g.status,
        teacherId: g.teacherId,
        teacherName: g.teacherName,
        levelId: g.levelId,
        levelName: g.levelName,
        subjectName: g.subjectName,
        subjectColor: g.subjectColor,
        programName: g.programName,
        schedules: g.schedules,
      })),
    [groupsQuery.data],
  );

  const options = useMemo(() => {
    const active = groups.filter((g) => g.status === "active");
    const uniq = (pairs: [string | null, string | null][]): TimetableOption[] => {
      const m = new Map<string, string>();
      for (const [id, label] of pairs) if (id) m.set(id, label ?? "—");
      return [...m.entries()]
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
    };
    return {
      group: active
        .map((g) => ({ id: g.id, label: g.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      teacher: uniq(active.map((g) => [g.teacherId, g.teacherName])),
      level: uniq(active.map((g) => [g.levelId, g.levelName])),
      room: (roomsQuery.data ?? []).map((r) => ({ id: r.id, label: r.name })),
    };
  }, [groups, roomsQuery.data]);

  const blocks = useMemo(() => buildTimetable(groups, filter), [groups, filter]);
  const conflicts = useMemo(() => teacherConflicts(groups), [groups]);

  return {
    groups,
    options,
    blocks,
    conflicts,
    isLoading: groupsQuery.isLoading || roomsQuery.isLoading,
    error: groupsQuery.error ?? roomsQuery.error,
    refetch: () => {
      void groupsQuery.refetch();
      void roomsQuery.refetch();
    },
  };
}
