# Master Roadmap — Administrative Core First

> Status: **proposed, awaiting approval** (2026-10-01). **Update 2026-10-03:** SEC-01 and SEC-02 are done (`20261003100000`, `20261003100100`, local only), the backlog is committed on branch `formation-foundation`, and the Formation phase order now lives in `docs/ADR-004-formation-architecture.md`, which supersedes the A-/F-series ordering below where they differ. Nothing in this file is implemented by
> writing it. Supersedes `docs/ROADMAP.md` (pre-fork, 2026-08-02).
> Evidence base: local schema (49/49 migrations, latest `20261001110100`), `src/`, `scripts/e2e/`,
> `docs/PROJECT_KNOWLEDGE_BASE.md`. Labels: **CONFIRMED** = verified in code/DB or by running it.

Workflow for every task below: audit → one task → implement → test → security review → build →
report → review → next task. One business capability per task; one migration per task at most
(plus a separate enum-only migration when Postgres requires it).

---

## A. Current-state summary

- **Platform:** TanStack Start + React 19 + Supabase. RLS is the security boundary; privileged
  actions go through server functions (`*.functions.ts` → `*.server.ts`, `assertAdmin`, service
  role). Roles: `admin`, `teacher`, `student` only.
- **Tenancy:** one Supabase project = one institution. `center_settings` is a singleton. There is no
  `tenant_id`. "SaaS" therefore means **one deployment per institution** unless this decision is
  formally reopened (README, prior instruction "do not introduce multi-tenancy").
- **Schema (CONFIRMED, local):** 27 tables, all RLS-enabled; 5 views, all `security_invoker`;
  4 buckets (`avatars`, `branding` public; `course-resources`, `hr-documents` private).
- **Quality:** `tsc` 0 errors; 324/324 unit tests; ~45 e2e suites (local only, not wired to CI);
  **no CI**.
- **Repository state:** `main` = `4a8c5a9`. The working tree holds **six completed but uncommitted
  tasks**: Payment Management, the pending-only withdraw policy, Programmes, HR foundation, the
  detail-route fixes, and the sidebar roadmap. That is 6 migrations plus about 60 files. They have
  been applied to the **local** database only.
- **Production:** whether the three August migrations reached production is UNKNOWN. None of the
  six new migrations has been applied there. The Supabase CLI in this folder is **linked to
  production**.

### Findings from this audit (new or re-confirmed)

| # | Finding | Severity | Evidence |
|---|---|---|---|
| F1 | **A student can insert their own registration already `approved`** (also `decided_at` and `note`). This bypasses admin approval and the decision notification. Capacity is still enforced. | **High** (security) | CONFIRMED by a local HTTP probe: `POST /registrations {status:"approved"}` with a student JWT → 201, stored `approved`. The insert policy's WITH CHECK ignores `status`; `authenticated` has INSERT on `status`, `decided_at` and `note`; no trigger forces `pending`. `verify-enrollment-security` only tests an insert without `status`. |
| F2 | `students.status` (active/inactive/…) gates nothing. An "inactive" student can still sign in, request places and read material. | Medium | CONFIRMED: no policy or function except `entity_lifecycle` reads it. |
| F3 | Admins cannot create a student or enrol a student into a group. Students come in only through public signup and self-request. | Medium (admin-first gap) | CONFIRMED: students page offers "copy invite link" only; the only registration insert is the student hook `useCreateRegistration`. |
| F4 | Rooms are free text (`group_schedules.room`). No teacher or room double-booking check exists anywhere. | Medium | CONFIRMED (schema, grep). |
| F5 | `level_stage` enum = primary/middle/high (Algerian school stages). `can_join_group` requires `groups.level_id`. Language, professional and workshop programmes have no fitting level and cannot be self-joined. | Medium (product scope) | CONFIRMED. |
| F6 | `UNIQUE(group_id, weekday)`: at most one session per group per day. Intensive formations and workshops often need two. | Medium (product scope) | CONFIRMED (ADR-003 foundation). |
| F7 | ADR-003 forbids exams, grades and evaluations "including roadmap entries". The product owner now requires them. | Governance | ADR-003 header; `navigation.ts` comment. |
| F8 | Carried over: storage objects orphaned after cascade; `setTeacherLifecycle` ignores the ban result; first-admin bootstrap undocumented; unbounded list queries; SSR `lang`/`dir` hardcoded. | Low–Medium | Knowledge base §15. |

