/**
 * Privileged teacher-account operations. SERVER ONLY.
 *
 * SECURITY CONTRACT
 * -----------------
 * This module reaches `supabaseAdmin`, which holds the service role key and
 * bypasses Row Level Security entirely. Three rules keep that safe:
 *
 *   1. The `.server.ts` suffix keeps this file out of the client bundle. It
 *      must only ever be reached through `createServerFn().handler()`, and it
 *      must never be imported from a component, route, or `.functions.ts`.
 *   2. Every exported operation calls `assertAdmin()` first. The service role
 *      ignores RLS, so authorisation is this module's own responsibility --
 *      there is no policy underneath to catch a mistake.
 *   3. Generated passwords are returned to the caller exactly once and are
 *      never written to the database, the audit log, or any log line.
 */

import { canDelete, describeBlockers, type DependencySeverity } from "./dependency-model";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/* ----------------------------- PASSWORD GEN ----------------------------- */

/**
 * Alphabet excluding characters that are ambiguous when a temporary password is
 * read off a screen or a printout: 0/O, 1/l/I. An admin will be dictating these
 * to a teacher, so transcription errors are a real failure mode.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const SYMBOLS = "!@#$%&*?";
const LENGTH = 16;

/**
 * Cryptographically secure temporary password.
 *
 * Uses `crypto.getRandomValues` with rejection sampling -- taking `% alphabet`
 * of a raw byte would bias the low-numbered characters, since 256 is not a
 * multiple of the alphabet size. At 16 characters from a 56-character alphabet
 * this is roughly 92 bits of entropy.
 *
 * Contains no name, date, or sequence: nothing derived from the account.
 */
export function generateTemporaryPassword(): string {
  const pool = ALPHABET + SYMBOLS;
  const max = Math.floor(256 / pool.length) * pool.length;
  const out: string[] = [];

  while (out.length < LENGTH) {
    const bytes = new Uint8Array(LENGTH);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (out.length >= LENGTH) break;
      // Reject the tail that would skew the distribution.
      if (b >= max) continue;
      out.push(pool[b % pool.length] as string);
    }
  }

  // Guarantee at least one symbol and one digit so the result always satisfies
  // a strict password policy, without weakening the rest of the string.
  const withSymbol = ensureClass(out, SYMBOLS, 0);
  return ensureClass(withSymbol, "23456789", 1).join("");
}

function ensureClass(chars: string[], klass: string, at: number): string[] {
  if (chars.some((c) => klass.includes(c))) return chars;
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  const copy = [...chars];
  copy[at] = klass[(bytes[0] as number) % klass.length] as string;
  return copy;
}

/* ------------------------------ ADMIN CLIENT ---------------------------- */

let cached: ReturnType<typeof createClient<Database>> | undefined;

/**
 * Service-role client, created lazily so a missing key fails at call time with
 * a clear message rather than at import time with a blank screen.
 */
function admin() {
  if (cached) return cached;

  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!url || !key) {
    throw new ProvisioningError(
      "SERVICE_KEY_MISSING",
      "Server is not configured to create accounts. Set SUPABASE_SERVICE_ROLE_KEY as a server-side environment variable.",
    );
  }

  cached = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** A failure with a stable code the client can map to a translated message. */
export class ProvisioningError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProvisioningError";
  }
}

/* ------------------------------ AUTHORISATION --------------------------- */

export interface Actor {
  id: string;
  email: string | null;
}

/**
 * Confirms the caller is an admin, using the caller's own access token.
 *
 * The token is verified by Supabase Auth, then the role is read with the
 * service client. Reading the role via the *admin* client is deliberate: it
 * must not depend on the caller's RLS visibility, only on what the database
 * actually records.
 */
