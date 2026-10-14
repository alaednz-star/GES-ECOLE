import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type {
  AttendanceStatus,
  EntityStatus,
  GroupRow,
  Level,
  LevelStage,
  RegistrationRow,
  RegistrationStatus,
  StudentRow,
  Subject,
  TeacherRow,
} from "./types";
import type { LevelOption, LevelSystemOption } from "./level-model";
import { DEFAULT_SUBJECT_DOMAIN, isSubjectDomain } from "./subject-domain";
import { OFFLINE_MUTATIONS } from "@/features/desktop/offline-model";

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export const schoolKeys = {
  levels: ["levels"] as const,
  allLevels: ["levels", "all"] as const,
  levelSystems: ["level-systems"] as const,
  subjects: ["subjects"] as const,
  teachers: ["teachers"] as const,
  students: ["students"] as const,
  groups: ["groups"] as const,
  registrations: ["registrations"] as const,
  /** Under the registrations root, so every enrollment write refreshes them too. */
  groupRegistrations: (groupId: string) => ["registrations", "group", groupId] as const,
  registrationQueue: (status: string) => ["registrations", "queue", status] as const,
  registrationCounts: ["registrations", "counts"] as const,
  studentSearch: (term: string) => ["students", "search", term] as const,
  settings: ["center-settings"] as const,
  /**
   * Root for everything derived from the `attendance` table.
   *
   * Every attendance query is namespaced under it, so one write invalidates all
   * of them -- including consumers added later. Previously each key had its own
   * root and `useSaveAttendance` invalidated exactly one, leaving the workspace
   * pending count, the student portal and the admin dashboard stale for the
   * global `staleTime` of 60s. Reproduced across two tabs: tab 1 still showed
   * "6 pending" after tab 2 completed 3 registers.
   */
  attendanceRoot: ["attendance"] as const,
  attendance: (groupId: string, date: string) => ["attendance", "roster", groupId, date] as const,
  markedSessions: (from: string) => ["attendance", "marked-sessions", from] as const,
  todayAttendance: (date: string) => ["attendance", "today", date] as const,
  myAttendance: (studentId: string) => ["attendance", "mine", studentId] as const,
  myRegistrations: (studentId: string) => ["my-registrations", studentId] as const,
};

/* ------------------------------ LEVELS ------------------------------ */

/**
 * The Algerian SCHOOL levels (1AP..3AS), in order.
 *
 * Since Phase 3A (20261004110000) `levels` also holds CEFR, training and custom levels, each in
 * its level system. Every screen that calls this hook is a school context -- onboarding,
 * students, statistics, the Levels page, standalone groups -- so it reads the school system
 * only, exactly as before. The formation and group forms use `useLevelSystems` + `useAllLevels`
 * (Phase 3B), scoped to the formation's system.
 */
export function useLevels() {
  return useQuery({
    queryKey: schoolKeys.levels,
    queryFn: async (): Promise<Level[]> => {
      const rows = must(
        await supabase
          .from("levels")
          .select("*, level_systems!inner(kind)")
          .eq("level_systems.kind", "school")
          .order("position", { ascending: true }),
      );
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        stage: r.stage as LevelStage,
        position: r.position,
        status: r.status as EntityStatus,
      }));
    },
  });
}

/**
 * Every level system (Phase 3A), in display order. Used where a formation chooses its system;
 * every other screen stays on `useLevels()`.
 */
export function useLevelSystems() {
  return useQuery({
    queryKey: schoolKeys.levelSystems,
    queryFn: async (): Promise<LevelSystemOption[]> => {
      const rows = must(
        await supabase
          .from("level_systems")
          .select("id, code, kind, name, position, status")
          .order("position", { ascending: true }),
      );
      return rows.map((r) => ({
        id: r.id,
        code: r.code,
        kind: r.kind as LevelSystemOption["kind"],
        name: r.name,
        position: r.position,
        status: r.status,
      }));
    },
  });
}

/**
 * The levels of EVERY system, each with its system. Only the formation and group forms read it,
 * always scoped to one system (`levelsOfSystem`). Keyed under `levels`, so saving a level
 * refreshes it too.
 */
