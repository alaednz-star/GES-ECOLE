/**
 * Statistiques: the school's figures, derived from existing data (ADR-007). PURE.
 * Students, enrollments, groups' fill rates, attendance by month, teachers' weekly load.
 */

export interface StatsStudent {
  id: string;
  status: string;
  registeredAt: string;
}

export interface StatsRegistration {
  id: string;
  studentId: string;
  groupId: string;
  status: string;
  createdAt: string;
}

export interface StatsGroup {
  id: string;
  name: string;
  status: string;
  maxStudents: number;
  enrolled: number;
  programName: string | null;
  levelName: string | null;
  teacherId: string | null;
  teacherName: string | null;
  schedules: { startTime: string; endTime: string }[];
}

export interface AttendanceMonthRow {
  month: string;
  groupId: string;
  present: number;
  late: number;
  excused: number;
  absent: number;
  total: number;
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number) as [number, number];
  return h * 60 + m;
};

/** Present + late count as attended; excused is neither counted for nor against. */
export function attendanceRate(r: {
  present: number;
  late: number;
  excused: number;
  total: number;
}): number | null {
  const counted = r.total - r.excused;
  if (counted <= 0) return null;
  return Math.round(((r.present + r.late) / counted) * 100);
}

export interface SchoolStats {
  students: { total: number; active: number; newThisMonth: number };
  enrollments: { active: number; pending: number; newThisMonth: number };
  groups: { active: number; seats: number; enrolled: number; fillRate: number | null };
  attendance: { rate: number | null; sessionsMarked: number };
  byProgram: { name: string; enrolled: number; groups: number }[];
  byLevel: { name: string; enrolled: number }[];
  fill: { name: string; enrolled: number; seats: number; rate: number }[];
  attendanceByMonth: { month: string; rate: number | null; total: number }[];
  teacherLoad: { name: string; hours: number; groups: number }[];
  enrollmentsByMonth: { month: string; count: number }[];
}

export function buildStats(
  students: readonly StatsStudent[],
  registrations: readonly StatsRegistration[],
  groups: readonly StatsGroup[],
  attendance: readonly AttendanceMonthRow[],
  today: string,
): SchoolStats {
  const month = today.slice(0, 7);
  const active = groups.filter((g) => g.status === "active");
  const seats = active.reduce((s, g) => s + g.maxStudents, 0);
  const enrolled = active.reduce((s, g) => s + g.enrolled, 0);
  const approved = registrations.filter((r) => r.status === "approved");

  const byProgram = new Map<string, { enrolled: number; groups: number }>();
  const byLevel = new Map<string, number>();
  for (const g of active) {
    const p = byProgram.get(g.programName ?? "") ?? { enrolled: 0, groups: 0 };
    p.enrolled += g.enrolled;
    p.groups += 1;
    byProgram.set(g.programName ?? "", p);
    byLevel.set(g.levelName ?? "", (byLevel.get(g.levelName ?? "") ?? 0) + g.enrolled);
  }

  const months = new Map<
    string,
    { present: number; late: number; excused: number; total: number }
  >();
  for (const a of attendance) {
    const m = a.month.slice(0, 7);
    const v = months.get(m) ?? { present: 0, late: 0, excused: 0, total: 0 };
    v.present += a.present;
    v.late += a.late;
    v.excused += a.excused;
    v.total += a.total;
    months.set(m, v);
  }
  const all = [...months.values()].reduce(
    (t, v) => ({
      present: t.present + v.present,
      late: t.late + v.late,
      excused: t.excused + v.excused,
      total: t.total + v.total,
    }),
    { present: 0, late: 0, excused: 0, total: 0 },
  );

  const teachers = new Map<string, { name: string; minutes: number; groups: number }>();
  for (const g of active) {
    if (!g.teacherId) continue;
    const v = teachers.get(g.teacherId) ?? { name: g.teacherName ?? "—", minutes: 0, groups: 0 };
    v.groups += 1;
    for (const s of g.schedules) v.minutes += minutes(s.endTime) - minutes(s.startTime);
    teachers.set(g.teacherId, v);
  }

  const regMonths = new Map<string, number>();
  for (const r of registrations) {
    if (r.status !== "approved" && r.status !== "withdrawn") continue;
    const m = r.createdAt.slice(0, 7);
    regMonths.set(m, (regMonths.get(m) ?? 0) + 1);
  }

  return {
    students: {
      total: students.length,
      active: students.filter((s) => s.status === "active").length,
      newThisMonth: students.filter((s) => s.registeredAt.slice(0, 7) === month).length,
    },
    enrollments: {
      active: approved.length,
      pending: registrations.filter((r) => r.status === "pending").length,
      newThisMonth: approved.filter((r) => r.createdAt.slice(0, 7) === month).length,
    },
    groups: {
      active: active.length,
      seats,
      enrolled,
      fillRate: seats > 0 ? Math.round((enrolled / seats) * 100) : null,
    },
    attendance: { rate: attendanceRate(all), sessionsMarked: all.total },
    byProgram: [...byProgram.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.enrolled - a.enrolled),
    byLevel: [...byLevel.entries()]
      .map(([name, enrolledCount]) => ({ name, enrolled: enrolledCount }))
      .sort((a, b) => b.enrolled - a.enrolled),
    fill: active
      .map((g) => ({
        name: g.name,
        enrolled: g.enrolled,
        seats: g.maxStudents,
        rate: g.maxStudents > 0 ? Math.round((g.enrolled / g.maxStudents) * 100) : 0,
      }))
      .sort((a, b) => b.rate - a.rate),
    attendanceByMonth: [...months.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([m, v]) => ({ month: m, rate: attendanceRate(v), total: v.total })),
    teacherLoad: [...teachers.values()]
      .map((v) => ({
        name: v.name,
        hours: Math.round((v.minutes / 60) * 10) / 10,
        groups: v.groups,
      }))
      .sort((a, b) => b.hours - a.hours),
    enrollmentsByMonth: [...regMonths.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([m, count]) => ({ month: m, count })),
  };
}