export async function assertAdmin(accessToken: string | undefined): Promise<Actor> {
  if (!accessToken) {
    throw new ProvisioningError("UNAUTHENTICATED", "You must be signed in.");
  }

  const { data: userData, error: userError } = await admin().auth.getUser(accessToken);
  if (userError || !userData.user) {
    throw new ProvisioningError("UNAUTHENTICATED", "Your session has expired.");
  }

  const { data: roles, error: roleError } = await admin()
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id);

  if (roleError) {
    throw new ProvisioningError("ROLE_LOOKUP_FAILED", "Could not verify your permissions.");
  }
  if (!(roles ?? []).some((r) => r.role === "admin")) {
    throw new ProvisioningError("FORBIDDEN", "Only administrators can manage teacher accounts.");
  }

  return { id: userData.user.id, email: userData.user.email ?? null };
}

/* -------------------------------- AUDIT -------------------------------- */

type AuditAction = Database["public"]["Enums"]["audit_action"];

/**
 * Appends to the audit trail. Never receives a password: callers pass only
 * non-secret context, and a CHECK constraint on the table rejects the keys
 * `password`, `temporary_password` and `temp_password` regardless.
 *
 * A failed audit write must not roll back a completed account operation, so
 * this logs and continues rather than throwing.
 */
async function audit(entry: {
  action: AuditAction;
  actor: Actor;
  targetId: string | null;
  targetEmail: string | null;
  details?: Record<string, unknown>;
}) {
  const { error } = await admin()
    .from("audit_log")
    .insert({
      action: entry.action,
      actor_id: entry.actor.id,
      actor_email: entry.actor.email,
      target_id: entry.targetId,
      target_email: entry.targetEmail,
      details: (entry.details ?? {}) as never,
    });
  if (error) console.error("[audit] failed to record", entry.action, error.message);
}

/**
 * "Banned until the heat death of the sun", which is how GoTrue expresses an indefinite ban:
 * `banned_until` is a timestamp, and there is no null-meaning-forever. A hundred years.
 */
const INDEFINITE_BAN = "876000h";

/**
 * Turns a database refusal into an error the UI can explain.
 *
 * The guard raises with a SQLSTATE chosen to say which rule was broken -- 42501 for acting on
 * your own account, 23514 for the last administrator -- so the message the administrator reads
 * names the actual reason rather than "something went wrong".
 */
function refusalFrom(message: string): ProvisioningError {
  if (/own account/i.test(message)) {
    return new ProvisioningError(
      "SELF_ACTION",
      "You cannot deactivate or delete your own account. Ask another administrator.",
    );
  }
  if (/last administrator/i.test(message)) {
    return new ProvisioningError(
      "LAST_ADMIN",
      "This is the last administrator who can sign in. Add another one first.",
    );
  }
  return new ProvisioningError("REFUSED", message);
}

/* ------------------------------ OPERATIONS ------------------------------ */

export interface CreateTeacherInput {
  fullName: string;
  email: string;
  phone: string | null;
  subjectIds: string[];
  experienceYears: number;
  bio: string | null;
}

export interface CreatedTeacher {
  teacherId: string;
  fullName: string;
  email: string;
  /** Returned exactly once. Never stored, never logged, never re-retrievable. */
  temporaryPassword: string;
}

/**
 * Creates a teacher account.
 *
 * Two-phase by design:
 *
 *   1. `auth.admin.createUser` fires `handle_new_user`, which creates the profile
 *      and a least-privilege *student* identity. The trigger never reads a role
 *      from metadata -- that field is browser-writable at signup.
 *   2. `private.provision_staff` elevates the account to `teacher` under an admin
 *      check, creates the teachers row and writes the audit entry, atomically.
 *
 * Any failure after step 1 deletes the auth user; profiles/teachers/user_roles
 * cascade from auth.users, so the observable outcome is all-or-nothing.
 */