export function useAllLevels() {
  return useQuery({
    queryKey: schoolKeys.allLevels,
    queryFn: async (): Promise<LevelOption[]> => {
      const rows = must(
        await supabase
          .from("levels")
          .select("id, system_id, code, name, stage, position, status")
          .order("position", { ascending: true }),
      );
      return rows.map((r) => ({
        id: r.id,
        systemId: r.system_id,
        code: r.code,
        name: r.name,
        stage: (r.stage ?? null) as LevelOption["stage"],
        position: r.position,
        status: r.status,
      }));
    },
  });
}

export function useSaveLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<Level> & { name: string; stage: LevelStage }) => {
      const payload = {
        name: input.name,
        stage: input.stage,
        position: input.position ?? 0,
        status: input.status ?? "active",
      };
      if (input.id) must(await supabase.from("levels").update(payload).eq("id", input.id).select());
      else must(await supabase.from("levels").insert(payload).select());
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: schoolKeys.levels }),
  });
}

export function useDeleteLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("levels").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: schoolKeys.levels }),
  });
}

/* ----------------------------- SUBJECTS ----------------------------- */

/**
 * Slug for a custom subject's stable key: accent-folded, lowercase, underscored.
 * Mirrors the backfill in `20260808100000_subject_locale_keys.sql` so a subject
 * added through the UI is keyed the same way one added in SQL would be.
 */
function slugifySubject(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function useSubjects() {
  return useQuery({
    queryKey: schoolKeys.subjects,
    queryFn: async (): Promise<Subject[]> => {
      const rows = must(await supabase.from("subjects").select("*").order("name"));
      return rows.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        color: r.color,
        description: r.description,
        domain: isSubjectDomain(r.domain) ? r.domain : DEFAULT_SUBJECT_DOMAIN,
        status: r.status as EntityStatus,
      }));
    },
  });
}

export function useSaveSubject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<Subject> & { name: string }) => {
      // `key` is the subject's locale-independent identity and is NOT NULL.
      // A subject created through the UI derives one from its name; the six
      // built-in subjects already carry curated keys that map to the i18n
      // dictionaries, so those are never regenerated here.
      const payload = {
        name: input.name,
        key: input.key ?? slugifySubject(input.name),
        color: input.color ?? "#0F766E",
        description: input.description ?? null,
        domain: input.domain ?? DEFAULT_SUBJECT_DOMAIN,
        status: input.status ?? "active",
      };
      if (input.id)
        must(await supabase.from("subjects").update(payload).eq("id", input.id).select());
      else must(await supabase.from("subjects").insert(payload).select());
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: schoolKeys.subjects }),
  });
}

export function useDeleteSubject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("subjects").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: schoolKeys.subjects }),
  });
}

/* ----------------------------- TEACHERS ----------------------------- */

export function useTeachers() {
  return useQuery({
    queryKey: schoolKeys.teachers,
    queryFn: async (): Promise<TeacherRow[]> => {
      const teachers = must(
        await supabase
          .from("teachers")
          .select(
            "id, experience_years, bio, status, profiles!inner(full_name, email, phone, avatar_url), teacher_subjects(subject_id, subjects(id, key, name))",
          ),
      );
      const groups = must(await supabase.from("groups").select("teacher_id"));
      return teachers.map((t) => ({
        id: t.id,
        fullName: t.profiles?.full_name ?? "—",
        email: t.profiles?.email ?? null,
        phone: t.profiles?.phone ?? null,
        avatarUrl: t.profiles?.avatar_url ?? null,
        experienceYears: t.experience_years,
        bio: t.bio ?? null,
        status: t.status as EntityStatus,
        subjects: (t.teacher_subjects ?? [])
          .map((ts) => ts.subjects?.name)
          .filter((n): n is string => !!n),
        subjectIds: (t.teacher_subjects ?? [])
          .map((ts) => ts.subject_id)
          .filter((id): id is string => !!id),
        groupCount: groups.filter((g) => g.teacher_id === t.id).length,
      }));
    },
  });
}

