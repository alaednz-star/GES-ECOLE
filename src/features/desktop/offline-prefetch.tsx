/**
 * Desktop app (ADR-010): prepares offline use. While online, it loads what each role works with,
 * through the very hooks the pages use (same query keys, same fetches), so the persisted cache
 * covers those pages even if they were not opened yet. Renders nothing.
 *
 * - teacher: their groups, sessions of the last and next 14 days, today's rosters, lesson log,
 *   chapters, assessments, periods, conversations, news;
 * - administrator: groups, students, teachers, today's attendance, sessions, conversations, news;
 * - student: their enrollments, attendance, resources, conversations, news.
 */

import { useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { todayIso } from "@/lib/format";
import {
  useGroups,
  useMyAttendance,
  useMyRegistrations,
  useStudents,
  useTeachers,
  useTodayAttendance,
} from "@/features/school/queries";
import { useSessions } from "@/features/school/session/use-sessions";
import { useSessionRoster } from "@/features/school/session/use-session-attendance";
import { useMyResources } from "@/features/school/resources/queries";
import {
  useAssessments,
  useChapters,
  useLessonEntries,
  usePeriods,
} from "@/features/pedagogy/queries";
import { useConversations, useNewsFeed } from "@/features/communication/queries";

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function OfflinePrefetch() {
  const { user } = useAuth();
  const online = useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );
  if (!user || !online) return null;
  if (user.role === "student") return <StudentPrefetch studentId={user.id} />;
  return <StaffPrefetch isAdmin={user.role === "admin"} />;
}

function StaffPrefetch({ isAdmin }: { isAdmin: boolean }) {
  const today = todayIso();
  const { sessions } = useSessions({ from: shift(today, -14), to: shift(today, 14) }, today);
  useConversations(false);
  useNewsFeed();
  usePeriods();
  if (isAdmin) return <AdminPrefetch today={today} />;
  // Today's registers: what a teacher marks first when the connection is gone.
  const todays = sessions.filter((s) => s.date === today);
  return (
    <>
      <TeacherPrefetch />
      {todays.map((s) => (
        <RosterPrefetch key={s.key} groupId={s.groupId} date={s.date} />
      ))}
    </>
  );
}

function TeacherPrefetch() {
  useGroups();
  useLessonEntries(null);
  useChapters(null);
  useAssessments(null);
  return null;
}

function AdminPrefetch({ today }: { today: string }) {
  useGroups();
  useStudents();
  useTeachers();
  useTodayAttendance(today);
  return null;
}

function RosterPrefetch({ groupId, date }: { groupId: string; date: string }) {
  useSessionRoster(groupId, date);
  return null;
}

function StudentPrefetch({ studentId }: { studentId: string }) {
  useMyRegistrations(studentId);
  useMyAttendance(studentId);
  useMyResources(studentId);
  useConversations(false);
  useNewsFeed();
  return null;
}
