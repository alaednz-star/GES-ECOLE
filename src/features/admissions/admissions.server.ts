/**
 * Pre-registrations (pré-inscriptions): public intake and administrative acceptance. SERVER ONLY.
 *
 * SECURITY CONTRACT -- the same as `teachers/provisioning.server.ts`:
 *   1. The `.server.ts` suffix keeps this file out of the client bundle; it is only reached
 *      through `admissions.functions.ts`, which imports it INSIDE each handler.
 *   2. This module holds the service-role client, which ignores RLS. So:
 *        - the PUBLIC functions (formation page, submission) expose a minimal projection and
 *          validate every field again, rate-limit, and only ever INSERT one application;
 *        - the ADMIN function (accept) calls `assertAdmin` first and runs the registration under
 *          the administrator's own session, so RLS and every registration trigger still apply.
 *   3. The submitter's network address is never stored: only a salted hash, for rate limiting.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  validateApplicationDraft,
  type ApplicationDraft,
  type ApplicationField,
} from "./application-model";

type Client = ReturnType<typeof createClient<Database>>;
let cached: Client | undefined;

function service(): Client {
  if (cached) return cached;
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    throw new AdmissionsError("SERVICE_KEY_MISSING", "The server is not configured.");
  }
  cached = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** A client acting as the calling user: RLS and auth.uid() are theirs. */
function asUser(accessToken: string): Client {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) {
    throw new AdmissionsError("SERVICE_KEY_MISSING", "The server is not configured.");
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export class AdmissionsError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly fields?: Partial<Record<ApplicationField, string>>,
  ) {
    super(message);
    this.name = "AdmissionsError";
  }
}

/* ------------------------------------------------------------------ public formation page */

export interface PublicGroup {
  id: string;
  name: string;
  startDate: string;
  endDate: string | null;
  placesLeft: number;
  schedules: { weekday: number; startTime: string; endTime: string }[];
}

export interface PublicFormation {
  open: true;
  id: string;
  name: string;
  type: { code: string; name: string; builtIn: boolean } | null;
  description: string | null;
  subject: { key: string | null; name: string } | null;
  levelName: string | null;
  levelSystem: { code: string; name: string } | null;
  startDate: string | null;
  endDate: string | null;
  durationHours: number | null;
  groups: PublicGroup[];
  guardianRequiredUnderAge: number;
  schoolLevels: { id: string; name: string }[];
}

export type PublicFormationResult = PublicFormation | { open: false; name: string | null } | null;

/** Accepting pre-registrations = active formation with registrations open. */
async function loadOpenFormation(programId: string) {
  const { data, error } = await service()
    .from("programs")
    .select(
      `id, name, category, status, registration_open, description, start_date, end_date, duration_hours,
       subject:subjects ( key, name ),
       level:levels ( name ),
       level_system:level_systems ( code, name ),
       type:formation_types ( code, name, built_in )`,
    )
    .eq("id", programId)
    .maybeSingle();
  if (error) throw new AdmissionsError("LOOKUP_FAILED", "Could not load the formation.");
  return data;
}

async function guardianAge(): Promise<number> {
  const { data } = await service()
    .from("center_settings")
    .select("guardian_required_under_age")
    .limit(1)
    .maybeSingle();
  return data?.guardian_required_under_age ?? 18;
}

/**
 * What a visitor may see of a formation: its offer, its active groups (schedule, places left),
 * and what the form needs. Nothing about teachers, students or prices.
 */