---

## B. Administrative capability matrix

States: COMPLETE · PARTIAL · FOUNDATION · NONE · LEGACY (needs rework) · BLOCKED.

| Domain | State | Existing | Missing | Dependencies | Priority |
|---|---|---|---|---|---|
| Institution configuration | PARTIAL | `center_settings`: name, branding, logo, colours, phone, address, `academic_year` (free text), public site | institution type; holidays; working days and hours; receipt/legal identifiers (Phase 6) | — | P1 |
| Academic years / periods | FOUNDATION | free-text `academic_year`; per-group `start_date`/`end_date` | `academic_years` + periods (term/semester) entity; "current year" | ADR-004 | P1 |
| Levels | COMPLETE (school scope) | `levels` + `stage`, statistics | non-school levels (language A1–C2, professional) | F5, ADR-004 | P2 |
| Streams | COMPLETE | `streams`, consistency triggers | — | — | — |
| Subjects | COMPLETE | `subjects` (locale keys), qualifications | coefficients (Phase 3) | — | — |
| Programmes / formations | PARTIAL | `programs`, lifecycle, `groups.program_id`, derived capacity and teachers, admin UI | student catalogue for level-less programme groups; fees (Phase 2) | F5, T00 | P1 |
| Groups | COMPLETE | capacity, weekly slots, term window, qualification, programme link, detail page, roster exports | room entity link; more than one slot per day (F6) | A05 | — |
| Rooms | FOUNDATION | free-text `group_schedules.room`, shown in schedules | room entity, capacity, active flag, CRUD | — | P1 |
| Course resources | COMPLETE | chapters, resources, publication, engagement, quota, signed URLs | orphaned-object cleanup (F8) | — | — |
| Physical resources / equipment | NONE | — | inventory, booking | A05 | P4 |
| Students | PARTIAL | self-signup, onboarding, admin edit (level, stream, status), notes, detail, CSV and roster exports | admin creation (F3); effective status (F2); archive/delete (`entity_dependencies('student')` exists, no UI); dossier documents | T00 | **P1** |
| Teachers / trainers | COMPLETE | provisioning, qualifications, lifecycle and ban, deletion with dependencies, roster export | — | — | — |
| Administrators | COMPLETE | create, deactivate, delete, last-admin guard | two-admin race (documented) | — | — |
| Employees (HR) | PARTIAL | files, contracts, availability, staff attendance, leave, documents, audit, admin-only RLS | workload and service hours, staff reports, payroll prep (Phase 4) | A08 | P4 |
| Pre-registration | NONE | public signup creates an account immediately | prospect/inquiry pipeline without an account; conversion to student | A02 | P1 |
| Registration / dossier processing | PARTIAL | request → approve/reject (+bulk, note, notification), one per subject+level, pending-only withdraw | **F1 fix**; admin-initiated enrolment; transfer; withdrawal history (withdraw = DELETE); dossier documents | T00 | **P0/P1** |
| Waiting lists | NONE | capacity refuses an approve when full; pending acts as an unordered queue | ordered waitlist, promotion | T00, A03 | P1 |
| Capacity | COMPLETE | `enforce_group_capacity` trigger, `group_enrollment_counts` | room-capacity cross-check | A05 | — |
| Timetable | FOUNDATION | weekly `group_schedules`; student schedule; session calendar | institution-wide grid by room, teacher, level and group; print | A05, A06 | P1 |
| Sessions | PARTIAL | derived `(group_id, session_date)` (ADR-003), status, calendar | cancellations, holidays, make-ups (`session_exceptions`, ADR-003 §8.2); more than one per day (F6) | A04 | P1 |
| Availability | PARTIAL | HR `employee_availability`; `slotsOutsideAvailability` (informational) | used as a scheduling constraint | A06 | P1 |
| Conflict detection | NONE | HR overlap triggers (availability, leave) only | teacher, room and student double-booking | A05 | P1 |
| Student attendance | COMPLETE | drawer, keyboard, deep links, report, student view | absence notifications (enum exists, not emitted) | C03 | — |
| Admin dashboard | PARTIAL | counts, setup checklist, today's attendance | operational queues: pending decisions, waitlist, unmarked sessions, occupancy | A03, A10 | P1 |
| Operational statistics | FOUNDATION | level stats, attendance report, HR cards, payment totals | consolidated statistics page and exports | A13 | P1 |
| Audit | PARTIAL | `audit_log` for staff, payments and HR (activity tabs) | registrations, groups and students audit; admin audit viewer ("Sécurité") | — | P2 |
| Payments core | COMPLETE | ledger, create/edit/delete, RESTRICT, column grants, audit, totals | — (rest is Phase 2) | — | — |
| Fees / schedules / balances / discounts / receipts / invoices / refunds / reports | NONE | `groups.price_dzd` (no period, LEGACY for billing) | everything | A04, F-series | P2 |
| Evaluations / grades / report cards / progression | COMPLETE (2026-10-08, ADR-008) | assessments, scores, periods, derived averages and ranks, remarks, printable report card, progression | promotion decisions, student-facing grades screen | — | — |
| Cahier de textes / homework | COMPLETE (2026-10-08, ADR-008) | `lesson_entries` per session, chapter, homework and due date | student-facing homework view | — | — |
| Communication | COMPLETE (2026-10-14, ADR-009) | SharePoint-style news (audiences, covers, pinning, scheduling, views, likes), messaging with safeguarding supervision, e-mail/SMS outbox, reminder rules (payments, absences, lesson log) | real e-mail/SMS delivery (needs a provider), comments under news | provider decision | P5 (delivery only) |
| Official documents | DEFERRED | roster DOCX/PDF, CSV exports | Phase 6 research (separate workspace) | maturity | P6 |
| CI / test hygiene | NONE | local suites | CI; stale suites (hard-coded 54321 and 5173) | — | P1 (parallel) |

