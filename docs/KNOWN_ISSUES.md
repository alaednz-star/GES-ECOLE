# Known Issues

Verified 2026-08-02. Each entry states how it was confirmed.
**Phase 0 was completed on 2026-08-02** — see `PHASE_0_REPORT.md`. Items K1, K3, K4 and K9 are
resolved and retained below for history.

---

## Resolved in Phase 0

### ~~K1 — Admin console is entirely non-functional in production~~ ✅ FIXED
`private.is_admin()` called `public.has_role(...)`, which no longer existed after migration 4 moved
it to the `private` schema. Every policy branch evaluating `is_admin()` raised `ERROR 42883`.

*Why it went unnoticed:* Postgres short-circuits `OR`. Self-filtered queries
(`WHERE id = auth.uid()`) satisfy the first branch and never evaluate `is_admin()`, so login and the
student dashboard looked healthy while the admin console was dead.

**Fixed** by migration `20260802210000_fix_is_admin_schema_resolution.sql`. Verified: `is_admin()`
returns `true` for the production admin, and all 10 admin page reads plus 13 write operations pass
over real HTTP.

### ~~K3 — `anon` holds `TRUNCATE` on all 12 tables~~ ✅ FIXED
**Fixed** by `20260802210200_revoke_unnecessary_grants.sql`. `anon` now holds **zero** privileges on
public tables; `authenticated` holds exactly SELECT/INSERT/UPDATE/DELETE. Verified over HTTP:
anonymous reads now return `401` at the privilege layer rather than relying on RLS alone.

### ~~K4 — No indexes anywhere~~ ✅ FIXED
**Fixed** by `20260802210100_add_foreign_key_indexes.sql` — 11 indexes covering the authorization
hot path (`user_roles.user_id`), every filtering foreign key, and a partial index for approved
registrations.

### ~~K9 — `.env` committed, not in `.gitignore`~~ ✅ ADDRESSED
`.env` holds only publishable values and is intentionally kept (it is part of the project configuration). `.gitignore` now
blocks `.env.local`, `.env.production`, `*.key`, `*.pem`, and service-account files, and
`.env.example` documents that the service role key must never be committed.

---

## High (open)

### K2 — Query failures are invisible to the user
`isError` appears **zero times** across all routes and feature components. Mutations surface errors
via `toast.error`, but a failed *query* renders as an empty table or a blank card with no message.

*Confirmed:* `grep -rn "isError" src/` returns nothing.

This is why K1 presents as "the admin dashboard is mysteriously empty" instead of an error. Fixing
K2 is what makes K1-class bugs self-reporting in future.

*(K3 and K4 were resolved in Phase 0 — see the Resolved section above.)*

---

## Medium

### K5 — Teachers land in the admin Groups CRUD UI
`dashboard.groups.tsx` guards `["admin", "teacher"]` with no in-component gating, while RLS allows
admin writes only. Teachers see create/edit/delete controls that always fail.

### K6 — Unbounded queries with client-side joins
`useGroups` reads the whole `profiles` and `registrations` tables per load; `useTeachers` and
`useStudents` do the same to compute counts. No pagination on any list. See `PERFORMANCE.md` P4/P5.

### K7 — CSV formula injection
`export-csv.ts` escapes for CSV but not for spreadsheet formula evaluation. A field starting with
`=`, `+`, `-`, or `@` executes in Excel/Sheets.

### K8 — No server-side validation beyond auth forms
Group capacity, price, schedule times, and settings accept any value the client sends. No CHECK
constraints beyond `weekday BETWEEN 0 AND 6`.

*(K9 was addressed in Phase 0 — see the Resolved section above.)*

---

## Low

### K10 — 678 Prettier violations
`npm run lint` reports 686 problems: 678 formatting, 8 benign `react-refresh` warnings, **zero logic
errors**. Fully auto-fixable with `npm run lint -- --fix` (or `npm run format`), but that produces a
large diff — land it as an isolated commit.

### K11 — Dead code and dependencies
~23 unused shadcn components; `date-fns` has zero imports; `recharts`, `embla-carousel-react`,
`input-otp`, `vaul`, `react-resizable-panels`, `react-day-picker` are reachable only through unused
wrappers. See `COMPONENTS.md`.

### K12 — `queries.ts` mixes six domains in 639 lines
Mechanical split into per-domain modules.

### K13 — All three locales eagerly bundled
120 KB chunk; roughly 80 KB is dead weight per user.

### K14 — Hardcoded personal email in migration 5 — RESOLVED
Migration `20260802192800` granted the admin role to one person's e-mail address. In Gestion
École it is a documented no-op (it never had an effect on a new database); the first
administrator comes from `handle_new_user()`'s first-admin rule.

### K15 — `signUp()` sends an ignored `role`
The database hard-codes `student`. Harmless but misleading; remove the field.

### K16 — Raw Postgres errors shown to users
`toast.error(e.message)` would currently render
`function public.has_role(uuid, unknown) does not exist` to an end user.

### K17 — `<html lang="fr" dir="ltr">` hardcoded in the SSR shell
`__root.tsx` emits French/LTR; the client corrects it after hydration. Arabic users get a flash of
LTR layout, and the server-rendered HTML is mislabelled for crawlers and screen readers.

### ~~K18 — README is boilerplate~~ FIXED
Replaced with real project documentation: stack, scripts, environment rules and a doc index.
No mention of Supabase setup or required environment variables.

---

## Explicitly not issues

- **No secret leaks to the client.** Verified byte-level; the `sb_secret_` hit is a prefix
  comparison inside `isNewSupabaseApiKey()`.
- **RLS is enabled on all 12 tables**, all policies scoped `TO authenticated`.
- **CSRF middleware is correctly re-registered** in `start.ts`.
- **TypeScript passes strict-mode `tsc --noEmit` with zero errors.**
- **Production build succeeds.**
- **`dangerouslySetInnerHTML` in `ui/chart.tsx` is not an XSS vector** (developer-authored CSS
  variables; component unused).
- **Privilege escalation through signup is closed.**
