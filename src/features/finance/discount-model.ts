/**
 * Remises & bourses: catalogue validation and the amount a grant would waive (ADR-006). PURE.
 * Mirrors `save_discount` / `grant_discount`; the database stays the authority.
 */

export type DiscountKind = "percent" | "amount";

export interface Discount {
  id: string;
  name: string;
  kind: DiscountKind;
  value: number;
  /** Only for this fee type; null = any fee. */
  feeType: string | null;
  description: string | null;
  active: boolean;
}

export interface DiscountDraft {
  name: string;
  kind: DiscountKind;
  value: string;
  feeType: string | null;
  description: string;
}

export type DiscountValidation =
  | {
      ok: true;
      values: {
        name: string;
        kind: DiscountKind;
        value: number;
        feeType: string | null;
        description: string | null;
      };
    }
  | { ok: false; errors: Partial<Record<"name" | "value" | "description", string>> };

export function validateDiscountDraft(d: DiscountDraft): DiscountValidation {
  const errors: Partial<Record<"name" | "value" | "description", string>> = {};
  const name = d.name.trim();
  if (name.length < 1 || name.length > 80) errors.name = "discounts.error.name";
  const text = d.value.trim();
  const value = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(value) || value <= 0) errors.value = "discounts.error.value";
  else if (d.kind === "percent" && value > 100) errors.value = "discounts.error.percent";
  else if (value > 2_147_483_647) errors.value = "fees.error.amountTooLarge";
  const description = d.description.trim();
  if (description.length > 300) errors.description = "discounts.error.description";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: { name, kind: d.kind, value, feeType: d.feeType, description: description || null },
  };
}

/**
 * What granting would waive on a fee: a percentage of the fee (rounded down) or the fixed amount,
 * never more than what is left after the discounts already granted. 0 = nothing left.
 */
export function discountAmount(
  kind: DiscountKind,
  value: number,
  chargeAmount: number,
  alreadyDiscounted: number,
): number {
  const room = Math.max(0, chargeAmount - alreadyDiscounted);
  const raw = kind === "percent" ? Math.floor((chargeAmount * value) / 100) : value;
  return Math.max(0, Math.min(raw, room));
}

/** The catalogue entries that may be granted on a fee of this type. */
export function applicableDiscounts(catalogue: readonly Discount[], feeType: string): Discount[] {
  return catalogue.filter((d) => d.active && (d.feeType === null || d.feeType === feeType));
}