---

## C. Dependency order

```text
G1 commit/review backlog ─┐
T00 registration security ┼─► A01 student status ─► A02 admin-created students ─► A09 pre-registration
G2 ADR-004 scope ─────────┘        │                       │
                                   └─► A03 admin enrolment/transfer ─► A10 waiting list ─► A13 dashboard
A04 academic years/periods ─► A08 session exceptions ─► H01 workload
A05 rooms ─► A06 conflict detection ─► A07 timetable views
A12 programme catalogue (needs T00, ADR-004 levels decision)
A04 + A03 ─► F01 fee types ─► F02 charges ─► F03 schedules ─► F04 balances ─► F07 refunds, F08 invoices, F09 reports, C04 reminders
Payments core ─► F06 receipts (independent of F01–F04)
ADR-004 + A04 ─► P03 evaluations ─► P04 grades ─► P05 report cards ─► P06 progression
C01 email infrastructure ─► C03/C04 notifications by email
```

Hard gates before any new feature: **G1** (the uncommitted backlog reviewed and committed),
**T00** (F1 closed).

---

## D. Implementation phases

| Phase | Content | Exit criterion |
|---|---|---|
| 0 — Gates | G1, T00, G2, Q01 | backlog committed; F1 closed and regression-tested; ADR-004 accepted; CI runs tsc, unit tests and build |
| 1 — Administrative core | A01–A14 | an admin can enrol walk-ins, manage rooms and a conflict-free timetable, process inquiries and waitlists, and see operational queues |
| 2 — Finance completion | F01–F10 | expected vs paid per student is derivable; receipts, invoices and reports exist; no stored balances |
| 3 — Academic administration | P01–P06 | gated by ADR-004 |
| 4 — HR / institution completion | H01–H04 | builds on the HR foundation; no second HR model |
| 5 — Communication | C01–C06 | needs a provider decision (email/SMS) |
| 6 — Algerian documents | deferred | research in a separate workspace, reviewed before implementation |

---

## E. Task breakdown

Field key: **Obj** objective · **In** scope · **Out** explicit out-of-scope · **Dep** dependencies ·
**DB / BE / UI / Sec** impacts · **Tests** · **Done** acceptance criteria.
Every task also runs: `tsc`, `npm run test:unit`, `npm run build`, and the existing critical e2e
suites (`verify-enrollment-security`, `verify-payments`, `verify-programs`, `verify-hr`,
`verify-role-integrity`). All database work is local only.

### Phase 0 — Gates

