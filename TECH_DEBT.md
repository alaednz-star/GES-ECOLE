# Technical Debt Register

Audited 2026-08-02. Difficulty: **S** ≈ under an hour · **M** ≈ half a day · **L** ≈ multiple days.

---

## CRITICAL

### ~~TD-1 — `private.is_admin()` is broken; admin console is down~~ ✅ FIXED in Phase 0
`is_admin()` called `public.has_role(...)` after migration 4 moved it to `private`, with `search_path`
pinned to `public`, so every admin read and write raised `ERROR 42883`. Fixed by
`20260802210000_fix_is_admin_schema_resolution.sql`. See `PHASE_0_REPORT.md`.

---

## HIGH

### ~~TD-2 — Query errors are never surfaced~~ ✅ FIXED in Phase 1
**Correction to the original finding.** The claim "`isError` appears zero times" came from grepping
for that literal string and was **wrong** — five pages already destructured `error` and passed it to
`DataTable`, which already had an error branch. The genuine defects were: raw Postgres/GoTrue text
shown to users (including SQL hints), no retry affordance, pages swallowing errors via
`data: x = []` defaults, and no retry policy at all.

**Fixed** by `lib/errors.ts` (classification + friendly messages), `ErrorState` (surface + retry),
`use-action-feedback` (consistent toasts), and per-page wiring. See `PHASE_1_REPORT.md`.

### ~~TD-3 — No indexes on any foreign key~~ ✅ FIXED in Phase 0
11 indexes added by `20260802210100_add_foreign_key_indexes.sql`, covering the authorization hot path
and every filtering foreign key.

### ~~TD-4 — `anon` holds `TRUNCATE`/`REFERENCES`/`TRIGGER` on all tables~~ ✅ FIXED in Phase 0
Revoked by `20260802210200_revoke_unnecessary_grants.sql`. `anon` now holds no table privileges;
anonymous reads return HTTP 401 at the privilege layer.

### TD-5 — No server-side validation of domain invariants
**Description** Only login/registration have Zod schemas. Capacity, price, schedule times, and
settings accept anything RLS permits.
**Why it matters** Negative prices, inverted time ranges, and oversized strings can be written
directly from a browser console.
**Solution** CHECK constraints for the invariants (cannot be bypassed), plus shared Zod schemas.
**Difficulty** M

### TD-6 — Authorization enforced only at browser render time
**Description** `RequireAuth` gates during render, not in `beforeLoad`.
**Why it matters** Protected route code is downloaded before the check. Data stays safe via RLS, but
forged client state yields a broken admin UI rather than a clean refusal.
**Solution** Move guards to `beforeLoad` with a redirect; keep `RequireAuth` for rendering only.
**Difficulty** M

---

## MEDIUM

### TD-7 — Unbounded queries and client-side joins
**Description** `useGroups` reads all profiles and all registrations per load; `useTeachers` and
`useStudents` fetch whole tables to compute counts. No pagination anywhere.
**Solution** Embedded selects for names; a view or RPC for aggregates; `.range()` pagination wired to
the table.
**Difficulty** L

### TD-8 — `queries.ts` holds six domains in 639 lines
**Solution** Split into `queries/{levels,subjects,teachers,students,groups,registrations,attendance,settings}.ts`
sharing the `schoolKeys` registry.
**Difficulty** M — mechanical, but touches every dashboard import.

### ~~TD-9 — Teachers routed into admin-only Groups CRUD~~ ✅ FIXED in Phase 1
Gated on `hasRole("admin")` — actions column, header button, and empty-state button. Teachers now
get a read-only view instead of controls whose writes RLS always rejected.

### ~~TD-10 — CSV formula injection~~ ✅ FIXED in Phase 2
Values beginning `=`, `+`, `-`, `@`, tab or CR are prefixed with a quote before escaping; headers
are now escaped too. `src/lib/export-csv.ts`.

### TD-11 — Session tokens in `localStorage`
**Description** Any XSS yields persistent account takeover. No XSS vector exists today.
**Solution** Cookie-based sessions using the already-written `auth-middleware.ts`.
**Difficulty** L — do this with the server-side data layer, not standalone.

