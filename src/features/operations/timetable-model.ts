/**
 * Emplois du temps: the weekly timetable derived from groups' slots (ADR-007). PURE.
 *
 * Nothing is stored: a timetable is the set of weekly slots of ACTIVE groups, filtered by group,
 * teacher, room or level. Overlapping blocks in one day are laid out side by side (lanes); two
 * slots of the same teacher at overlapping times are reported as a conflict.
 */

/** The Algerian school week starts on Saturday. 0 = Sunday ... 6 = Saturday. */
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5] as const;

export interface TimetableGroup {
  id: string;
  name: string;
  status: string;
  teacherId: string | null;
  teacherName: string | null;
  levelId: string | null;
  levelName: string | null;
  subjectName: string | null;
  subjectColor: string | null;
  programName: string | null;
  schedules: {
    id: string;
    weekday: number;
    startTime: string;
    endTime: string;
    room: string | null;
    roomId?: string | null;
  }[];
}

export type TimetableView = "all" | "group" | "teacher" | "room" | "level";

export interface TimetableFilter {
  view: TimetableView;
  /** The group, teacher, room or level id; ignored for "all". */
  id: string | null;
}

export interface TimetableBlock {
  slotId: string;
  groupId: string;
  groupName: string;
  teacherName: string | null;
  subjectName: string | null;
  color: string | null;
  room: string | null;
  weekday: number;
  start: number; // minutes since midnight
  end: number;
  startTime: string;
  endTime: string;
  /** Column within its day when blocks overlap (0-based), and how many columns that cluster uses. */
  lane: number;
  lanes: number;
}

export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number) as [number, number];
  return h * 60 + m;
};

export function matchesFilter(
  g: TimetableGroup,
  slot: TimetableGroup["schedules"][number],
  f: TimetableFilter,
): boolean {
  switch (f.view) {
    case "all":
      return true;
    case "group":
      return g.id === f.id;
    case "teacher":
      return g.teacherId === f.id;
    case "room":
      return (slot.roomId ?? null) === f.id;
    case "level":
      return g.levelId === f.id;
  }
}

/** The blocks of the timetable, with lanes assigned per day. Inactive groups are left out. */
export function buildTimetable(
  groups: readonly TimetableGroup[],
  filter: TimetableFilter,
): TimetableBlock[] {
  const blocks: TimetableBlock[] = [];
  for (const g of groups) {
    if (g.status !== "active") continue;
    for (const s of g.schedules) {
      if (!matchesFilter(g, s, filter)) continue;
      blocks.push({
        slotId: s.id,
        groupId: g.id,
        groupName: g.name,
        teacherName: g.teacherName,
        subjectName: g.subjectName,
        color: g.subjectColor,
        room: s.room,
        weekday: s.weekday,
        start: toMinutes(s.startTime),
        end: toMinutes(s.endTime),
        startTime: s.startTime.slice(0, 5),
        endTime: s.endTime.slice(0, 5),
        lane: 0,
        lanes: 1,
      });
    }
  }
  // Lanes: per day, greedy by start time; a cluster of transitively overlapping blocks shares
  // one lane count so they line up.
  for (const day of WEEK_ORDER) {
    const list = blocks
      .filter((b) => b.weekday === day)
      .sort((a, b) => a.start - b.start || a.end - b.end);
    let cluster: TimetableBlock[] = [];
    let clusterEnd = -1;
    const flush = () => {
      const n = Math.max(1, ...cluster.map((b) => b.lane + 1));
      for (const b of cluster) b.lanes = n;
      cluster = [];
    };
    for (const b of list) {
      if (cluster.length > 0 && b.start >= clusterEnd) flush();
      const used = new Set(cluster.filter((o) => o.end > b.start).map((o) => o.lane));
      let lane = 0;
      while (used.has(lane)) lane++;
      b.lane = lane;
      cluster.push(b);
      clusterEnd = Math.max(clusterEnd, b.end);
    }
    if (cluster.length > 0) flush();
  }
  return blocks;
}

/** The hour range to draw: from the earliest start to the latest end, whole hours, default 8-18. */
export function hourRange(blocks: readonly TimetableBlock[]): { from: number; to: number } {
  if (blocks.length === 0) return { from: 8, to: 18 };
  const from = Math.floor(Math.min(...blocks.map((b) => b.start)) / 60);
  const to = Math.ceil(Math.max(...blocks.map((b) => b.end)) / 60);
  return { from: Math.min(from, 8), to: Math.max(to, from + 1) };
}

export interface TeacherConflict {
  teacherName: string;
  weekday: number;
  a: string;
  b: string;
}

/** Slots of the same teacher that overlap on the same day (active groups only). */
export function teacherConflicts(groups: readonly TimetableGroup[]): TeacherConflict[] {
  const slots = groups
    .filter((g) => g.status === "active" && g.teacherId)
    .flatMap((g) =>
      g.schedules.map((s) => ({
        teacherId: g.teacherId as string,
        teacherName: g.teacherName ?? "—",
        group: g.name,
        weekday: s.weekday,
        start: toMinutes(s.startTime),
        end: toMinutes(s.endTime),
      })),
    );
  const out: TeacherConflict[] = [];
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const x = slots[i] as (typeof slots)[number];
      const y = slots[j] as (typeof slots)[number];
      if (
        x.teacherId === y.teacherId &&
        x.weekday === y.weekday &&
        x.start < y.end &&
        y.start < x.end
      ) {
        out.push({ teacherName: x.teacherName, weekday: x.weekday, a: x.group, b: y.group });
      }
    }
  }
  return out;
}

/** Weekly hours per room id (active groups), for the rooms page. */
export function roomWeeklyHours(
  groups: readonly TimetableGroup[],
): Map<string, { hours: number; slots: number }> {
  const out = new Map<string, { hours: number; slots: number }>();
  for (const g of groups) {
    if (g.status !== "active") continue;
    for (const s of g.schedules) {
      if (!s.roomId) continue;
      const v = out.get(s.roomId) ?? { hours: 0, slots: 0 };
      v.hours += (toMinutes(s.endTime) - toMinutes(s.startTime)) / 60;
      v.slots += 1;
      out.set(s.roomId, v);
    }
  }
  return out;
}