**G1 — Review and commit the uncommitted backlog**
- Obj: put the six completed tasks into reviewable commits on `main`, with no history rewrite.
- In: group into commits per task (payments, withdraw policy, programmes, HR, routes, sidebar, docs); re-run all suites first.
- Out: production migration, deployment, new code.
- Dep: user approval of the commit plan. DB/BE/UI/Sec: none (already done).
- Tests: full suite set listed above. Done: clean `git status` except intentional untracked files (`.mcp.json`, `BG HERO.png` — user decision).

**T00 — Registration requests always start as `pending`** — DONE 2026-10-03 (`20261003100000`)
- Obj: close F1.
- In: one migration. Either a BEFORE INSERT trigger that, for non-admins, forces `status = 'pending'`, `decided_at = NULL` and `note = NULL`, or tighten the insert WITH CHECK and revoke column INSERT on `status`, `decided_at` and `note` from `authenticated` (the admin insert path then needs to be checked). Smallest correct option chosen during implementation.
- Out: admin enrolment UI (A03), any other policy.
- Dep: none. DB: one migration. BE/UI: none expected (the student hook already sends no status).
- Sec: affects the registration insert path only. Re-check admin inserts (fixtures, seed) still work.
- Tests: extend `verify-enrollment-security`: a student POST with `approved` / `rejected` / `decided_at` / `note` lands as pending with nulls; an admin insert of `approved` still works; capacity and one-per-subject unchanged.
- Done: probe returns pending; all enrollment suites green.

**G2 — ADR-004: scope expansion** — DONE 2026-10-03 (`docs/ADR-004-formation-architecture.md`)
- Obj: formally record the product decisions this roadmap depends on.
- In: supersede ADR-003's exclusion of exams, grades and evaluations (sessions architecture stays); confirm "one deployment per institution" as the SaaS model; decide how non-school levels are modelled (F5); decide whether two sessions per day are needed (F6); decide whether the `groups.price_dzd` meaning changes under Fee Types.
- Out: code. Dep: product owner. Done: ADR accepted, and the knowledge base §9/§14 updated.

**Q01 — CI and stale-suite hygiene** (can run in parallel)
- Obj: every push runs tsc, unit tests and build. Fix or quarantine suites hard-coding `54321` (the neighbouring project) or port `5173`.
- Out: running e2e against any hosted DB. DB: none. Sec: no secrets in CI beyond the build.
- Done: green pipeline; stale suites read `.env.local` like `fixtures.mjs`.

### Phase 1 — Administrative core

**A01 — Effective student status**
- Obj: make `inactive`, `suspended` and `archived` mean something (F2).
- In: status transitions through an admin server function; deactivation bans sign-in (GoTrue, as for teachers); inactive students cannot request places (`can_join_group` checks status); archive; permanent deletion only when `entity_dependencies('student')` reports nothing blocking.
- Out: dossier documents (A11), admin creation (A02).
- Dep: T00. DB: migration (function and policy changes, audit enum values in their own migration). BE: server function. UI: actions on the students list and detail, reusing the teacher lifecycle pattern.
- Sec: admin only; cannot affect staff accounts; audit every transition.
- Tests: unit model; e2e per status (sign-in refused, request refused, data retained); deletion refused with payments/attendance.
- Done: every status has a tested effect.

**A02 — Admin-created student accounts (walk-in enrolment)**
- Obj: the administration can register a student without the student signing up (F3).
- In: `createStudentFn` (service role) creates the auth user; the trigger creates the student; the admin fills the onboarding fields; temporary password, credentials dialog, forced change. All reused from teacher provisioning.
- Out: enrolling into groups (A03), pre-registration (A09), guardians as accounts (no parent role).
- Dep: A01. DB: probably none (perhaps an audit enum value). BE: server function. UI: "Add student" dialog on `/dashboard/students/`.
- Sec: server-side `assertAdmin`; never a client-supplied role; compensating delete on failure.
- Tests: e2e create → sign in → forced change → onboarded; non-admin refused.
- Done: walk-in student usable end to end.

**A03 — Admin enrolment and transfer**
- Obj: an admin places a student in a group directly and transfers between groups atomically.
- In: admin "Enrol" (inserted approved, capacity enforced) from the student detail and group detail pages; transfer RPC (reject or close old + approve new in one transaction); a withdrawal reason recorded instead of a silent delete for approved places.
- Out: waitlist (A10), fees (F-series).
- Dep: T00. DB: one RPC, maybe a `withdrawn` status (enum migration). BE: hooks. UI: existing dialogs and pickers.
- Sec: admin only; payments RESTRICT respected (transfer never deletes a paid registration).
- Tests: capacity full, one-per-subject, transfer with payments, notifications.
- Done: no admin needs the student's account to manage their places.