export function useUpdateTeacher() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      experienceYears: number;
      status: EntityStatus;
      subjectIds: string[];
      phone: string | null;
      bio: string | null;
    }) => {
      must(
        await supabase
          .from("teachers")
          .update({
            experience_years: input.experienceYears,
            status: input.status,
            bio: input.bio,
          })
          .eq("id", input.id)
          .select(),
      );
      must(
        await supabase.from("profiles").update({ phone: input.phone }).eq("id", input.id).select(),
      );
      const { error: delErr } = await supabase
        .from("teacher_subjects")
        .delete()
        .eq("teacher_id", input.id);
      if (delErr) throw new Error(delErr.message);
      if (input.subjectIds.length > 0) {
        must(
          await supabase
            .from("teacher_subjects")
            .insert(input.subjectIds.map((s) => ({ teacher_id: input.id, subject_id: s })))
            .select(),
        );
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: schoolKeys.teachers });
      void qc.invalidateQueries({ queryKey: schoolKeys.groups });
    },
  });
}

/* ----------------------------- STUDENTS ----------------------------- */

export function useStudents() {
  return useQuery({
    queryKey: schoolKeys.students,
    queryFn: async (): Promise<StudentRow[]> => {
      // `user_roles!inner` is defence in depth, not the primary guarantee.
      // ADR-002 makes a non-student row in this table unrepresentable via a
      // composite FK on (id, role); this join means that even if a future
      // migration weakened that constraint, staff could not silently reappear
      // in a student list.
      const students = must(
        await supabase
          .from("students")
          .select(
            "id, level_id, stream_id, status, registered_at, profiles!inner(full_name, email, phone, avatar_url), levels(name), user_roles!inner(role)",
          )
          .eq("user_roles.role", "student")
          .order("registered_at", { ascending: false }),
      );
      const regs = must(
        await supabase.from("registrations").select("student_id").eq("status", "approved"),
      );
      return students.map((s) => ({
        id: s.id,
        fullName: s.profiles?.full_name ?? "—",
        email: s.profiles?.email ?? null,
        phone: s.profiles?.phone ?? null,
        avatarUrl: s.profiles?.avatar_url ?? null,
        levelId: s.level_id,
        levelName: s.levels?.name ?? null,
        streamId: s.stream_id,
        status: s.status as EntityStatus,
        registeredAt: s.registered_at,
        groupCount: regs.filter((r) => r.student_id === s.id).length,
      }));
    },
  });
}

export function useUpdateStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      levelId: string | null;
      streamId?: string | null | undefined;
      status: EntityStatus;
      phone: string | null;
      fullName: string;
    }) => {
      must(
        await supabase
          .from("students")
          .update({
            level_id: input.levelId,
            ...(input.streamId !== undefined ? { stream_id: input.streamId } : {}),
            status: input.status,
          })
          .eq("id", input.id)
          .select(),
      );
      must(
        await supabase
          .from("profiles")
          .update({ phone: input.phone, full_name: input.fullName })
          .eq("id", input.id)
          .select(),
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: schoolKeys.students });
    },
  });
}

/* ------------------------------ GROUPS ------------------------------ */

