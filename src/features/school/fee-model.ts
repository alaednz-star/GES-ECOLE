/**
 * Fee arithmetic and validation. PURE (ADR-005).
 *
 * Free of runtime imports beyond other pure modules so `node --test` can load it.
 *
 * WHAT IS OWED vs WHAT WAS PAID. A charge is an obligation, a payment is money received; this
 * module only COMPARES them. `balanceOf` sums active charges and payments per enrollment and,
 * for display, applies the payments to the installments oldest due date first. That coverage is
 * computed each time from the two ledgers and never stored: it is not an allocation, and a family
 * paying two installments at once or half of one needs no special case.
 *
 * WHOLE DINARS, INTEGER ARITHMETIC. Amounts are Postgres `int`s; the only division is the even
 * split of a total into installments, which distributes the remainder dinar by dinar.
 */

import { isIsoDate } from "./payment-model.ts";
import {
  DUE_DATE_MAX,
  DUE_DATE_MIN,
  FEE_AMOUNT_MAX,
  FEE_LABEL_MAX,
  FEE_NOTE_MAX,
  FEE_TYPE_NEEDING_LABEL,
  INSTALLMENTS_MAX,
  type Charge,
  type ChargeDraft,
  type ChargeValues,
  type EnrollmentBalance,
  type InstallmentDraft,
  type InstallmentView,
  type ReceivedPayment,
} from "./fee-types.ts";

/** Parses a whole positive number of dinars typed by a person; NaN for anything else. */
export function parseDinars(text: string): number {
  const t = text.trim();
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

/**
 * `total` split into `count` whole-dinar parts that add up exactly: 10 000 in 3 gives
 * 3 334, 3 333, 3 333 (the remainder goes to the first installments). Empty when the split is
 * impossible (no installments, or fewer dinars than installments).
 */
export function splitAmount(total: number, count: number): number[] {
  if (!Number.isSafeInteger(total) || !Number.isInteger(count) || count < 1 || total < count) {
    return [];
  }
  const base = Math.floor(total / count);
  const rest = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < rest ? 1 : 0));
}

/**
 * `first` plus `months` calendar months, keeping its day of the month where it exists and the
 * last day otherwise: 2026-01-31 plus 1 is 2026-02-28, plus 2 is 2026-03-31. Always computed from
 * the first date, so a schedule does not drift to the 28th after February.
 */