export async function getPublicFormation(programId: string): Promise<PublicFormationResult> {
  const p = await loadOpenFormation(programId);
  if (!p) return null;
  if (p.status !== "active" || !p.registration_open) return { open: false, name: p.name };

  const { data: groups } = await service()
    .from("groups")
    .select(
      "id, name, start_date, end_date, max_students, group_schedules ( weekday, start_time, end_time )",
    )
    .eq("program_id", programId)
    .eq("status", "active")
    .order("name");
  const ids = (groups ?? []).map((g) => g.id);
  const { data: counts } = ids.length
    ? await service()
        .from("group_enrollment_counts")
        .select("group_id, enrolled_count")
        .in("group_id", ids)
    : { data: [] };
  const enrolled = new Map(
    (counts ?? []).map((c) => [c.group_id as string, Number(c.enrolled_count ?? 0)]),
  );

  const { data: levels } = await service()
    .from("levels")
    .select("id, name, position, level_systems!inner ( code )")
    .eq("level_systems.code", "algerian_school")
    .eq("status", "active")
    .order("position");

  const type = p.type as unknown as { code: string; name: string; built_in: boolean } | null;
  return {
    open: true,
    id: p.id,
    name: p.name,
    type: type ? { code: type.code, name: type.name, builtIn: type.built_in } : null,
    description: p.description,
    subject: (p.subject as unknown as { key: string | null; name: string } | null) ?? null,
    levelName: (p.level as unknown as { name: string } | null)?.name ?? null,
    levelSystem: (p.level_system as unknown as { code: string; name: string } | null) ?? null,
    startDate: p.start_date,
    endDate: p.end_date,
    durationHours: p.duration_hours,
    groups: (groups ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      startDate: g.start_date,
      endDate: g.end_date,
      placesLeft: Math.max(0, g.max_students - (enrolled.get(g.id) ?? 0)),
      schedules: (g.group_schedules ?? [])
        .map((s) => ({ weekday: s.weekday, startTime: s.start_time, endTime: s.end_time }))
        .sort((a, b) => a.weekday - b.weekday),
    })),
    guardianRequiredUnderAge: await guardianAge(),
    schoolLevels: (levels ?? []).map((l) => ({ id: l.id, name: l.name })),
  };
}

/* ------------------------------------------------------------------ public submission */

export interface SubmissionInput {
  programId: string;
  draft: ApplicationDraft;
  locale: "fr" | "ar" | "en";
  /** Honeypot: a field humans never see. Filled = a bot. */
  website: string;
  /** Milliseconds between the form appearing and being sent. Too fast = a bot. */
  elapsedMs: number;
}

const RATE_WINDOW_MINUTES = 15;
const RATE_PER_SOURCE = 5;
const RATE_PER_PHONE_PER_DAY = 3;
const MIN_FILL_MS = 3000;