export function useGroups() {
  return useQuery({
    queryKey: schoolKeys.groups,
    queryFn: async (): Promise<GroupRow[]> => {
      const groups = must(
        await supabase
          .from("groups")
          .select(
            "id, name, max_students, price_dzd, status, subject_id, teacher_id, level_id, stream_id, program_id, start_date, end_date, subjects(key, name, color), levels(name), programs(name), group_schedules(id, weekday, start_time, end_time, room, room_id)",
          )
          .order("name"),
      );
      // BOUNDED (BUG-01): the teachers' names come from one `in (...)` read of exactly the
      // teachers these groups name, and enrolment from `group_enrollment_counts` (one row per
      // group, security_invoker). Both used to scan whole tables -- every profile and every
      // registration -- and PostgREST silently caps a response at 1000 rows, so a school with
      // more registrations than that saw wrong occupancy. Same visibility as before: RLS still
      // decides which counts and names the caller may read.
      const teacherIds = [...new Set(groups.map((g) => g.teacher_id).filter(Boolean))] as string[];
      const [profiles, counts] = await Promise.all([
        teacherIds.length
          ? supabase.from("profiles").select("id, full_name, avatar_url").in("id", teacherIds)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from("group_enrollment_counts")
          .select("group_id, enrolled_count")
          .in(
            "group_id",
            groups.map((g) => g.id),
          ),
      ]);
      const names = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name]));
      const avatars = new Map((profiles.data ?? []).map((p) => [p.id, p.avatar_url]));
      const enrolledBy = new Map(
        (counts.data ?? []).map((c) => [c.group_id as string, Number(c.enrolled_count ?? 0)]),
      );

      return groups.map((g) => ({
        id: g.id,
        name: g.name,
        subjectId: g.subject_id,
        subjectKey: g.subjects?.key ?? null,
        subjectName: g.subjects?.name ?? null,
        subjectColor: g.subjects?.color ?? null,
        teacherId: g.teacher_id,
        teacherName: g.teacher_id ? (names.get(g.teacher_id) ?? null) : null,
        teacherAvatarUrl: g.teacher_id ? (avatars.get(g.teacher_id) ?? null) : null,
        levelId: g.level_id,
        levelName: g.levels?.name ?? null,
        streamId: g.stream_id,
        // RLS decides whether the name is visible: administrators see every programme, a
        // teacher only the programmes of their own groups, a student none (name is null).
        programId: g.program_id,
        programName: g.programs?.name ?? null,
        startDate: g.start_date,
        endDate: g.end_date,
        maxStudents: g.max_students,
        priceDzd: g.price_dzd,
        status: g.status as EntityStatus,
        enrolled: enrolledBy.get(g.id) ?? 0,
        schedules: (g.group_schedules ?? [])
          .map((s) => ({
            id: s.id,
            weekday: s.weekday,
            startTime: s.start_time.slice(0, 5),
            endTime: s.end_time.slice(0, 5),
            room: s.room,
            roomId: s.room_id ?? null,
          }))
          .sort((a, b) => a.weekday - b.weekday),
      }));
    },
  });
}

export interface GroupInput {
  id?: string;
  name: string;
  subjectId: string | null;
  teacherId: string | null;
  levelId: string | null;
  /** NULL means the group is open to every stream of its level. */
  streamId?: string | null | undefined;
  /** Optional programme the group runs. NULL keeps it standalone. */
  programId?: string | null | undefined;
  /** ISO date. Defaults to today server-side when omitted. */
  startDate?: string | null | undefined;
  endDate?: string | null | undefined;
  maxStudents: number;
  priceDzd: number;
  status: EntityStatus;
  schedules: {
    weekday: number;
    startTime: string;
    endTime: string;
    room: string | null;
    roomId?: string | null;
  }[];
}

export function useSaveGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: GroupInput) => {
      const payload = {
        name: input.name,
        subject_id: input.subjectId,
        teacher_id: input.teacherId,
        level_id: input.levelId,
        // Must be sent explicitly. Omitting it leaves stream_id untouched on
        // update (and NULL on insert), which the database rejects for a level
        // that offers streams.
        stream_id: input.streamId ?? null,
        // Sent explicitly for the same reason: omitting it on update would keep a stale
        // programme, and the programme-consistency trigger checks it with level/subject.
        program_id: input.programId ?? null,
        // Sent explicitly so an edit cannot silently drop the term window.
        ...(input.startDate ? { start_date: input.startDate } : {}),
        end_date: input.endDate ?? null,
        max_students: input.maxStudents,
        price_dzd: input.priceDzd,
        status: input.status,
      };
      let groupId = input.id;
      if (groupId) {
        must(await supabase.from("groups").update(payload).eq("id", groupId).select());
      } else {
        const rows = must(await supabase.from("groups").insert(payload).select("id"));
        groupId = rows[0]?.id;
      }
      if (!groupId) throw new Error("Groupe introuvable.");

      // Slots are replaced in ONE transaction (20261007110100): a refused slot -- a room already
      // taken, two slots the same day -- leaves the previous slots untouched. The error is thrown
      // as-is so its code (23514) shows the database's own sentence.
      const { error: slotsError } = await supabase.rpc("replace_group_schedules", {
        p_group: groupId,
        p_slots: input.schedules.map((s) => ({
          weekday: s.weekday,
          start_time: s.startTime,
          end_time: s.endTime,
          room: s.room,
          room_id: s.roomId ?? null,
        })) as Json,
      });
      if (slotsError) throw slotsError;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: schoolKeys.groups });
      // A group's programme, capacity or teacher feeds the programme list. The literal root
      // (programKeys.root in programs.ts) avoids a circular import between the two modules.
      void qc.invalidateQueries({ queryKey: ["programs"] });
    },
  });
}

