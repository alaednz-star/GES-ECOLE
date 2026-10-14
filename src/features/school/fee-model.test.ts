/**
 * Fee arithmetic and validation (ADR-005).
 *
 * The rules a family's statement depends on: a split that always adds up, schedules that do not
 * drift after February, a form that refuses what the database refuses, and a balance that keeps
 * what is OWED apart from what was PAID -- with payments that do not match installments one to one.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  addMonths,
  balanceOf,
  buildSchedule,
  chargeToDraft,
  paymentSuggestion,
  draftScheduleTotal,
  splitAmount,
  sumBalances,
  validateChargeDraft,
} from "./fee-model.ts";
import { BUILT_IN_FEE_TYPES, type Charge, type ChargeDraft } from "./fee-types.ts";

const TYPES = [...BUILT_IN_FEE_TYPES];
const TODAY = "2026-11-15";

const draft = (over: Partial<ChargeDraft> = {}): ChargeDraft => ({
  feeType: "tuition",
  label: "",
  amount: "30000",
  note: "",
  installments: [
    { amount: "10000", dueOn: "2026-10-01" },
    { amount: "10000", dueOn: "2026-11-01" },
    { amount: "10000", dueOn: "2026-12-01" },
  ],
  ...over,
});

const charge = (id: string, parts: [string, number][], over: Partial<Charge> = {}): Charge => ({
  id,
  registrationId: "reg",
  feeType: "tuition",
  label: null,
  amountDzd: parts.reduce((s, [, a]) => s + a, 0),
  note: null,
  status: "active",
  createdAt: "2026-09-01T00:00:00Z",
  cancelledAt: null,
  cancelReason: null,
  installments: parts.map(([dueOn, amountDzd], i) => ({
    id: `${id}-${i + 1}`,
    position: i + 1,
    amountDzd,
    dueOn,
  })),
  ...over,
});

test("splitAmount always adds up, the remainder going to the first installments", () => {
  assert.deepEqual(splitAmount(10000, 3), [3334, 3333, 3333]);
  assert.deepEqual(splitAmount(30000, 3), [10000, 10000, 10000]);
  assert.deepEqual(splitAmount(5, 5), [1, 1, 1, 1, 1]);
  for (const [total, n] of [
    [99999, 7],
    [1, 1],
    [24000, 24],
    [2147483647, 24],
  ] as const) {
    const parts = splitAmount(total, n);
    assert.equal(parts.length, n);
    assert.equal(
      parts.reduce((s, p) => s + p, 0),
      total,
    );
    assert.ok(parts.every((p) => p > 0 && Number.isInteger(p)));
  }
});

test("splitAmount refuses impossible splits rather than producing zero installments", () => {
  assert.deepEqual(splitAmount(3, 5), []);
  assert.deepEqual(splitAmount(1000, 0), []);
  assert.deepEqual(splitAmount(NaN, 2), []);
});

test("addMonths keeps the day, clamps to month end, and never drifts", () => {
  assert.equal(addMonths("2026-01-31", 0), "2026-01-31");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2026-01-31", 2), "2026-03-31");
  assert.equal(addMonths("2028-01-30", 1), "2028-02-29");
  assert.equal(addMonths("2026-11-15", 2), "2027-01-15");
});

test("buildSchedule gives monthly installments that add up to the amount", () => {
  const rows = buildSchedule("10000", 3, "2026-09-30");
  assert.deepEqual(rows, [
    { amount: "3334", dueOn: "2026-09-30" },
    { amount: "3333", dueOn: "2026-10-30" },
    { amount: "3333", dueOn: "2026-11-30" },
  ]);
  assert.equal(draftScheduleTotal(rows ?? []), 10000);
  assert.equal(buildSchedule("abc", 3, "2026-09-30"), null);
  assert.equal(buildSchedule("10000", 25, "2026-09-30"), null);
  assert.equal(buildSchedule("10000", 3, "2026-02-30"), null);
});

test("a valid draft becomes the values save_charge takes", () => {
  const r = validateChargeDraft(draft({ note: "  Trimestre 1  " }), TYPES);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.values, {
    feeType: "tuition",
    label: null,
    amountDzd: 30000,
    note: "Trimestre 1",
    installments: [
      { dueOn: "2026-10-01", amountDzd: 10000 },
      { dueOn: "2026-11-01", amountDzd: 10000 },
      { dueOn: "2026-12-01", amountDzd: 10000 },
    ],
  });
});

test("amounts are whole positive dinars: no zero, negative, decimal or spaced input", () => {
  for (const amount of ["0", "-500", "1500.5", "1e3", "1 500", "", "abc", "2147483648"]) {
    const r = validateChargeDraft(
      draft({ amount, installments: [{ amount: "1", dueOn: "2026-10-01" }] }),
      TYPES,
    );
    assert.equal(r.ok, false, amount);
    if (!r.ok) assert.ok(r.errors.amount, amount);
  }
  const neg = validateChargeDraft(
    draft({
      amount: "1000",
      installments: [
        { amount: "1500", dueOn: "2026-10-01" },
        { amount: "-500", dueOn: "2026-11-01" },
      ],
    }),
    TYPES,
  );
  assert.equal(neg.ok, false);
  if (!neg.ok) assert.equal(neg.rows[1]?.amount, "fees.error.installmentAmount");
});

test("installments must add up to the amount", () => {
  const r = validateChargeDraft(
    draft({
      installments: [
        { amount: "10000", dueOn: "2026-10-01" },
        { amount: "10000", dueOn: "2026-11-01" },
      ],
    }),
    TYPES,
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.errors.installments, "fees.error.sumMismatch");
});

test("due dates must be real, in range, and strictly increasing", () => {
  const bad = (installments: ChargeDraft["installments"]) =>
    validateChargeDraft(draft({ amount: "2000", installments }), TYPES);
  let r = bad([{ amount: "2000", dueOn: "2026-02-30" }]);
  assert.ok(!r.ok && r.rows[0]?.dueOn === "fees.error.dueDate");
  r = bad([{ amount: "2000", dueOn: "1999-12-31" }]);
  assert.ok(!r.ok && r.rows[0]?.dueOn === "fees.error.dueDate");
  r = bad([
    { amount: "1000", dueOn: "2026-10-01" },
    { amount: "1000", dueOn: "2026-10-01" },
  ]);
  assert.ok(!r.ok && r.rows[1]?.dueOn === "fees.error.dueOrder");
  r = bad([
    { amount: "1000", dueOn: "2026-11-01" },
    { amount: "1000", dueOn: "2026-10-01" },
  ]);
  assert.ok(!r.ok && r.rows[1]?.dueOn === "fees.error.dueOrder");
});

test("between 1 and 24 installments", () => {
  let r = validateChargeDraft(draft({ installments: [] }), TYPES);
  assert.ok(!r.ok && r.errors.installments === "fees.error.installmentCount");
  const many = Array.from({ length: 25 }, (_, i) => ({
    amount: "1",
    dueOn: addMonths("2026-01-01", i),
  }));
  r = validateChargeDraft(draft({ amount: "25", installments: many }), TYPES);
  assert.ok(!r.ok && r.errors.installments === "fees.error.installmentCount");
});

test("type and label: a known type, and 'other' must say what it is for", () => {
  let r = validateChargeDraft(draft({ feeType: "gym" }), TYPES);
  assert.ok(!r.ok && r.errors.feeType === "fees.error.type");
  r = validateChargeDraft(draft({ feeType: "other", label: "   " }), TYPES);
  assert.ok(!r.ok && r.errors.label === "fees.error.labelRequired");
  r = validateChargeDraft(draft({ feeType: "other", label: "Sortie pédagogique" }), TYPES);
  assert.ok(r.ok && r.values.label === "Sortie pédagogique");
  r = validateChargeDraft(draft({ label: "x".repeat(121) }), TYPES);
  assert.ok(!r.ok && r.errors.label === "fees.error.labelTooLong");
});

test("chargeToDraft round-trips through validation", () => {
  const c = charge(
    "c1",
    [
      ["2026-10-01", 12000],
      ["2026-12-01", 12000],
    ],
    { label: "T1", note: "n" },
  );
  const r = validateChargeDraft(chargeToDraft(c), TYPES);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.values.amountDzd, 24000);
    assert.equal(r.values.installments.length, 2);
  }
});

test("owed and paid stay separate: nothing paid means everything remains", () => {
  const b = balanceOf(
    [
      charge("c1", [
        ["2026-10-01", 10000],
        ["2026-12-01", 10000],
      ]),
    ],
    [],
    TODAY,
  );
  assert.equal(b.dueDzd, 20000);
  assert.equal(b.paidDzd, 0);
  assert.equal(b.remainingDzd, 20000);
  assert.equal(b.overdueDzd, 10000);
  assert.equal(b.installments["c1-1"]?.status, "overdue");
  assert.equal(b.installments["c1-2"]?.status, "upcoming");
  assert.deepEqual(b.nextDue, { dueOn: "2026-12-01", remainingDzd: 10000 });
});

test("one payment can cover several installments, and half of the next", () => {
  const c = charge("c1", [
    ["2026-10-01", 10000],
    ["2026-11-01", 10000],
    ["2026-12-01", 10000],
  ]);
  const b = balanceOf([c], [{ amountDzd: 25000 }], TODAY);
  assert.equal(b.installments["c1-1"]?.status, "paid");
  assert.equal(b.installments["c1-2"]?.status, "paid");
  assert.equal(b.installments["c1-3"]?.status, "partial");
  assert.equal(b.installments["c1-3"]?.remainingDzd, 5000);
  assert.equal(b.remainingDzd, 5000);
  assert.equal(b.overdueDzd, 0);
});

test("several small payments add up against one installment", () => {
  const c = charge("c1", [["2026-12-01", 9000]]);
  const b = balanceOf([c], [{ amountDzd: 3000 }, { amountDzd: 3000 }, { amountDzd: 3000 }], TODAY);
  assert.equal(b.installments["c1-1"]?.status, "paid");
  assert.equal(b.remainingDzd, 0);
});

test("an installment past its due date and only partly covered is overdue for the rest", () => {
  const c = charge("c1", [["2026-11-01", 10000]]);
  const b = balanceOf([c], [{ amountDzd: 4000 }], TODAY);
  assert.equal(b.installments["c1-1"]?.status, "overdue");
  assert.equal(b.installments["c1-1"]?.coveredDzd, 4000);
  assert.equal(b.overdueDzd, 6000);
});

test("due today is not yet overdue", () => {
  const b = balanceOf([charge("c1", [[TODAY, 1000]])], [], TODAY);
  assert.equal(b.installments["c1-1"]?.status, "upcoming");
  assert.equal(b.overdueDzd, 0);
});

test("payments go to the oldest due date first, across fees", () => {
  const reg = charge("a-reg", [["2026-09-15", 3000]], { feeType: "registration" });
  const tuition = charge("b-tui", [
    ["2026-10-01", 10000],
    ["2026-11-01", 10000],
  ]);
  const b = balanceOf([tuition, reg], [{ amountDzd: 8000 }], TODAY);
  assert.equal(b.installments["a-reg-1"]?.status, "paid");
  assert.equal(b.installments["b-tui-1"]?.coveredDzd, 5000);
  assert.equal(b.installments["b-tui-2"]?.coveredDzd, 0);
  assert.equal(b.remainingDzd, 15000);
});

test("cancelled fees owe nothing; paying beyond the fees is shown as an advance", () => {
  const kept = charge("c1", [["2026-10-01", 5000]]);
  const cancelled = charge("c2", [["2026-10-01", 9000]], { status: "cancelled" });
  const b = balanceOf([kept, cancelled], [{ amountDzd: 7000 }], TODAY);
  assert.equal(b.dueDzd, 5000);
  assert.equal(b.remainingDzd, 0);
  assert.equal(b.advanceDzd, 2000);
  assert.equal(b.installments["c2-1"], undefined);
});

test("payments without any fee are an advance, never a negative balance", () => {
  const b = balanceOf([], [{ amountDzd: 3000 }], TODAY);
  assert.equal(b.dueDzd, 0);
  assert.equal(b.remainingDzd, 0);
  assert.equal(b.advanceDzd, 3000);
});

test("student totals do not let one enrollment's advance hide another's debt", () => {
  const paidAhead = balanceOf([charge("x", [["2026-10-01", 1000]])], [{ amountDzd: 4000 }], TODAY);
  const unpaid = balanceOf([charge("y", [["2026-10-01", 5000]])], [], TODAY);
  const t = sumBalances([paidAhead, unpaid]);
  assert.equal(t.dueDzd, 6000);
  assert.equal(t.paidDzd, 4000);
  assert.equal(t.remainingDzd, 5000);
  assert.equal(t.overdueDzd, 5000);
});

/* ---------------------------------------------- the amount the payment form proposes */

