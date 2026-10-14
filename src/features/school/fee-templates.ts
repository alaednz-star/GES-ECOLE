/**
 * Formation fee templates and group overrides: fetch and write (ADR-005). Rules and arithmetic
 * live in `fee-template-model.ts` (pure, tested).
 *
 * SECURITY is the database's: templates are readable by administrators only, and written only
 * through `save_fee_template`, `remove_fee_template` and `customize_group_fees` (admin check,
 * audited). Templates never touch existing charges; a new APPROVED enrollment receives its
 * charges from them in the database, whatever screen created it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { FeeTemplate, FeeTemplateInstallment, TemplateValues } from "./fee-template-model";

export const feeTemplateKeys = {
  /** Every template query: a write refreshes the formation, its groups and the catalogue. */
  root: ["fee-templates"] as const,
  program: (programId: string) => ["fee-templates", "program", programId] as const,
  group: (groupId: string) => ["fee-templates", "group", groupId] as const,
  all: () => ["fee-templates", "all"] as const,
};

interface RawTemplate {
  id: string;
  program_id: string | null;
  group_id: string | null;
  fee_type: string;
  label: string | null;
  amount_dzd: number;
  schedule: unknown;
  position: number;
}

const TEMPLATE_SELECT = "id, program_id, group_id, fee_type, label, amount_dzd, schedule, position";

function toTemplate(t: RawTemplate): FeeTemplate {
  return {
    id: t.id,
    programId: t.program_id,
    groupId: t.group_id,
    feeType: t.fee_type,
    label: t.label,
    amountDzd: t.amount_dzd,
    schedule: ((t.schedule ?? []) as { months: number; amount_dzd: number }[]).map(
      (s): FeeTemplateInstallment => ({ months: s.months, amountDzd: s.amount_dzd }),
    ),
    position: t.position,
  };
}

/** Every active item of every formation, in one read: the catalogue page (no N+1). */
export function useAllFeeTemplates() {
  return useQuery({
    queryKey: feeTemplateKeys.all(),
    queryFn: async (): Promise<FeeTemplate[]> => {
      const { data, error } = await supabase
        .from("fee_templates")
        .select(TEMPLATE_SELECT)
        .eq("status", "active")
        .order("position");
      if (error) throw error;
      return ((data ?? []) as RawTemplate[]).map(toTemplate);
    },
  });
}

/** The active items of a formation: its defaults and every group override. */
export function useFeeTemplates(programId: string | null | undefined, groupId?: string | null) {
  // A formation's items (defaults and overrides), or -- for a group without formation -- its own.
  const standalone = !programId && !!groupId;
  return useQuery({
    queryKey: standalone
      ? feeTemplateKeys.group(groupId as string)
      : feeTemplateKeys.program(programId ?? ""),
    enabled: !!programId || standalone,
    queryFn: async (): Promise<FeeTemplate[]> => {
      const base = supabase.from("fee_templates").select(TEMPLATE_SELECT).eq("status", "active");
      const { data, error } = await (
        standalone
          ? base.eq("group_id", groupId as string).is("program_id", null)
          : base.eq("program_id", programId as string)
      ).order("position");
      if (error) throw error;
      return ((data ?? []) as RawTemplate[]).map(toTemplate);
    },
  });
}

/** Creates (no `id`) or edits an item. Applies to FUTURE enrollments only. */
export function useSaveFeeTemplate(programId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TemplateValues & { id?: string; groupId: string | null }) => {
      // The generated Args type every parameter as non-null; NULL means "new", "formation
      // default" and "no label".
      const none = null as unknown as string;
      const { data, error } = await supabase.rpc("save_fee_template", {
        p_id: input.id ?? none,
        p_program: programId ?? none,
        p_group: input.groupId ?? none,
        p_fee_type: input.feeType,
        p_label: input.label ?? none,
        p_amount: input.amountDzd,
        p_schedule: input.schedule.map((s) => ({
          months: s.months,
          amount_dzd: s.amountDzd,
        })) as Json,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: feeTemplateKeys.root }),
  });
}

/** Removes an item: deleted if unused, archived if charges came from it. */
export function useRemoveFeeTemplate(_programId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<"deleted" | "archived"> => {
      const { data, error } = await supabase.rpc("remove_fee_template", { p_id: id });
      if (error) throw error;
      return data === "archived" ? "archived" : "deleted";
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: feeTemplateKeys.root }),
  });
}

/** Starts a group's own fees from a copy of the formation's defaults. */
export function useCustomizeGroupFees(_programId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (groupId: string): Promise<number> => {
      const { data, error } = await supabase.rpc("customize_group_fees", { p_group: groupId });
      if (error) throw error;
      return data ?? 0;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: feeTemplateKeys.root }),
  });
}
