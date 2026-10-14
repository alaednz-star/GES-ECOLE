/**
 * Programmes: the educational offering above groups (20261001100000_programs.sql).
 *
 * A separate module, like `payments.ts`: one screen's data should not drag the whole school's
 * query surface behind it. Rules live in `program-model.ts` (pure, unit tested).
 *
 * SECURITY is RLS: administrators write; a teacher reads only the programmes their own groups
 * belong to; students and anonymous visitors read nothing. The route guard is navigation.
 *
 * THREE ROUND TRIPS, NEVER N+1: the programmes with their groups embedded; the approved
 * enrolment count of those groups from `group_enrollment_counts` (security_invoker); the
 * teachers' names in one `in (...)` read of `profiles`.
 *
 * Errors are thrown as the Supabase error object so `lib/errors.ts` can classify by `code`
 * (23505 duplicate name, 23503 programme still has groups, 23514 with the trigger's sentence).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { schoolKeys } from "./queries";
import type { Json } from "@/integrations/supabase/types";
import {
  createFormationPayload,
  type FirstGroupValues,
  type NewProgramStatus,
  type ProgramCategory,
  type ProgramStatus,
  type ProgramValues,
} from "./program-model";

export const programKeys = {
  root: ["programs"] as const,
  list: () => ["programs", "list"] as const,
};

export interface ProgramGroup {
  id: string;
  name: string;
  status: string;
  maxStudents: number;
  enrolled: number;
  teacherId: string | null;
  teacherName: string | null;
}

export interface ProgramRow {
  id: string;
  name: string;
  category: ProgramCategory;
  status: ProgramStatus;
  registrationOpen: boolean;
  description: string | null;
  curriculum: string | null;
  /** NULL = no specific level. */
  levelSystemId: string | null;
  levelSystemCode: string | null;
  levelSystemName: string | null;
  levelId: string | null;
  levelName: string | null;
  subjectId: string | null;
  subjectKey: string | null;
  subjectName: string | null;
  startDate: string | null;
  endDate: string | null;
  durationHours: number | null;
  createdAt: string;
  updatedAt: string;
  groups: ProgramGroup[];
}

interface RawProgram {
  id: string;
  name: string;
  category: string;
  status: string;
  registration_open: boolean;
  description: string | null;
  curriculum: string | null;
  level_system_id: string | null;
  level_id: string | null;
  subject_id: string | null;
  start_date: string | null;
  end_date: string | null;
  duration_hours: number | null;
  created_at: string;
  updated_at: string;
  level_system: { code: string; name: string } | null;
  level: { name: string } | null;
  subject: { key: string | null; name: string } | null;
  groups: {
    id: string;
    name: string;
    status: string;
    max_students: number;
    teacher_id: string | null;
  }[];
}