export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("groups").delete().eq("id", id);
      // Thrown as-is, not re-wrapped: the caller needs `code` to tell a group
      // protected by its payments (23503, payments RESTRICT) from any other failure.
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: schoolKeys.groups }),
  });
}

/* --------------------------- REGISTRATIONS --------------------------- */

/**
 * What a registration row needs on screen. The student's name is embedded through
 * `students -> profiles` (RLS applies to both), instead of reading the whole profiles table.
 */
const REGISTRATION_SELECT =
  "id, student_id, group_id, status, note, created_at, decided_at, withdrawn_at, withdrawal_reason, groups(name, subjects(key, name), levels(name)), students(profiles(full_name))";

interface RawRegistration {
  id: string;
  student_id: string;
  group_id: string;
  status: string;
  note: string | null;
  created_at: string;
  decided_at: string | null;
  withdrawn_at: string | null;
  withdrawal_reason: string | null;
  groups: {
    name: string;
    subjects: { key: string | null; name: string } | null;
    levels: { name: string } | null;
  } | null;
  students: { profiles: { full_name: string | null } | null } | null;
}

function toRegistrationRow(r: RawRegistration): RegistrationRow {
  return {
    id: r.id,
    studentId: r.student_id,
    studentName: r.students?.profiles?.full_name || "—",
    groupId: r.group_id,
    groupName: r.groups?.name ?? "—",
    subjectKey: r.groups?.subjects?.key ?? null,
    subjectName: r.groups?.subjects?.name ?? null,
    levelName: r.groups?.levels?.name ?? null,
    status: r.status as RegistrationStatus,
    createdAt: r.created_at,
    note: r.note,
    decidedAt: r.decided_at,
    withdrawnAt: r.withdrawn_at,
    withdrawalReason: r.withdrawal_reason,
  };
}

/** Upper bound for one list response; PostgREST caps responses at 1000 rows anyway. */
export const REGISTRATION_LIST_LIMIT = 1000;

/**
 * Every registration the caller may read. Still one capped read (BUG-01 remains for its
 * dashboard/statistics consumers); enrollment management uses the bounded hooks below.
 */
export function useRegistrations() {
  return useQuery({
    queryKey: schoolKeys.registrations,
    queryFn: async (): Promise<RegistrationRow[]> => {
      const rows = must(
        await supabase
          .from("registrations")
          .select(REGISTRATION_SELECT)
          .order("created_at", { ascending: false }),
      ) as unknown as RawRegistration[];
      return rows.map(toRegistrationRow);
    },
  });
}

export interface BoundedRegistrations {
  rows: RegistrationRow[];
  /** Exact number of matching rows in the database. */
  total: number;
  /** More rows exist than were returned: the screen says so instead of looking complete. */
  truncated: boolean;
}

async function boundedRegistrations(
  filter: (q: ReturnType<typeof registrationsQuery>) => ReturnType<typeof registrationsQuery>,
): Promise<BoundedRegistrations> {
  const { data, error, count } = await filter(registrationsQuery())
    .order("created_at", { ascending: false })
    .limit(REGISTRATION_LIST_LIMIT);
  if (error) throw error;
  const rows = ((data ?? []) as unknown as RawRegistration[]).map(toRegistrationRow);
  const total = count ?? rows.length;
  return { rows, total, truncated: total > rows.length };
}

function registrationsQuery() {
  return supabase.from("registrations").select(REGISTRATION_SELECT, { count: "exact" });
}

/** One group's registrations, all states (enrolled, pending, history). Bounded by the group. */
export function useGroupRegistrations(groupId: string | undefined) {
  return useQuery({
    queryKey: schoolKeys.groupRegistrations(groupId ?? "none"),
    enabled: !!groupId,
    queryFn: () => boundedRegistrations((q) => q.eq("group_id", groupId as string)),
  });
}

