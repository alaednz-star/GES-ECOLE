/**
 * Pre-registrations (pré-inscriptions): rules shared by the public form, the server function that
 * receives it and the administration screen. PURE -- no runtime imports, so `node --test` loads it.
 *
 * The database enforces the structural part (20261005110000_applications.sql); the intake server
 * function runs `validateApplicationDraft` again, because a server function is a public HTTP
 * endpoint and nothing the browser sends is trusted.
 *
 * DATA MINIMISATION (Law 18-07): only what is needed to process the request is collected -- who
 * the learner is, how to reach them (or their guardian), which formation and group. No documents.
 */

export const APPLICATION_STATUSES = [
  "new",
  "reviewing",
  "accepted",
  "rejected",
  "duplicate",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Statuses still waiting for a decision. */
export const OPEN_APPLICATION_STATUSES: readonly ApplicationStatus[] = ["new", "reviewing"];

export const GUARDIAN_RELATIONS = ["father", "mother", "guardian", "other"] as const;
export type GuardianRelation = (typeof GUARDIAN_RELATIONS)[number];

export const NAME_MAX = 60;
export const MESSAGE_MAX = 1000;
export const SCHEDULE_MAX = 300;
export const SCHOOL_NAME_MAX = 120;

/** Completed years between a birth date and `today` (both YYYY-MM-DD). */
export function ageOn(dateOfBirth: string, today: string): number {
  const [by, bm, bd] = dateOfBirth.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}

/** Whether a guardian is required: the learner is younger than the institution's threshold. */
export function guardianRequired(
  dateOfBirth: string,
  today: string,
  requiredUnderAge: number,
): boolean {
  return ageOn(dateOfBirth, today) < requiredUnderAge;
}

/**
 * Normalises a phone number to digits with an optional leading "+". Algerian numbers are written
 * "0550 12 34 56", "05 50 12 34 56", "+213 550 12 34 56" or "00213 550...": spaces, dots, dashes
 * and brackets are dropped and "00" becomes "+". Returns null when what remains is not 9 to 15
 * digits (the database CHECK).
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let s = trimmed.replace(/[\s.\-()/]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  return /^\+?[0-9]{9,15}$/.test(s) ? s : null;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export interface ApplicationDraft {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
  email: string;
  schoolLevelId: string | null;
  schoolName: string;
  guardianName: string;
  guardianPhone: string;
  guardianRelation: GuardianRelation | "";
  preferredGroupId: string | null;
  preferredSchedule: string;
  message: string;
  consent: boolean;
}

export interface ApplicationValues {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string | null;
  email: string | null;
  schoolLevelId: string | null;
  schoolName: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianRelation: GuardianRelation | null;
  preferredGroupId: string | null;
  preferredSchedule: string | null;
  message: string | null;
}

export type ApplicationField =
  | "firstName"
  | "lastName"
  | "dateOfBirth"
  | "phone"
  | "email"
  | "schoolName"
  | "guardianName"
  | "guardianPhone"
  | "guardianRelation"
  | "preferredSchedule"
  | "message"
  | "consent";

export type ApplicationValidation =
  | { ok: true; values: ApplicationValues; minor: boolean }
  | { ok: false; errors: Partial<Record<ApplicationField, string>> };

/**
 * Validates a pre-registration. Returns i18n keys (`admissions.error.*`).
 *
 *   - learner: first and last name, a real birth date (3 to 100 years old)
 *   - minor (younger than `guardianRequiredUnderAge`): guardian name, phone and relationship
 *   - adult: their own phone
 *   - phones: Algerian or international formats, normalised; e-mail optional
 *   - consent to the processing of the data is required
 */
export function validateApplicationDraft(
  draft: ApplicationDraft,
  options: { today: string; guardianRequiredUnderAge: number },
): ApplicationValidation {
  const errors: Partial<Record<ApplicationField, string>> = {};

  const firstName = draft.firstName.trim();
  const lastName = draft.lastName.trim();
  if (!firstName) errors.firstName = "admissions.error.required";
  else if (firstName.length > NAME_MAX) errors.firstName = "admissions.error.tooLong";
  if (!lastName) errors.lastName = "admissions.error.required";
  else if (lastName.length > NAME_MAX) errors.lastName = "admissions.error.tooLong";

  const dob = draft.dateOfBirth.trim();
  let minor = false;
  if (!dob) errors.dateOfBirth = "admissions.error.required";
  else if (!isIsoDate(dob)) errors.dateOfBirth = "admissions.error.date";
  else {
    const age = ageOn(dob, options.today);
    if (age < 3 || age >= 100) errors.dateOfBirth = "admissions.error.date";
    else minor = age < options.guardianRequiredUnderAge;
  }

  const phone = draft.phone.trim() ? normalizePhone(draft.phone) : null;
  if (draft.phone.trim() && !phone) errors.phone = "admissions.error.phone";

  const email = draft.email.trim().toLowerCase();
  if (email && (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
    errors.email = "admissions.error.email";
  }

  const guardianName = draft.guardianName.trim();
  const guardianPhone = draft.guardianPhone.trim() ? normalizePhone(draft.guardianPhone) : null;
  if (draft.guardianPhone.trim() && !guardianPhone) errors.guardianPhone = "admissions.error.phone";
  if (guardianName && (guardianName.length < 2 || guardianName.length > 120)) {
    errors.guardianName = "admissions.error.tooLong";
  }

  if (minor) {
    if (!guardianName) errors.guardianName = "admissions.error.required";
    if (!draft.guardianPhone.trim()) errors.guardianPhone = "admissions.error.required";
    if (!draft.guardianRelation) errors.guardianRelation = "admissions.error.required";
  } else if (!draft.phone.trim() && !errors.dateOfBirth) {
    errors.phone = "admissions.error.required";
  }

  const schoolName = draft.schoolName.trim();
  if (schoolName.length > SCHOOL_NAME_MAX) errors.schoolName = "admissions.error.tooLong";
  const preferredSchedule = draft.preferredSchedule.trim();
  if (preferredSchedule.length > SCHEDULE_MAX)
    errors.preferredSchedule = "admissions.error.tooLong";
  const message = draft.message.trim();
  if (message.length > MESSAGE_MAX) errors.message = "admissions.error.tooLong";

  if (!draft.consent) errors.consent = "admissions.error.consent";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    minor,
    values: {
      firstName,
      lastName,
      dateOfBirth: dob,
      phone,
      email: email || null,
      schoolLevelId: draft.schoolLevelId,
      schoolName: schoolName || null,
      guardianName: minor || guardianName ? guardianName || null : null,
      guardianPhone: minor || guardianPhone ? guardianPhone : null,
      guardianRelation: draft.guardianRelation || null,
      preferredGroupId: draft.preferredGroupId,
      preferredSchedule: preferredSchedule || null,
      message: message || null,
    },
  };
}

/** An empty form. */
export function emptyApplicationDraft(): ApplicationDraft {
  return {
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    phone: "",
    email: "",
    schoolLevelId: null,
    schoolName: "",
    guardianName: "",
    guardianPhone: "",
    guardianRelation: "",
    preferredGroupId: null,
    preferredSchedule: "",
    message: "",
    consent: false,
  };
}

/* ------------------------------------------------------------------ review */

export interface DuplicateCandidateSource {
  id: string;
  fullName: string;
  phone: string | null;
  guardianPhone: string | null;
  dateOfBirth: string | null;
}

/** Lowercase, accent-free, single-spaced: "Ben Ali  Ahméd" and "ahmed ben ali" compare equal. */
export function normalizeName(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort();
}

/**
 * Existing students who may be the same person as the applicant, strongest reason first:
 *   phone        a phone of the application equals the student's or their guardian's phone
 *   name + birth same name words and same birth date
 *   name         same name words
 * Never shown to the public: only the administration sees candidates, at review.
 */
export function duplicateCandidates(
  application: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    phone: string | null;
    guardianPhone: string | null;
  },
  students: readonly DuplicateCandidateSource[],
): { id: string; reason: "phone" | "nameAndBirth" | "name" }[] {
  const phones = new Set(
    [application.phone, application.guardianPhone].filter(Boolean) as string[],
  );
  const name = normalizeName(`${application.firstName} ${application.lastName}`).join(" ");
  const rank = { phone: 0, nameAndBirth: 1, name: 2 } as const;
  const out: { id: string; reason: "phone" | "nameAndBirth" | "name" }[] = [];
  for (const s of students) {
    const samePhone =
      (s.phone !== null && phones.has(s.phone)) ||
      (s.guardianPhone !== null && phones.has(s.guardianPhone));
    const sameName = normalizeName(s.fullName).join(" ") === name && name !== "";
    if (samePhone) out.push({ id: s.id, reason: "phone" });
    else if (sameName && s.dateOfBirth === application.dateOfBirth) {
      out.push({ id: s.id, reason: "nameAndBirth" });
    } else if (sameName) out.push({ id: s.id, reason: "name" });
  }
  return out.sort((a, b) => rank[a.reason] - rank[b.reason]);
}

/** What an administrator may do with an application in a given status. */
export function applicationActions(status: ApplicationStatus): {
  canStartReview: boolean;
  canDecide: boolean;
  canReopen: boolean;
} {
  const open = OPEN_APPLICATION_STATUSES.includes(status);
  return {
    canStartReview: status === "new",
    canDecide: open,
    canReopen: status === "rejected" || status === "duplicate",
  };
}