### ~~TD-12 — `.env` committed and not ignored~~ ✅ ADDRESSED in Phase 0
`.env` holds only publishable values and is kept intentionally (it is part of the project configuration). `.gitignore` now
blocks `.env.local`, `.env.production`, `*.key`, `*.pem`; `.env.example` documents the rule.

### ~~TD-13 — No `staleTime`; everything refetches constantly~~ ✅ FIXED in Phase 1
`staleTime: 60s`, `gcTime: 5min`, `refetchOnWindowFocus: false`, plus retry with exponential
backoff gated on retriable errors only.

---

## LOW

### TD-14 — 678 Prettier violations
**Solution** `npm run format` as one isolated commit, so it never mixes with logic diffs.
**Difficulty** S

### TD-15 — ~23 unused components and 7 unused dependencies
**Description** Includes `recharts` (largest), and `date-fns` with zero imports. Keep `tooltip` and
`separator` (used by `sidebar.tsx`) and `cmdk` (used by global search).
**Difficulty** S

### TD-16 — All three locales eagerly bundled (~80 KB wasted)
**Solution** Dynamic-import non-default dictionaries.
**Difficulty** M

### TD-17 — `<html lang="fr" dir="ltr">` hardcoded in SSR shell
**Description** Arabic users get a flash of LTR; server HTML is mislabelled for crawlers and screen
readers.
**Solution** Resolve locale server-side (cookie or `Accept-Language`) and emit correct attributes.
**Difficulty** M

### ~~TD-18 — Raw Postgres errors shown in toasts~~ ✅ FIXED in Phase 1
`lib/errors.ts` maps SQLSTATEs, PostgREST codes, HTTP statuses and GoTrue prose to translated
messages. Verified against a live production error: SQL hint and table name both suppressed.

### TD-19 — Hardcoded personal email in migration 5
**Solution** Environment-driven bootstrap or seed script.
**Difficulty** S

### TD-20 — `signUp()` sends an ignored `role` field
**Solution** Delete the field from the payload.
**Difficulty** S

### ~~TD-21 — README is boilerplate~~ FIXED
Replaced with real documentation: stack, scripts, environment rules, database and doc index.

### TD-22 — No test suite at all
**Description** No test runner, no tests. TypeScript strict mode is the only automated safety net —
and it cannot catch TD-1, which lives in SQL.
**Solution** Vitest for `schedule.ts`/`export-csv.ts`/i18n; pgTAP or a seeded integration suite for
RLS policies — the highest-value tests here, since RLS is the only security boundary.
**Difficulty** L

---

## Status

**Phase 0 (done)** — TD-1, TD-3, TD-4, TD-12. Product restored; database gaps closed.
**Phase 1 (done)** — TD-2, TD-9, TD-13, TD-18. Failures are now visible and actionable.
**Phase 2 (done)** — TD-10. Feature completion: profiles, group/attendance detail, notifications.

## Remaining sequencing

**Next — hygiene (a few days)**
TD-20 (ignored role field), TD-14 (formatting), TD-15 (dead code), TD-21 (README),
TD-19 (hardcoded email). Small, isolated, low-risk.

**Also newly outstanding after Phase 2**
Schema completion deferred from Phase 2: `guardian_phone` on `students`; `center_settings` columns
for time zone, working days and default attendance rules; Supabase Storage for logo/avatar upload
(currently URL-only). One migration covers all three.

**Then — hardening (one to two weeks)**
TD-5 (server-side validation), TD-6 (`beforeLoad` guards), TD-8 (split `queries.ts`),
TD-22 (RLS test suite — highest value, since RLS is the only security boundary).

**Then — scale (one to two weeks)**
TD-7 (pagination, SQL-side joins), TD-16 (lazy locales), TD-17 (SSR locale), TD-11 (cookie sessions).

**Before any Phase 5 feature — decide multi-tenancy.** `center_settings` is a single-row singleton;
the schema models exactly one centre. Retrofitting `tenant_id` after payments and invoicing exist is
dramatically more expensive. See `docs/ROADMAP.md`.