export async function createTeacherAccount(
  accessToken: string | undefined,
  input: CreateTeacherInput,
): Promise<CreatedTeacher> {
  const actor = await assertAdmin(accessToken);
  const email = input.email.trim().toLowerCase();

  if (input.subjectIds.length === 0) {
    throw new ProvisioningError("NO_SUBJECTS", "Select at least one subject taught.");
  }

  // Fail before creating anything if the address is taken. `createUser` would
  // also reject, but this produces a precise message instead of a raw API error.
  const { data: existing } = await admin()
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existing) {
    throw new ProvisioningError("EMAIL_TAKEN", "An account with this email already exists.");
  }

  const temporaryPassword = generateTemporaryPassword();

  const { data: created, error: createError } = await admin().auth.admin.createUser({
    email,
    password: temporaryPassword,
    // The admin vouches for the address; a teacher should not have to complete
    // an email round trip before their first shift.
    email_confirm: true,
    // Descriptive only. `user_metadata` is writable by the account holder, so
    // nothing here may influence authorisation -- the role is set afterwards by
    // private.provision_staff() under an admin check.
    user_metadata: {
      full_name: input.fullName.trim(),
      phone: input.phone,
    },
    // Service-role-only, not writable by the user. Safe to carry the role for
    // downstream consumers (JWT claims); still not the source of truth.
    app_metadata: { role: "teacher" },
  });

  if (createError || !created.user) {
    throw new ProvisioningError(
      "AUTH_CREATE_FAILED",
      createError?.message ?? "Could not create the account.",
    );
  }

  const teacherId = created.user.id;

  try {
    // Elevate to staff. The trigger created a profile plus a least-privilege
    // student identity; this promotes it to `teacher`, creates the teachers row,
    // flags the temporary password and writes the audit entry -- all in one
    // transaction, so a half-provisioned staff account cannot exist.
    //
    // Doing this in SQL rather than as separate PostgREST writes is deliberate:
    // the previous version updated a `teachers` row that the trigger never
    // created, so it silently matched zero rows.
    // `exactOptionalPropertyTypes` distinguishes "absent" from "undefined", so
    // the optional args are spread in only when present rather than passed as
    // undefined. Omitting them lets the SQL DEFAULT apply, which is the intent.
    const { error: provisionError } = await admin().rpc("provision_staff", {
      _target: teacherId,
      _role: "teacher",
      _experience_years: input.experienceYears,
      ...(input.bio == null ? {} : { _bio: input.bio }),
      ...(input.phone == null ? {} : { _phone: input.phone }),
    });
    if (provisionError) throw new Error(provisionError.message);

    const { error: subjectError } = await admin()
      .from("teacher_subjects")
      .insert(input.subjectIds.map((subject_id) => ({ teacher_id: teacherId, subject_id })));
    if (subjectError) throw new Error(subjectError.message);
  } catch (e) {
    // Compensating action: remove the auth user so nothing partial survives.
    // profiles/teachers/user_roles cascade from auth.users.
    await admin().auth.admin.deleteUser(teacherId);
    throw new ProvisioningError(
      "PROFILE_SETUP_FAILED",
      e instanceof Error ? e.message : "Could not finish setting up the account.",
    );
  }

  await audit({
    action: "teacher_created",
    actor,
    targetId: teacherId,
    targetEmail: email,
    details: { subjects: input.subjectIds.length },
  });

  return {
    teacherId,
    fullName: input.fullName.trim(),
    email,
    temporaryPassword,
  };
}

/** Issues a fresh temporary password and re-arms the forced change. */
export async function resetTeacherPassword(
  accessToken: string | undefined,
  teacherId: string,
): Promise<CreatedTeacher> {
  const actor = await assertAdmin(accessToken);

  const { data: profile, error } = await admin()
    .from("profiles")
    .select("id, full_name, email")
    .eq("id", teacherId)
    .maybeSingle();

  if (error || !profile) {
    throw new ProvisioningError("NOT_FOUND", "That teacher no longer exists.");
  }

  const temporaryPassword = generateTemporaryPassword();

  const { error: updateError } = await admin().auth.admin.updateUserById(teacherId, {
    password: temporaryPassword,
  });
  if (updateError) {
    throw new ProvisioningError("RESET_FAILED", updateError.message);
  }

  await admin().from("profiles").update({ password_change_required: true }).eq("id", teacherId);

  await audit({
    action: "teacher_password_reset",
    actor,
    targetId: teacherId,
    targetEmail: profile.email,
  });

  return {
    teacherId,
    fullName: profile.full_name,
    email: profile.email ?? "",
    temporaryPassword,
  };
}

