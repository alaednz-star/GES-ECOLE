/**
 * Pre-registrations for the administration screen (20261005110000_applications.sql).
 *
 * Reads and simple status changes go straight to the table: RLS lets administrators -- and only
 * them -- read and update applications. Acceptance goes through `acceptApplicationFn`, because it
 * may create a student account (service role, server side).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { currentAccessToken } from "@/integrations/supabase/access-token";
import { programKeys } from "@/features/school/programs";
import { schoolKeys } from "@/features/school/queries";
import { acceptApplicationFn } from "./admissions.functions";
import type {
  ApplicationStatus,
  DuplicateCandidateSource,
  GuardianRelation,
} from "./application-model";

export const admissionKeys = {
  root: ["applications"] as const,
  candidates: (id: string) => ["applications", "candidates", id] as const,
};

export interface ApplicationRow {
  id: string;
  programId: string | null;
  programName: string;
  preferredGroupId: string | null;
  preferredGroupName: string | null;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string | null;
  email: string | null;
  schoolLevelName: string | null;
  schoolName: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianRelation: GuardianRelation | null;
  preferredSchedule: string | null;
  message: string | null;
  locale: string;
  status: ApplicationStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  studentId: string | null;
  registrationId: string | null;
  createdAt: string;
}

/** Bounded: the most recent 500 applications (open ones first in the screen). */
const LIST_LIMIT = 500;

export function useApplications() {
  return useQuery({
    queryKey: admissionKeys.root,
    queryFn: async (): Promise<ApplicationRow[]> => {
      const { data, error } = await supabase
        .from("applications")
        .select(
          `id, program_id, program_name, preferred_group_id, first_name, last_name, date_of_birth,
           phone, email, school_name, guardian_name, guardian_phone, guardian_relation,
           preferred_schedule, message, locale, status, decision_note, decided_at, student_id,
           registration_id, created_at,
           preferred_group:groups ( name ),
           school_level:levels ( name )`,
        )
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT);
      if (error) throw error;
      return (data ?? []).map((a) => ({
        id: a.id,
        programId: a.program_id,
        programName: a.program_name,
        preferredGroupId: a.preferred_group_id,
        preferredGroupName: (a.preferred_group as unknown as { name: string } | null)?.name ?? null,
        firstName: a.first_name,
        lastName: a.last_name,
        dateOfBirth: a.date_of_birth,
        phone: a.phone,
        email: a.email,
        schoolLevelName: (a.school_level as unknown as { name: string } | null)?.name ?? null,
        schoolName: a.school_name,
        guardianName: a.guardian_name,
        guardianPhone: a.guardian_phone,
        guardianRelation: a.guardian_relation as GuardianRelation | null,
        preferredSchedule: a.preferred_schedule,
        message: a.message,
        locale: a.locale,
        status: a.status as ApplicationStatus,
        decisionNote: a.decision_note,
        decidedAt: a.decided_at,
        studentId: a.student_id,
        registrationId: a.registration_id,
        createdAt: a.created_at,
      }));
    },
  });
}

/** Number of applications waiting for a first look (sidebar / header badge). */
export function useNewApplicationsCount() {
  return useQuery({
    queryKey: [...admissionKeys.root, "new-count"],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("status", "new");
      if (error) throw error;
      return count ?? 0;
    },
  });
}

/**
 * Students who may be the applicant: same phone (student or guardian), or same name. The final
 * ranking is `duplicateCandidates` (pure); this only narrows the read.
 */
export function useCandidateStudents(application: ApplicationRow | null) {
  return useQuery({
    queryKey: admissionKeys.candidates(application?.id ?? "none"),
    enabled: application !== null,
    queryFn: async (): Promise<DuplicateCandidateSource[]> => {
      if (!application) return [];
      const phones = [application.phone, application.guardianPhone].filter(Boolean) as string[];
      const lastName = application.lastName.replace(/[%_,()]/g, " ").trim();
      const filters = [
        ...phones.map((p) => `phone.eq.${p}`),
        ...(lastName ? [`full_name.ilike.%${lastName}%`] : []),
      ];
      const byProfile = filters.length
        ? await supabase
            .from("profiles")
            .select("id, full_name, phone, students!inner ( guardian_phone, date_of_birth )")
            .or(filters.join(","))
            .limit(50)
        : { data: [], error: null };
      const byGuardian = phones.length
        ? await supabase
            .from("students")
            .select(
              "id, guardian_phone, date_of_birth, profile:profiles!students_id_fkey ( full_name, phone )",
            )
            .in("guardian_phone", phones)
            .limit(50)
        : { data: [], error: null };
      if (byProfile.error) throw byProfile.error;
      if (byGuardian.error) throw byGuardian.error;
      const out = new Map<string, DuplicateCandidateSource>();
      for (const p of byProfile.data ?? []) {
        const s = p.students as unknown as {
          guardian_phone: string | null;
          date_of_birth: string | null;
        } | null;
        out.set(p.id, {
          id: p.id,
          fullName: p.full_name,
          phone: p.phone,
          guardianPhone: s?.guardian_phone ?? null,
          dateOfBirth: s?.date_of_birth ?? null,
        });
      }
      for (const s of byGuardian.data ?? []) {
        const profile = s.profile as unknown as { full_name: string; phone: string | null } | null;
        out.set(s.id, {
          id: s.id,
          fullName: profile?.full_name ?? "",
          phone: profile?.phone ?? null,
          guardianPhone: s.guardian_phone,
          dateOfBirth: s.date_of_birth,
        });
      }
      return [...out.values()];
    },
  });
}

/** Review moves that need no account: start review, refuse, mark duplicate, reopen. */
export function useSetApplicationStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      status: "reviewing" | "rejected" | "duplicate";
      note?: string | null;
      studentId?: string | null;
    }) => {
      const decided = input.status !== "reviewing";
      const { data: auth } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("applications")
        .update({
          status: input.status,
          decision_note: decided ? input.note?.trim() || null : null,
          decided_at: decided ? new Date().toISOString() : null,
          decided_by: decided ? (auth.user?.id ?? null) : null,
          ...(input.status === "duplicate" ? { student_id: input.studentId ?? null } : {}),
        })
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw { code: "PGRST116", message: "Application not found" };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: admissionKeys.root }),
  });
}

export function useAcceptApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      applicationId: string;
      studentId: string | null;
      groupId: string;
    }) => {
      const accessToken = await currentAccessToken();
      if (!accessToken) throw { code: "UNAUTHENTICATED", message: "Session expired" };
      const result = await acceptApplicationFn({ data: { accessToken, ...input } });
      if (!result.ok) throw { code: result.code, message: result.message };
      return result;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: admissionKeys.root });
      void qc.invalidateQueries({ queryKey: schoolKeys.registrations });
      void qc.invalidateQueries({ queryKey: schoolKeys.students });
      void qc.invalidateQueries({ queryKey: schoolKeys.groups });
      void qc.invalidateQueries({ queryKey: programKeys.root });
    },
  });
}
