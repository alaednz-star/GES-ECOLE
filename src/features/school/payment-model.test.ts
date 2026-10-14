/**
 * Payment totals and validation, tested from both sides of every boundary.
 *
 * A wrong total does not throw -- it is discovered by a person reconciling a cash box. The
 * boundaries that matter: today versus yesterday, the month edge, malformed rows, and every
 * way an amount can be typed wrongly.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  enrollmentAfterStudentChange,
  enrollmentsOf,
  isIsoDate,
  payableStudents,
  selectedEnrollment,
  monthBounds,
  sumAmounts,
  summarisePayments,
  validatePaymentDraft,
} from "./payment-model.ts";
import type { DailyTotal, PayableRegistration, PaymentDraft } from "./payment-types.ts";

const TODAY = "2026-09-30";

const day = (paidOn: string, totalDzd: number, paymentCount = 1): DailyTotal => ({
  paidOn,
  totalDzd,
  paymentCount,
});

const draft = (over: Partial<PaymentDraft> = {}): PaymentDraft => ({
  amount: "3000",
  paidOn: TODAY,
  method: "cash",
  note: "",
  reference: "",
  ...over,
});

/* ------------------------------ summarisePayments ------------------------------ */

test("summarisePayments: empty or missing input is all zeros", () => {
  const zero = { totalDzd: 0, count: 0, todayDzd: 0, todayCount: 0, monthDzd: 0, monthCount: 0 };
  assert.deepEqual(summarisePayments([], TODAY), zero);
  assert.deepEqual(summarisePayments(null, TODAY), zero);
  assert.deepEqual(summarisePayments(undefined, TODAY), zero);
});

test("summarisePayments: all-time total and count cover every day", () => {
  const t = summarisePayments(
    [day("2025-12-01", 1000, 1), day("2026-09-01", 2500, 2), day(TODAY, 700, 3)],
    TODAY,
  );
  assert.equal(t.totalDzd, 4200);
  assert.equal(t.count, 6);
});

test("summarisePayments: today is the caller's date only, not yesterday", () => {
  const t = summarisePayments([day("2026-09-29", 5000), day(TODAY, 1200, 2)], TODAY);
  assert.equal(t.todayDzd, 1200);
  assert.equal(t.todayCount, 2);
});

test("summarisePayments: this month includes the 1st and today, excludes last month", () => {
  const t = summarisePayments(
    [day("2026-08-31", 9999), day("2026-09-01", 1000), day(TODAY, 500), day("2025-09-15", 777)],
    TODAY,
  );
  assert.equal(t.monthDzd, 1500);
  assert.equal(t.monthCount, 2);
});

test("summarisePayments: a malformed row counts as zero instead of poisoning the totals", () => {
  const rows = [
    day(TODAY, 1000),
    { paidOn: TODAY, totalDzd: Number.NaN, paymentCount: 1 },
    { paidOn: TODAY, totalDzd: null as unknown as number, paymentCount: null as unknown as number },
  ];
  const t = summarisePayments(rows, TODAY);
  assert.equal(t.totalDzd, 1000);
  assert.equal(t.todayDzd, 1000);
  assert.equal(t.count, 2);
});

test("summarisePayments: bigint sums arriving as strings still add up", () => {
  const t = summarisePayments(
    [{ paidOn: TODAY, totalDzd: "2500" as unknown as number, paymentCount: 1 }],
    TODAY,
  );
  assert.equal(t.totalDzd, 2500);
});

/* ---------------------------------- helpers ---------------------------------- */

test("sumAmounts: sums the visible rows and tolerates bad values", () => {
  assert.equal(sumAmounts([{ amountDzd: 100 }, { amountDzd: 250 }]), 350);
  assert.equal(sumAmounts([{ amountDzd: Number.NaN }, { amountDzd: 5 }]), 5);
  assert.equal(sumAmounts(null), 0);
});