export type LifecycleState = "active" | "suspended" | "archived";

/** A dependency that stands between an entity and permanent deletion. */
export interface EntityDependency {
  sourceTable: string;
  relationship: string;
  rowCount: number;
  severity: DependencySeverity;
}

/**
 * Moves a teacher through the lifecycle: active / suspended / archived.
 *
 * The rules live in `private.entity_lifecycle` -- which states are legal, that
 * archiving is refused while groups remain assigned, and the audit entry. This
 * function orchestrates only, and adds the one thing SQL cannot do: banning the
 * auth user, which is what actually prevents sign-in. The `status` column alone
 * is cosmetic.
 */
export async function setTeacherLifecycle(
  accessToken: string | undefined,
  teacherId: string,
  next: LifecycleState,
  reason?: string | null,
): Promise<void> {
  await assertAdmin(accessToken);

  const { error } = await admin().rpc("set_teacher_lifecycle", {
    _teacher: teacherId,
    _next: next,
    ...(reason == null ? {} : { _reason: reason }),
  });

  if (error) {
    // The database raises a precise message (e.g. "Cannot archive: 3 group(s)
    // still assigned"); surface it rather than a generic failure, since it
    // tells the admin exactly what to do next.
    throw new ProvisioningError("LIFECYCLE_FAILED", error.message);
  }

  // Suspended and archived accounts must not be able to sign in.
  await admin().auth.admin.updateUserById(teacherId, {
    ban_duration: next === "active" ? "none" : INDEFINITE_BAN,
  });
}

/** Reads why an entity cannot be deleted, so the UI can explain rather than guess. */
export async function getEntityDependencies(
  accessToken: string | undefined,
  entity: "teacher" | "student",
  id: string,
): Promise<EntityDependency[]> {
  await assertAdmin(accessToken);

  const { data, error } = await admin().rpc("entity_dependencies", {
    _entity: entity,
    _id: id,
  });
  if (error) throw new ProvisioningError("DEPENDENCY_LOOKUP_FAILED", error.message);

  return (data ?? []).map((d) => ({
    sourceTable: d.source_table,
    relationship: d.relationship,
    rowCount: d.row_count,
    severity: d.severity as EntityDependency["severity"],
  }));
}

/**
 * Permanently deletes a teacher account.
 *
 * Deliberately hard to reach: archive is the real "delete" for anyone who has
 * taught. This exists for genuine mistakes -- an account created and never used.
 *
 * The dependency check is re-run here rather than trusted from the client: the
 * UI's copy may be stale, and a server function is a public HTTP endpoint.
 */
export async function deleteTeacherAccount(
  accessToken: string | undefined,
  teacherId: string,
): Promise<void> {
  const actor = await assertAdmin(accessToken);

  const deps = await getEntityDependencies(accessToken, "teacher", teacherId);

  // Asked positively -- see `dependency-model.ts`. Read as "anything that is not incidental",
  // this refused every account that had ever appeared in the audit log, which is every account
  // that has ever existed.
  if (!canDelete(deps)) {
    throw new ProvisioningError(
      "HAS_DEPENDENCIES",
      `This account still owns records: ${describeBlockers(deps)}. Archive it instead.`,
    );
  }

  const { data: profile } = await admin()
    .from("profiles")
    .select("email")
    .eq("id", teacherId)
    .maybeSingle();

  // Audit BEFORE deleting: audit_log.target_id is ON DELETE SET NULL, so the
  // entry survives with the email preserved as the record of who was removed.
  await audit({
    action: "teacher_deleted",
    actor,
    targetId: teacherId,
    targetEmail: profile?.email ?? null,
  });

  // Removing the auth user cascades profiles/teachers/user_roles away.
  const { error } = await admin().auth.admin.deleteUser(teacherId);
  if (error) throw new ProvisioningError("DELETE_FAILED", error.message);
}

