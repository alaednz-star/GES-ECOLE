/**
 * Server-function boundary for administrator management.
 *
 * Same contract as `teachers/provisioning.functions.ts`, and deliberately the same
 * shape: `provisioning.server.ts` is imported **inside** each handler, never at
 * module scope. This file is reachable from the client graph, so a top-level
 * import would pull the service-role client into the browser bundle.
 *
 * Validation runs here as well as in the form. A server function is a public HTTP
 * endpoint — anyone can POST to it — so nothing the client sends is trusted, and
 * every handler re-checks authorisation server-side through `assertAdmin`.
 *
 * THE ROLE IS NOT AN INPUT. There is no `role` field in any schema below. An
 * administrator is created because `createAdminAccount` says `admin` in server
 * code; no request body can change that.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const listSchema = z.object({
  accessToken: z.string().min(1),
});

const createSchema = z.object({
  accessToken: z.string().min(1),
  fullName: z.string().trim().min(3).max(120),
  email: z.string().trim().email().max(254),
  // The page's own origin, used to build the setup link. Supabase independently
  // refuses any redirect that is not allow-listed, so a forged value cannot
  // redirect a recovery mail somewhere else — it just fails to send.
  origin: z.string().trim().url().max(300),
});

const recoverySchema = z.object({
  accessToken: z.string().min(1),
  userId: z.string().uuid(),
  origin: z.string().trim().url().max(300),
});

const lifecycleSchema = z.object({
  accessToken: z.string().min(1),
  userId: z.string().uuid(),
  // Whether the account should be able to sign in afterwards. A boolean rather than an
  // action name, so a request cannot ask for a transition that does not exist.
  active: z.boolean(),
});

const deleteSchema = z.object({
  accessToken: z.string().min(1),
  userId: z.string().uuid(),
});

export type UsersResult =
  | { ok: true; users: import("../teachers/provisioning.server").ManagedUser[] }
  | { ok: false; code: string; message: string };

export type CreateAdminResult =
  | { ok: true; admin: import("../teachers/provisioning.server").CreatedAdmin }
  | { ok: false; code: string; message: string };

export type RecoveryResult =
  { ok: true; sent: boolean } | { ok: false; code: string; message: string };

export type LifecycleResult = { ok: true } | { ok: false; code: string; message: string };

export const listUsersFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => listSchema.parse(data))
  .handler(async ({ data }): Promise<UsersResult> => {
    const { listManagedUsers, ProvisioningError } = await import("../teachers/provisioning.server");
    try {
      return { ok: true, users: await listManagedUsers(data.accessToken) };
    } catch (e) {
      if (e instanceof ProvisioningError) return { ok: false, code: e.code, message: e.message };
      console.error("[listUsersFn]", e);
      return { ok: false, code: "UNKNOWN", message: "Could not load the user list." };
    }
  });

export const createAdminFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data }): Promise<CreateAdminResult> => {
    const { createAdminAccount, ProvisioningError } =
      await import("../teachers/provisioning.server");
    try {
      const created = await createAdminAccount(data.accessToken, {
        fullName: data.fullName,
        email: data.email,
        origin: data.origin,
      });
      return { ok: true, admin: created };
    } catch (e) {
      if (e instanceof ProvisioningError) return { ok: false, code: e.code, message: e.message };
      // Never surface an unexpected server error verbatim; it can leak internals.
      console.error("[createAdminFn]", e);
      return { ok: false, code: "UNKNOWN", message: "Could not create the account." };
    }
  });

export const sendRecoveryFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => recoverySchema.parse(data))
  .handler(async ({ data }): Promise<RecoveryResult> => {
    const { resendRecoveryFor, ProvisioningError } =
      await import("../teachers/provisioning.server");
    try {
      return {
        ok: true,
        sent: await resendRecoveryFor(data.accessToken, data.userId, data.origin),
      };
    } catch (e) {
      if (e instanceof ProvisioningError) return { ok: false, code: e.code, message: e.message };
      console.error("[sendRecoveryFn]", e);
      return { ok: false, code: "UNKNOWN", message: "Could not send the email." };
    }
  });

/**
 * Deactivates or reactivates an administrator.
 *
 * THE TARGET IS AN ID, NEVER A ROLE OR A FLAG THAT DECIDES AUTHORITY. Whether the caller may
 * do this is re-derived on the server from their own token, and whether the target MAY be
 * deactivated is decided by the database -- so a forged request can name any account it likes
 * and still be refused by the same rules the screen shows.
 */
export const setAdminActiveFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => lifecycleSchema.parse(data))
  .handler(async ({ data }): Promise<LifecycleResult> => {
    const { setAdminActive, ProvisioningError } = await import("../teachers/provisioning.server");
    try {
      await setAdminActive(data.accessToken, data.userId, data.active);
      return { ok: true };
    } catch (e) {
      if (e instanceof ProvisioningError) return { ok: false, code: e.code, message: e.message };
      console.error("[setAdminActiveFn]", e);
      return { ok: false, code: "UNKNOWN", message: "Could not update the account." };
    }
  });

/** Permanently deletes an administrator account. The audit trail survives it. */
export const deleteAdminFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => deleteSchema.parse(data))
  .handler(async ({ data }): Promise<LifecycleResult> => {
    const { deleteAdminAccount, ProvisioningError } =
      await import("../teachers/provisioning.server");
    try {
      await deleteAdminAccount(data.accessToken, data.userId);
      return { ok: true };
    } catch (e) {
      if (e instanceof ProvisioningError) return { ok: false, code: e.code, message: e.message };
      console.error("[deleteAdminFn]", e);
      return { ok: false, code: "UNKNOWN", message: "Could not delete the account." };
    }
  });
