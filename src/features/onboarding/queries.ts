import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normaliseAlgerianPhone } from "@/lib/phone";
import type { Gender, OnboardingInput, OnboardingStatus } from "./types";

export const onboardingKeys = {
  status: (userId: string) => ["onboarding-status", userId] as const,
};

/**
 * Whether this student still needs to complete onboarding.
 *
 * Only students are gated. Admins and teachers have no `students` row, so the
 * query returns `needsOnboarding: false` for them and the gate lets them
 * straight through.
 */
export function useOnboardingStatus(userId: string | undefined, isStudent: boolean) {
  return useQuery({
    queryKey: onboardingKeys.status(userId ?? "anon"),
    enabled: !!userId && isStudent,
    // The answer changes exactly once per account, so there is no reason to
    // re-fetch it on every navigation.
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<OnboardingStatus> => {
      const { data, error } = await supabase
        .from("students")
        .select("onboarded_at, level_id")
        .eq("id", userId as string)
        .maybeSingle();
      if (error) throw error;
      return {
        // No students row means nothing to complete -- treat as done rather
        // than trapping the user in a wizard that cannot save.
        needsOnboarding: data ? data.onboarded_at === null : false,
        onboardedAt: data?.onboarded_at ?? null,
      };
    },
  });
}

/**
 * Writes the wizard's answers across `profiles` and `students`, then stamps
 * `onboarded_at`.
 *
 * The stamp is written last and in its own statement: the CHECK constraint
 * `students_onboarding_complete` rejects a stamped row whose required fields
 * are missing, so if the first update fails the account simply stays
 * un-onboarded and the student can retry. There is no half-finished state.
 */
export function useCompleteOnboarding(userId: string | undefined) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: OnboardingInput) => {
      if (!userId) throw new Error("Not authenticated");

      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          full_name: input.fullName.trim(),
          // Store one canonical shape (0XXXXXXXXX) so numbers are comparable
          // and exportable regardless of how they were typed.
          phone: input.phone ? normaliseAlgerianPhone(input.phone) : null,
        })
        .eq("id", userId);
      if (profileError) throw profileError;

      const { error: studentError } = await supabase
        .from("students")
        .update({
          gender: input.gender as Gender,
          date_of_birth: input.dateOfBirth,
          guardian_name: input.guardianName.trim(),
          guardian_phone: normaliseAlgerianPhone(input.guardianPhone) ?? input.guardianPhone.trim(),
          address: input.address?.trim() || null,
          level_id: input.levelId,
          stream_id: input.streamId ?? null,
          onboarded_at: new Date().toISOString(),
        })
        .eq("id", userId);
      if (studentError) throw studentError;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: onboardingKeys.status(userId ?? "anon") });
      void qc.invalidateQueries({ queryKey: ["my-profile", userId ?? "anon"] });
      void qc.invalidateQueries({ queryKey: ["students"] });
    },
  });
}