**A04 — Academic years and periods**
- Obj: a real academic calendar to anchor sessions, fees, evaluations and reports.
- In: `academic_years` (label, start/end, one current) and `academic_periods` (term/semester/custom, within the year); optional `academic_year_id` on groups and programmes; replace free-text `center_settings.academic_year` reads.
- Out: holidays (A08), evaluations (P-series), fee schedules.
- Dep: G2. DB: one migration (no change to existing group semantics; nullable link). UI: Settings section.
- Sec: authenticated read; admin write.
- Tests: overlap and containment constraints; unit model.
- Done: current year and periods queryable, used by the dashboard.

**A05 — Rooms**
- Obj: rooms as managed entities.
- In: `rooms` (name unique, capacity, active, notes); `group_schedules.room_id` FK (RESTRICT), with the legacy text kept read-only and best-effort backfilled by name; admin CRUD page (unhides "Salles").
- Out: conflict checks (A06), equipment (H04).
- Dep: none. DB: one migration. UI: list and form reusing DataTable and dialogs; room picker in the group form.
- Sec: staff read; admin write.
- Tests: e2e CRUD, delete refused while in use, legacy text preserved.
- Done: every new schedule slot can name a room entity.

**A06 — Scheduling conflict detection**
- Obj: refuse teacher double-booking and room double-booking.
- In: a database trigger on `group_schedules` and `groups` (teacher change, term window change) checking overlapping weekday/time within overlapping date windows, for active groups; a room capacity < group capacity warning; an HR availability mismatch warning (reuse `slotsOutsideAvailability`). Clear 23P01/23514 messages.
- Out: student-level conflicts (separate, later); automatic timetable generation.
- Dep: A05. DB: one migration. UI: form error states only.
- Sec: none new.
- Tests: e2e conflicts per dimension; archived or inactive groups ignored; existing data audited first (report existing conflicts before enforcing).
- Done: conflicting saves impossible; existing data unaffected or reported.

**A07 — Institution timetable views**
- Obj: one admin view of the week by room, teacher, level and group.
- In: a read-only grid derived from `group_schedules` (no new table); filters; print and PDF using the roster print approach. Unhides "Emplois du temps".
- Out: drag-to-edit, generation. Dep: A05, A06. DB: none. Sec: admin (and teacher for their own) via existing RLS.
- Tests: browser fr/ar/RTL, mobile; unit grid model.
- Done: printable weekly timetable per room and teacher.

**A08 — Session exceptions and holidays**
- Obj: cancel, reschedule and make up sessions; institution holidays.
- In: `session_exceptions` keyed on `SessionKey` (ADR-003 §8.2: cancelled, rescheduled to date/time/room); holidays per academic year; session status `cancelled` already reserved; attendance refused on cancelled sessions.
- Out: notifications to students (C-series), two sessions per day (only if G2 approves; separate task).
- Dep: A04. DB: one migration. BE: extend the session derivation without widening `SessionInstance` (ADR-003 rule).
- Tests: session status unit tests; attendance validation e2e.
- Done: calendars and reports exclude cancelled and holiday sessions.

**A09 — Pre-registration (inquiries)**
- Obj: capture prospects before an account exists (unhides "Pré-inscriptions").
- In: `inquiries` (name, phone, guardian, desired level/programme, source, status new → contacted → converted | dropped); public form (anon insert only, rate-limited, minimal columns) and admin entry; conversion uses A02 (+A03).
- Out: payments for prospects, marketing campaigns, email (C-series).
- Dep: A02. DB: one migration. Sec: anon INSERT only (no read); admin read/write; spam control decided in the task.
- Tests: anon cannot read; conversion links the student; RLS per role.
- Done: an inquiry becomes an enrolled student without retyping.

**A10 — Waiting list**
- Obj: an ordered queue when a group is full.
- In: a `waitlisted` registration state (enum migration) with a position/timestamp; admin promotes (capacity re-checked); optional auto-offer is out.
- Out: notifications (C-series), automatic promotion.
- Dep: T00, A03. DB: two migrations (enum, logic). UI: registrations page filter and group detail section.
- Tests: ordering, promotion, capacity, one-per-subject interaction.
- Done: full groups keep an explicit, ordered queue.

