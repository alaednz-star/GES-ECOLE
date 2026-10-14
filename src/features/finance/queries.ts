/**
 * Finance management data (ADR-006): balances, discounts, receipts, invoices, reports, billing
 * identity. Fetches and writes only; figures come from the pure models next to this file.
 *
 * SECURITY is the database's: every table is admin-read (students their own receipts and
 * invoices), and every write goes through an audited SECURITY DEFINER function. Errors are thrown
 * as the Supabase error object (lib/errors.ts classifies by code).
 *
 * SCALE: PostgREST caps a response at max_rows (1000). Lists that can grow beyond it are read page
 * by page (`readAll`); aggregates come from small security_invoker views.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { schoolNameOrNull } from "@/lib/brand";
import { CHARGE_SELECT, toCharge, type RawCharge } from "../school/fees";
import type { Charge } from "../school/fee-types";
import type { BalanceEnrollment } from "./balances-model";
import type { ChargeMonthRow, PaymentMonthRow } from "./reports-model";
import type { Discount, DiscountKind } from "./discount-model";

export const financeKeys = {
  root: ["finance"] as const,
  balances: () => ["finance", "balances"] as const,
  discounts: () => ["finance", "discounts"] as const,
  grants: () => ["finance", "grants"] as const,
  receipts: () => ["finance", "receipts"] as const,
  receipt: (id: string) => ["finance", "receipt", id] as const,
  paymentReceipt: (paymentId: string) => ["finance", "payment-receipt", paymentId] as const,
  invoices: () => ["finance", "invoices"] as const,
  invoice: (id: string) => ["finance", "invoice", id] as const,
  reports: () => ["finance", "reports"] as const,
  billing: () => ["finance", "billing"] as const,
};

const PAGE = 1000;

/** Reads every row of a query, page by page (PostgREST caps each response at 1000). */
async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/* ------------------------------------------------------------------ balances */

interface RawBalanceCharge extends RawCharge {
  registration: {
    id: string;
    student_id: string;
    status: string;
    student: { profile: { full_name: string | null } | null } | null;
    group: { name: string; program_id: string | null; program: { name: string } | null } | null;
  } | null;
}

export interface FinanceLedger {
  enrollments: BalanceEnrollment[];
  charges: Charge[];
  paid: Map<string, number>;
}

/** Every active fee (with installments and discounts) and the payments total per enrollment. */
export function useFinanceLedger() {
  return useQuery({
    queryKey: financeKeys.balances(),
    queryFn: async (): Promise<FinanceLedger> => {
      const raw = await readAll<RawBalanceCharge>((from, to) =>
        supabase
          .from("charges")
          .select(
            `${CHARGE_SELECT}, registration:registrations!inner ( id, student_id, status, student:students ( profile:profiles ( full_name ) ), group:groups ( name, program_id, program:programs ( name ) ) )`,
          )
          .eq("status", "active")
          .order("id")
          .range(from, to),
      );
      const totals = await readAll<{ registration_id: string | null; paid_dzd: number | null }>(
        (from, to) =>
          supabase
            .from("enrollment_payment_totals")
            .select("registration_id, paid_dzd")
            .order("registration_id")
            .range(from, to),
      );
      const paid = new Map<string, number>();
      for (const t of totals) {
        if (t.registration_id) paid.set(t.registration_id, Number(t.paid_dzd ?? 0));
      }

      const enrollments = new Map<string, BalanceEnrollment>();
      for (const c of raw) {
        const r = c.registration;
        if (!r || enrollments.has(r.id)) continue;
        enrollments.set(r.id, {
          registrationId: r.id,
          studentId: r.student_id,
          studentName: r.student?.profile?.full_name || "—",
          groupName: r.group?.name ?? null,
          programId: r.group?.program_id ?? null,
          programName: r.group?.program?.name ?? null,
          status: r.status,
        });
      }
      // Enrollments with payments but no active fee still appear (an advance).
      const missing = [...paid.keys()].filter((id) => !enrollments.has(id));
      for (let i = 0; i < missing.length; i += 200) {
        const { data, error } = await supabase
          .from("registrations")
          .select(
            "id, student_id, status, student:students ( profile:profiles ( full_name ) ), group:groups ( name, program_id, program:programs ( name ) )",
          )
          .in("id", missing.slice(i, i + 200));
        if (error) throw error;
        for (const r of (data ?? []) as unknown as NonNullable<
          RawBalanceCharge["registration"]
        >[]) {
          enrollments.set(r.id, {
            registrationId: r.id,
            studentId: r.student_id,
            studentName: r.student?.profile?.full_name || "—",
            groupName: r.group?.name ?? null,
            programId: r.group?.program_id ?? null,
            programName: r.group?.program?.name ?? null,
            status: r.status,
          });
        }
      }
      return { enrollments: [...enrollments.values()], charges: raw.map(toCharge), paid };
    },
  });
}

