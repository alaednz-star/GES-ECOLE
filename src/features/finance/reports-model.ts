/**
 * Rapports financiers: aggregates of the monthly report views over a period (ADR-006). PURE.
 *
 * The views give one row per month x formation x method (payments) or x fee type (charges); a
 * period is a range of months, inclusive. Received money and charged fees are kept apart.
 */

export interface PaymentMonthRow {
  month: string; // YYYY-MM-01
  programId: string | null;
  programName: string | null;
  method: string;
  totalDzd: number;
  paymentCount: number;
}

export interface ChargeMonthRow {
  month: string;
  programId: string | null;
  programName: string | null;
  feeType: string;
  chargedDzd: number;
  chargeCount: number;
  discountedDzd: number;
}

export interface Period {
  /** First month, YYYY-MM. */
  from: string;
  /** Last month, YYYY-MM, inclusive. */
  to: string;
}

const inPeriod = (month: string, p: Period) => {
  const m = month.slice(0, 7);
  return m >= p.from && m <= p.to;
};

/** The months of the period, oldest first (YYYY-MM). */
export function monthsOf(p: Period): string[] {
  const out: string[] = [];
  let [y, m] = p.from.split("-").map(Number) as [number, number];
  const [ty, tm] = p.to.split("-").map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 240) break;
  }
  return out;
}

export interface FinanceReport {
  receivedDzd: number;
  paymentCount: number;
  chargedDzd: number;
  discountedDzd: number;
  byMonth: { month: string; receivedDzd: number; chargedDzd: number; discountedDzd: number }[];
  byMethod: { method: string; receivedDzd: number; paymentCount: number }[];
  byProgram: {
    programId: string | null;
    programName: string | null;
    receivedDzd: number;
    chargedDzd: number;
    discountedDzd: number;
  }[];
  byFeeType: { feeType: string; chargedDzd: number; discountedDzd: number }[];
}

export function buildReport(
  payments: readonly PaymentMonthRow[],
  charges: readonly ChargeMonthRow[],
  period: Period,
): FinanceReport {
  const pay = payments.filter((r) => inPeriod(r.month, period));
  const chg = charges.filter((r) => inPeriod(r.month, period));

  const byMonth = monthsOf(period).map((month) => ({
    month,
    receivedDzd: pay.filter((r) => r.month.startsWith(month)).reduce((s, r) => s + r.totalDzd, 0),
    chargedDzd: chg.filter((r) => r.month.startsWith(month)).reduce((s, r) => s + r.chargedDzd, 0),
    discountedDzd: chg
      .filter((r) => r.month.startsWith(month))
      .reduce((s, r) => s + r.discountedDzd, 0),
  }));

  const methods = new Map<string, { receivedDzd: number; paymentCount: number }>();
  for (const r of pay) {
    const m = methods.get(r.method) ?? { receivedDzd: 0, paymentCount: 0 };
    m.receivedDzd += r.totalDzd;
    m.paymentCount += r.paymentCount;
    methods.set(r.method, m);
  }

  const programs = new Map<string, FinanceReport["byProgram"][number]>();
  const programOf = (id: string | null, name: string | null) => {
    const key = id ?? "none";
    const p = programs.get(key) ?? {
      programId: id,
      programName: name,
      receivedDzd: 0,
      chargedDzd: 0,
      discountedDzd: 0,
    };
    programs.set(key, p);
    return p;
  };
  for (const r of pay) programOf(r.programId, r.programName).receivedDzd += r.totalDzd;
  for (const r of chg) {
    const p = programOf(r.programId, r.programName);
    p.chargedDzd += r.chargedDzd;
    p.discountedDzd += r.discountedDzd;
  }

  const fees = new Map<string, { feeType: string; chargedDzd: number; discountedDzd: number }>();
  for (const r of chg) {
    const f = fees.get(r.feeType) ?? { feeType: r.feeType, chargedDzd: 0, discountedDzd: 0 };
    f.chargedDzd += r.chargedDzd;
    f.discountedDzd += r.discountedDzd;
    fees.set(r.feeType, f);
  }

  return {
    receivedDzd: pay.reduce((s, r) => s + r.totalDzd, 0),
    paymentCount: pay.reduce((s, r) => s + r.paymentCount, 0),
    chargedDzd: chg.reduce((s, r) => s + r.chargedDzd, 0),
    discountedDzd: chg.reduce((s, r) => s + r.discountedDzd, 0),
    byMonth,
    byMethod: [...methods.entries()]
      .map(([method, v]) => ({ method, ...v }))
      .sort((a, b) => b.receivedDzd - a.receivedDzd),
    byProgram: [...programs.values()].sort(
      (a, b) => b.receivedDzd - a.receivedDzd || b.chargedDzd - a.chargedDzd,
    ),
    byFeeType: [...fees.values()].sort((a, b) => b.chargedDzd - a.chargedDzd),
  };
}
