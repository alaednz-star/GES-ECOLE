# Roadmap

> **SUPERSEDED (2026-10-01)** by [`MASTER_ROADMAP.md`](MASTER_ROADMAP.md). Kept as a pre-fork
> historical record; do not plan from it.

Engineering roadmap for turning Gestion École into a commercial SaaS.
Nothing here is a commitment to scope — it is the recommended order of work.

---

## Phase 0 — Restore the product (immediate, ~1 day)

The application is **published and publicly reachable**, and its admin console does not work.

- Repair `private.is_admin()` (TD-1)
- Add foreign-key indexes (TD-3)
- Revoke `TRUNCATE`/`REFERENCES`/`TRIGGER` from `anon` (TD-4)
- Add `.env` to `.gitignore`, add `.env.example` (TD-12)

**Exit criteria:** an admin can sign in, list students, and create a group. Verified by a manual
pass over each admin screen, not by inspection.

## Phase 1 — Make failure visible (~3 days)

Today a database failure renders as an empty table. That is how Phase 0's bug reached production.

- Query error states throughout the UI (TD-2)
- `staleTime` defaults (TD-13)
- Fix the teacher/Groups role mismatch (TD-9)
- CSV formula-injection escaping (TD-10)
- Friendly, translated error messages (TD-18)
- Drop the ignored `role` from `signUp()` (TD-20)

## Phase 2 — Hygiene (~2 days)

Land these as isolated commits so they never obscure a logic diff.

- `npm run format` across the repo (TD-14)
- Delete unused components and dependencies (TD-15)
- ~~Replace the boilerplate README with real setup docs (TD-21)~~ done
- Replace the hardcoded admin email with an env-driven bootstrap (TD-19)

## Phase 3 — Production hardening (1–2 weeks)

- CHECK constraints + shared Zod validation (TD-5)
- Route guards in `beforeLoad` (TD-6)
- Split `queries.ts` per domain (TD-8)
- **RLS test suite** (TD-22) — the highest-value tests in this codebase, because RLS is the only
  security boundary. Cover: student cannot self-promote; teacher sees only their approved students;
  anon sees nothing; admin sees everything.

## Phase 4 — Scale (1–2 weeks)

- Server-side pagination and SQL-side joins (TD-7)
- Lazy-load locale dictionaries (TD-16)
- Correct SSR `lang`/`dir` per user locale (TD-17)
- Cookie-based sessions via the existing `auth-middleware.ts` (TD-11)

## Phase 5 — Commercial features

Currently scaffolded in navigation as `comingSoon` with no implementation:
`/dashboard/payments`, `/dashboard/invoices`, `/dashboard/reports`, `/dashboard/users`,
`/dashboard/security`.

Before building these, two architectural decisions are needed:

### Multi-tenancy — decide before writing another feature
`center_settings` is a **single-row singleton**. The schema models exactly one tutoring centre. A
commercial SaaS selling to many centres needs either a `tenant_id` on every table with RLS scoping,
or database-per-tenant. Retrofitting this after payments and invoicing exist is dramatically more
expensive than doing it now. **This is the single most consequential open decision in the project.**

### Server-side data layer
`auth-middleware.ts` and `client.server.ts` are written and unused. Payments in particular must not
be a browser-direct write — money movement needs server functions, webhook verification, and an
audit trail.

## Ongoing

- Add CI: typecheck, lint, build, and the RLS suite on every push.
- Track bundle size as a build-time budget.
- Keep `docs/` current — it is now accurate; it will drift within weeks if not maintained.