test("monthBounds: first and last day, including February and leap years", () => {
  assert.deepEqual(monthBounds("2026-09-30"), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(monthBounds("2026-02-10"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(monthBounds("2028-02-10"), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(monthBounds("2026-12-05"), { from: "2026-12-01", to: "2026-12-31" });
});

test("isIsoDate: real calendar dates only", () => {
  assert.equal(isIsoDate("2026-09-30"), true);
  assert.equal(isIsoDate("2026-02-30"), false);
  assert.equal(isIsoDate("2026-9-3"), false);
  assert.equal(isIsoDate("30/09/2026"), false);
  assert.equal(isIsoDate(""), false);
});

/* ---------------------------- validatePaymentDraft ---------------------------- */

test("validate: a correct draft becomes database values, trimmed, empty text as null", () => {
  const r = validatePaymentDraft(
    draft({ amount: " 4500 ", note: "  ", reference: " CHQ-12 " }),
    TODAY,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.values, {
      amountDzd: 4500,
      paidOn: TODAY,
      method: "cash",
      note: null,
      reference: "CHQ-12",
    });
  }
});

test("validate: zero, negative, decimal, exponent and spaced amounts are refused, not coerced", () => {
  for (const amount of ["0", "-200", "1500.5", "1500,5", "1e3", "1 500", "", "abc"]) {
    const r = validatePaymentDraft(draft({ amount }), TODAY);
    assert.equal(r.ok, false, `amount ${JSON.stringify(amount)} should be refused`);
    if (!r.ok) assert.equal(r.errors.amount, "payments.error.amount");
  }
});

test("validate: an amount beyond Postgres int is refused", () => {
  const r = validatePaymentDraft(draft({ amount: "2147483648" }), TODAY);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.errors.amount, "payments.error.amountTooLarge");
  assert.equal(validatePaymentDraft(draft({ amount: "2147483647" }), TODAY).ok, true);
});

test("validate: future and impossible dates are refused; today and the past are allowed", () => {
  const future = validatePaymentDraft(draft({ paidOn: "2026-10-01" }), TODAY);
  assert.equal(future.ok, false);
  if (!future.ok) assert.equal(future.errors.paidOn, "payments.error.dateFuture");

  const bogus = validatePaymentDraft(draft({ paidOn: "2026-02-30" }), TODAY);
  assert.equal(bogus.ok, false);
  if (!bogus.ok) assert.equal(bogus.errors.paidOn, "payments.error.date");

  const ancient = validatePaymentDraft(draft({ paidOn: "1999-12-31" }), TODAY);
  assert.equal(ancient.ok, false);

  assert.equal(validatePaymentDraft(draft({ paidOn: "2025-01-15" }), TODAY).ok, true);
});

test("validate: an unknown method is refused", () => {
  const r = validatePaymentDraft(draft({ method: "bitcoin" as never }), TODAY);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.errors.method, "payments.error.method");
});

test("validate: note limit is 500 characters after trimming, matching the CHECK", () => {
  assert.equal(validatePaymentDraft(draft({ note: "x".repeat(500) }), TODAY).ok, true);
  const r = validatePaymentDraft(draft({ note: "x".repeat(501) }), TODAY);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.errors.note, "payments.error.noteTooLong");
});

test("validate: reference limit is 100 characters, matching the CHECK", () => {
  assert.equal(validatePaymentDraft(draft({ reference: "r".repeat(100) }), TODAY).ok, true);
  const r = validatePaymentDraft(draft({ reference: "r".repeat(101) }), TODAY);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.errors.reference, "payments.error.referenceTooLong");
});

test("validate: several problems are all reported at once", () => {
  const r = validatePaymentDraft(draft({ amount: "0", paidOn: "nope" }), TODAY);
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(Object.keys(r.errors).sort(), ["amount", "paidOn"]);
});

/* ---------------------------------------------- student first, then the enrollment */

const reg = (
  registrationId: string,
  studentId: string,
  studentName: string,
  groupName: string,
  programName: string | null = null,
): PayableRegistration => ({
  registrationId,
  studentId,
  studentName,
  groupId: `g-${registrationId}`,
  groupName,
  programName,
});
const PAYABLE = [
  reg("r1", "amine", "Amine Belkacem", "3AS Sciences — Physique", "Soutien Bac"),
  reg("r2", "amine", "Amine Belkacem", "3AS Sciences — Anglais", "Anglais Bac"),
  reg("r3", "amine", "Amine Belkacem", "3AS Sciences — Français"),
  reg("r4", "sara", "Sara K", "Calcul mental — Samedi", "Calcul mental"),
];

test("each student is listed once, whatever their number of enrollments", () => {
  const students = payableStudents(PAYABLE);
  assert.deepEqual(
    students.map((s) => [s.studentName, s.enrollmentCount]),
    [
      ["Amine Belkacem", 3],
      ["Sara K", 1],
    ],
  );
});

test("after choosing a student, only that student's enrollments are offered", () => {
  assert.deepEqual(
    enrollmentsOf(PAYABLE, "amine").map((e) => e.registrationId),
    ["r2", "r3", "r1"],
  );
  assert.deepEqual(
    enrollmentsOf(PAYABLE, "sara").map((e) => e.registrationId),
    ["r4"],
  );
  assert.deepEqual(enrollmentsOf(PAYABLE, null), []);
});

test("a single enrollment is preselected; several are left to the administrator", () => {
  assert.equal(enrollmentAfterStudentChange(PAYABLE, "sara"), "r4");
  assert.equal(enrollmentAfterStudentChange(PAYABLE, "amine"), null);
  assert.equal(enrollmentAfterStudentChange(PAYABLE, null), null);
});

test("changing the student never keeps the previous student's enrollment", () => {
  // r2 was chosen for Amine; the student becomes Sara: r2 is no longer submittable.
  assert.equal(selectedEnrollment(PAYABLE, "sara", "r2"), null);
  assert.equal(
    selectedEnrollment(PAYABLE, "sara", enrollmentAfterStudentChange(PAYABLE, "sara"))
      ?.registrationId,
    "r4",
  );
});

test("the submitted enrollment is exactly the chosen one, and must still be approved", () => {
  assert.equal(selectedEnrollment(PAYABLE, "amine", "r3")?.registrationId, "r3");
  // An enrollment no longer in the approved list (withdrawn meanwhile) cannot be submitted.
  assert.equal(
    selectedEnrollment(
      PAYABLE.filter((p) => p.registrationId !== "r3"),
      "amine",
      "r3",
    ),
    null,
  );
  assert.equal(selectedEnrollment(PAYABLE, "amine", null), null);
});
