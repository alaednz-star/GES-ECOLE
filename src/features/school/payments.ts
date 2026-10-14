/**
 * Payment management: the ledger of money received, its totals, and the writes.
 *
 * A separate module from `queries.ts` for the same reason `resources/queries.ts` is: one
 * screen's data should not drag the whole school's query surface behind the shell. Every
 * figure is computed in `payment-model.ts`, which is pure and unit tested; this file only
 * fetches and writes.
 *
 * SECURITY. Admin-only is enforced by RLS (20260820100000, 20260930100100), not here and not
 * by the route guard: teachers match no payments policy, students read only their own, and
 * only the five editable columns can be updated at all. Every insert, edit and delete is
 * written to `audit_log` by a trigger, so nothing in this file needs to remember to.
 *
 * ERRORS are thrown as the Supabase error object, not re-wrapped: `lib/errors.ts` classifies
 * by `code` (23503 "in use", 42501 "forbidden", 23514 with the trigger's own sentence), and a
 * `new Error(message)` would throw that code away.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type {
  DailyTotal,
  PayableRegistration,
  PaymentFilters,
  PaymentMethod,
  PaymentRecord,
  PaymentValues,
} from "./payment-types";

/**
 * Upper bound on rows per ledger window. A month of a centre's payments is far below it; if a
 * window ever reaches it, the page says so rather than silently dropping rows (the lesson
 * ADR-003 §5.2 records about `useAttendanceRange`'s silent cap).
 *
 * Truncation is detected with PostgREST's exact COUNT of the filtered window, NOT by asking for
 * `LEDGER_LIMIT + 1` rows: PostgREST caps every response at `max_rows` (Supabase default 1000),
 * so a 1001-row request silently returns 1000 and the overflow would never be seen. Measured on
 * the local stack: `limit=1500` answered `Content-Range: 0-999/2412`.
 */
export const LEDGER_LIMIT = 1000;

export const paymentKeys = {
  /** Everything under one root: any write refreshes the ledger, the totals and the pickers. */
  root: ["payments"] as const,
  /** Both window ends and every filter are in the key (ADR-003 §7.2). */
  ledger: (f: PaymentFilters) =>
    ["payments", "ledger", f.from, f.to, f.method, f.groupId, f.studentId] as const,
  totals: () => ["payments", "daily-totals"] as const,
  payable: () => ["payments", "payable-registrations"] as const,
};

/*
  THE STUDENT'S NAME LIVES ON `profiles`, NOT `students`.

  The previous ledger embedded `students:student_id(id, full_name)`. `students` has no
  `full_name` column, so every request failed with 42703 and -- because the page never
  rendered query errors -- the admin saw an empty list instead of a failure. The path is
  registrations.student_id -> students.id -> profiles.id, and the embed below walks it.
*/
const LEDGER_SELECT = `
  id, amount_dzd, paid_on, method, note, reference, created_at, updated_at, recorded_by,
  registration:registrations!inner (
    id, student_id, group_id,
    student:students ( profile:profiles ( full_name, email ) ),
    group:groups ( id, name )
  )
`;

interface RawLedgerRow {
  id: string;
  amount_dzd: number;
  paid_on: string;
  method: string;
  note: string | null;
  reference: string | null;
  created_at: string;
  updated_at: string;
  recorded_by: string | null;
  registration: {
    id: string;
    student_id: string | null;
    group_id: string | null;
    student: { profile: { full_name: string | null; email: string | null } | null } | null;
    group: { id: string; name: string } | null;
  } | null;
}

export interface LedgerResult {
  rows: PaymentRecord[];
  /** Payments matching the filters in the window, including any not returned. */
  total: number;
  /** True when the window held more payments than were returned. */
  truncated: boolean;
}

/**
 * Payments in a date window, newest first, filtered on the server.
 *
 * Two round trips, never N+1: the payments with their student and group embedded, then the
 * names of the (few) staff who recorded them. `recorded_by` references `auth.users`, which
 * PostgREST cannot embed, so the recorders are resolved in one `in (...)` read of `profiles`
 * -- admins may read every profile.
 */