test("no active fee: nothing is proposed (no price is invented)", () => {
  assert.deepEqual(paymentSuggestion([], [{ amountDzd: 5000 }], TODAY), { kind: "none" });
  const cancelled = charge("c1", [["2026-12-01", 9000]], { status: "cancelled" });
  assert.deepEqual(paymentSuggestion([cancelled], [], TODAY), { kind: "none" });
});

test("fully paid: settled, nothing proposed", () => {
  const s = paymentSuggestion([charge("c1", [["2026-10-01", 5000]])], [{ amountDzd: 5000 }], TODAY);
  assert.deepEqual(s, { kind: "settled", dueDzd: 5000 });
});

test("the next unpaid installment is proposed, for what is left on it", () => {
  const c = charge("c1", [
    ["2026-12-01", 10000],
    ["2027-01-01", 10000],
  ]);
  let s = paymentSuggestion([c], [], TODAY);
  assert.ok(s.kind === "due" && s.amountDzd === 10000 && s.dueOn === "2026-12-01" && !s.overdue);
  // 4 000 already received: 6 000 left on the first installment.
  s = paymentSuggestion([c], [{ amountDzd: 4000 }], TODAY);
  assert.ok(s.kind === "due" && s.amountDzd === 6000 && s.remainingDzd === 16000);
});

