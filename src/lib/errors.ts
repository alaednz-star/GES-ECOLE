/**
 * Translates backend failures into messages a user can act on.
 *
 * Supabase surfaces PostgREST/Postgres errors with a `code` field (SQLSTATE for
 * database errors, a `PGRST*` string for PostgREST ones) and a `message` written
 * for developers -- e.g. `new row violates row-level security policy for table
 * "subjects"`. Showing those verbatim leaks schema details and tells the user
 * nothing useful, so every consumer should go through `toMessageKey` and render
 * the translated result.
 */

type Translate = (key: string, vars?: Record<string, string | number>) => string;

interface ErrorShape {
  code?: string | undefined;
  message?: string | undefined;
  name?: string | undefined;
  status?: number | undefined;
}

function readError(error: unknown): ErrorShape {
  if (typeof error !== "object" || error === null) {
    return { message: typeof error === "string" ? error : undefined };
  }
  const e = error as Record<string, unknown>;
  return {
    code: typeof e["code"] === "string" ? e["code"] : undefined,
    message: typeof e["message"] === "string" ? e["message"] : undefined,
    name: typeof e["name"] === "string" ? e["name"] : undefined,
    status: typeof e["status"] === "number" ? e["status"] : undefined,
  };
}

/** True when the failure is transient and retrying could plausibly succeed. */
export function isRetriableError(error: unknown): boolean {
  const { code, message, status } = readError(error);

  // Offline / DNS / connection reset surface as a TypeError from fetch.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (message && /network|fetch failed|failed to fetch|load failed/i.test(message)) return true;

  // PostgREST/Supabase pass the HTTP status through.
  if (status === 408 || status === 429) return true;
  if (status !== undefined && status >= 500) return true;

  // Postgres: serialization failure, deadlock, too many connections, cannot connect.
  if (code && ["40001", "40P01", "53300", "08006", "08001", "57014"].includes(code)) return true;

  return false;
}

/**
 * Maps an unknown failure to an i18n key. Falls back to a generic key rather
 * than echoing the raw backend text.
 */
export function toMessageKey(error: unknown): string {
  const { code, message, status } = readError(error);

  // Desktop app (ADR-010): an action that cannot be queued offline.
  if (code === "OFFLINE_REFUSED") return "error.offlineRefused";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "error.offline";
  if (message && /network|fetch failed|failed to fetch|load failed/i.test(message)) {
    return "error.network";
  }

  switch (code) {
    // --- Supabase Auth (GoTrue) error codes ---
    // These are checked before the SQLSTATE table because GoTrue returns a
    // string code, and a signup 422 has several distinct causes that must not
    // collapse into one generic message.
    case "weak_password":
      // GoTrue folds "too short" and "found in a breach corpus" into the same
      // code, so the prose is the only way to tell them apart.
      return message && /at least \d+ characters/i.test(message)
        ? "error.auth.weakPassword"
        : "error.auth.breachedPassword";
    case "user_already_exists":
    case "email_exists":
      return "error.auth.emailTaken";
    case "email_address_invalid":
    case "validation_failed":
      return "error.auth.invalidEmail";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "error.rateLimited";
    case "email_not_confirmed":
      return "error.auth.emailNotConfirmed";
    case "invalid_credentials":
      return "error.auth.invalidCredentials";
    case "signup_disabled":
      return "error.auth.signupDisabled";

    // --- PostgREST ---
    case "PGRST301": // JWT expired
      return "error.sessionExpired";
    case "PGRST116": // no rows returned where one was required
      return "error.notFound";

    // --- Postgres ---
    case "42501": // insufficient_privilege / RLS violation
      return "error.forbidden";
    case "23505": // unique_violation
      return "error.duplicate";
    case "23503": // foreign_key_violation
      return "error.inUse";
    // check_violation. Our triggers raise these with messages written FOR the
    // user ("The group does not meet on 2026-08-05"), so replacing them with a
    // generic string throws away the only sentence that says what to do. Handled
    // in `toMessage` below, which prefers the database's own wording.
    case "23514":
      return "error.invalidValue";
    case "23502": // not_null_violation
      return "error.missingField";
    case "22001": // string_data_right_truncation
      return "error.tooLong";
    case "40001": // serialization_failure
    case "40P01": // deadlock_detected
      return "error.conflictRetry";
    case "53300": // too_many_connections
      return "error.busy";
    case "42883": // undefined_function -- the Phase 0 is_admin() failure mode
      return "error.server";
    default:
      break;
  }

  if (status === 401) return "error.sessionExpired";
  if (status === 403) return "error.forbidden";
  if (status === 404) return "error.notFound";
  if (status === 409) return "error.duplicate";
  if (status === 429) return "error.rateLimited";
  if (status !== undefined && status >= 500) return "error.server";

  // --- Supabase Auth (GoTrue) returns prose, not codes ---
  if (message) {
    if (/invalid login credentials/i.test(message)) return "error.auth.invalidCredentials";
    if (/email not confirmed/i.test(message)) return "error.auth.emailNotConfirmed";
    if (/user already registered|already been registered/i.test(message)) {
      return "error.auth.emailTaken";
    }
    if (/password should be at least/i.test(message)) return "error.auth.weakPassword";
    // Older GoTrue builds return this prose without a machine code.
    if (/known to be weak|easy to guess|pwned|leaked/i.test(message)) {
      return "error.auth.breachedPassword";
    }
    if (/unable to validate email|invalid format/i.test(message)) {
      return "error.auth.invalidEmail";
    }
    if (/rate limit|too many requests/i.test(message)) return "error.rateLimited";
    if (/same password/i.test(message)) return "error.auth.samePassword";
  }

  return "error.generic";
}

/**
 * Maps an error straight to display text.
 *
 * One deliberate exception to "never show raw backend text": our own CHECK
 * triggers raise messages written for the reader -- "The group does not meet on
 * 2026-08-05" tells the teacher exactly what to change, where "Valeur invalide"
 * tells them nothing. Only `23514` qualifies, because only those messages are
 * ours; every other SQLSTATE still resolves to a translated key.
 */
export function toMessage(error: unknown, t: Translate): string {
  const key = toMessageKey(error);
  if (key === "error.invalidValue") {
    const raw = (error as { message?: string } | null)?.message;
    // Guard against Postgres internals leaking: our triggers write prose, so a
    // message with no spaces or full of identifiers is not meant for a user.
    if (raw && raw.length < 200 && raw.includes(" ") && !/^[A-Z_]+$/.test(raw)) {
      return raw;
    }
  }
  return t(key);
}