export function usePaymentLedger(filters: PaymentFilters) {
  return useQuery({
    queryKey: paymentKeys.ledger(filters),
    queryFn: async (): Promise<LedgerResult> => {
      let query = supabase
        .from("payments")
        .select(LEDGER_SELECT, { count: "exact" })
        .gte("paid_on", filters.from)
        .lte("paid_on", filters.to)
        .order("paid_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(LEDGER_LIMIT);
      if (filters.method !== "all") query = query.eq("method", filters.method);
      if (filters.groupId !== "all") query = query.eq("registration.group_id", filters.groupId);
      if (filters.studentId !== "all") {
        query = query.eq("registration.student_id", filters.studentId);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      const page = (data ?? []) as unknown as RawLedgerRow[];
      const total = count ?? page.length;
      const truncated = total > page.length;

      const recorderIds = [...new Set(page.map((r) => r.recorded_by).filter(Boolean))] as string[];
      const names = new Map<string, string>();
      if (recorderIds.length > 0) {
        const { data: people, error: peopleError } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", recorderIds);
        if (peopleError) throw peopleError;
        for (const p of people ?? []) names.set(p.id, p.full_name);
      }

      return {
        total,
        truncated,
        rows: page.map((r) => ({
          id: r.id,
          amountDzd: r.amount_dzd,
          paidOn: r.paid_on,
          method: r.method as PaymentMethod,
          note: r.note,
          reference: r.reference,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          registrationId: r.registration?.id ?? "",
          studentId: r.registration?.student_id ?? null,
          studentName: r.registration?.student?.profile?.full_name || null,
          studentEmail: r.registration?.student?.profile?.email ?? null,
          groupId: r.registration?.group?.id ?? null,
          groupName: r.registration?.group?.name ?? null,
          recordedBy: r.recorded_by,
          recordedByName: r.recorded_by ? (names.get(r.recorded_by) ?? null) : null,
        })),
      };
    },
  });
}

/**
 * Per-day sums from `payment_daily_totals` (security_invoker). One row per day that has
 * payments, so a year is a few hundred rows however many payments it holds.
 */
export function usePaymentDailyTotals() {
  return useQuery({
    queryKey: paymentKeys.totals(),
    queryFn: async (): Promise<DailyTotal[]> => {
      const { data, error } = await supabase
        .from("payment_daily_totals")
        .select("paid_on, total_dzd, payment_count");
      if (error) throw error;
      return (data ?? [])
        .filter((d) => d.paid_on !== null)
        .map((d) => ({
          paidOn: d.paid_on as string,
          totalDzd: Number(d.total_dzd ?? 0),
          paymentCount: Number(d.payment_count ?? 0),
        }));
    },
  });
}

/**
 * Approved registrations -- the only thing a payment may be recorded against (the insert
 * policy refuses anything else). Feeds the form's picker and the student/group filters.
 */
export function usePayableRegistrations() {
  return useQuery({
    queryKey: paymentKeys.payable(),
    queryFn: async (): Promise<PayableRegistration[]> => {
      const { data, error } = await supabase
        .from("registrations")
        .select(
          "id, student_id, group_id, student:students ( profile:profiles ( full_name ) ), group:groups ( id, name, program:programs ( name ) )",
        )
        .eq("status", "approved");
      if (error) throw error;
      const raw = (data ?? []) as unknown as {
        id: string;
        student_id: string;
        group_id: string | null;
        student: { profile: { full_name: string | null } | null } | null;
        group: { id: string; name: string; program: { name: string } | null } | null;
      }[];
      return raw
        .map((r) => ({
          registrationId: r.id,
          studentId: r.student_id,
          studentName: r.student?.profile?.full_name || null,
          groupId: r.group?.id ?? r.group_id,
          groupName: r.group?.name ?? null,
          programName: r.group?.program?.name ?? null,
        }))
        .sort(
          (a, b) =>
            (a.studentName ?? "").localeCompare(b.studentName ?? "") ||
            (a.groupName ?? "").localeCompare(b.groupName ?? ""),
        );
    },
  });
}

/**
 * Records money received. `recorded_by` is the signed-in user; the insert policy refuses any
 * other value and any registration that is not approved.
 */
export function useRecordPayment() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: PaymentValues & { registrationId: string }) => {
      const { error } = await supabase.from("payments").insert({
        registration_id: input.registrationId,
        amount_dzd: input.amountDzd,
        paid_on: input.paidOn,
        method: input.method,
        note: input.note,
        reference: input.reference,
        recorded_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentKeys.root }),
  });
}

/**
 * Corrects a payment. Only the five editable columns are sent -- the database refuses any
 * other (column-level UPDATE grant), so the registration and recorder cannot be changed.
 *
 * `.select("id")` so an update that matched nothing (another admin deleted the payment
 * meanwhile) is reported instead of silently "succeeding" on zero rows.
 */
export function useUpdatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PaymentValues & { id: string }) => {
      const { data, error } = await supabase
        .from("payments")
        .update({
          amount_dzd: input.amountDzd,
          paid_on: input.paidOn,
          method: input.method,
          note: input.note,
          reference: input.reference,
        })
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw { code: "PGRST116", message: "Payment not found" };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentKeys.root }),
  });
}

/** Removes a payment recorded in error. Admin-only by policy; audited by trigger. */
export function useDeletePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from("payments").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw { code: "PGRST116", message: "Payment not found" };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentKeys.root }),
  });
}
