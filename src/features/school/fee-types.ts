/**
 * Shapes for fees and installments (ADR-005). No imports, so `fee-model.ts` and its tests can use
 * these without dragging the Supabase client into the test runner.
 *
 * VOCABULARY. A CHARGE (fee) is what an enrollment owes; an INSTALLMENT is a dated part of it; a
 * PAYMENT (payment-types.ts) is money received. They are separate records: nothing here turns a
 * payment into a fee or ties a payment to an installment.
 */

/** The built-in fee types (`fee_types.built_in`), displayed through the dictionaries by code. */
export const BUILT_IN_FEE_TYPES = [
  "registration",
  "tuition",
  "materials",
  "exam",
  "insurance",
  "transport",
  "canteen",
  "other",
] as const;

/** The fee type whose charges must carry a label (`charges_other_labelled`). */
export const FEE_TYPE_NEEDING_LABEL = "other";

/** Matches `charges.label` (1..120 after trimming). */
export const FEE_LABEL_MAX = 120;
/** Matches `charges.note` (<= 500). */
export const FEE_NOTE_MAX = 500;
/** Matches `cancel_charge` (1..300 after trimming). */
export const FEE_CANCEL_REASON_MAX = 300;
/** Matches `charge_installments.position` (1..24). */
export const INSTALLMENTS_MAX = 24;
/** `amount_dzd` is a Postgres `int`. */
export const FEE_AMOUNT_MAX = 2_147_483_647;
/** Matches the `due_on` CHECK. */
export const DUE_DATE_MIN = "2000-01-01";
export const DUE_DATE_MAX = "2100-12-31";

export interface FeeType {
  code: string;
  /** Reference name; built-in types are displayed through the dictionaries instead. */
  name: string;
  builtIn: boolean;
  /** Inactive types stay readable on existing charges but are not offered for new ones. */
  active: boolean;
  position: number;
}

export type ChargeStatus = "active" | "cancelled";

export interface Installment {
  id: string;
  position: number;
  amountDzd: number;
  /** `YYYY-MM-DD`. */
  dueOn: string;
}

export interface Charge {
  id: string;
  registrationId: string;
  feeType: string;
  label: string | null;
  amountDzd: number;
  note: string | null;
  status: ChargeStatus;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  /** In position (= due-date) order. */
  installments: Installment[];
  /** Discounts granted on this fee (ADR-006), active and cancelled. Absent = none. */
  discounts?: ChargeDiscount[];
}

export type ChargeDiscountStatus = "active" | "cancelled";

/** A discount granted on one fee: its amount was frozen when it was granted. */
export interface ChargeDiscount {
  id: string;
  label: string;
  amountDzd: number;
  reason: string | null;
  status: ChargeDiscountStatus;
  grantedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
}

/** A payment as the fees section needs it: money received on an enrollment. */
export interface ReceivedPayment {
  id: string;
  registrationId: string;
  amountDzd: number;
  paidOn: string;
  method: string;
}

/** What the form edits. Strings, because that is what inputs hold. */
export interface InstallmentDraft {
  amount: string;
  dueOn: string;
}

export interface ChargeDraft {
  feeType: string;
  label: string;
  amount: string;
  note: string;
  installments: InstallmentDraft[];
}

/** A draft that passed validation, in the shape `save_charge` takes. */
export interface ChargeValues {
  feeType: string;
  label: string | null;
  amountDzd: number;
  note: string | null;
  installments: { dueOn: string; amountDzd: number }[];
}

/**
 * An installment's situation, DERIVED for display: the enrollment's payments are applied to its
 * installments oldest due date first. Not stored, not an allocation -- a payment is never tied to
 * an installment in the database.
 */
export type InstallmentStatus = "paid" | "partial" | "overdue" | "upcoming";

export interface InstallmentView extends Installment {
  chargeId: string;
  /** The part of the enrollment's payments that covers this installment (derived). */
  coveredDzd: number;
  remainingDzd: number;
  status: InstallmentStatus;
}

/** What one enrollment owes against what it has paid. Every figure is derived. */
export interface EnrollmentBalance {
  /** Sum of the ACTIVE charges. */
  dueDzd: number;
  /** Sum of the active discounts on those charges (ADR-006). */
  discountDzd: number;
  /** Sum of the payments received on the enrollment. */
  paidDzd: number;
  /** What is still owed: max(0, due - discounts - paid). */
  remainingDzd: number;
  /** Paid beyond what is owed: max(0, paid - (due - discounts)). */
  advanceDzd: number;
  /** The uncovered part of installments whose due date has passed. */
  overdueDzd: number;
  /** The next installment not yet fully covered, due today or later. */
  nextDue: { dueOn: string; remainingDzd: number } | null;
  /** Installments of active charges, by id. */
  installments: Record<string, InstallmentView>;
}