async function hashSource(source: string): Promise<string> {
  const salt = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
  const bytes = new TextEncoder().encode(`${salt}:${source}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Receives a pre-registration from the public form. Returns normally for a bot (honeypot or too
 * fast) without storing anything, so a script learns nothing. Never reveals whether the person
 * is already known.
 */
export async function submitApplication(input: SubmissionInput, source: string): Promise<void> {
  if (input.website.trim() !== "" || input.elapsedMs < MIN_FILL_MS) return;

  const p = await loadOpenFormation(input.programId);
  if (!p || p.status !== "active" || !p.registration_open) {
    throw new AdmissionsError("CLOSED", "Pre-registration is closed for this formation.");
  }

  const threshold = await guardianAge();
  const result = validateApplicationDraft(input.draft, {
    today: todayIsoUtc(),
    guardianRequiredUnderAge: threshold,
  });
  if (!result.ok) throw new AdmissionsError("INVALID", "Some fields are invalid.", result.errors);
  const v = result.values;

  // A preferred group must be an active group of THIS formation; anything else is dropped.
  let preferredGroupId: string | null = null;
  if (v.preferredGroupId) {
    const { data: g } = await service()
      .from("groups")
      .select("id")
      .eq("id", v.preferredGroupId)
      .eq("program_id", input.programId)
      .eq("status", "active")
      .maybeSingle();
    preferredGroupId = g?.id ?? null;
  }
  // The current school level must be a school level; anything else is dropped.
  let schoolLevelId: string | null = null;
  if (v.schoolLevelId) {
    const { data: l } = await service()
      .from("levels")
      .select("id, level_systems!inner ( code )")
      .eq("id", v.schoolLevelId)
      .eq("level_systems.code", "algerian_school")
      .maybeSingle();
    schoolLevelId = l?.id ?? null;
  }

  // Rate limits: per network origin, and per contact phone for this formation.
  const sourceHash = await hashSource(source);
  const since = new Date(Date.now() - RATE_WINDOW_MINUTES * 60_000).toISOString();
  const { count: bySource } = await service()
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("source_hash", sourceHash)
    .gte("created_at", since);
  if ((bySource ?? 0) >= RATE_PER_SOURCE) {
    throw new AdmissionsError("RATE_LIMITED", "Too many requests. Please try again later.");
  }
  const contact = v.guardianPhone ?? v.phone;
  if (contact) {
    const day = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const { count: byPhone } = await service()
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("program_id", input.programId)
      .or(`phone.eq.${contact},guardian_phone.eq.${contact}`)
      .gte("created_at", day);
    if ((byPhone ?? 0) >= RATE_PER_PHONE_PER_DAY) {
      throw new AdmissionsError("RATE_LIMITED", "Too many requests. Please try again later.");
    }
  }

  const { error } = await service().from("applications").insert({
    program_id: p.id,
    program_name: p.name,
    preferred_group_id: preferredGroupId,
    first_name: v.firstName,
    last_name: v.lastName,
    date_of_birth: v.dateOfBirth,
    phone: v.phone,
    email: v.email,
    school_level_id: schoolLevelId,
    school_name: v.schoolName,
    guardian_name: v.guardianName,
    guardian_phone: v.guardianPhone,
    guardian_relation: v.guardianRelation,
    preferred_schedule: v.preferredSchedule,
    message: v.message,
    locale: input.locale,
    consent_at: new Date().toISOString(),
    source_hash: sourceHash,
  });
  if (error) {
    console.error("[submitApplication]", error.code, error.message);
    throw new AdmissionsError("SAVE_FAILED", "The request could not be saved.");
  }
}

/* ------------------------------------------------------------------ acceptance (admin) */

export interface AcceptInput {
  accessToken: string;
  applicationId: string;
  /** An existing student to place, or null to create the student from the application. */
  studentId: string | null;
  groupId: string;
}

/**
 * Accepts an application: creates the student from it (or uses an existing one), then places
 * them in the chosen group of the requested formation with an APPROVED registration, closing the
 * application -- the last two in one transaction (`accept_application`), under the
 * administrator's own session. A student created here gets no portal access (login disabled);
 * the administration can open it later. If the placement fails, a student created by this call is
 * removed again, so nothing is left half-done.
 */
export async function acceptApplication(
  input: AcceptInput,
): Promise<{ studentId: string; registrationId: string }> {
  const { assertAdmin } = await import("../teachers/provisioning.server");
  await assertAdmin(input.accessToken);

  const { data: app, error } = await service()
    .from("applications")
    .select("*")
    .eq("id", input.applicationId)
    .maybeSingle();
  if (error || !app) throw new AdmissionsError("NOT_FOUND", "Application not found.");
  if (app.status !== "new" && app.status !== "reviewing") {
    throw new AdmissionsError("ALREADY_DECIDED", "This application has already been decided.");
  }

  let studentId = input.studentId;
  let created = false;
  if (!studentId) {
    const { generateTemporaryPassword } = await import("../teachers/provisioning.server");
    const fullName = `${app.first_name} ${app.last_name}`.trim();
    const { data: user, error: createError } = await service().auth.admin.createUser({
      // An internal address: the learner signs in only once the administration opens portal
      // access (ADR-004 section 5). The real e-mail, if any, is kept on the profile.
      email: `student-${crypto.randomUUID()}@no-login.madrasti.local`,
      password: generateTemporaryPassword(),
      email_confirm: true,
      ban_duration: "876000h",
      user_metadata: { full_name: fullName, phone: app.phone },
    });
    if (createError || !user.user) {
      console.error("[acceptApplication] createUser", createError?.message);
      throw new AdmissionsError("STUDENT_CREATE_FAILED", "The student could not be created.");
    }
    studentId = user.user.id;
    created = true;
    const profile = await service()
      .from("profiles")
      .update({ full_name: fullName, phone: app.phone, email: app.email })
      .eq("id", studentId);
    const student = await service()
      .from("students")
      .update({
        date_of_birth: app.date_of_birth,
        guardian_name: app.guardian_name,
        guardian_phone: app.guardian_phone,
        level_id: app.school_level_id,
      })
      .eq("id", studentId);
    if (profile.error || student.error) {
      await service().auth.admin.deleteUser(studentId);
      console.error("[acceptApplication] profile", profile.error?.message, student.error?.message);
      throw new AdmissionsError("STUDENT_CREATE_FAILED", "The student could not be created.");
    }
  }

  const { data: registrationId, error: rpcError } = await asUser(input.accessToken).rpc(
    "accept_application",
    { p_application: input.applicationId, p_student: studentId, p_group: input.groupId },
  );
  if (rpcError || !registrationId) {
    if (created) await service().auth.admin.deleteUser(studentId);
    const code =
      rpcError?.code === "23505"
        ? "ALREADY_ENROLLED"
        : rpcError?.code === "23514"
          ? "PLACEMENT_REFUSED"
          : "ACCEPT_FAILED";
    throw new AdmissionsError(code, rpcError?.message ?? "The application could not be accepted.");
  }
  return { studentId, registrationId: registrationId as string };
}
