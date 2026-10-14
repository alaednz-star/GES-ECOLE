/**
 * Subject domains and the formation-type filter.
 *
 *   node --test src/features/school/subject-domain.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SUBJECT_DOMAIN,
  SUBJECT_DOMAINS,
  SUBJECT_DOMAINS_BY_CATEGORY,
  categoryOffersAllDomains,
  isSubjectCompatible,
  isSubjectDomain,
  subjectAfterCategoryChange,
  subjectsForCategory,
} from "./subject-domain.ts";
import { BUILT_IN_FORMATION_TYPES } from "./formation-type-model.ts";

const s = (id: string, domain: string) => ({ id, domain });
const subjects = [
  s("english", "languages"),
  s("french", "languages"),
  s("arabic", "languages"),
  s("maths", "school_subjects"),
  s("physics", "school_subjects"),
  s("it", "computing"),
  s("accounting", "professional"),
  s("mkt", "other"),
];
const ids = (list: { id: string }[]) => list.map((x) => x.id).sort();

test("the domains match the database CHECK, with 'other' as the unclassified default", () => {
  assert.deepEqual(
    [...SUBJECT_DOMAINS],
    ["languages", "school_subjects", "computing", "professional", "other"],
  );
  assert.equal(DEFAULT_SUBJECT_DOMAIN, "other");
  assert.equal(isSubjectDomain("languages"), true);
  assert.equal(isSubjectDomain("Languages"), false);
  assert.equal(isSubjectDomain(null), false);
});

test("every built-in formation type has a filter, using known domains only", () => {
  for (const c of BUILT_IN_FORMATION_TYPES) {
    const domains = SUBJECT_DOMAINS_BY_CATEGORY[c];
    assert.ok(domains && domains.length > 0, c);
    for (const d of domains) assert.ok(isSubjectDomain(d), `${c}: ${d}`);
  }
});

test("a language formation offers language subjects only", () => {
  assert.deepEqual(ids(subjectsForCategory(subjects, "language")), ["arabic", "english", "french"]);
});

test("academic support and exam preparation offer school subjects and languages", () => {
  const expected = ["arabic", "english", "french", "maths", "physics"];
  assert.deepEqual(ids(subjectsForCategory(subjects, "academic_support")), expected);
  assert.deepEqual(ids(subjectsForCategory(subjects, "exam_preparation")), expected);
});

test("professional training offers professional, computing and language subjects", () => {
  assert.deepEqual(ids(subjectsForCategory(subjects, "professional_training")), [
    "accounting",
    "arabic",
    "english",
    "french",
    "it",
  ]);
});

test("workshop and other offer every subject, unclassified ones included", () => {
  assert.equal(subjectsForCategory(subjects, "workshop").length, subjects.length);
  assert.equal(subjectsForCategory(subjects, "other").length, subjects.length);
  assert.equal(categoryOffersAllDomains("workshop"), true);
  assert.equal(categoryOffersAllDomains("language"), false);
});

test("the subject a formation was saved with is always offered (existing data loads)", () => {
  assert.deepEqual(ids(subjectsForCategory(subjects, "language", "maths")), [
    "arabic",
    "english",
    "french",
    "maths",
  ]);
});

test("no subject fits every type", () => {
  for (const c of BUILT_IN_FORMATION_TYPES) assert.equal(isSubjectCompatible(c, null), true);
});

test("changing the type keeps a compatible subject", () => {
  assert.deepEqual(subjectAfterCategoryChange(subjects, "english", "academic_support"), {
    subjectId: "english",
    cleared: false,
  });
  assert.deepEqual(subjectAfterCategoryChange(subjects, "english", "professional_training"), {
    subjectId: "english",
    cleared: false,
  });
});

test("changing the type clears an incompatible subject and says so", () => {
  assert.deepEqual(subjectAfterCategoryChange(subjects, "maths", "language"), {
    subjectId: null,
    cleared: true,
  });
  assert.deepEqual(subjectAfterCategoryChange(subjects, "it", "academic_support"), {
    subjectId: null,
    cleared: true,
  });
});

test("no subject, or a subject not loaded yet, is left as it is", () => {
  assert.deepEqual(subjectAfterCategoryChange(subjects, null, "language"), {
    subjectId: null,
    cleared: false,
  });
  assert.deepEqual(subjectAfterCategoryChange([], "x", "language"), {
    subjectId: "x",
    cleared: false,
  });
});

test("school education offers school subjects and languages", () => {
  assert.deepEqual(ids(subjectsForCategory(subjects, "formal_education")), [
    "arabic",
    "english",
    "french",
    "maths",
    "physics",
  ]);
});

test("general course and extracurricular activities offer every subject", () => {
  assert.equal(subjectsForCategory(subjects, "general_course").length, subjects.length);
  assert.equal(subjectsForCategory(subjects, "extracurricular").length, subjects.length);
});

test("a custom type offers every subject (its purpose is the institution's)", () => {
  assert.equal(subjectsForCategory(subjects, "custom_stage_intensif").length, subjects.length);
  assert.equal(categoryOffersAllDomains("custom_stage_intensif"), true);
});

test("English fits a language course, academic support, professional training and a workshop", () => {
  for (const c of [
    "language",
    "academic_support",
    "professional_training",
    "workshop",
    "extracurricular",
  ]) {
    assert.equal(isSubjectCompatible(c, { domain: "languages" }), true, c);
  }
});
