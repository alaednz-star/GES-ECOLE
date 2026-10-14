/**
 * Payment arithmetic and validation. PURE.
 *
 * Deliberately free of runtime imports so `node --test` can load it (the Resources module
 * learned this the hard way). Money logic is the last thing that should be hard to test.
 *
 * ACTUAL MONEY ONLY. Everything here sums payments that were received. Nothing computes what
 * a family owes: `groups.price_dzd` has no billing period, so an "outstanding" figure derived
 * from it would be an assumption presented as a fact. Expected and outstanding amounts belong
 * to the payment-schedule phase.
 *
 * WHOLE DINARS, INTEGER ARITHMETIC. `amount_dzd` is an `int`; nothing here divides.
 */

import {
  PAYMENT_AMOUNT_MAX,
  PAYMENT_METHODS,
  PAYMENT_NOTE_MAX,
  PAYMENT_REFERENCE_MAX,
  type DailyTotal,
  type PayableRegistration,
  type PaymentDraft,
  type PaymentValues,
} from "./payment-types.ts";

export interface PaymentTotals {
  totalDzd: number;
  count: number;
  todayDzd: number;
  todayCount: number;
  monthDzd: number;
  monthCount: number;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Header figures from `payment_daily_totals`.
 *
 * `today` is the caller's LOCAL date (`todayIso()`), never the server's: the view groups by
 * `paid_on`, which is already a local calendar date, so comparing it to a UTC date would move
 * the late evening into tomorrow. "This month" is the calendar month containing `today`.
 */
export function summarisePayments(
  days: readonly DailyTotal[] | null | undefined,
  today: string,
): PaymentTotals {
  const totals: PaymentTotals = {
    totalDzd: 0,
    count: 0,
    todayDzd: 0,
    todayCount: 0,
    monthDzd: 0,
    monthCount: 0,
  };
  if (!days) return totals;
  const month = today.slice(0, 7);
  for (const d of days) {
    const amount = num(d?.totalDzd);
    const count = num(d?.paymentCount);
    totals.totalDzd += amount;
    totals.count += count;
    if (d?.paidOn === today) {
      totals.todayDzd += amount;
      totals.todayCount += count;
    }
    if (typeof d?.paidOn === "string" && d.paidOn.slice(0, 7) === month) {
      totals.monthDzd += amount;
      totals.monthCount += count;
    }
  }
  return totals;
}

/** Sum of a list of payments, for the ledger's "shown" footer. */
export function sumAmounts(rows: readonly { amountDzd: number }[] | null | undefined): number {
  if (!rows) return 0;
  let sum = 0;
  for (const r of rows) sum += num(r?.amountDzd);
  return sum;
}

/** First and last day of the month containing `isoDate`, both `YYYY-MM-DD`. */
export function monthBounds(isoDate: string): { from: string; to: string } {
  const [y, m] = isoDate.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

/** A real calendar date in `YYYY-MM-DD` form -- rejects `2026-02-30`. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export type PaymentField = "amount" | "paidOn" | "method" | "note" | "reference";

export type PaymentValidation =
  | { ok: true; values: PaymentValues }
  | { ok: false; errors: Partial<Record<PaymentField, string>> };

/**
 * Validates a form draft against the same rules the database enforces, so the admin reads a
 * translated sentence instead of a rejected request. The database remains the authority:
 * every rule here is also a CHECK, a trigger or a policy.
 *
 * Returns i18n keys, not text, so this stays free of the dictionary.
 */
export function validatePaymentDraft(draft: PaymentDraft, today: string): PaymentValidation {
  const errors: Partial<Record<PaymentField, string>> = {};

  // Digits only: "1500.5", "1e3", "-200" and "1 500" are all refused rather than coerced.
  // `Math.trunc` would have silently recorded 1500 for "1500.9".
  const amountText = draft.amount.trim();
  const amount = /^\d+$/.test(amountText) ? Number(amountText) : NaN;
  if (!Number.isSafeInteger(amount) || amount <= 0) errors.amount = "payments.error.amount";
  else if (amount > PAYMENT_AMOUNT_MAX) errors.amount = "payments.error.amountTooLarge";

  if (!isIsoDate(draft.paidOn) || draft.paidOn < "2000-01-01") {
    errors.paidOn = "payments.error.date";
  } else if (draft.paidOn > today) {
    errors.paidOn = "payments.error.dateFuture";
  }

  if (!(PAYMENT_METHODS as readonly string[]).includes(draft.method)) {
    errors.method = "payments.error.method";
  }

  const note = draft.note.trim();
  if (note.length > PAYMENT_NOTE_MAX) errors.note = "payments.error.noteTooLong";

  const reference = draft.reference.trim();
  if (reference.length > PAYMENT_REFERENCE_MAX)
    errors.reference = "payments.error.referenceTooLong";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      amountDzd: amount,
      paidOn: draft.paidOn,
      method: draft.method,
      note: note || null,
      reference: reference || null,
    },
  };
}

/*
  CHOOSING WHAT A PAYMENT IS FOR: student first, then one of that student's enrollments.

  A payment still belongs to ONE approved enrollment (the insert policy requires it). The form
  only stops listing the same student once per enrollment: the person is chosen once, then the
  formation / group among that student's approved enrollments.
*/

export interface PayableStudent {
  studentId: string;
  studentName: string | null;
  enrollmentCount: number;
}

/** Each student with at least one approved enrollment, once, by name. */
export function payableStudents(payable: readonly PayableRegistration[]): PayableStudent[] {
  const byId = new Map<string, PayableStudent>();
  for (const p of payable) {
    const s = byId.get(p.studentId);
    if (s) s.enrollmentCount += 1;
    else
      byId.set(p.studentId, {
        studentId: p.studentId,
        studentName: p.studentName,
        enrollmentCount: 1,
      });
  }
  return [...byId.values()].sort(
    (a, b) =>
      (a.studentName ?? "").localeCompare(b.studentName ?? "") ||
      a.studentId.localeCompare(b.studentId),
  );
}

/** The approved enrollments of one student, by group name. Empty without a student. */
export function enrollmentsOf(
  payable: readonly PayableRegistration[],
  studentId: string | null,
): PayableRegistration[] {
  if (!studentId) return [];
  return payable
    .filter((p) => p.studentId === studentId)
    .sort(
      (a, b) =>
        (a.groupName ?? "").localeCompare(b.groupName ?? "") ||
        (a.programName ?? "").localeCompare(b.programName ?? ""),
    );
}

/**
 * The enrollment to select when a student is (re)chosen: theirs when they have exactly one,
 * otherwise none -- the previous student's choice is never carried over.
 */
export function enrollmentAfterStudentChange(
  payable: readonly PayableRegistration[],
  studentId: string | null,
): string | null {
  const own = enrollmentsOf(payable, studentId);
  return own.length === 1 ? (own[0] as PayableRegistration).registrationId : null;
}

/**
 * The enrollment the form may submit: it must still be an approved enrollment of the chosen
 * student. Null otherwise (nothing chosen, another student's, or no longer approved).
 */
export function selectedEnrollment(
  payable: readonly PayableRegistration[],
  studentId: string | null,
  registrationId: string | null,
): PayableRegistration | null {
  if (!studentId || !registrationId) return null;
  return (
    payable.find((p) => p.registrationId === registrationId && p.studentId === studentId) ?? null
  );
}
