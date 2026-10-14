/**
 * Formation fee templates and group overrides: rules and arithmetic. PURE (ADR-005).
 *
 * A template is CONFIGURATION -- what is normally charged to a new enrollment. It becomes a
 * student's real charge (fee-model.ts) only when an enrollment is approved, in the database
 * (`private.apply_fee_templates`). Nothing here creates, changes or reads charges.
 *
 * The schedule is relative: each installment is due a number of months after the enrollment is
 * approved. The rules are those of charge installments: 1 to 24, whole dinars > 0, strictly
 * increasing, summing exactly to the fee (`private.fee_schedule_error`).
 */

import { addMonths, parseDinars, splitAmount } from "./fee-model.ts";
import {
  FEE_AMOUNT_MAX,
  FEE_LABEL_MAX,
  FEE_TYPE_NEEDING_LABEL,
  INSTALLMENTS_MAX,
} from "./fee-types.ts";

/** Matches `private.fee_schedule_error` (0..120 months after enrollment). */
export const TEMPLATE_MONTHS_MAX = 120;

export interface FeeTemplateInstallment {
  /** Months after the enrollment is approved (0 = on enrollment). */
  months: number;
  amountDzd: number;
}

export interface FeeTemplate {
  id: string;
  /** Null only for a group without formation (a subject class pricing itself). */
  programId: string | null;
  /** Null for the formation's default; set for an item of that group's override. */
  groupId: string | null;
  feeType: string;
  label: string | null;
  amountDzd: number;
  schedule: FeeTemplateInstallment[];
  position: number;
}

export interface TemplateInstallmentDraft {
  amount: string;
  months: string;
}

export interface TemplateDraft {
  feeType: string;
  label: string;
  amount: string;
  installments: TemplateInstallmentDraft[];
}

export interface TemplateValues {
  feeType: string;
  label: string | null;
  amountDzd: number;
  schedule: FeeTemplateInstallment[];
}

/**
 * A starting schedule: `count` installments every `everyMonths` months from enrollment, the total
 * split evenly (remainder on the first installments). Null when the inputs cannot make one.
 */
export function buildTemplateSchedule(
  amountText: string,
  count: number,
  everyMonths: number,
): TemplateInstallmentDraft[] | null {
  if (count < 1 || count > INSTALLMENTS_MAX || everyMonths < 1) return null;
  if ((count - 1) * everyMonths > TEMPLATE_MONTHS_MAX) return null;
  const parts = splitAmount(parseDinars(amountText), count);
  if (parts.length === 0) return null;
  return parts.map((amount, i) => ({ amount: String(amount), months: String(i * everyMonths) }));
}

export type TemplateField = "feeType" | "label" | "amount" | "installments";
export type TemplateRowField = "amount" | "months";

export type TemplateValidation =
  | { ok: true; values: TemplateValues }
  | {
      ok: false;
      errors: Partial<Record<TemplateField, string>>;
      rows: Record<number, Partial<Record<TemplateRowField, string>>>;
    };