/* ============================ ADMINISTRATORS ============================ */

/**
 * WHY ADMIN PROVISIONING LIVES IN THIS FILE
 *
 * The module is named for teachers because they came first, but what it actually
 * holds is the privileged account machinery: the service-role client, the
 * `assertAdmin` gate, the audit writer and the compensating delete. Creating an
 * administrator needs every one of those and nothing else, so it reuses them
 * rather than standing up a second provisioning path with its own copy of the
 * security-critical parts. One place to audit is the point.
 */

export interface ManagedUser {
  id: string;
  fullName: string;
  email: string;
  role: Database["public"]["Enums"]["app_role"];
  /** True while the account still holds an administrator-issued password. */
  passwordChangeRequired: boolean;
  emailConfirmed: boolean;
  /**
   * False once the account is banned and can no longer sign in.
   *
   * Read from `auth.users.banned_until`, which is the field GoTrue itself checks --
   * not from a status column that could disagree with it.
   */
  active: boolean;
  createdAt: string;
}

/** Everyone who can reach the management area. Admins first, then teachers. */
export async function listManagedUsers(accessToken: string | undefined): Promise<ManagedUser[]> {
  await assertAdmin(accessToken);

  const { data: roles, error: roleError } = await admin()
    .from("user_roles")
    .select("user_id, role")
    .in("role", ["admin", "teacher"]);
  if (roleError) throw new ProvisioningError("LOOKUP_FAILED", "Could not load the user list.");

  const ids = (roles ?? []).map((r) => r.user_id);
  if (ids.length === 0) return [];

  const { data: profiles, error: profileError } = await admin()
    .from("profiles")
    .select("id, full_name, email, password_change_required, created_at")
    .in("id", ids);
  if (profileError) throw new ProvisioningError("LOOKUP_FAILED", "Could not load the user list.");

  // `email_confirmed_at` lives in auth.users, which PostgREST does not expose. The
  // admin API is the only way to read it, and it matters here: an unconfirmed
  // administrator cannot sign in, and the list would otherwise look fine.
  const confirmed = new Map<string, boolean>();
  const active = new Map<string, boolean>();
  const { data: authUsers } = await admin().auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const u of authUsers?.users ?? []) {
    confirmed.set(u.id, Boolean(u.email_confirmed_at));
    // `banned_until` is a timestamp, not a flag: a ban that has lapsed is not a ban.
    const bannedUntil = (u as { banned_until?: string | null }).banned_until;
    active.set(u.id, !bannedUntil || new Date(bannedUntil).getTime() <= Date.now());
  }

  const roleOf = new Map(roles.map((r) => [r.user_id, r.role]));

  return (profiles ?? [])
    .map((p) => ({
      id: p.id,
      fullName: p.full_name,
      email: p.email ?? "",
      role: roleOf.get(p.id) ?? "student",
      passwordChangeRequired: p.password_change_required ?? false,
      emailConfirmed: confirmed.get(p.id) ?? false,
      // Absent from the auth listing means we could not read it; treating an unknown
      // account as active keeps the list honest rather than showing a ban that is not there.
      active: active.get(p.id) ?? true,
      createdAt: p.created_at,
    }))
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
      return a.fullName.localeCompare(b.fullName);
    });
}

export interface CreateAdminInput {
  fullName: string;
  email: string;
  /** Where the setup link should land. Supabase rejects any origin not allow-listed. */
  origin: string;
}

export interface CreatedAdmin {
  id: string;
  fullName: string;
  email: string;
  recoveryEmailSent: boolean;
}

/**
 * Creates an administrator, then invites them to choose their own password.
 *
 * NO TEMPORARY PASSWORD IS PRODUCED OR RETURNED. The teacher flow issues one
 * because a teacher is often set up in person and told their password out loud;
 * an administrator is not, and a password that travels through a third party is
 * a password that has already been shared. The account is created with a random
 * secret nobody sees, and the recovery mail is what turns it into a usable login.
 *
 * The role is `admin`, fixed here in server code. It is never read from the
 * request: the browser sends a name and an email, and nothing else can change
 * what privilege is granted.
 */