**A11 — Student dossier documents**
- Obj: admin-held student files (identity, photos, certificates).
- In: `student_documents` plus a private bucket, cloned from the HR documents pattern (admin-only, signed URLs, audit).
- Out: Algerian official templates (Phase 6), student uploads (decide in the task).
- Dep: A01. DB: one migration plus bucket. Sec: admin only; RESTRICT and audit.
- Done: dossier tab on student detail.

**A12 — Programme catalogue and level-less enrolment**
- Obj: students can request programmes and formations that have no school level (F5).
- In: extend `can_join_group` (open programme with `registration_open` and level-less groups); catalogue section grouped by programme.
- Out: fees; new level taxonomy (unless G2 decides it here).
- Dep: T00, G2. DB: function change. Sec: re-verify eligibility suites.
- Done: a formation group is requestable by eligible students only.

**A13 — Operational admin dashboard and statistics**
- Obj: queues an administrator acts on, plus a statistics page (unhides "Statistiques").
- In: pending decisions, waitlist, unmarked or overdue sessions, groups near capacity, today's sessions by room, attendance rate trends, enrolment by level/programme; CSV export. Read-only, derived (security_invoker views if aggregated).
- Out: finance KPIs (F09), charts for decoration.
- Dep: A03, A10 (degrades gracefully without them). DB: views only.
- Done: every number is clickable through to its list.

**A14 — Audit coverage and admin audit viewer**
- Obj: audit registrations decisions, group and student changes; one admin "Journal d'activité" view (the "Sécurité" entry).
- In: audit triggers (enum values in their own migration); a paginated read-only viewer with filters.
- Out: export to external SIEM. Sec: admin read only; no secrets in details (existing CHECK).
- Done: every admin action on people, places and money is traceable.

### Phase 2 — Finance completion (builds on Payments core; no rebuild)

| ID | Title | Objective / scope | Out | Dep | DB |
|---|---|---|---|---|---|
| F01 | Fee types and price catalogue (**partly done 2026-10-06, ADR-005:** `fee_types` table with built-ins; price catalogue / formation templates and `price_dzd` fate remain) | fee types (registration, tuition/training, transport, canteen, other), amount and period (one-off, monthly, per term, per programme); attach to programme or group; decide `price_dzd` fate (G2) | charging students | A04, G2 | 1 migration |
| F02 | Student charges (**done 2026-10-06, ADR-005:** charges per enrollment, entered by the admin; generation from templates comes with F01) | what each student owes, generated from approved registrations + fee types per period; derived balance never stored | discounts | F01, A03 | 1 |
| F03 | Payment schedules and installments (**done 2026-10-06, ADR-005**) | due dates and installments per charge | reminders | F02 | 1 |
| F04 | Outstanding balances and overdue (per-student remaining/overdue derived on the student page since 2026-10-06; allocation and the admin list remain) (**done 2026-10-06, ADR-006: Soldes & impayés, derived; no allocation**) | allocation of existing payments to charges; derived outstanding/overdue views; admin list | dunning | F03 | 1 + views |
| F05 | Discounts, scholarships, sibling discount (**done 2026-10-06, ADR-006**) | rules applied to charges, audited, admin-only | automatic eligibility | F02 | 1 |
| F06 | Receipts (**done 2026-10-06, ADR-006**) | numbered, immutable, printable receipt per payment (gapless sequence); generic format until Phase 6 | legal fiscal formats | Payments core | 1 |
| F07 | Refunds | separate refund records (never negative payments, per existing decision) | payment gateway | F04 | 1 |
| F08 | Invoices (**done 2026-10-06, ADR-006**) | invoice documents from charges | e-invoicing | F02, F04 | 1 |
| F09 | Financial reports and exports (**done 2026-10-06, ADR-006**) | period revenue, by method, programme, group; outstanding ageing; CSV/PDF | accounting integration | F04 | views |
| F10 | Student payment view | student sees own payments, charges and receipts (RLS already allows own payments) | online payment | F04, F06 | none |

Security rules for every F task: admin write only; teachers never see money; students read their own only; every change audited; RESTRICT so financial history survives deletions.

### Phase 3 — Academic administration (blocked by G2)

