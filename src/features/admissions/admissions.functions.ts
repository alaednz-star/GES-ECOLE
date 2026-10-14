/**
 * Server-function boundary for pre-registrations (pré-inscriptions).
 *
 * Same contract as `admins/admins.functions.ts`: `admissions.server.ts` is imported INSIDE each
 * handler, never at module scope, so the service-role client never reaches the browser bundle.
 * Every input is validated here (a server function is a public HTTP endpoint) and again in the
 * server module; the public functions need no session, the accept function checks that the
 * caller is an administrator.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ApplicationField } from "./application-model";

const formationSchema = z.object({ programId: z.string().uuid() });

const text = (max: number) => z.string().max(max);
const submitSchema = z.object({
  programId: z.string().uuid(),
  locale: z.enum(["fr", "ar", "en"]),
  website: z.string().max(200),
  elapsedMs: z.number().int().min(0).max(86_400_000),
  draft: z.object({
    firstName: text(200),
    lastName: text(200),
    dateOfBirth: text(20),
    phone: text(40),
    email: text(300),
    schoolLevelId: z.string().uuid().nullable(),
    schoolName: text(300),
    guardianName: text(300),
    guardianPhone: text(40),
    guardianRelation: z.enum(["father", "mother", "guardian", "other", ""]),
    preferredGroupId: z.string().uuid().nullable(),
    preferredSchedule: text(600),
    message: text(2000),
    consent: z.boolean(),
  }),
});

const acceptSchema = z.object({
  accessToken: z.string().min(1),
  applicationId: z.string().uuid(),
  studentId: z.string().uuid().nullable(),
  groupId: z.string().uuid(),
});

export type PublicFormationResult = import("./admissions.server").PublicFormationResult;
export type PublicFormation = import("./admissions.server").PublicFormation;

export type SubmitResult =
  { ok: true } | { ok: false; code: string; fields?: Partial<Record<ApplicationField, string>> };

export type AcceptResult =
  | { ok: true; studentId: string; registrationId: string }
  | { ok: false; code: string; message: string };

/** The public page of a formation. Null when it does not exist; `open: false` when closed. */
export const getPublicFormationFn = createServerFn({ method: "GET" })
  .validator((data: unknown) => formationSchema.parse(data))
  .handler(async ({ data }): Promise<PublicFormationResult> => {
    const { getPublicFormation } = await import("./admissions.server");
    try {
      return await getPublicFormation(data.programId);
    } catch (e) {
      console.error("[getPublicFormationFn]", e);
      return null;
    }
  });

/** Receives a pre-registration from the public form. */
export const submitApplicationFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => submitSchema.parse(data))
  .handler(async ({ data }): Promise<SubmitResult> => {
    const { submitApplication, AdmissionsError } = await import("./admissions.server");
    const { getRequestIP, getRequestHeader } = await import("@tanstack/react-start/server");
    const source =
      getRequestIP({ xForwardedFor: true }) ?? getRequestHeader("user-agent") ?? "unknown";
    try {
      await submitApplication(data, source);
      return { ok: true };
    } catch (e) {
      if (e instanceof AdmissionsError) {
        return { ok: false, code: e.code, ...(e.fields ? { fields: e.fields } : {}) };
      }
      console.error("[submitApplicationFn]", e);
      return { ok: false, code: "UNKNOWN" };
    }
  });

/** Accepts an application: student created or linked, then placed in a group. Admin only. */
export const acceptApplicationFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => acceptSchema.parse(data))
  .handler(async ({ data }): Promise<AcceptResult> => {
    const { acceptApplication, AdmissionsError } = await import("./admissions.server");
    const { ProvisioningError } = await import("../teachers/provisioning.server");
    try {
      return { ok: true, ...(await acceptApplication(data)) };
    } catch (e) {
      if (e instanceof AdmissionsError || e instanceof ProvisioningError) {
        return { ok: false, code: e.code, message: e.message };
      }
      console.error("[acceptApplicationFn]", e);
      return { ok: false, code: "UNKNOWN", message: "The application could not be accepted." };
    }
  });
