/**
 * Pre-registration rules.
 *
 *   node --test src/features/admissions/application-model.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  ageOn,
  applicationActions,
  duplicateCandidates,
  emptyApplicationDraft,
  guardianRequired,
  normalizeName,
  normalizePhone,
  validateApplicationDraft,
  type ApplicationDraft,
} from "./application-model.ts";

const TODAY = "2026-10-05";
const opts = { today: TODAY, guardianRequiredUnderAge: 18 };
const draft = (over: Partial<ApplicationDraft> = {}): ApplicationDraft => ({
  ...emptyApplicationDraft(),
  firstName: "Ahmed",
  lastName: "Ben Ali",
  dateOfBirth: "2016-03-14",
  guardianName: "Karim Ben Ali",
  guardianPhone: "0550 12 34 56",
  guardianRelation: "father",
  consent: true,
  ...over,
});

test("age counts completed years", () => {
  assert.equal(ageOn("2016-10-05", TODAY), 10);
  assert.equal(ageOn("2016-10-06", TODAY), 9);
  assert.equal(guardianRequired("2010-01-01", TODAY, 18), true);
  assert.equal(guardianRequired("2000-01-01", TODAY, 18), false);
  // The threshold is the institution's setting.
  assert.equal(guardianRequired("2010-01-01", TODAY, 16), false);
});

test("Algerian and international phone formats are normalised", () => {
  assert.equal(normalizePhone("0550 12 34 56"), "0550123456");
  assert.equal(normalizePhone("05.50.12.34.56"), "0550123456");
  assert.equal(normalizePhone("+213 550 12 34 56"), "+213550123456");
  assert.equal(normalizePhone("00213-550-123-456"), "+213550123456");
  assert.equal(normalizePhone("(021) 23 45 67"), "021234567");
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizePhone("05 50 AB"), null);
  assert.equal(normalizePhone("  "), null);
});

test("a child's pre-registration needs the guardian's name, phone and relationship", () => {
  const ok = validateApplicationDraft(draft(), opts);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.minor, true);
    assert.equal(ok.values.guardianPhone, "0550123456");
    assert.equal(ok.values.phone, null);
  }
  const missing = validateApplicationDraft(
    draft({ guardianName: "", guardianPhone: "", guardianRelation: "" }),
    opts,
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.deepEqual(
      [missing.errors.guardianName, missing.errors.guardianPhone, missing.errors.guardianRelation],
      ["admissions.error.required", "admissions.error.required", "admissions.error.required"],
    );
  }
});

test("an adult applies with their own phone; a guardian is not required", () => {
  const adult = draft({
    dateOfBirth: "1998-06-01",
    phone: "0661 22 33 44",
    guardianName: "",
    guardianPhone: "",
    guardianRelation: "",
  });
  const r = validateApplicationDraft(adult, opts);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.minor, false);
    assert.equal(r.values.phone, "0661223344");
    assert.equal(r.values.guardianName, null);
  }
  const noPhone = validateApplicationDraft({ ...adult, phone: "" }, opts);
  assert.equal(noPhone.ok, false);
  if (!noPhone.ok) assert.equal(noPhone.errors.phone, "admissions.error.required");
});

test("names, dates, e-mail, lengths and consent are checked", () => {
  const r = validateApplicationDraft(
    draft({
      firstName: " ",
      dateOfBirth: "2026-02-30",
      email: "not-an-email",
      message: "m".repeat(1001),
      consent: false,
    }),
    opts,
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.errors.firstName, "admissions.error.required");
    assert.equal(r.errors.dateOfBirth, "admissions.error.date");
    assert.equal(r.errors.email, "admissions.error.email");
    assert.equal(r.errors.message, "admissions.error.tooLong");
    assert.equal(r.errors.consent, "admissions.error.consent");
  }
  // Too young / implausibly old.
  for (const dateOfBirth of ["2024-01-01", "1900-01-01"]) {
    const bad = validateApplicationDraft(draft({ dateOfBirth }), opts);
    assert.equal(bad.ok, false, dateOfBirth);
  }
});

test("values are trimmed and empty optionals become null", () => {
  const r = validateApplicationDraft(
    draft({ firstName: "  Ahmed ", email: " Parent@Mail.DZ ", schoolName: "  ", message: " " }),
    opts,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.values.firstName, "Ahmed");
    assert.equal(r.values.email, "parent@mail.dz");
    assert.equal(r.values.schoolName, null);
    assert.equal(r.values.message, null);
  }
});

test("names compare without accents, case or word order", () => {
  assert.deepEqual(normalizeName("Ben Ali  Ahméd"), normalizeName("ahmed ben ali"));
});

test("duplicate candidates: phone first, then name + birth date, then name", () => {
  const app = {
    firstName: "Ahmed",
    lastName: "Ben Ali",
    dateOfBirth: "2016-03-14",
    phone: null,
    guardianPhone: "0550123456",
  };
  const students = [
    {
      id: "name-only",
      fullName: "Ahmed Ben Ali",
      phone: null,
      guardianPhone: null,
      dateOfBirth: "2012-01-01",
    },
    {
      id: "phone",
      fullName: "Sara Ben Ali",
      phone: null,
      guardianPhone: "0550123456",
      dateOfBirth: null,
    },
    {
      id: "name-birth",
      fullName: "ben ali ahmed",
      phone: null,
      guardianPhone: null,
      dateOfBirth: "2016-03-14",
    },
    {
      id: "other",
      fullName: "Yacine K",
      phone: "0770000000",
      guardianPhone: null,
      dateOfBirth: null,
    },
  ];
  assert.deepEqual(duplicateCandidates(app, students), [
    { id: "phone", reason: "phone" },
    { id: "name-birth", reason: "nameAndBirth" },
    { id: "name-only", reason: "name" },
  ]);
});

test("review actions follow the status", () => {
  assert.deepEqual(applicationActions("new"), {
    canStartReview: true,
    canDecide: true,
    canReopen: false,
  });
  assert.deepEqual(applicationActions("reviewing"), {
    canStartReview: false,
    canDecide: true,
    canReopen: false,
  });
  assert.deepEqual(applicationActions("accepted"), {
    canStartReview: false,
    canDecide: false,
    canReopen: false,
  });
  assert.equal(applicationActions("rejected").canReopen, true);
  assert.equal(applicationActions("duplicate").canReopen, true);
});