/** The administration's queue, filtered by status on the server ("all" = every status). */
export function useRegistrationQueue(status: RegistrationStatus | "all") {
  return useQuery({
    queryKey: schoolKeys.registrationQueue(status),
    queryFn: () => boundedRegistrations((q) => (status === "all" ? q : q.eq("status", status))),
  });
}

/** Exact count per status, without reading the rows. */
export function useRegistrationCounts() {
  return useQuery({
    queryKey: schoolKeys.registrationCounts,
    queryFn: async () => {
      const statuses = ["pending", "approved", "rejected", "withdrawn"] as const;
      const results = await Promise.all(
        statuses.map((st) =>
          supabase
            .from("registrations")
            .select("id", { count: "exact", head: true })
            .eq("status", st),
        ),
      );
      const out: Record<(typeof statuses)[number] | "all", number> = {
        pending: 0,
        approved: 0,
        rejected: 0,
        withdrawn: 0,
        all: 0,
      };
      results.forEach((r, i) => {
        if (r.error) throw r.error;
        out[statuses[i] as (typeof statuses)[number]] = r.count ?? 0;
      });
      out.all = out.pending + out.approved + out.rejected + out.withdrawn;
      return out;
    },
  });
}

export interface StudentMatch {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  levelName: string | null;
  status: EntityStatus;
  onboarded: boolean;
}

/** How many students a search returns at most: enough to pick from, never the whole school. */
export const STUDENT_SEARCH_LIMIT = 20;

/**
 * Finds students by name, email or phone for the enrollment dialog -- on the server, capped at
 * `STUDENT_SEARCH_LIMIT`. Administrators read every student; RLS applies as usual.
 */
export function useStudentSearch(term: string) {
  const q = term.trim();
  return useQuery({
    queryKey: schoolKeys.studentSearch(q),
    enabled: q.length >= 2,
    queryFn: async (): Promise<StudentMatch[]> => {
      // Characters that are syntax in a PostgREST `or` filter are removed from the term.
      const safe = q.replace(/[,()*%\\]/g, " ").trim();
      const pattern = `%${safe}%`;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, phone, students!inner(status, onboarded_at, levels(name))")
        .or(`full_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`)
        .order("full_name")
        .limit(STUDENT_SEARCH_LIMIT);
      if (error) throw error;
      return (data ?? []).map((p) => {
        const st = p.students as unknown as {
          status: EntityStatus;
          onboarded_at: string | null;
          levels: { name: string } | null;
        } | null;
        return {
          id: p.id,
          fullName: p.full_name || "—",
          email: p.email,
          phone: p.phone,
          levelName: st?.levels?.name ?? null,
          status: st?.status ?? "active",
          onboarded: !!st?.onboarded_at,
        };
      });
    },
  });
}

function invalidateEnrollment(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: schoolKeys.registrations });
  void qc.invalidateQueries({ queryKey: schoolKeys.groups });
  // A group's enrolment feeds the formation list and page (literal root avoids a cycle).
  void qc.invalidateQueries({ queryKey: ["programs"] });
}

/**
 * The administration places a student in a group. If the student already has a pending
 * request there, it is approved (one row, not two); otherwise a new registration is inserted
 * as approved. The database decides: capacity, one active registration per group, one per
 * subject and level. Errors are thrown as-is so `enrollmentProblem` can name the reason.
 */
export function useEnrollStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      groupId: string;
      studentId: string;
      pendingRegistrationId?: string | null;
    }) => {
      const now = new Date().toISOString();
      const { error } = input.pendingRegistrationId
        ? await supabase
            .from("registrations")
            .update({ status: "approved", decided_at: now })
            .eq("id", input.pendingRegistrationId)
            .eq("status", "pending")
            .select("id")
            .single()
        : await supabase
            .from("registrations")
            .insert({
              student_id: input.studentId,
              group_id: input.groupId,
              status: "approved",
              decided_at: now,
            })
            .select("id")
            .single();
      if (error) throw error;
    },
    onSuccess: () => invalidateEnrollment(qc),
  });
}

/**
 * Ends a student's place in a group: the registration becomes `withdrawn` (when and by whom are
 * stamped by the database). Nothing is deleted -- attendance and payments stay with it, and the
 * student can be enrolled again later as a new registration.
 */