/** Mirrors `save_fee_template`; returns i18n keys. The database stays the authority. */
export function validateTemplateDraft(
  draft: TemplateDraft,
  allowedTypes: readonly string[],
): TemplateValidation {
  const errors: Partial<Record<TemplateField, string>> = {};
  const rows: Record<number, Partial<Record<TemplateRowField, string>>> = {};

  if (!draft.feeType || !allowedTypes.includes(draft.feeType)) errors.feeType = "fees.error.type";
  const label = draft.label.trim();
  if (label.length > FEE_LABEL_MAX) errors.label = "fees.error.labelTooLong";
  else if (draft.feeType === FEE_TYPE_NEEDING_LABEL && !label)
    errors.label = "fees.error.labelRequired";

  const amount = parseDinars(draft.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) errors.amount = "fees.error.amount";
  else if (amount > FEE_AMOUNT_MAX) errors.amount = "fees.error.amountTooLarge";

  const schedule: FeeTemplateInstallment[] = [];
  const count = draft.installments.length;
  if (count < 1 || count > INSTALLMENTS_MAX) {
    errors.installments = "fees.error.installmentCount";
  } else {
    let previous: number | null = null;
    let sum = 0;
    draft.installments.forEach((row, i) => {
      const rowErrors: Partial<Record<TemplateRowField, string>> = {};
      const part = parseDinars(row.amount);
      if (!Number.isSafeInteger(part) || part <= 0)
        rowErrors.amount = "fees.error.installmentAmount";
      const months = /^\d+$/.test(row.months.trim()) ? Number(row.months.trim()) : NaN;
      if (!Number.isInteger(months) || months > TEMPLATE_MONTHS_MAX) {
        rowErrors.months = "feeTemplates.error.months";
      } else if (previous !== null && months <= previous) {
        rowErrors.months = "fees.error.dueOrder";
      }
      if (Number.isInteger(months)) previous = months;
      if (Object.keys(rowErrors).length > 0) rows[i] = rowErrors;
      else {
        sum += part;
        schedule.push({ months, amountDzd: part });
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
    values: { feeType: draft.feeType, label: label || null, amountDzd: amount, schedule },
  };
}

export function templateToDraft(t: FeeTemplate): TemplateDraft {
  return {
    feeType: t.feeType,
    label: t.label ?? "",
    amount: String(t.amountDzd),
    installments: t.schedule.map((s) => ({
      amount: String(s.amountDzd),
      months: String(s.months),
    })),
  };
}

/**
 * What a NEW enrollment in a group would be charged: the group's own items when it has any
 * (override), otherwise the formation's default items. The same rule as the database.
 */
export function applicableTemplates(
  items: readonly FeeTemplate[],
  groupId: string | null,
): { source: "group" | "formation" | "none"; items: FeeTemplate[] } {
  const byPosition = (a: FeeTemplate, b: FeeTemplate) => a.position - b.position;
  const own = groupId ? items.filter((t) => t.groupId === groupId).sort(byPosition) : [];
  if (own.length > 0) return { source: "group", items: own };
  const defaults = items.filter((t) => t.groupId === null).sort(byPosition);
  return { source: defaults.length > 0 ? "formation" : "none", items: defaults };
}

export function templatesTotal(items: readonly Pick<FeeTemplate, "amountDzd">[]): number {
  return items.reduce((s, t) => s + t.amountDzd, 0);
}

/** The due dates an enrollment approved on `base` would get (same rule as the database). */
export function dueDatesFrom(base: string, schedule: readonly FeeTemplateInstallment[]): string[] {
  return schedule.map((s) => addMonths(base, s.months));
}

/**
 * A formation's catalogue price: the total of its DEFAULT fees (what a new enrollment in a group
 * without override is charged), or null when none is configured. Groups with their own fees are
 * counted, not priced: their price is shown on the group.
 */
export interface CatalogueEntry {
  priceDzd: number | null;
  fees: FeeTemplate[];
  groupsWithOwnFees: number;
}

export function catalogueEntry(items: readonly FeeTemplate[], programId: string): CatalogueEntry {
  const mine = items.filter((t) => t.programId === programId);
  const fees = mine.filter((t) => t.groupId === null).sort((a, b) => a.position - b.position);
  const groups = new Set(mine.filter((t) => t.groupId !== null).map((t) => t.groupId));
  return {
    priceDzd: fees.length > 0 ? templatesTotal(fees) : null,
    fees,
    groupsWithOwnFees: groups.size,
  };
}

/** The price of a group without formation: the total of its own items, or null when none. */
export function groupCatalogueEntry(
  items: readonly FeeTemplate[],
  groupId: string,
): CatalogueEntry {
  const fees = items
    .filter((t) => t.groupId === groupId && t.programId === null)
    .sort((a, b) => a.position - b.position);
  return { priceDzd: fees.length > 0 ? templatesTotal(fees) : null, fees, groupsWithOwnFees: 0 };
}
