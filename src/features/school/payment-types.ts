/**
 * Shapes for payment management. No imports, so `payment-model.ts` and its tests can use
 * these without dragging the Supabase client into the test runner.
 */

/** Matches the CHECK constraint on `payments.method`. */
export const PAYMENT_METHODS = ["cash", "transfer", "cheque", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Matches `payments.note` CHECK (length <= 500). */
export const PAYMENT_NOTE_MAX = 500;
/** Matches `payments_reference_length` (1..100 after trimming). */
export const PAYMENT_REFERENCE_MAX = 100;
/** `amount_dzd` is a Postgres `int`. */
export const PAYMENT_AMOUNT_MAX = 2_147_483_647;

/**
 * One payment as the ledger shows it: the transaction plus who paid, for which group, and
 * who recorded it. Names are nullable because an account or group can disappear after the
 * money was recorded, and the payment must still be listed.
 */
export interface PaymentRecord {
  id: string;
  amountDzd: number;
  /** The day the money changed hands, `YYYY-MM-DD`. */
  paidOn: string;
  method: PaymentMethod;
  note: string | null;
  reference: string | null;
  createdAt: string;
  updatedAt: string;
  registrationId: string;
  studentId: string | null;
  studentName: string | null;
  studentEmail: string | null;
  groupId: string | null;
  groupName: string | null;
  recordedBy: string | null;
  recordedByName: string | null;
}

/** An approved registration a payment can be recorded against. */
export interface PayableRegistration {
  registrationId: string;
  studentId: string;
  studentName: string | null;
  groupId: string | null;
  groupName: string | null;
  /** The formation the group belongs to; null for a standalone group. */
  programName: string | null;
}

/** One row of `payment_daily_totals`. */
export interface DailyTotal {
  paidOn: string;
  totalDzd: number;
  paymentCount: number;
}

/** Server-side ledger filters. Both date bounds are always set: the ledger is windowed. */
export interface PaymentFilters {
  from: string;
  to: string;
  method: PaymentMethod | "all";
  groupId: string | "all";
  studentId: string | "all";
}

/** What the form edits. Strings, because that is what inputs hold. */
export interface PaymentDraft {
  amount: string;
  paidOn: string;
  method: PaymentMethod;
  note: string;
  reference: string;
}

/** A draft that passed validation, in the shape the database takes. */
export interface PaymentValues {
  amountDzd: number;
  paidOn: string;
  method: PaymentMethod;
  note: string | null;
  reference: string | null;
}