export function useWithdrawRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; reason: string | null }) => {
      const { error } = await supabase
        .from("registrations")
        .update({ status: "withdrawn", withdrawal_reason: input.reason?.trim() || null })
        .eq("id", input.id)
        .select("id")
        .single();
      if (error) throw error;
    },
    onSuccess: () => invalidateEnrollment(qc),
  });
}

export function useDecideRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: RegistrationStatus }) => {
      must(
        await supabase
          .from("registrations")
          .update({ status, decided_at: new Date().toISOString() })
          .eq("id", id)
          .select(),
      );
    },
    onSuccess: () => invalidateEnrollment(qc),
  });
}

export function useMyRegistrations(studentId: string | undefined) {
  return useQuery({
    queryKey: schoolKeys.myRegistrations(studentId ?? "anon"),
    enabled: !!studentId,
    queryFn: async () => {
      const rows = must(
        await supabase
          .from("registrations")
          .select(
            // `note` is the administration's reason for a decision -- shown to the
            // student on a rejected request rather than left in the table.
            "id, status, note, created_at, decided_at, withdrawn_at, withdrawal_reason, group_id, groups(name, price_dzd, max_students, stream_id, start_date, end_date, subjects(key, name, color), levels(name), group_schedules(id, weekday, start_time, end_time, room, room_id), teacher_id)",
          )
          .eq("student_id", studentId as string)
          .order("created_at", { ascending: false }),
      );
      return rows;
    },
  });
}

export function useCreateRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ studentId, groupId }: { studentId: string; groupId: string }) => {
      const rows = must(
        await supabase
          .from("registrations")
          .insert({ student_id: studentId, group_id: groupId })
          .select("id"),
      );
      // The confirmation page is addressed by registration id, so the caller
      // needs it back rather than just a success signal.
      return rows[0]?.id ?? null;
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: schoolKeys.myRegistrations(vars.studentId) });
      void qc.invalidateQueries({ queryKey: schoolKeys.registrations });
    },
  });
}

/**
 * Withdraws the student's own request.
 *
 * A DELETE rather than a status change, because that is what the schema supports: the
 * `registrations delete` policy already allows `student_id = auth.uid()`, and there is
 * no `cancelled` value in `registration_status` (pending / approved / rejected). RLS is
 * the gate -- a student cannot remove anyone else's row, and this needs no new policy.
 *
 * Deleting also frees the (student, group) unique pair, which is what lets a student
 * apply again later. A soft "cancelled" state would keep occupying it.
 */
export function useCancelRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; studentId: string }) => {
      const { error } = await supabase.from("registrations").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: schoolKeys.myRegistrations(vars.studentId) });
      void qc.invalidateQueries({ queryKey: schoolKeys.registrations });
      void qc.invalidateQueries({ queryKey: schoolKeys.groups });
    },
  });
}

/* ---------------------------- ATTENDANCE ---------------------------- */

/** One register that has been taken: a (group, date) pair. */
export interface MarkedSession {
  groupId: string;
  sessionDate: string;
}

/**
 * Which registers have already been taken since `from`.
 *
 * Deliberately narrow: only the two columns needed to answer "was this session
 * marked?". `useAttendance` returns a full roster for one group on one date,
 * which is the wrong granularity -- detecting forgotten registers spans every
 * group the teacher owns. RLS already limits rows to sessions they may see.
 */