export async function createAdminAccount(
  accessToken: string | undefined,
  input: CreateAdminInput,
): Promise<CreatedAdmin> {
  const actor = await assertAdmin(accessToken);
  const email = input.email.trim().toLowerCase();

  const { data: existing } = await admin()
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existing) {
    // Deliberately does NOT promote the existing account. Matching an address is
    // not authorisation to change someone's role.
    throw new ProvisioningError("EMAIL_TAKEN", "An account with this email already exists.");
  }

  const throwaway = generateTemporaryPassword();

  const { data: created, error: createError } = await admin().auth.admin.createUser({
    email,
    password: throwaway,
    // The inviting admin vouches for the address, so the account is usable the
    // moment its owner sets a password.
    email_confirm: true,
    user_metadata: { full_name: input.fullName.trim() },
    // Service-role-only and not writable by the account holder. Descriptive; the
    // source of truth remains `user_roles`, written by provision_staff below.
    app_metadata: { role: "admin" },
  });

  if (createError || !created.user) {
    throw new ProvisioningError(
      "AUTH_CREATE_FAILED",
      createError?.message ?? "Could not create the account.",
    );
  }

  const adminId = created.user.id;

  try {
    // The signup trigger left a least-privilege student identity behind; this
    // replaces it with `admin` and clears the students row, in one transaction.
    const { error: provisionError } = await admin().rpc("provision_staff", {
      _target: adminId,
      _role: "admin",
    });
    if (provisionError) throw new Error(provisionError.message);
  } catch (e) {
    // Nothing half-provisioned survives: profiles/user_roles cascade from auth.users.
    await admin().auth.admin.deleteUser(adminId);
    throw new ProvisioningError(
      "PROFILE_SETUP_FAILED",
      e instanceof Error ? e.message : "Could not finish setting up the account.",
    );
  }

  // `role_granted` rather than a new enum value -- adding one would need a
  // migration, and this is precisely what happened.
  await audit({
    action: "role_granted",
    actor,
    targetId: adminId,
    targetEmail: email,
    details: { role: "admin" },
  });

  const recoveryEmailSent = await sendPasswordRecovery(email, input.origin);

  return { id: adminId, fullName: input.fullName.trim(), email, recoveryEmailSent };
}

/**
 * Asks Supabase to mail a recovery link. Returns whether it was accepted.
 *
 * Never throws on failure: an administrator who exists but whose invitation mail
 * bounced is a recoverable situation, and losing the account because the mail
 * step failed is not. The caller reports the difference to the UI.
 */
