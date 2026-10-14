import type { DependencySeverity } from "./dependency-model";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isValidAlgerianPhone, normaliseAlgerianPhone } from "@/lib/phone";

/**
 * Server-function boundary for privileged teacher operations.
 *
 * IMPORTANT: `provisioning.server.ts` is imported **inside** each handler, never
 * at module scope. This file is reachable from the client graph, so a top-level
 * import would pull the service-role client into the browser bundle. The dynamic
 * import keeps it strictly on the server.
 *
 * Validation runs here as well as in the form: a server function is a public
 * HTTP endpoint, so it cannot trust anything the client sends.
 */

const createSchema = z.object({
  accessToken: z.string().min(1),
  fullName: z.string().trim().min(3).max(120),
  email: z.string().trim().email().max(254),
  phone: z
    .string()
    .trim()
    .refine((v) => v === "" || isValidAlgerianPhone(v), "invalid phone")
    .optional(),
  subjectIds: z.array(z.string().uuid()).min(1),
  experienceYears: z.number().int().min(0).max(60),
  bio: z.string().trim().max(2000).optional(),
});

const resetSchema = z.object({
  accessToken: z.string().min(1),
  teacherId: z.string().uuid(),
});

const lifecycleSchema = z.object({
  accessToken: z.string().min(1),
  teacherId: z.string().uuid(),
  status: z.enum(["active", "suspended", "archived"]),
  reason: z.string().trim().max(500).optional(),
});

const targetSchema = z.object({
  accessToken: z.string().min(1),
  teacherId: z.string().uuid(),
});

/** A relationship an account leaves behind. Not all of them stand in the way. */
export interface DependencyRow {
  sourceTable: string;
  relationship: string;
  rowCount: number;
  severity: DependencySeverity;
}

export interface DependencyResult {
  ok: boolean;
  code?: string;
  message?: string;
  dependencies?: DependencyRow[];
}

/** Shape returned to the admin. Carries the one-time password. */
export interface ProvisionResult {
  ok: boolean;
  code?: string;
  message?: string;
  teacher?: {
    teacherId: string;
    fullName: string;
    email: string;
    temporaryPassword: string;
  };
}

export const createTeacherFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data }): Promise<ProvisionResult> => {
    const { createTeacherAccount, ProvisioningError } = await import("./provisioning.server");
    try {
      const teacher = await createTeacherAccount(data.accessToken, {
        fullName: data.fullName,
        email: data.email,
        phone: data.phone ? normaliseAlgerianPhone(data.phone) : null,
        subjectIds: data.subjectIds,
        experienceYears: data.experienceYears,
        bio: data.bio ?? null,
      });
      return { ok: true, teacher };
    } catch (e) {
      if (e instanceof ProvisioningError) {
        return { ok: false, code: e.code, message: e.message };
      }
      // Never surface an unexpected server error verbatim -- it can leak
      // internals. Log it server-side, return something generic.
      console.error("[createTeacherFn]", e);
      return { ok: false, code: "UNKNOWN", message: "Could not create the account." };
    }
  });

export const resetTeacherPasswordFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => resetSchema.parse(data))
  .handler(async ({ data }): Promise<ProvisionResult> => {
    const { resetTeacherPassword, ProvisioningError } = await import("./provisioning.server");
    try {
      const teacher = await resetTeacherPassword(data.accessToken, data.teacherId);
      return { ok: true, teacher };
    } catch (e) {
      if (e instanceof ProvisioningError) {
        return { ok: false, code: e.code, message: e.message };
      }
      console.error("[resetTeacherPasswordFn]", e);
      return { ok: false, code: "UNKNOWN", message: "Could not reset the password." };
    }
  });

/** Suspend / reactivate / archive / restore. One endpoint, one state machine. */
export const setTeacherLifecycleFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => lifecycleSchema.parse(data))
  .handler(async ({ data }): Promise<ProvisionResult> => {
    const { setTeacherLifecycle, ProvisioningError } = await import("./provisioning.server");
    try {
      await setTeacherLifecycle(data.accessToken, data.teacherId, data.status, data.reason ?? null);
      return { ok: true };
    } catch (e) {
      if (e instanceof ProvisioningError) {
        return { ok: false, code: e.code, message: e.message };
      }
      console.error("[setTeacherLifecycleFn]", e);
      return { ok: false, code: "UNKNOWN", message: "Could not update the account." };
    }
  });

/** Reads the blockers so the UI can explain, rather than offer a doomed action. */
export const teacherDependenciesFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => targetSchema.parse(data))
  .handler(async ({ data }): Promise<DependencyResult> => {
    const { getEntityDependencies, ProvisioningError } = await import("./provisioning.server");
    try {
      const dependencies = await getEntityDependencies(data.accessToken, "teacher", data.teacherId);
      return { ok: true, dependencies };
    } catch (e) {
      if (e instanceof ProvisioningError) {
        return { ok: false, code: e.code, message: e.message };
      }
      console.error("[teacherDependenciesFn]", e);
      return { ok: false, code: "UNKNOWN", message: "Could not read dependencies." };
    }
  });

/** Permanent deletion. Refused server-side when any dependency remains. */
export const deleteTeacherFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => targetSchema.parse(data))
  .handler(async ({ data }): Promise<ProvisionResult> => {
    const { deleteTeacherAccount, ProvisioningError } = await import("./provisioning.server");
    try {
      await deleteTeacherAccount(data.accessToken, data.teacherId);
      return { ok: true };
    } catch (e) {
      if (e instanceof ProvisioningError) {
        return { ok: false, code: e.code, message: e.message };
      }
      console.error("[deleteTeacherFn]", e);
      return { ok: false, code: "UNKNOWN", message: "Could not delete the account." };
    }
  });