/* ------------------------------------------------------------------ discounts */

export function useDiscounts() {
  return useQuery({
    queryKey: financeKeys.discounts(),
    queryFn: async (): Promise<Discount[]> => {
      const { data, error } = await supabase
        .from("discounts")
        .select("id, name, kind, value, fee_type, description, status")
        .order("name");
      if (error) throw error;
      return (data ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        kind: d.kind as DiscountKind,
        value: d.value,
        feeType: d.fee_type,
        description: d.description,
        active: d.status === "active",
      }));
    },
  });
}

export interface DiscountGrant {
  id: string;
  label: string;
  amountDzd: number;
  reason: string | null;
  status: "active" | "cancelled";
  grantedAt: string;
  cancelReason: string | null;
  discountId: string | null;
  chargeFeeType: string;
  chargeLabel: string | null;
  chargeAmountDzd: number;
  studentId: string | null;
  studentName: string | null;
  groupName: string | null;
}

/** Every grant, newest first (the Remises & bourses page). */
export function useDiscountGrants() {
  return useQuery({
    queryKey: financeKeys.grants(),
    queryFn: async (): Promise<DiscountGrant[]> => {
      type Raw = {
        id: string;
        label: string;
        amount_dzd: number;
        reason: string | null;
        status: string;
        granted_at: string;
        cancel_reason: string | null;
        discount_id: string | null;
        charge: {
          fee_type: string;
          label: string | null;
          amount_dzd: number;
          registration: {
            student_id: string;
            student: { profile: { full_name: string | null } | null } | null;
            group: { name: string } | null;
          } | null;
        } | null;
      };
      const raw = await readAll<Raw>((from, to) =>
        supabase
          .from("charge_discounts")
          .select(
            "id, label, amount_dzd, reason, status, granted_at, cancel_reason, discount_id, charge:charges ( fee_type, label, amount_dzd, registration:registrations ( student_id, student:students ( profile:profiles ( full_name ) ), group:groups ( name ) ) )",
          )
          .order("granted_at", { ascending: false })
          .range(from, to),
      );
      return raw.map((g) => ({
        id: g.id,
        label: g.label,
        amountDzd: g.amount_dzd,
        reason: g.reason,
        status: g.status as DiscountGrant["status"],
        grantedAt: g.granted_at,
        cancelReason: g.cancel_reason,
        discountId: g.discount_id,
        chargeFeeType: g.charge?.fee_type ?? "other",
        chargeLabel: g.charge?.label ?? null,
        chargeAmountDzd: g.charge?.amount_dzd ?? 0,
        studentId: g.charge?.registration?.student_id ?? null,
        studentName: g.charge?.registration?.student?.profile?.full_name || null,
        groupName: g.charge?.registration?.group?.name ?? null,
      }));
    },
  });
}

/** Any write here can change balances, the student page and reports: refresh them all. */
function useInvalidateMoney() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: financeKeys.root });
    void qc.invalidateQueries({ queryKey: ["fees"] });
    void qc.invalidateQueries({ queryKey: ["payments"] });
  };
}

const NONE = null as unknown as string;

