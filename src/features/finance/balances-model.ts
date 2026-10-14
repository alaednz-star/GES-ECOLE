/**
 * Soldes & impayés: one row per enrollment, what it owes against what it has paid (ADR-006).
 * PURE -- every figure comes from `balanceOf` (fee-model.ts), the same rule as the student page.
 *
 * Owed = active charges - active discounts; paid = payments received; nothing is stored.
 * Overdue ageing counts, per overdue installment, the part not covered, by days late.
 */

import { balanceOf } from "../school/fee-model.ts";
import type { Charge, EnrollmentBalance } from "../school/fee-types.ts";

export interface BalanceEnrollment {
  registrationId: string;
  studentId: string;
  studentName: string;
  groupName: string | null;
  programId: string | null;
  programName: string | null;
  /** registration_status */
  status: string;
}

export interface BalanceRow extends BalanceEnrollment {
  balance: EnrollmentBalance;
  /** Due date of the oldest installment still uncovered and late, if any. */
  oldestOverdueOn: string | null;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/**
 * The rows of the page: every enrollment that has an active fee or a payment. `paid` maps a
 * registration to what it has received (enrollment_payment_totals).
 */
export function buildBalanceRows(
  enrollments: readonly BalanceEnrollment[],
  charges: readonly Charge[],
  paid: ReadonlyMap<string, number>,
  today: string,
): BalanceRow[] {
  const byReg = new Map<string, Charge[]>();
  for (const c of charges) {
    const list = byReg.get(c.registrationId) ?? [];
    list.push(c);
    byReg.set(c.registrationId, list);
  }
  const rows: BalanceRow[] = [];
  for (const e of enrollments) {
    const own = byReg.get(e.registrationId) ?? [];
    const received = paid.get(e.registrationId) ?? 0;
    if (!own.some((c) => c.status === "active") && received === 0) continue;
    const balance = balanceOf(own, received > 0 ? [{ amountDzd: received }] : [], today);
    const late = Object.values(balance.installments)
      .filter((i) => i.status === "overdue")
      .map((i) => i.dueOn)
      .sort();
    rows.push({ ...e, balance, oldestOverdueOn: late[0] ?? null });
  }
  return rows.sort(
    (a, b) =>
      b.balance.overdueDzd - a.balance.overdueDzd ||
      b.balance.remainingDzd - a.balance.remainingDzd ||
      a.studentName.localeCompare(b.studentName),
  );
}

export type BalanceView = "all" | "owing" | "overdue" | "settled";

export function filterBalanceRows(
  rows: readonly BalanceRow[],
  view: BalanceView,
  programId: string | "all",
): BalanceRow[] {
  return rows.filter(
    (r) =>
      (programId === "all" || r.programId === programId) &&
      (view === "all" ||
        (view === "owing" && r.balance.remainingDzd > 0) ||
        (view === "overdue" && r.balance.overdueDzd > 0) ||
        (view === "settled" && r.balance.remainingDzd === 0)),
  );
}

export interface BalanceTotals {
  enrollments: number;
  dueDzd: number;
  discountDzd: number;
  paidDzd: number;
  remainingDzd: number;
  overdueDzd: number;
  overdueEnrollments: number;
}

export function balanceTotals(rows: readonly BalanceRow[]): BalanceTotals {
  return rows.reduce<BalanceTotals>(
    (t, r) => ({
      enrollments: t.enrollments + 1,
      dueDzd: t.dueDzd + r.balance.dueDzd,
      discountDzd: t.discountDzd + r.balance.discountDzd,
      paidDzd: t.paidDzd + r.balance.paidDzd,
      remainingDzd: t.remainingDzd + r.balance.remainingDzd,
      overdueDzd: t.overdueDzd + r.balance.overdueDzd,
      overdueEnrollments: t.overdueEnrollments + (r.balance.overdueDzd > 0 ? 1 : 0),
    }),
    {
      enrollments: 0,
      dueDzd: 0,
      discountDzd: 0,
      paidDzd: 0,
      remainingDzd: 0,
      overdueDzd: 0,
      overdueEnrollments: 0,
    },
  );
}

export const AGEING_BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

/** Overdue amounts by days late: the part of each late installment not yet covered. */
export function ageingOf(rows: readonly BalanceRow[], today: string): Record<AgeingBucket, number> {
  const out: Record<AgeingBucket, number> = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const r of rows) {
    for (const i of Object.values(r.balance.installments)) {
      if (i.status !== "overdue") continue;
      const days = daysBetween(i.dueOn, today);
      const bucket: AgeingBucket =
        days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
      out[bucket] += i.remainingDzd;
    }
  }
  return out;
}
