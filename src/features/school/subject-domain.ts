/**
 * Subject domains and which ones fit each formation type (ADR-004 section 1). PURE.
 *
 * No runtime imports, so `node --test` can load it.
 *
 * TWO DIFFERENT CONCEPTS, KEPT APART
 *   subject domain   what a subject IS (`subjects.domain`): English is a language, Mathematics
 *                    a school subject. Set on the Subjects page.
 *   formation type   what an OFFER is (`programs.category`): a language course, academic
 *                    support, an exam preparation...
 *
 * The type only FILTERS the subjects the formation form offers. It never redefines a subject,
 * and the database does not couple the two: a formation keeps the subject it was saved with,
 * and reclassifying a subject never invalidates a formation. Level systems are a third,
 * independent concept (`level-model.ts`).
 */

import type { ProgramCategory } from "./program-model";

/** Matches the CHECK on `subjects.domain` (20261004130000_subject_domains.sql). */
export const SUBJECT_DOMAINS = [
  "languages",
  "school_subjects",
  "computing",
  "professional",
  "other",
] as const;
export type SubjectDomain = (typeof SUBJECT_DOMAINS)[number];

/** The domain a subject gets when none is chosen: the explicit "not classified" state. */
export const DEFAULT_SUBJECT_DOMAIN: SubjectDomain = "other";

export function isSubjectDomain(value: unknown): value is SubjectDomain {
  return (SUBJECT_DOMAINS as readonly unknown[]).includes(value);
}

/**
 * The subject domains each BUILT-IN formation type offers.
 *
 *   school education, academic support,  school subjects and languages (Arabic, French and
 *   exam preparation                     English are school subjects too)
 *   language course                      languages
 *   professional training                professional, computing, and languages (business or
 *                                        professional English is a real offer)
 *   general course, extracurricular,     every domain (maths enrichment, Soroban, programming,
 *   workshop, other                      robotics, English club...)
 *
 * A custom type (created by the institution) offers every domain: Gestion École does not know its
 * purpose. A filter for the form only, not a database rule.
 */
export const SUBJECT_DOMAINS_BY_CATEGORY: Partial<
  Record<ProgramCategory, readonly SubjectDomain[]>
> = {
  formal_education: ["school_subjects", "languages"],
  academic_support: ["school_subjects", "languages"],
  exam_preparation: ["school_subjects", "languages"],
  language: ["languages"],
  general_course: SUBJECT_DOMAINS,
  extracurricular: SUBJECT_DOMAINS,
  professional_training: ["professional", "computing", "languages"],
  workshop: SUBJECT_DOMAINS,
  other: SUBJECT_DOMAINS,
};

export function domainsForCategory(category: ProgramCategory): readonly SubjectDomain[] {
  return SUBJECT_DOMAINS_BY_CATEGORY[category] ?? SUBJECT_DOMAINS;
}

/** Whether every domain is offered (no filtering to explain). */
export function categoryOffersAllDomains(category: ProgramCategory): boolean {
  return SUBJECT_DOMAINS.every((d) => domainsForCategory(category).includes(d));
}

export function isSubjectCompatible(
  category: ProgramCategory,
  subject: { domain: string } | null | undefined,
): boolean {
  if (!subject) return true; // "no subject" fits every type
  return (domainsForCategory(category) as readonly string[]).includes(subject.domain);
}

/**
 * The subjects the formation form offers for a type: the compatible ones, plus `keepId` (the
 * subject an existing formation was saved with) so an existing combination still loads and
 * shows what it holds.
 */
export function subjectsForCategory<T extends { id: string; domain: string }>(
  subjects: readonly T[],
  category: ProgramCategory,
  keepId: string | null = null,
): T[] {
  return subjects.filter((s) => s.id === keepId || isSubjectCompatible(category, s));
}

/**
 * The subject to keep after the type changes: the current one if it still fits, otherwise none.
 * `cleared` tells the form to explain why the subject was removed.
 */
export function subjectAfterCategoryChange<T extends { id: string; domain: string }>(
  subjects: readonly T[],
  subjectId: string | null,
  category: ProgramCategory,
): { subjectId: string | null; cleared: boolean } {
  if (!subjectId) return { subjectId: null, cleared: false };
  const subject = subjects.find((s) => s.id === subjectId);
  // Unknown (not loaded yet): leave it to the database rather than drop a real value.
  if (!subject) return { subjectId, cleared: false };
  return isSubjectCompatible(category, subject)
    ? { subjectId, cleared: false }
    : { subjectId: null, cleared: true };
}