export function useMarkedSessions(from: string) {
  return useQuery({
    queryKey: schoolKeys.markedSessions(from),
    queryFn: async (): Promise<MarkedSession[]> => {
      const rows = must(
        await supabase
          .from("attendance")
          .select("group_id, session_date")
          .gte("session_date", from),
      );
      // Many student rows collapse to one marked session.
      const seen = new Set<string>();
      const out: MarkedSession[] = [];
      for (const r of rows) {
        const key = `${r.group_id}|${r.session_date}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ groupId: r.group_id, sessionDate: r.session_date });
      }
      return out;
    },
  });
}

export function useAttendance(groupId: string | undefined, date: string) {
  return useQuery({
    queryKey: schoolKeys.attendance(groupId ?? "none", date),
    enabled: !!groupId,
    queryFn: async () => {
      const [roster, marks] = await Promise.all([
        supabase
          .from("registrations")
          .select("student_id, profiles:students(id, profiles(full_name, avatar_url))")
          .eq("group_id", groupId as string)
          .eq("status", "approved"),
        supabase
          .from("attendance")
          .select("student_id, status")
          .eq("group_id", groupId as string)
          .eq("session_date", date),
      ]);
      if (roster.error) throw new Error(roster.error.message);
      if (marks.error) throw new Error(marks.error.message);

      const marked = new Map(marks.data.map((m) => [m.student_id, m.status as AttendanceStatus]));
      return (roster.data ?? []).map((r) => ({
        studentId: r.student_id,
        fullName: r.profiles?.profiles?.full_name ?? "—",
        avatarUrl: r.profiles?.profiles?.avatar_url ?? null,
        status: marked.get(r.student_id) ?? null,
      }));
    },
  });
}

export interface AttendanceSaveInput {
  groupId: string;
  date: string;
  markedBy: string;
  entries: { studentId: string; status: AttendanceStatus }[];
}

/**
 * The attendance write itself. Standalone so the desktop app can replay it after a restart
 * (ADR-010): an upsert on (group, student, date), so sending it twice is harmless.
 */
export async function saveAttendanceEntries(input: AttendanceSaveInput): Promise<void> {
  if (input.entries.length === 0) return;
  must(
    await supabase
      .from("attendance")
      .upsert(
        input.entries.map((e) => ({
          group_id: input.groupId,
          student_id: e.studentId,
          session_date: input.date,
          status: e.status,
          marked_by: input.markedBy,
        })),
        { onConflict: "group_id,student_id,session_date" },
      )
      .select(),
  );
}

export function useSaveAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: OFFLINE_MUTATIONS.attendance,
    mutationFn: saveAttendanceEntries,
    // Invalidate the ROOT, not the one roster key. The workspace's pending
    // count, the student portal and the admin dashboard all read this table;
    // naming them individually meant each new consumer had to be remembered,
    // and three were already being missed.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: schoolKeys.attendanceRoot });
    },
  });
}

export function useMyAttendance(studentId: string | undefined) {
  return useQuery({
    queryKey: schoolKeys.myAttendance(studentId ?? "anon"),
    enabled: !!studentId,
    queryFn: async () => {
      const rows = must(
        await supabase
          .from("attendance")
          .select("id, session_date, status, groups(name)")
          .eq("student_id", studentId as string)
          .order("session_date", { ascending: false })
          .limit(50),
      );
      return rows;
    },
  });
}

/* ------------------------ TODAY'S ATTENDANCE ------------------------ */

export function useTodayAttendance(date: string) {
  return useQuery({
    queryKey: schoolKeys.todayAttendance(date),
    queryFn: async () => {
      const rows = must(
        await supabase.from("attendance").select("status").eq("session_date", date),
      );
      return {
        total: rows.length,
        present: rows.filter((r) => r.status === "present").length,
      };
    },
  });
}

/* ----------------------------- SETTINGS ----------------------------- */

export interface CenterSettings {
  school_name: string;
  academic_year: string;
  default_language: string;
  phone: string | null;
  address: string | null;
  logo_url: string | null;
}

export function useCenterSettings() {
  return useQuery({
    queryKey: schoolKeys.settings,
    queryFn: async (): Promise<CenterSettings | null> => {
      const { data, error } = await supabase
        .from("center_settings")
        .select("school_name, academic_year, default_language, phone, address, logo_url")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as CenterSettings | null) ?? null;
    },
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      // No `schoolName` either: it is the school's identity, and `features/branding` owns it.
      academicYear: string;
      defaultLanguage: string;
      phone: string | null;
      address: string | null;
      // No `logoUrl`. The logo is branding, and `features/branding` owns that column --
      // two writers for one field is how an upload gets undone by an unrelated Save.
    }) => {
      must(
        await supabase
          .from("center_settings")
          .update({
            academic_year: input.academicYear,
            default_language: input.defaultLanguage,
            phone: input.phone,
            address: input.address,
          })
          .eq("id", true)
          .select(),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: schoolKeys.settings }),
  });
}
