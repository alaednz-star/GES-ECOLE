import { z } from "zod";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

import { isValidAlgerianPhone } from "@/lib/phone";

const MIN_AGE = 3;
const MAX_AGE = 100;

function ageOn(date: Date): number {
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const monthDiff = today.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) age -= 1;
  return age;
}

/** A required Algerian mobile. Validation and normalisation live in lib/phone. */
const requiredPhone = (t: Translate, requiredKey: string) =>
  z
    .string()
    .trim()
    .min(1, t(requiredKey))
    .refine(isValidAlgerianPhone, t("onboarding.error.phoneInvalid"));

/**
 * An optional Algerian mobile: blank is fine, but anything typed must be a
 * real mobile number rather than being silently discarded.
 */
const optionalPhone = (t: Translate) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || isValidAlgerianPhone(v), t("onboarding.error.phoneInvalid"))
    .optional();

/** Step 2 — who the student is. Mirrors the CHECK constraints on `students`. */
export const createPersonalSchema = (t: Translate) =>
  z.object({
    fullName: z
      .string()
      .trim()
      .min(3, t("onboarding.error.fullName"))
      .max(120, t("onboarding.error.fullNameLong")),
    gender: z.enum(["male", "female"], { message: t("onboarding.error.gender") }),
    dateOfBirth: z
      .string()
      .min(1, t("onboarding.error.dobRequired"))
      .refine((value) => !Number.isNaN(Date.parse(value)), t("onboarding.error.dobInvalid"))
      .refine((value) => {
        const age = ageOn(new Date(value));
        return age >= MIN_AGE && age <= MAX_AGE;
      }, t("onboarding.error.dobRange")),
    // Optional: the guardian's number is the contact the centre relies on.
    phone: optionalPhone(t),
  });

/**
 * Step 3 — guardian contact.
 *
 * Split from the personal step rather than appended to it: the centre needs a
 * reachable adult, and giving that its own screen makes the ask obvious instead
 * of burying it at the bottom of a long form.
 */
export const createGuardianSchema = (t: Translate) =>
  z.object({
    guardianName: z
      .string()
      .trim()
      .min(3, t("onboarding.error.guardianName"))
      .max(120, t("onboarding.error.guardianNameLong")),
    guardianPhone: requiredPhone(t, "onboarding.error.guardianPhoneRequired"),
    address: z.string().trim().max(300, t("onboarding.error.addressLong")).optional(),
  });

/**
 * Steps 4-5 — academic identity.
 *
 * `streamId` is optional here because whether it is *required* depends on which
 * level was chosen, which zod cannot see from inside the schema. The wizard
 * blocks progress when a stream is missing, and the Task 2A database trigger is
 * the authoritative backstop.
 */
export const createAcademicSchema = (t: Translate) =>
  z.object({
    stage: z.enum(["primary", "middle", "high"], { message: t("onboarding.error.stage") }),
    levelId: z.string().uuid(t("onboarding.error.level")),
    streamId: z.string().uuid().nullable().optional(),
  });

export type PersonalValues = z.infer<ReturnType<typeof createPersonalSchema>>;
export type GuardianValues = z.infer<ReturnType<typeof createGuardianSchema>>;
export type AcademicValues = z.infer<ReturnType<typeof createAcademicSchema>>;