export function useSaveDiscount() {
  const refresh = useInvalidateMoney();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      name: string;
      kind: DiscountKind;
      value: number;
      feeType: string | null;
      description: string | null;
    }) => {
      const { error } = await supabase.rpc("save_discount", {
        p_id: input.id ?? NONE,
        p_name: input.name,
        p_kind: input.kind,
        p_value: input.value,
        p_fee_type: input.feeType ?? NONE,
        p_description: input.description ?? NONE,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
}

export function useSetDiscountActive() {
  const refresh = useInvalidateMoney();
  return useMutation({
    mutationFn: async (input: { id: string; active: boolean }) => {
      const { error } = await supabase.rpc("set_discount_active", {
        p_id: input.id,
        p_active: input.active,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
}

export function useGrantDiscount() {
  const refresh = useInvalidateMoney();
  return useMutation({
    mutationFn: async (input: {
      chargeId: string;
      discountId: string | null;
      amountDzd: number | null;
      label: string | null;
      reason: string | null;
    }) => {
      const { error } = await supabase.rpc("grant_discount", {
        p_charge: input.chargeId,
        p_discount: input.discountId ?? NONE,
        p_amount: (input.amountDzd ?? null) as unknown as number,
        p_label: input.label ?? NONE,
        p_reason: input.reason ?? NONE,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
}

export function useCancelDiscount() {
  const refresh = useInvalidateMoney();
  return useMutation({
    mutationFn: async (input: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("cancel_discount", {
        p_grant: input.id,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
}

/* ------------------------------------------------------------------ receipts */

export interface Receipt {
  id: string;
  number: string;
  paymentId: string | null;
  registrationId: string | null;
  studentId: string | null;
  studentName: string | null;
  groupName: string | null;
  programName: string | null;
  amountDzd: number;
  paidOn: string;
  method: string;
  reference: string | null;
  status: "issued" | "voided";
  issuedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

const RECEIPT_SELECT =
  "id, number, payment_id, registration_id, student_id, student_name, group_name, program_name, amount_dzd, paid_on, method, reference, status, issued_at, voided_at, void_reason";

type RawReceipt = {
  id: string;
  number: string;
  payment_id: string | null;
  registration_id: string | null;
  student_id: string | null;
  student_name: string | null;
  group_name: string | null;
  program_name: string | null;
  amount_dzd: number;
  paid_on: string;
  method: string;
  reference: string | null;
  status: string;
  issued_at: string;
  voided_at: string | null;
  void_reason: string | null;
};

function toReceipt(r: RawReceipt): Receipt {
  return {
    id: r.id,
    number: r.number,
    paymentId: r.payment_id,
    registrationId: r.registration_id,
    studentId: r.student_id,
    studentName: r.student_name,
    groupName: r.group_name,
    programName: r.program_name,
    amountDzd: r.amount_dzd,
    paidOn: r.paid_on,
    method: r.method,
    reference: r.reference,
    status: r.status as Receipt["status"],
    issuedAt: r.issued_at,
    voidedAt: r.voided_at,
    voidReason: r.void_reason,
  };
}

export function useReceipts() {
  return useQuery({
    queryKey: financeKeys.receipts(),
    queryFn: async (): Promise<Receipt[]> =>
      (
        await readAll<RawReceipt>((from, to) =>
          supabase
            .from("receipts")
            .select(RECEIPT_SELECT)
            .order("issued_at", { ascending: false })
            .order("number", { ascending: false })
            .range(from, to),
        )
      ).map(toReceipt),
  });
}

export function useReceipt(id: string) {
  return useQuery({
    queryKey: financeKeys.receipt(id),
    queryFn: async (): Promise<Receipt | null> => {
      const { data, error } = await supabase
        .from("receipts")
        .select(RECEIPT_SELECT)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? toReceipt(data as RawReceipt) : null;
    },
  });
}

/** The current (issued) receipt of a payment. */
export function usePaymentReceipt(paymentId: string | null) {
  return useQuery({
    queryKey: financeKeys.paymentReceipt(paymentId ?? ""),
    enabled: !!paymentId,
    queryFn: async (): Promise<Receipt | null> => {
      const { data, error } = await supabase
        .from("receipts")
        .select(RECEIPT_SELECT)
        .eq("payment_id", paymentId as string)
        .eq("status", "issued")
        .maybeSingle();
      if (error) throw error;
      return data ? toReceipt(data as RawReceipt) : null;
    },
  });
}

/* ------------------------------------------------------------------ invoices */

export interface InvoiceLine {
  chargeId: string;
  feeType: string;
  label: string | null;
  amountDzd: number;
  installments: { position: number; dueOn: string; amountDzd: number }[];
}

/** The issuer frozen into an invoice when it was issued. */
export interface InvoiceIssuer {
  schoolName: string | null;
  legalName: string | null;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
  nif: string | null;
  nis: string | null;
  rc: string | null;
  taxArticle: string | null;
}

export interface Invoice {
  id: string;
  number: string;
  registrationId: string | null;
  studentId: string | null;
  studentName: string | null;
  groupName: string | null;
  programName: string | null;
  issuer: InvoiceIssuer;
  lines: InvoiceLine[];
  discounts: { label: string; amountDzd: number }[];
  totalDzd: number;
  discountDzd: number;
  paidDzd: number;
  balanceDzd: number;
  status: "issued" | "voided";
  issuedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

const INVOICE_SELECT =
  "id, number, registration_id, student_id, student_name, group_name, program_name, issuer, lines, discounts, total_dzd, discount_dzd, paid_dzd, balance_dzd, status, issued_at, voided_at, void_reason";

type RawInvoice = {
  id: string;
  number: string;
  registration_id: string | null;
  student_id: string | null;
  student_name: string | null;
  group_name: string | null;
  program_name: string | null;
  issuer: unknown;
  lines: unknown;
  discounts: unknown;
  total_dzd: number;
  discount_dzd: number;
  paid_dzd: number;
  balance_dzd: number;
  status: string;
  issued_at: string;
  voided_at: string | null;
  void_reason: string | null;
};

function toIssuer(i: Record<string, string | null | undefined>): InvoiceIssuer {
  return {
    schoolName: i["school_name"] ?? null,
    legalName: i["legal_name"] ?? null,
    address: i["address"] ?? null,
    phone: i["phone"] ?? null,
    logoUrl: i["logo_url"] ?? null,
    nif: i["nif"] ?? null,
    nis: i["nis"] ?? null,
    rc: i["rc"] ?? null,
    taxArticle: i["tax_article"] ?? null,
  };
}

function toInvoice(r: RawInvoice): Invoice {
  const lines = (r.lines ?? []) as {
    charge_id: string;
    fee_type: string;
    label: string | null;
    amount_dzd: number;
    installments: { position: number; due_on: string; amount_dzd: number }[] | null;
  }[];
  return {
    id: r.id,
    number: r.number,
    registrationId: r.registration_id,
    studentId: r.student_id,
    studentName: r.student_name,
    groupName: r.group_name,
    programName: r.program_name,
    issuer: toIssuer((r.issuer ?? {}) as Record<string, string | null | undefined>),
    lines: lines.map((l) => ({
      chargeId: l.charge_id,
      feeType: l.fee_type,
      label: l.label,
      amountDzd: l.amount_dzd,
      installments: (l.installments ?? []).map((i) => ({
        position: i.position,
        dueOn: i.due_on,
        amountDzd: i.amount_dzd,
      })),
    })),
    discounts: ((r.discounts ?? []) as { label: string; amount_dzd: number }[]).map((d) => ({
      label: d.label,
      amountDzd: d.amount_dzd,
    })),
    totalDzd: r.total_dzd,
    discountDzd: r.discount_dzd,
    paidDzd: r.paid_dzd,
    balanceDzd: r.balance_dzd,
    status: r.status as Invoice["status"],
    issuedAt: r.issued_at,
    voidedAt: r.voided_at,
    voidReason: r.void_reason,
  };
}

export function useInvoices() {
  return useQuery({
    queryKey: financeKeys.invoices(),
    queryFn: async (): Promise<Invoice[]> =>
      (
        await readAll<RawInvoice>((from, to) =>
          supabase
            .from("invoices")
            .select(INVOICE_SELECT)
            .order("issued_at", { ascending: false })
            .range(from, to),
        )
      ).map(toInvoice),
  });
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: financeKeys.invoice(id),
    queryFn: async (): Promise<Invoice | null> => {
      const { data, error } = await supabase
        .from("invoices")
        .select(INVOICE_SELECT)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? toInvoice(data as RawInvoice) : null;
    },
  });
}

export function useIssueInvoice() {
  const refresh = useInvalidateMoney();
  return useMutation({
    mutationFn: async (registrationId: string): Promise<string> => {
      const { data, error } = await supabase.rpc("issue_invoice", {
        p_registration: registrationId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: refresh,
  });
}

export function useVoidInvoice() {
  const refresh = useInvalidateMoney();
  return useMutation({
    mutationFn: async (input: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("void_invoice", {
        p_id: input.id,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
}

/* ------------------------------------------------------------------ billing identity */

export interface BillingIdentity {
  /** center_settings is a singleton keyed by a boolean. */
  id: boolean;
  schoolName: string | null;
  legalName: string | null;
  nif: string | null;
  nis: string | null;
  rc: string | null;
  taxArticle: string | null;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
}

export function useBillingIdentity() {
  return useQuery({
    queryKey: financeKeys.billing(),
    queryFn: async (): Promise<BillingIdentity | null> => {
      const { data, error } = await supabase
        .from("center_settings")
        .select("id, school_name, legal_name, nif, nis, rc, tax_article, address, phone, logo_url")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        schoolName: schoolNameOrNull(data.school_name),
        legalName: data.legal_name,
        nif: data.nif,
        nis: data.nis,
        rc: data.rc,
        taxArticle: data.tax_article,
        address: data.address,
        phone: data.phone,
        logoUrl: data.logo_url,
      };
    },
  });
}

/** Admin-only by RLS ("settings admin write"). */
export function useSaveBillingIdentity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: boolean;
      legalName: string | null;
      nif: string | null;
      nis: string | null;
      rc: string | null;
      taxArticle: string | null;
    }) => {
      const { data, error } = await supabase
        .from("center_settings")
        .update({
          legal_name: input.legalName,
          nif: input.nif,
          nis: input.nis,
          rc: input.rc,
          tax_article: input.taxArticle,
        })
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw { code: "42501", message: "Not allowed" };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: financeKeys.billing() }),
  });
}

/* ------------------------------------------------------------------ reports */

export function useFinanceReportRows() {
  return useQuery({
    queryKey: financeKeys.reports(),
    queryFn: async (): Promise<{ payments: PaymentMonthRow[]; charges: ChargeMonthRow[] }> => {
      const pay = await readAll<{
        month: string | null;
        program_id: string | null;
        program_name: string | null;
        method: string | null;
        total_dzd: number | null;
        payment_count: number | null;
      }>((from, to) =>
        supabase.from("finance_payments_monthly").select("*").order("month").range(from, to),
      );
      const chg = await readAll<{
        month: string | null;
        program_id: string | null;
        program_name: string | null;
        fee_type: string | null;
        charged_dzd: number | null;
        charge_count: number | null;
        discounted_dzd: number | null;
      }>((from, to) =>
        supabase.from("finance_charges_monthly").select("*").order("month").range(from, to),
      );
      return {
        payments: pay
          .filter((r) => r.month)
          .map((r) => ({
            month: r.month as string,
            programId: r.program_id,
            programName: r.program_name,
            method: r.method ?? "other",
            totalDzd: Number(r.total_dzd ?? 0),
            paymentCount: Number(r.payment_count ?? 0),
          })),
        charges: chg
          .filter((r) => r.month)
          .map((r) => ({
            month: r.month as string,
            programId: r.program_id,
            programName: r.program_name,
            feeType: r.fee_type ?? "other",
            chargedDzd: Number(r.charged_dzd ?? 0),
            chargeCount: Number(r.charge_count ?? 0),
            discountedDzd: Number(r.discounted_dzd ?? 0),
          })),
      };
    },
  });
}

/** A student's current receipts, by payment (student page links). */
export function useStudentReceipts(studentId: string) {
  return useQuery({
    queryKey: [...financeKeys.receipts(), "student", studentId],
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase
        .from("receipts")
        .select("id, payment_id")
        .eq("student_id", studentId)
        .eq("status", "issued");
      if (error) throw error;
      const map = new Map<string, string>();
      for (const r of data ?? []) if (r.payment_id) map.set(r.payment_id, r.id);
      return map;
    },
  });
}
