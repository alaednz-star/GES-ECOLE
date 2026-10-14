import { useMemo } from "react";
import { useGroups, useRegistrations } from "@/features/school/queries";

export interface LevelStatistics {
  /** Distinct students holding an APPROVED enrolment in a group of this level. */
  students: number;
  /** Active groups belonging to this level. */
  groups: number;
  /** Distinct teachers assigned to those groups. */
  teachers: number;
  /** Sum of `max_students` across those groups. */
  capacity: number;
}

const EMPTY: LevelStatistics = { students: 0, groups: 0, teachers: 0, capacity: 0 };

/**
 * Level statistics, derived from enrolments rather than from the student record.
 *
 * The academic model is:
 *
 *     student -> registration -> group -> level
 *
 * A student is "in" a level because an approved registration puts them in a
 * group that belongs to it. The levels page previously counted
 * `students.level_id`, which is the student's DECLARED level from onboarding --
 * a different fact, and one that is null for anyone enrolled directly by an
 * admin. Every seeded student had approved enrolments and a null declared
 * level, so the cards read "Students: 0".
 *
 * Counting rules, per the business definition:
 *   - approved enrolments only (pending applications are not attendance)
 *   - active groups only (archived groups do not represent current provision)
 *   - students counted DISTINCT, so one student in two groups of a level is one
 *
 * Two queries total, both already shared and cached. The per-level figures are
 * computed in a single pass over each list, so adding a level costs nothing
 * extra -- no query per card.
 */
export function useLevelStatistics() {
  const groupsQuery = useGroups();
  const registrationsQuery = useRegistrations();

  const byLevel = useMemo(() => {
    const groups = (groupsQuery.data ?? []).filter((g) => g.status === "active");
    const registrations = registrationsQuery.data ?? [];

    // group id -> level id, so the registration pass is O(1) per row.
    const levelOfGroup = new Map<string, string>();
    const acc = new Map<
      string,
      { groups: number; teachers: Set<string>; capacity: number; students: Set<string> }
    >();

    const bucket = (levelId: string) => {
      let b = acc.get(levelId);
      if (!b) {
        b = { groups: 0, teachers: new Set(), capacity: 0, students: new Set() };
        acc.set(levelId, b);
      }
      return b;
    };

    for (const g of groups) {
      if (!g.levelId) continue;
      levelOfGroup.set(g.id, g.levelId);
      const b = bucket(g.levelId);
      b.groups += 1;
      b.capacity += g.maxStudents;
      if (g.teacherId) b.teachers.add(g.teacherId);
    }

    for (const r of registrations) {
      if (r.status !== "approved") continue;
      const levelId = levelOfGroup.get(r.groupId);
      if (!levelId) continue; // group archived or has no level
      bucket(levelId).students.add(r.studentId);
    }

    const out = new Map<string, LevelStatistics>();
    for (const [levelId, b] of acc) {
      out.set(levelId, {
        students: b.students.size,
        groups: b.groups,
        teachers: b.teachers.size,
        capacity: b.capacity,
      });
    }
    return out;
  }, [groupsQuery.data, registrationsQuery.data]);

  return {
    /** Stats for one level; zeroes when the level has no active groups. */
    forLevel: (levelId: string): LevelStatistics => byLevel.get(levelId) ?? EMPTY,
    byLevel,
    isLoading: groupsQuery.isLoading || registrationsQuery.isLoading,
    isFetching: groupsQuery.isFetching || registrationsQuery.isFetching,
    error: groupsQuery.error ?? registrationsQuery.error,
  };
}
