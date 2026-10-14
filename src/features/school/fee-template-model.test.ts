/**
 * Formation fee templates (ADR-005): schedules that always add up, the same refusals as the
 * database, and the formation-default / group-override rule.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  applicableTemplates,
  catalogueEntry,
  buildTemplateSchedule,
  dueDatesFrom,
  templateToDraft,
  templatesTotal,
  validateTemplateDraft,
  type FeeTemplate,
  type TemplateDraft,
} from "./fee-template-model.ts";
import { BUILT_IN_FEE_TYPES } from "./fee-types.ts";

const TYPES = [...BUILT_IN_FEE_TYPES];

const draft = (over: Partial<TemplateDraft> = {}): TemplateDraft => ({
  feeType: "tuition",
  label: "",
  amount: "30000",
  installments: [
    { amount: "10000", months: "0" },
    { amount: "10000", months: "1" },
    { amount: "10000", months: "2" },
  ],
  ...over,
});

const tpl = (id: string, groupId: string | null, amountDzd: number, position = 0): FeeTemplate => ({
  id,
  programId: "p",
  groupId,
  feeType: "tuition",
  label: null,
  amountDzd,
  schedule: [{ months: 0, amountDzd }],
  position,
});

test("a starting schedule splits the fee evenly, every N months from enrollment", () => {
  assert.deepEqual(buildTemplateSchedule("10000", 3, 1), [
    { amount: "3334", months: "0" },
    { amount: "3333", months: "1" },
    { amount: "3333", months: "2" },
  ]);
  assert.deepEqual(
    buildTemplateSchedule("30000", 3, 3)?.map((r) => r.months),
    ["0", "3", "6"],
  );
  assert.equal(buildTemplateSchedule("abc", 3, 1), null);
  assert.equal(buildTemplateSchedule("1000", 25, 1), null);
  assert.equal(buildTemplateSchedule("1000", 24, 6), null); // beyond 120 months
});

test("a valid template becomes the values save_fee_template takes", () => {
  const r = validateTemplateDraft(draft(), TYPES);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.values.amountDzd, 30000);
    assert.deepEqual(
      r.values.schedule.map((s) => s.months),
      [0, 1, 2],
    );
  }
});

test("the template schedule follows the charge rules", () => {
  let r = validateTemplateDraft(draft({ amount: "35000" }), TYPES);
  assert.ok(!r.ok && r.errors.installments === "fees.error.sumMismatch");
  r = validateTemplateDraft(
    draft({
      amount: "2000",
      installments: [
        { amount: "1000", months: "1" },
        { amount: "1000", months: "1" },
      ],
    }),
    TYPES,
  );
  assert.ok(!r.ok && r.rows[1]?.months === "fees.error.dueOrder");
  r = validateTemplateDraft(
    draft({ amount: "1000", installments: [{ amount: "1000", months: "121" }] }),
    TYPES,
  );
  assert.ok(!r.ok && r.rows[0]?.months === "feeTemplates.error.months");
  r = validateTemplateDraft(
    draft({ amount: "1000", installments: [{ amount: "-1000", months: "0" }] }),
    TYPES,
  );
  assert.ok(!r.ok && r.rows[0]?.amount === "fees.error.installmentAmount");
  r = validateTemplateDraft(draft({ installments: [] }), TYPES);
  assert.ok(!r.ok && r.errors.installments === "fees.error.installmentCount");
  r = validateTemplateDraft(draft({ feeType: "other" }), TYPES);
  assert.ok(!r.ok && r.errors.label === "fees.error.labelRequired");
  r = validateTemplateDraft(draft({ feeType: "gym" }), TYPES);
  assert.ok(!r.ok && r.errors.feeType === "fees.error.type");
});

test("a group without its own fees inherits the formation's; with them, uses its own", () => {
  const items = [
    tpl("f1", null, 30000, 0),
    tpl("f2", null, 2000, 1),
    tpl("g1", "g-intensive", 35000),
  ];
  assert.deepEqual(
    applicableTemplates(items, "g-saturday").items.map((t) => t.id),
    ["f1", "f2"],
  );
  assert.equal(applicableTemplates(items, "g-saturday").source, "formation");
  assert.deepEqual(
    applicableTemplates(items, "g-intensive").items.map((t) => t.id),
    ["g1"],
  );
  assert.equal(applicableTemplates(items, "g-intensive").source, "group");
  assert.equal(applicableTemplates([], "g-saturday").source, "none");
  assert.equal(applicableTemplates(items, null).source, "formation");
});

test("totals and due dates (month ends clamped, counted from enrollment)", () => {
  assert.equal(
    templatesTotal([tpl("a", null, 30000), tpl("b", null, 2000), tpl("c", null, 1500)]),
    33500,
  );
  assert.deepEqual(
    dueDatesFrom("2026-01-31", [
      { months: 0, amountDzd: 1 },
      { months: 1, amountDzd: 1 },
      { months: 2, amountDzd: 1 },
    ]),
    ["2026-01-31", "2026-02-28", "2026-03-31"],
  );
});

test("an existing template round-trips through the form", () => {
  const t: FeeTemplate = {
    ...tpl("x", null, 30000),
    schedule: [
      { months: 0, amountDzd: 15000 },
      { months: 3, amountDzd: 15000 },
    ],
  };
  const r = validateTemplateDraft(templateToDraft(t), TYPES);
  assert.ok(r.ok && r.values.schedule.length === 2 && r.values.schedule[1]?.months === 3);
});

test("the catalogue price is the total of the formation's default fees, or not configured", () => {
  const items = [
    { ...tpl("f1", null, 30000, 0), programId: "anglais" },
    { ...tpl("f2", null, 2000, 1), programId: "anglais" },
    { ...tpl("g1", "intensif", 35000), programId: "anglais" },
    { ...tpl("x", null, 9000), programId: "other" },
  ];
  const e = catalogueEntry(items, "anglais");
  assert.equal(e.priceDzd, 32000);
  assert.deepEqual(
    e.fees.map((f) => f.id),
    ["f1", "f2"],
  );
  assert.equal(e.groupsWithOwnFees, 1);
  assert.deepEqual(catalogueEntry(items, "soroban"), {
    priceDzd: null,
    fees: [],
    groupsWithOwnFees: 0,
  });
});
