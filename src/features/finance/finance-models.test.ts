/**
 * Finance management models (ADR-006): balances and ageing, report aggregates, discounts.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  ageingOf,
  balanceTotals,
  buildBalanceRows,
  daysBetween,
  filterBalanceRows,
  type BalanceEnrollment,
} from "./balances-model.ts";
import { buildReport, monthsOf } from "./reports-model.ts";
import { applicableDiscounts, discountAmount, validateDiscountDraft } from "./discount-model.ts";
import type { Charge } from "../school/fee-types.ts";

const TODAY = "2026-11-15";

const enr = (id: string, name: string, programId = "p1"): BalanceEnrollment => ({
  registrationId: id,
  studentId: `s-${id}`,
  studentName: name,
  groupName: "G",
  programId,
  programName: programId === "p1" ? "Anglais" : "Soroban",
  status: "approved",
});

const charge = (
  id: string,
  reg: string,
  parts: [string, number][],
  over: Partial<Charge> = {},
): Charge => ({
  id,
  registrationId: reg,
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

test("balance rows: only enrollments with a fee or a payment, the most overdue first", () => {
  const rows = buildBalanceRows(
    [enr("r1", "Amine"), enr("r2", "Sara"), enr("r3", "Nobody"), enr("r4", "Yanis", "p2")],
    [
      charge("c1", "r1", [
        ["2026-08-01", 10000],
        ["2026-12-01", 10000],
      ]),
      charge("c2", "r2", [["2026-11-01", 5000]]),
      charge("c4", "r4", [["2026-12-01", 3000]]),
    ],
    new Map([
      ["r2", 5000],
      ["r4", 1000],
    ]),
    TODAY,
  );
  assert.deepEqual(
    rows.map((r) => r.registrationId),
    ["r1", "r4", "r2"],
  );
  assert.equal(rows[0]?.oldestOverdueOn, "2026-08-01");
  assert.equal(rows.find((r) => r.registrationId === "r2")?.balance.remainingDzd, 0);
});

test("filters and totals", () => {
  const rows = buildBalanceRows(
    [enr("r1", "Amine"), enr("r2", "Sara"), enr("r4", "Yanis", "p2")],
    [
      charge("c1", "r1", [["2026-08-01", 10000]]),
      charge("c2", "r2", [["2026-11-01", 5000]]),
      charge("c4", "r4", [["2026-12-01", 3000]]),
    ],
    new Map([["r2", 5000]]),
    TODAY,
  );
  assert.equal(filterBalanceRows(rows, "overdue", "all").length, 1);
  assert.equal(filterBalanceRows(rows, "owing", "all").length, 2);
  assert.equal(filterBalanceRows(rows, "settled", "all").length, 1);
  assert.equal(filterBalanceRows(rows, "all", "p2").length, 1);
  const t = balanceTotals(rows);
  assert.equal(t.dueDzd, 18000);
  assert.equal(t.paidDzd, 5000);
  assert.equal(t.remainingDzd, 13000);
  assert.equal(t.overdueDzd, 10000);
  assert.equal(t.overdueEnrollments, 1);
});

test("ageing puts each late installment's uncovered part in its bucket", () => {
  const rows = buildBalanceRows(
    [enr("r1", "Amine")],
    [
      charge("c1", "r1", [
        ["2026-11-01", 1000],
        ["2026-09-20", 2000],
        ["2026-08-30", 4000],
        ["2026-06-01", 8000],
      ]),
    ],
    new Map(),
    TODAY,
  );
  assert.equal(daysBetween("2026-11-01", TODAY), 14);
  assert.deepEqual(ageingOf(rows, TODAY), {
    "0-30": 1000,
    "31-60": 2000,
    "61-90": 4000,
    "90+": 8000,
  });
});

test("reports aggregate a period, keeping received and charged apart", () => {
  const r = buildReport(
    [
      {
        month: "2026-09-01",
        programId: "p1",
        programName: "Anglais",
        method: "cash",
        totalDzd: 10000,
        paymentCount: 2,
      },
      {
        month: "2026-10-01",
        programId: "p1",
        programName: "Anglais",
        method: "transfer",
        totalDzd: 5000,
        paymentCount: 1,
      },
      {
        month: "2026-10-01",
        programId: "p2",
        programName: "Soroban",
        method: "cash",
        totalDzd: 3000,
        paymentCount: 1,
      },
      {
        month: "2026-12-01",
        programId: "p1",
        programName: "Anglais",
        method: "cash",
        totalDzd: 99999,
        paymentCount: 9,
      },
    ],
    [
      {
        month: "2026-09-01",
        programId: "p1",
        programName: "Anglais",
        feeType: "tuition",
        chargedDzd: 30000,
        chargeCount: 1,
        discountedDzd: 3000,
      },
      {
        month: "2026-10-01",
        programId: "p2",
        programName: "Soroban",
        feeType: "registration",
        chargedDzd: 2000,
        chargeCount: 1,
        discountedDzd: 0,
      },
    ],
    { from: "2026-09", to: "2026-11" },
  );
  assert.equal(r.receivedDzd, 18000);
  assert.equal(r.paymentCount, 4);
  assert.equal(r.chargedDzd, 32000);
  assert.equal(r.discountedDzd, 3000);
  assert.deepEqual(
    r.byMonth.map((m) => m.receivedDzd),
    [10000, 8000, 0],
  );
  assert.deepEqual(
    r.byMethod.map((m) => [m.method, m.receivedDzd]),
    [
      ["cash", 13000],
      ["transfer", 5000],
    ],
  );
  assert.deepEqual(
    r.byProgram.map((p) => [p.programName, p.receivedDzd, p.chargedDzd]),
    [
      ["Anglais", 15000, 30000],
      ["Soroban", 3000, 2000],
    ],
  );
  assert.equal(r.byFeeType[0]?.feeType, "tuition");
});

test("months of a period, across a year end", () => {
  assert.deepEqual(monthsOf({ from: "2026-11", to: "2027-02" }), [
    "2026-11",
    "2026-12",
    "2027-01",
    "2027-02",
  ]);
  assert.deepEqual(monthsOf({ from: "2026-05", to: "2026-04" }), []);
});

test("discount amounts: percent rounded down, never beyond what is left", () => {
  assert.equal(discountAmount("percent", 10, 30000, 0), 3000);
  assert.equal(discountAmount("percent", 33, 10000, 0), 3300);
  assert.equal(discountAmount("percent", 15, 999, 0), 149);
  assert.equal(discountAmount("amount", 5000, 30000, 27000), 3000);
  assert.equal(discountAmount("percent", 100, 30000, 30000), 0);
});

test("the discount catalogue form follows the database rules", () => {
  assert.ok(
    validateDiscountDraft({
      name: "Fratrie",
      kind: "percent",
      value: "10",
      feeType: null,
      description: "",
    }).ok,
  );
  let r = validateDiscountDraft({
    name: " ",
    kind: "percent",
    value: "10",
    feeType: null,
    description: "",
  });
  assert.ok(!r.ok && r.errors.name);
  r = validateDiscountDraft({
    name: "x",
    kind: "percent",
    value: "120",
    feeType: null,
    description: "",
  });
  assert.ok(!r.ok && r.errors.value === "discounts.error.percent");
  r = validateDiscountDraft({
    name: "x",
    kind: "amount",
    value: "-5",
    feeType: null,
    description: "",
  });
  assert.ok(!r.ok && r.errors.value === "discounts.error.value");
});

test("only active discounts for any fee or this fee type are offered", () => {
  const cat = [
    {
      id: "a",
      name: "Fratrie",
      kind: "percent" as const,
      value: 10,
      feeType: null,
      description: null,
      active: true,
    },
    {
      id: "b",
      name: "Tuition only",
      kind: "amount" as const,
      value: 500,
      feeType: "tuition",
      description: null,
      active: true,
    },
    {
      id: "c",
      name: "Archived",
      kind: "amount" as const,
      value: 500,
      feeType: null,
      description: null,
      active: false,
    },
  ];
  assert.deepEqual(
    applicableDiscounts(cat, "tuition").map((d) => d.id),
    ["a", "b"],
  );
  assert.deepEqual(
    applicableDiscounts(cat, "registration").map((d) => d.id),
    ["a"],
  );
});
