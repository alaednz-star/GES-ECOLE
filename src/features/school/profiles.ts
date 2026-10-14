import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  AttendanceStatus,
  AttendanceSummary,
  StudentNote,
  AttendanceHistoryRow,
} from "./types";

export const profileKeys = {
  notes: (studentId: string) => ["student-notes", studentId] as const,
  studentAttendance: (studentId: string) => ["student-attendance", studentId] as const,
  groupAttendance: (groupId: string) => ["group-attendance", groupId] as const,
  attendanceRange: (from: string, to: string) => ["attendance-range", from, to] as const,
  myProfile: (userId: string) => ["my-profile", userId] as const,
};

/** Aggregate a list of statuses into the counts every profile/report needs. */
export function summarise(statuses: AttendanceStatus[]): AttendanceSummary {
  const present = statuses.filter((s) => s === "present").length;
  const absent = statuses.filter((s) => s === "absent").length;
  const late = statuses.filter((s) => s === "late").length;
  const excused = statuses.filter((s) => s === "excused").length;
  const total = statuses.length;
  // Late still counts as attended -- the student was in the room.
  const attended = present + late;
  return {
    total,
    present,
    absent,
    late,
    excused,
    rate: total > 0 ? Math.round((attended / total) * 100) : 0,
  };
}

/* ---------------------------- STUDENT NOTES ---------------------------- */

export function useStudentNotes(studentId: string | undefined) {
  return useQuery({
    queryKey: profileKeys.notes(studentId ?? "none"),
    enabled: !!studentId,
    queryFn: async (): Promise<StudentNote[]> => {
      const { data, error } = await supabase
        .from("student_notes")
        .select("id, body, created_at, author_id, profiles:author_id(full_name)")
        .eq("student_id", studentId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((n) => ({
        id: n.id,
        body: n.body,
        createdAt: n.created_at,
        authorId: n.author_id,
        authorName: n.profiles?.full_name ?? "—",
      }));
    },
  });
}

export function useAddStudentNote(studentId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, authorId }: { body: string; authorId: string }) => {
      const { error } = await supabase
        .from("student_notes")
        .insert({ student_id: studentId as string, author_id: authorId, body });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: profileKeys.notes(studentId ?? "none") }),
  });
}

export function useDeleteStudentNote(studentId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("student_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: profileKeys.notes(studentId ?? "none") }),
  });
}

/* -------------------------- ATTENDANCE HISTORY -------------------------- */

/** Full attendance history for one student, newest first. */
export function useStudentAttendance(studentId: string | undefined) {
  return useQuery({
    queryKey: profileKeys.studentAttendance(studentId ?? "none"),
    enabled: !!studentId,
    queryFn: async (): Promise<AttendanceHistoryRow[]> => {
      const { data, error } = await supabase
        .from("attendance")
        .select("id, session_date, status, group_id, groups(name, subjects(name))")
        .eq("student_id", studentId as string)
        .order("session_date", { ascending: false })
        .limit(365);
      if (error) throw error;
      return (data ?? []).map((a) => ({
        id: a.id,
        sessionDate: a.session_date,
        status: a.status as AttendanceStatus,
        groupId: a.group_id,
        groupName: a.groups?.name ?? "—",
        subjectName: a.groups?.subjects?.name ?? null,
        studentId: studentId as string,
        studentName: "",
      }));
    },
  });
}

/** Attendance across a date range -- powers the admin attendance report. */
export function useAttendanceRange(from: string, to: string) {
  return useQuery({
    queryKey: profileKeys.attendanceRange(from, to),
    queryFn: async (): Promise<AttendanceHistoryRow[]> => {
      const { data, error } = await supabase
        .from("attendance")
        .select(
          "id, session_date, status, group_id, student_id, groups(name, subjects(name)), students(profiles(full_name))",
        )
        .gte("session_date", from)
        .lte("session_date", to)
        .order("session_date", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []).map((a) => ({
        id: a.id,
        sessionDate: a.session_date,
        status: a.status as AttendanceStatus,
        groupId: a.group_id,
        groupName: a.groups?.name ?? "—",
        subjectName: a.groups?.subjects?.name ?? null,
        studentId: a.student_id,
        studentName: a.students?.profiles?.full_name ?? "—",
      }));
    },
  });
}

/* ----------------------------- OWN PROFILE ----------------------------- */

export interface MyProfile {
  fullName: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  /** When the account was created -- the "member since" line on the profile. */
  createdAt: string;
}

export function useMyProfile(userId: string | undefined) {
  return useQuery({
    queryKey: profileKeys.myProfile(userId ?? "anon"),
    enabled: !!userId,
    queryFn: async (): Promise<MyProfile | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, email, phone, avatar_url, created_at")
        .eq("id", userId as string)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        fullName: data.full_name,
        email: data.email,
        phone: data.phone,
        avatarUrl: data.avatar_url,
        createdAt: data.created_at,
      };
    },
  });
}

export function useUpdateMyProfile(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      fullName: string;
      phone: string | null;
      avatarUrl: string | null;
    }) => {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: input.fullName,
          phone: input.phone,
          avatar_url: input.avatarUrl,
        })
        .eq("id", userId as string);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: profileKeys.myProfile(userId ?? "anon") });
      void qc.invalidateQueries({ queryKey: ["students"] });
      void qc.invalidateQueries({ queryKey: ["teachers"] });
    },
  });
}