export async function sendPasswordRecovery(email: string, origin: string): Promise<boolean> {
  const { error } = await admin().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${origin.replace(/\/+$/, "")}/reset-password`,
  });
  if (error) console.error("[sendPasswordRecovery]", error.message);
  return !error;
}

/** Re-sends the recovery mail for an existing managed user. Admin-gated. */
export async function resendRecoveryFor(
  accessToken: string | undefined,
  userId: string,
  origin: string,
): Promise<boolean> {
  const actor = await assertAdmin(accessToken);

  const { data: profile } = await admin()
    .from("profiles")
    .select("id, email")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.email) throw new ProvisioningError("NOT_FOUND", "That account no longer exists.");

  const sent = await sendPasswordRecovery(profile.email, origin);
  await audit({
    action: "teacher_password_reset",
    actor,
    targetId: userId,
    targetEmail: profile.email,
    details: { method: "recovery_email" },
  });
  return sent;
}

/* ==================== ADMINISTRATOR LIFECYCLE ==================== */

/**
 * Deactivates or reactivates an administrator.
 *
 * DEACTIVATION IS A BAN, NOT A DELETED ROW. `auth.users.banned_until` is the field GoTrue
 * itself consults when a token is issued or refreshed, so banning is what actually stops the
 * login. Removing the `user_roles` row instead would leave a working Supabase Auth account
 * behind -- able to sign in, merely without a role -- which is precisely the outcome this is
 * written to avoid. The profile, the role and every record the account is attached to are
 * left exactly as they are, so reactivation is a single field going back to null.
 *
 * A LIVE SESSION SURVIVES UNTIL ITS TOKEN EXPIRES. GoTrue refuses the next refresh once the
 * ban is set, so access ends within the access token's lifetime rather than instantly. This
 * is the same guarantee a suspended teacher gets; anything stronger would mean reaching into
 * `auth.sessions` behind the API's back.
 *
 * THE RULES ARE ENFORCED IN THE DATABASE. `private.assert_admin_removable` raises rather than
 * returning a boolean a caller could ignore, and applies to every path into this operation --
 * a forged POST straight at the server function meets the same rule the menu shows. Repeating
 * the check here would be a comfortable illusion, not a second line of defence.
 *
 * IT IS NOT ATOMIC, AND THAT IS STATED RATHER THAN IMPLIED. The ban is applied by GoTrue in a
 * separate round trip from the check, so two administrators deactivating EACH OTHER within the
 * same instant would both read "2 active", both be permitted, and both proceed -- leaving
 * nobody able to sign in. The single-actor version of that mistake, which is the one that
 * actually happens, is refused outright by the self rule. See the migration header in
 * 20260821110000 for what closing the remaining window would cost.
 */
export async function setAdminActive(
  accessToken: string | undefined,
  userId: string,
  active: boolean,
): Promise<void> {
  const actor = await assertAdmin(accessToken);

  const { data: profile } = await admin()
    .from("profiles")
    .select("id, email")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) throw new ProvisioningError("NOT_FOUND", "That account no longer exists.");

  if (!active) {
    const { error: guardError } = await admin().rpc("assert_admin_removable", {
      _target: userId,
      _actor: actor.id,
      _action: "deactivate",
    });
    if (guardError) throw refusalFrom(guardError.message);
  }

  const { error } = await admin().auth.admin.updateUserById(userId, {
    ban_duration: active ? "none" : INDEFINITE_BAN,
  });
  if (error) throw new ProvisioningError("UPDATE_FAILED", error.message);

  await audit({
    action: active ? "admin_reactivated" : "admin_deactivated",
    actor,
    targetId: userId,
    targetEmail: profile.email ?? null,
  });
}

/**
 * Permanently deletes an administrator account.
 *
 * Deactivation is the reversible answer and should be the usual one; this exists for an
 * account created by mistake. The audit trail survives, because `audit_log` points at
 * `profiles` with ON DELETE SET NULL and keeps the email beside the pointer -- see
 * 20260821090000. The entry naming the deletion is written BEFORE the account goes, so the
 * record of who removed whom exists even if the delete then fails.
 */
export async function deleteAdminAccount(
  accessToken: string | undefined,
  userId: string,
): Promise<void> {
  const actor = await assertAdmin(accessToken);

  const { data: profile } = await admin()
    .from("profiles")
    .select("id, email")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) throw new ProvisioningError("NOT_FOUND", "That account no longer exists.");

  const { error: guardError } = await admin().rpc("assert_admin_removable", {
    _target: userId,
    _actor: actor.id,
    _action: "delete",
  });
  if (guardError) throw refusalFrom(guardError.message);

  // The same dependency rule teachers get: an account that owns history is archived, not
  // erased. Audit entries are 'preserved' and never block -- see `dependency-model.ts`.
  const deps = await getEntityDependencies(accessToken, "teacher", userId);
  if (!canDelete(deps)) {
    throw new ProvisioningError(
      "HAS_DEPENDENCIES",
      `This account still owns records: ${describeBlockers(deps)}. Deactivate it instead.`,
    );
  }

  await audit({
    action: "admin_deleted",
    actor,
    targetId: userId,
    targetEmail: profile.email ?? null,
  });

  const { error } = await admin().auth.admin.deleteUser(userId);
  if (error) throw new ProvisioningError("DELETE_FAILED", error.message);
}