| ID | Title | Scope | Dep |
|---|---|---|---|
| P01 | Cahier de textes (**done 2026-10-08, ADR-008:** `lesson_entries`, `/dashboard/lesson-log`) | per-session lesson log keyed on `SessionKey` (module-owned table, ADR-003 pattern); teacher writes for own groups, admin reads all | A08 optional |
| P02 | Homework (**done 2026-10-08, ADR-008:** homework and due date on the lesson entry) | homework linked to a session/lesson; reuse resources with `role = homework` | P01 |
| P03 | Evaluations / exams (**done 2026-10-08, ADR-008:** `assessments`, kinds, scale, coefficient, publication) | evaluation definitions per group/period, coefficients, scale | G2, A04 |
| P04 | Grades (**done 2026-10-08, ADR-008:** `assessment_scores`, score sheet; publication instead of an admin lock) | grade entry (teacher own groups), validation/lock by admin | P03 |
| P05 | Averages and report cards (**done 2026-10-08, ADR-008:** `academic_periods`, derived averages and ranks, `report_comments`, printable bulletin) | derived averages, comments, printable report card | P04 |
| P06 | Results and progression (**partly done 2026-10-08, ADR-008:** chapter coverage, lesson-log rate, class average per period; promotion decisions not built) | pass/fail/promotion per period or programme completion | P05 |

### Phase 4 — HR / institution completion (extends the HR foundation)

| ID | Title | Scope | Dep |
|---|---|---|---|
| H01 | Workload and service hours | planned vs held teaching hours (schedules − exceptions), per employee/period; read-only | A08 |
| H02 | Staff reports | attendance, leave, contracts expiring; CSV | H01 |
| H03 | Payroll preparation | hours × rates export only (no payroll engine), rates on contracts | H01, G2 decision |
| H04 | Physical resources and equipment | inventory and room/resource booking | A05 |

### Phase 5 — Communication

| ID | Title | Scope | Dep |
|---|---|---|---|
| C01 | Email delivery infrastructure | server-side provider, templates fr/ar/en, delivery log, opt-out | provider decision |
| C02 | Announcements | admin → roles/groups/programmes; in-app first (enum `announcement` exists) | — |
| C03 | Absence notifications | emit `attendance_marked` (enum exists), then email | C01 optional |
| C04 | Payment reminders | from overdue balances | F04, C01 |
| C05 | Internal messaging | admin ↔ teacher ↔ student threads, RLS per participant | C02 |
| C06 | SMS | provider (Algerian coverage), cost control | C01 |

### Phase 6 — Algerian administration and documents: DEFERRED

Do not start. Research happens later in a separate workspace, using official Algerian sources first.
It must distinguish official/legal, common, local-convention and institution-specific documents,
and its results are reviewed before any implementation.

---

## F. Risks

1. **Uncommitted backlog** (six tasks, six migrations): loss or merge risk until G1.
2. **Production drift:** August migrations unverified on production; six new migrations local-only;
   `RESTRICT` changes deletion semantics there. A production rollout needs its own approved plan.
   The CLI is linked to production.
3. **F1 is live wherever the current schema runs**, including production (the policy predates the fork).
4. **ADR conflict (F7):** building evaluations before ADR-004 contradicts an accepted ADR.
5. **Model limits (F5, F6):** school-stage levels and one-slot-per-day constrain formations and
   workshops; changing either touches eligibility and the session key.
6. **`groups.price_dzd`** may conflict with Fee Types unless G2 defines its meaning.
7. **No CI;** several e2e suites point at the neighbouring stack (`54321`) or port `5173`.
8. **Hand-edited `types.ts`** (no CLI to regenerate) can drift from the schema.
9. **Scale:** unbounded list queries (`useGroups`, `useRegistrations`); PostgREST caps responses at 1000 rows.
10. **Storage orphans** after cascades still count toward the quota.

---

## G. Deferred work

- Phase 6 research (Algerian documents).
- Parent role / portal; secretary role (not requested).
- Multi-tenancy (excluded).
- Online payment gateway, accounting integration, e-invoicing.
- Automatic timetable generation; student-level schedule conflicts.
- Carried-over hardening (F8): orphan cleanup, ban-result check, first-admin bootstrap docs,
  pagination, SSR `lang`/`dir`. Each is a small standalone task, schedulable between features.