export function addMonths(first: string, months: number): string {
  const [y, m, d] = first.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth();
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${String(ty).padStart(4, "0")}-${String(tm + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * A starting schedule for the form: `count` monthly installments from `firstDue`, the total split
 * evenly. The administrator can then edit any amount or date. Returns null when the inputs cannot
 * make a schedule (invalid amount, date or count).
 */
export function buildSchedule(
  amountText: string,
  count: number,
  firstDue: string,
): InstallmentDraft[] | null {
  const total = parseDinars(amountText);
  if (!isIsoDate(firstDue) || count < 1 || count > INSTALLMENTS_MAX) return null;
  const parts = splitAmount(total, count);
  if (parts.length === 0) return null;
  return parts.map((amount, i) => ({ amount: String(amount), dueOn: addMonths(firstDue, i) }));
}

/** Sum of the installment amounts typed so far, ignoring rows that are not whole dinars. */
export function draftScheduleTotal(rows: readonly InstallmentDraft[]): number {
  let sum = 0;
  for (const r of rows) {
    const n = parseDinars(r.amount);
    if (Number.isSafeInteger(n)) sum += n;
  }
  return sum;
}

export type ChargeField = "feeType" | "label" | "amount" | "note" | "installments";
export type InstallmentField = "amount" | "dueOn";

export type ChargeValidation =
  | { ok: true; values: ChargeValues }
  | {
      ok: false;
      errors: Partial<Record<ChargeField, string>>;
      /** Per installment row (by index). */
      rows: Record<number, Partial<Record<InstallmentField, string>>>;
    };

/**
 * Validates a form draft against the same rules `save_charge` and the tables enforce, so the
 * administrator reads a translated sentence instead of a refused request. The database stays the
 * authority. `allowedTypes` are the codes the form may submit (active types, plus the charge's
 * current type when editing). Returns i18n keys, not text.
 */
export function validateChargeDraft(
  draft: ChargeDraft,
  allowedTypes: readonly string[],
): ChargeValidation {
  const errors: Partial<Record<ChargeField, string>> = {};
  const rows: Record<number, Partial<Record<InstallmentField, string>>> = {};

  if (!draft.feeType || !allowedTypes.includes(draft.feeType)) errors.feeType = "fees.error.type";

  const label = draft.label.trim();
  if (label.length > FEE_LABEL_MAX) errors.label = "fees.error.labelTooLong";
  else if (draft.feeType === FEE_TYPE_NEEDING_LABEL && !label)
    errors.label = "fees.error.labelRequired";

  const amount = parseDinars(draft.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) errors.amount = "fees.error.amount";
  else if (amount > FEE_AMOUNT_MAX) errors.amount = "fees.error.amountTooLarge";

  const note = draft.note.trim();
  if (note.length > FEE_NOTE_MAX) errors.note = "fees.error.noteTooLong";

  const count = draft.installments.length;
  const installments: { dueOn: string; amountDzd: number }[] = [];
  if (count < 1 || count > INSTALLMENTS_MAX) {
    errors.installments = "fees.error.installmentCount";
  } else {
    let previous: string | null = null;
    let sum = 0;
    draft.installments.forEach((row, i) => {
      const rowErrors: Partial<Record<InstallmentField, string>> = {};
      const part = parseDinars(row.amount);
      if (!Number.isSafeInteger(part) || part <= 0)
        rowErrors.amount = "fees.error.installmentAmount";
      if (!isIsoDate(row.dueOn) || row.dueOn < DUE_DATE_MIN || row.dueOn > DUE_DATE_MAX) {
        rowErrors.dueOn = "fees.error.dueDate";
      } else if (previous !== null && row.dueOn <= previous) {
        rowErrors.dueOn = "fees.error.dueOrder";
      }
      if (isIsoDate(row.dueOn)) previous = row.dueOn;
      if (Object.keys(rowErrors).length > 0) rows[i] = rowErrors;
      else {
        sum += part;
        installments.push({ dueOn: row.dueOn, amountDzd: part });
      }
    });
    if (Object.keys(rows).length === 0 && !errors.amount && sum !== amount) {
      errors.installments = "fees.error.sumMismatch";
    }
  }

  if (Object.keys(errors).length > 0 || Object.keys(rows).length > 0) {
    return { ok: false, errors, rows };
  }
  return {
    ok: true,
    values: {
      feeType: draft.feeType,
      label: label || null,
      amountDzd: amount,
      note: note || null,
      installments,
    },
  };
}

/** The form's starting point for editing an existing charge. */
export function chargeToDraft(charge: Charge): ChargeDraft {
  return {
    feeType: charge.feeType,
    label: charge.label ?? "",
    amount: String(charge.amountDzd),
    note: charge.note ?? "",
    installments: charge.installments.map((i) => ({ amount: String(i.amountDzd), dueOn: i.dueOn })),
  };
}

/**
 * What one enrollment owes against what it has paid, and -- for display -- how far its payments
 * go through its installments, oldest due date first. Cancelled charges count for nothing.
 * `today` is the caller's LOCAL date (`todayIso()`): an installment is overdue from the day after
 * its due date.
 */
export function balanceOf(
  charges: readonly Charge[],
  payments: readonly Pick<ReceivedPayment, "amountDzd">[],
  today: string,
): EnrollmentBalance {
  const active = charges.filter((c) => c.status === "active");
  const dueDzd = active.reduce((s, c) => s + c.amountDzd, 0);
  // What is waived on active fees (ADR-006). Like a payment, a discount is applied to the
  // installments oldest due date first, for display; nothing is stored.
  const discountDzd = active.reduce(
    (s, c) =>
      s +
      (c.discounts ?? []).filter((d) => d.status === "active").reduce((t, d) => t + d.amountDzd, 0),
    0,
  );
  const paidDzd = payments.reduce(
    (s, p) => s + (Number.isFinite(p.amountDzd) ? p.amountDzd : 0),
    0,
  );

  // Oldest due date first; ties broken by charge then position so the result is stable.
  const queue = active
    .flatMap((c) => c.installments.map((i) => ({ ...i, chargeId: c.id })))
    .sort(
      (a, b) =>
        a.dueOn.localeCompare(b.dueOn) ||
        a.chargeId.localeCompare(b.chargeId) ||
        a.position - b.position,
    );

  let available = paidDzd + discountDzd;
  let overdueDzd = 0;
  let nextDue: EnrollmentBalance["nextDue"] = null;
  const installments: Record<string, InstallmentView> = {};
  for (const i of queue) {
    const coveredDzd = Math.max(0, Math.min(i.amountDzd, available));
    available -= coveredDzd;
    const remainingDzd = i.amountDzd - coveredDzd;
    const status =
      remainingDzd === 0
        ? "paid"
        : i.dueOn < today
          ? "overdue"
          : coveredDzd > 0
            ? "partial"
            : "upcoming";
    if (status === "overdue") overdueDzd += remainingDzd;
    if (remainingDzd > 0 && i.dueOn >= today && nextDue === null) {
      nextDue = { dueOn: i.dueOn, remainingDzd };
    }
    installments[i.id] = { ...i, coveredDzd, remainingDzd, status };
  }

  const owedDzd = Math.max(0, dueDzd - discountDzd);
  return {
    dueDzd,
    discountDzd,
    paidDzd,
    remainingDzd: Math.max(0, owedDzd - paidDzd),
    advanceDzd: Math.max(0, paidDzd - owedDzd),
    overdueDzd,
    nextDue,
    installments,
  };
}

/** Totals over several enrollments: the student-level answer to "owes" and "has paid". */
export function sumBalances(balances: readonly EnrollmentBalance[]): {
  dueDzd: number;
  discountDzd: number;
  paidDzd: number;
  remainingDzd: number;
  overdueDzd: number;
} {
  return balances.reduce(
    (t, b) => ({
      dueDzd: t.dueDzd + b.dueDzd,
      discountDzd: t.discountDzd + b.discountDzd,
      paidDzd: t.paidDzd + b.paidDzd,
      remainingDzd: t.remainingDzd + b.remainingDzd,
      overdueDzd: t.overdueDzd + b.overdueDzd,
    }),
    { dueDzd: 0, discountDzd: 0, paidDzd: 0, remainingDzd: 0, overdueDzd: 0 },
  );
}

/**
 * What the payment form proposes for one enrollment (ADR-005). A suggestion only: the amount
 * stays editable, because a payment records what was actually received, not what was owed.
 *
 *   none     no active fee -- nothing is proposed (no price is ever invented)
 *   settled  active fees exist and are fully covered by the payments received
 *   due      the oldest installment not yet fully covered (overdue or not): its remaining
 *            amount is proposed; the enrollment's total remaining and overdue amounts are
 *            returned so the form can say what the proposal represents
 *
 * "Covered" uses the same display rule as the student page (`balanceOf`, oldest due date first).
 * Nothing is allocated or stored.
 */
export type PaymentSuggestion =
  | { kind: "none" }
  | { kind: "settled"; dueDzd: number }
  | {
      kind: "due";
      /** The proposed amount: what is left on the next unpaid installment. */
      amountDzd: number;
      dueOn: string;
      chargeId: string;
      overdue: boolean;
      remainingDzd: number;
      overdueDzd: number;
      /** Installments not yet fully covered whose due date has passed. */
      overdueCount: number;
    };

export function paymentSuggestion(
  charges: readonly Charge[],
  payments: readonly Pick<ReceivedPayment, "amountDzd">[],
  today: string,
): PaymentSuggestion {
  if (!charges.some((c) => c.status === "active")) return { kind: "none" };
  const balance = balanceOf(charges, payments, today);
  const open = Object.values(balance.installments)
    .filter((i) => i.remainingDzd > 0)
    .sort(
      (a, b) =>
        a.dueOn.localeCompare(b.dueOn) ||
        a.chargeId.localeCompare(b.chargeId) ||
        a.position - b.position,
    );
  const next = open[0];
  if (!next) return { kind: "settled", dueDzd: balance.dueDzd };
  return {
    kind: "due",
    amountDzd: next.remainingDzd,
    dueOn: next.dueOn,
    chargeId: next.chargeId,
    overdue: next.status === "overdue",
    remainingDzd: balance.remainingDzd,
    overdueDzd: balance.overdueDzd,
    overdueCount: open.filter((i) => i.status === "overdue").length,
  };
}