export function usePrograms() {
  return useQuery({
    queryKey: programKeys.list(),
    queryFn: async (): Promise<ProgramRow[]> => {
      const { data, error } = await supabase
        .from("programs")
        .select(
          `id, name, category, status, registration_open, description, curriculum,
           level_system_id, level_id, subject_id, start_date, end_date, duration_hours,
           created_at, updated_at,
           level_system:level_systems ( code, name ),
           level:levels ( name ),
           subject:subjects ( key, name ),
           groups ( id, name, status, max_students, teacher_id )`,
        )
        .order("name");
      if (error) throw error;
      const raw = (data ?? []) as unknown as RawProgram[];

      const groupIds = raw.flatMap((p) => p.groups.map((g) => g.id));
      const teacherIds = [
        ...new Set(raw.flatMap((p) => p.groups.map((g) => g.teacher_id)).filter(Boolean)),
      ] as string[];

      const [counts, people] = await Promise.all([
        groupIds.length
          ? supabase
              .from("group_enrollment_counts")
              .select("group_id, enrolled_count")
              .in("group_id", groupIds)
          : Promise.resolve({ data: [], error: null }),
        teacherIds.length
          ? supabase.from("profiles").select("id, full_name").in("id", teacherIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (counts.error) throw counts.error;
      if (people.error) throw people.error;

      const enrolled = new Map(
        (counts.data ?? []).map((c) => [c.group_id as string, Number(c.enrolled_count ?? 0)]),
      );
      const names = new Map((people.data ?? []).map((p) => [p.id, p.full_name]));

      return raw.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category as ProgramCategory,
        status: p.status as ProgramStatus,
        registrationOpen: p.registration_open,
        description: p.description,
        curriculum: p.curriculum,
        levelSystemId: p.level_system_id,
        levelSystemCode: p.level_system?.code ?? null,
        levelSystemName: p.level_system?.name ?? null,
        levelId: p.level_id,
        levelName: p.level?.name ?? null,
        subjectId: p.subject_id,
        subjectKey: p.subject?.key ?? null,
        subjectName: p.subject?.name ?? null,
        startDate: p.start_date,
        endDate: p.end_date,
        durationHours: p.duration_hours,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        groups: p.groups
          .map((g) => ({
            id: g.id,
            name: g.name,
            status: g.status,
            maxStudents: g.max_students,
            enrolled: enrolled.get(g.id) ?? 0,
            teacherId: g.teacher_id,
            teacherName: g.teacher_id ? (names.get(g.teacher_id) ?? null) : null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }));
    },
  });
}

function toRow(v: ProgramValues) {
  return {
    name: v.name,
    category: v.category,
    description: v.description,
    curriculum: v.curriculum,
    level_system_id: v.levelSystemId,
    level_id: v.levelId,
    subject_id: v.subjectId,
    start_date: v.startDate,
    end_date: v.endDate,
    duration_hours: v.durationHours,
    registration_open: v.registrationOpen,
  };
}

/** Creates (as a draft) or edits a programme. Status changes go through `useSetProgramStatus`. */
/**
 * Creates a formation and, optionally, its first group and weekly slots -- atomically, through
 * `public.create_formation` (20261003110000). The function runs as the caller (SECURITY
 * INVOKER), so the administrator-only policies and every group trigger still apply; if any part
 * fails, nothing is created. Returns the new formation's id (and the group's, when one was made).
 */
export function useCreateFormation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      values: ProgramValues;
      status: NewProgramStatus;
      firstGroup: FirstGroupValues | null;
    }) => {
      const payload = createFormationPayload(input.values, input.status, input.firstGroup);
      const { data, error } = await supabase.rpc("create_formation", {
        formation: payload.formation as Json,
        ...(payload.first_group ? { first_group: payload.first_group as Json } : {}),
      });
      if (error) throw error;
      const result = (data ?? {}) as { program_id?: string; group_id?: string | null };
      if (!result.program_id) throw { code: "PGRST116", message: "Formation not created" };
      return { programId: result.program_id, groupId: result.group_id ?? null };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: programKeys.root });
      void qc.invalidateQueries({ queryKey: schoolKeys.groups });
    },
  });
}

export function useSaveProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProgramValues & { id?: string }) => {
      if (input.id) {
        const { data, error } = await supabase
          .from("programs")
          .update(toRow(input))
          .eq("id", input.id)
          .select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw { code: "PGRST116", message: "Programme not found" };
        return input.id;
      }
      const { data, error } = await supabase
        .from("programs")
        .insert({ ...toRow(input), status: "draft", registration_open: false })
        .select("id");
      if (error) throw error;
      return data?.[0]?.id ?? null;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: programKeys.root }),
  });
}

/**
 * Deletes a formation that has no groups. The database refuses one that still has groups
 * (23503, `groups_program_id_fkey` ON DELETE RESTRICT): its groups, enrollments and payments are
 * never removed with it. Administrators only (RLS `programs admin write`).
 */
export function useDeleteProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from("programs").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw { code: "PGRST116", message: "Formation not found" };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: programKeys.root });
      void qc.invalidateQueries({ queryKey: schoolKeys.groups });
    },
  });
}

/**
 * Moves a programme through its lifecycle. `registrationOpen` is sent with the status because
 * the database refuses open registrations on anything but an active programme.
 */
export function useSetProgramStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: ProgramStatus; registrationOpen: boolean }) => {
      const { data, error } = await supabase
        .from("programs")
        .update({ status: input.status, registration_open: input.registrationOpen })
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw { code: "PGRST116", message: "Programme not found" };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: programKeys.root });
      void qc.invalidateQueries({ queryKey: schoolKeys.groups });
    },
  });
}
