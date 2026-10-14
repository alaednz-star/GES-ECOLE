/**
 * Fees and installments: what an enrollment owes (ADR-005). Fetches and writes only; every figure
 * is computed in `fee-model.ts`, which is pure and unit tested.
 *
 * A separate module, like `payments.ts`: one screen's data should not drag the whole school's
 * query surface behind the shell.
 *
 * SECURITY is enforced by the database, not here: administrators read every charge, a student
 * only those of their own enrollments, teachers none (RLS, 20261006100100). Clients hold no write
 * privilege on the tables; `save_charge` and `cancel_charge` are the only write path, check the
 * administrator role first and write the audit log themselves.
 *
 * ERRORS are thrown as the Supabase error object: `lib/errors.ts` classifies by `code` (42501
 * forbidden, 23505 duplicate, 23514 with the function's own sentence).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type {
  Charge,
  ChargeDiscount,
  ChargeStatus,
  ChargeValues,
  FeeType,
  ReceivedPayment,
} from "./fee-types";

export const feeKeys = {
  root: ["fees"] as const,
  types: () => ["fees", "types"] as const,
  student: (studentId: string) => ["fees", "student", studentId] as const,
  /** Under the payments root, so recording, editing or deleting a payment refreshes it. */
  studentPayments: (studentId: string) => ["payments", "student", studentId] as const,
};

/** Every fee type, active or not: an inactive type must still label the charges that use it. */
export function useFeeTypes() {
  return useQuery({
    queryKey: feeKeys.types(),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<FeeType[]> => {
      const { data, error } = await supabase
        .from("fee_types")
        .select("code, name, built_in, status, position")
        .order("position");
      if (error) throw error;
      return (data ?? []).map((t) => ({
        code: t.code,
        name: t.name,
        builtIn: t.built_in,
        active: t.status === "active",
        position: t.position,
      }));
    },
  });
}

export interface RawCharge {
  id: string;
  registration_id: string;
  fee_type: string;
  label: string | null;
  amount_dzd: number;
  note: string | null;
  status: string;
  created_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  installments: { id: string; position: number; amount_dzd: number; due_on: string }[] | null;
  discounts?: RawDiscount[] | null;
}

interface RawDiscount {
  id: string;
  label: string;
  amount_dzd: number;
  reason: string | null;
  status: string;
  granted_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

/** The embed and mapping shared by every screen that reads charges (student, balances). */
export const CHARGE_SELECT =
  "id, registration_id, fee_type, label, amount_dzd, note, status, created_at, cancelled_at, cancel_reason, installments:charge_installments ( id, position, amount_dzd, due_on ), discounts:charge_discounts ( id, label, amount_dzd, reason, status, granted_at, cancelled_at, cancel_reason )";

export function toCharge(c: RawCharge): Charge {
  return {
    id: c.id,
    registrationId: c.registration_id,
    feeType: c.fee_type,
    label: c.label,
    amountDzd: c.amount_dzd,
    note: c.note,
    status: c.status as ChargeStatus,
    createdAt: c.created_at,
    cancelledAt: c.cancelled_at,
    cancelReason: c.cancel_reason,
    installments: (c.installments ?? [])
      .map((i) => ({ id: i.id, position: i.position, amountDzd: i.amount_dzd, dueOn: i.due_on }))
      .sort((a, b) => a.position - b.position),
    discounts: (c.discounts ?? [])
      .map((d) => ({
        id: d.id,
        label: d.label,
        amountDzd: d.amount_dzd,
        reason: d.reason,
        status: d.status as ChargeDiscount["status"],
        grantedAt: d.granted_at,
        cancelledAt: d.cancelled_at,
        cancelReason: d.cancel_reason,
      }))
      .sort((a, b) => a.grantedAt.localeCompare(b.grantedAt)),
  };
}

/** A student's charges with their installments, all enrollments, cancelled ones included. */
export function useStudentCharges(studentId: string, enabled = true) {
  return useQuery({
    queryKey: feeKeys.student(studentId),
    enabled,
    queryFn: async (): Promise<Charge[]> => {
      const { data, error } = await supabase
        .from("charges")
        .select(`${CHARGE_SELECT}, registration:registrations!inner ( student_id )`)
        .eq("registration.student_id", studentId)
        .order("created_at");
      if (error) throw error;
      return ((data ?? []) as unknown as RawCharge[]).map(toCharge);
    },
  });
}

/** The money a student has paid, per enrollment (read from the unchanged payments ledger). */
export function useStudentPayments(studentId: string, enabled = true) {
  return useQuery({
    queryKey: feeKeys.studentPayments(studentId),
    enabled,
    queryFn: async (): Promise<ReceivedPayment[]> => {
      const { data, error } = await supabase
        .from("payments")
        .select(
          "id, registration_id, amount_dzd, paid_on, method, registration:registrations!inner ( student_id )",
        )
        .eq("registration.student_id", studentId)
        .order("paid_on", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((p) => ({
        id: p.id,
        registrationId: p.registration_id,
        amountDzd: p.amount_dzd,
        paidOn: p.paid_on,
        method: p.method,
      }));
    },
  });
}

/**
 * Creates a charge on an enrollment (`id` absent) or edits an active one. The whole schedule is
 * sent each time; an edit replaces it. The enrollment of an existing charge never changes.
 */
export function useSaveCharge(studentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ChargeValues & { id?: string; registrationId: string }) => {
      // The generated Args type every parameter as non-null; `save_charge` takes NULL for "new
      // charge", "no label" and "no note".
      const none = null as unknown as string;
      const { data, error } = await supabase.rpc("save_charge", {
        p_charge: input.id ?? none,
        p_registration: input.registrationId,
        p_fee_type: input.feeType,
        p_label: input.label ?? none,
        p_amount: input.amountDzd,
        p_note: input.note ?? none,
        p_installments: input.installments.map((i) => ({
          due_on: i.dueOn,
          amount_dzd: i.amountDzd,
        })) as Json,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: feeKeys.student(studentId) }),
  });
}

/** Cancels an active charge, with a reason. It stays listed and stops counting as owed. */
export function useCancelCharge(studentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("cancel_charge", {
        p_charge: input.id,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: feeKeys.student(studentId) }),
  });
}