test("several unpaid installments: the oldest is proposed, with the overdue total", () => {
  const c = charge("c1", [
    ["2026-09-01", 10000],
    ["2026-10-01", 10000],
    ["2026-12-01", 10000],
  ]);
  const s = paymentSuggestion([c], [], TODAY);
  assert.ok(s.kind === "due");
  if (s.kind !== "due") return;
  assert.equal(s.amountDzd, 10000);
  assert.equal(s.dueOn, "2026-09-01");
  assert.equal(s.overdue, true);
  assert.equal(s.overdueDzd, 20000);
  assert.equal(s.overdueCount, 2);
  assert.equal(s.remainingDzd, 30000);
  assert.equal(s.chargeId, "c1");
});

test("across several fees, the earliest due installment wins", () => {
  const exam = charge("b-exam", [["2026-11-20", 2000]], { feeType: "exam" });
  const tuition = charge("a-tui", [["2026-12-01", 10000]]);
  const s = paymentSuggestion([tuition, exam], [], TODAY);
  assert.ok(s.kind === "due" && s.chargeId === "b-exam" && s.amountDzd === 2000);
});

/* ---------------------------------------------- discounts (ADR-006) */

const discount = (amountDzd: number, status: "active" | "cancelled" = "active") => ({
  id: `d-${amountDzd}-${status}`,
  label: "Remise",
  amountDzd,
  reason: null,
  status,
  grantedAt: "2026-10-01T00:00:00Z",
  cancelledAt: status === "cancelled" ? "2026-10-02T00:00:00Z" : null,
  cancelReason: status === "cancelled" ? "x" : null,
});

test("a discount reduces what is left, and covers installments like a payment", () => {
  const c = {
    ...charge("c1", [
      ["2026-10-01", 10000],
      ["2026-12-01", 10000],
    ]),
    discounts: [discount(3000)],
  };
  const b = balanceOf([c], [{ amountDzd: 5000 }], TODAY);
  assert.equal(b.dueDzd, 20000);
  assert.equal(b.discountDzd, 3000);
  assert.equal(b.paidDzd, 5000);
  assert.equal(b.remainingDzd, 12000);
  assert.equal(b.installments["c1-1"]?.coveredDzd, 8000);
  assert.equal(b.overdueDzd, 2000);
});

test("cancelled discounts, and discounts on cancelled fees, count for nothing", () => {
  const kept = {
    ...charge("c1", [["2026-12-01", 10000]]),
    discounts: [discount(4000, "cancelled")],
  };
  const gone = {
    ...charge("c2", [["2026-12-01", 5000]], { status: "cancelled" }),
    discounts: [discount(5000)],
  };
  const b = balanceOf([kept, gone], [], TODAY);
  assert.equal(b.discountDzd, 0);
  assert.equal(b.remainingDzd, 10000);
});

test("a full grant settles the fee; payments on top become an advance", () => {
  const c = { ...charge("c1", [["2026-10-01", 30000]]), discounts: [discount(30000)] };
  const b = balanceOf([c], [{ amountDzd: 1000 }], TODAY);
  assert.equal(b.remainingDzd, 0);
  assert.equal(b.advanceDzd, 1000);
  assert.deepEqual(paymentSuggestion([c], [], TODAY), { kind: "settled", dueDzd: 30000 });
});
