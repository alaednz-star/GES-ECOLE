# Project Knowledge Base — Gestion École

> Engineering memory for future developers and AI agents. Read this **before** changing
> anything. It records what exists, where, why, what depends on it, and what breaks if it
> is changed. It is not the source of truth — see the maintenance rule at the end.
>
> Confidence labels: **CONFIRMED** (verified in code, migrations, ADRs or by running a
> command) · **INFERRED** (follows from several pieces of evidence, not executed) ·
> **UNKNOWN / REQUIRES VERIFICATION**.

---

## 1. Project identity

| Fact | Status |
|---|---|
| **Gestion École** is a school-management product for private schools and tutoring centres ("cours de soutien"), built for Algeria: French / Arabic / English with full RTL, Algerian phone formats, a Saturday-first week. | CONFIRMED |
| One installation = one Supabase project = one school. **No multi-tenancy exists, and none is planned**: there is no `tenant_id`/`school_id`; `center_settings` is a singleton row (`id boolean PRIMARY KEY CHECK (id)`). | CONFIRMED |
| The school's identity is **configuration, not code**: name, tagline, three descriptions, logo, colours, contacts live in the `center_settings` row and reach the UI through `BrandProvider` (admin: Paramètres → Identité visuelle). An unconfigured installation renders as **Gestion École** (`PRODUCT_BRAND`, `brand.name`). | CONFIRMED |
| No project ref, school name, hosted URL or real account is committed. A school's values live in `.env` (desktop release builds, uncommitted), Vercel environment variables, and the `center_settings` row. | CONFIRMED (2026-10-14 clean copy) |
| Hosting: Vercel (Nitro `vercel` preset), branch `main`. Desktop: Tauri 2, Windows (ADR-010 pending, see MASTER_ROADMAP). | CONFIRMED |
| The project originated in Lovable: `@lovable.dev/vite-tanstack-config` is still the base of `vite.config.ts` (it sets port 8080). | CONFIRMED |

**History.** This repository (GES-ECOLE) started on 2026-10-14 as a clean copy of an earlier
single-school deployment, which had itself been forked from a platform called Madrasti. The
copy kept the code, migrations and decisions, not the git history, the school's identity or
its operational scripts; the earlier repository is the archive. ADRs and audit documents keep
their original wording as records, so they may say "Madrasti" or show demo accounts on
`@madrasti.local`.

**Compatibility identifiers — keep them:**
- `@no-login.madrasti.local`: the internal e-mail domain of students created without a login
  (`admissions.server.ts`). Existing databases hold rows with it, and the communication
  migration excludes it from e-mail sending. Changing it needs a data migration.
- `LEGACY_DEFAULT_SCHOOL_NAME = "Madrasti"` (`src/lib/brand.ts`): the old column default;
  `schoolNameOrNull()` reads it as "not set" everywhere (brand, page title, settings form,
  billing identity). Migration `20261015100000` sets the default to `''` and clears only an
  untouched default.
- `LEGACY_LOCALE_STORAGE_KEY = "madrasti.locale"` (`src/lib/i18n/config.ts`): read once and
  moved to `gestion-ecole.locale` so users keep their language.

---

## 1a. Environment map — never confuse these

| Environment | Identifier | Where defined | Rule |
|---|---|---|---|
| **Local stack** | containers `supabase_*_<project_id>`; API `http://127.0.0.1:55321` | `supabase/config.toml` (ports), `.env.local` (URL + local keys) | Development, e2e, demo data |
| **A school's hosted project** | its project ref | Vercel env, `.env` (desktop release), `supabase link` (`supabase/.temp/`) | Never committed; never a test target |

The Supabase CLI names the local containers from `SUPABASE_PROJECT_ID` when a `.env` sets it,
otherwise from `project_id` in `config.toml` (`gestion-ecole`). On the original development
machine another project's stack holds ports **5432x**; never point a suite at it.

---

## 1b. Local development — exactly how it works

Full instructions: LOCAL_SETUP.md. CONFIRMED unless marked.

| Question | Answer |
|---|---|
| Docker? | **Yes**, Docker Desktop: the local Supabase stack runs as containers created by the **Supabase CLI** (`supabase start`); there is no compose file. |
| What starts the frontend? | `npm run dev` → `vite dev` on **:8080** (port from `@lovable.dev/vite-tanstack-config`). |
| Ports | API/Kong **55321**, Postgres **55322**, shadow DB 55320, Studio **55323**, Inbucket (mail) **55324**, Analytics 55327 (`supabase/config.toml`). |
| Which env file wins? | Vite: `.env.local` **overrides** `.env` in every mode (dev and build). With `.env.local` present, a local `npm run build` targets the local stack. Vercel builds are unaffected. |
| How migrations reach the local DB | `supabase start` on an empty volume, or `supabase db reset` (local). |
| Seed / demo data | `npm run seed:demo` (idempotent), `npm run seed:demo:fresh`, `npm run verify:demo`; writes through the local-only `/pg/query` endpoint via `scripts/e2e/fixtures.mjs`, which refuses non-loopback URLs and reads `.env.local`. Demo accounts: `admin.demo`, `teacher.demo`, `student.demo`, `mehdi.demo`, `sarah.demo` `@demo.gestion-ecole.local` (`docs/local-demo-data.md`). Removal: `scripts/reset-demo-data.sql` (local, both demo domains). |
| Local mail | Inbucket, `http://127.0.0.1:55324`. INFERRED from config. |

**Safe:** `npm run dev`, `npm run test:unit`, `npx tsc --noEmit`, `npm run seed:demo*`,
`npm run verify:demo`, e2e scripts that take their API from `fixtures.mjs`,
`supabase start|stop|status`, `supabase db reset` **without** `--linked`.

**Dangerous:**
- A folder linked with `supabase link` acts on that hosted project: `supabase db push`,
  `db reset --linked`, `migration repair`, `db pull`. Check `supabase/.temp/project-ref` first;
  only push with the school owner's approval.
- `npm run format` rewrites hundreds of files (TD-14).

**Hazard — e2e suites that hard-code another stack.** `verify-enrollment-integrity`,
`verify-enrollment-ui`, `verify-level-statistics`, `verify-role-integrity`, `verify-rtl`,
`verify-teacher-lifecycle`, `verify-teacher-workspace`, `verify-teachers-ui` contain
`127.0.0.1:54321` (another project's stack) and/or app port `5173`. Do not run them until they
read `fixtures.mjs` (QA-01). Before running any suite, grep it for `54321` / `5173`. Past
incidents (2026-10-03, 2026-10-04): suites run by mistake sent reads and rejected inserts to
the neighbouring stack.

**Fragility — `verify-teacher-deletion.mjs`, `verify-role-integrity.mjs`** insert attendance
with the DB's UTC `current_date` into a fixture group whose weekday comes from the LOCAL clock,
so between 00:00 and 01:00 local (UTC+1) they fail with "The group does not meet on …". Not a
product bug.

**E2E fixtures and the partial index:** suites that upsert registrations must target
`on conflict (student_id, group_id) where status in ('pending', 'approved')`.

**Routing rule:** list/detail pairs use `dashboard.x.index.tsx` + `dashboard.x.$id.tsx`
(a parent route without `<Outlet/>` renders the list instead of the detail).

---

## 2. Product purpose

- **Who:** one private tutoring ("cours de soutien") centre, its administrators, teachers
  and students. CONFIRMED
- **Problem solved:** students self-register online and apply to class groups matching
  their academic level and stream; administrators approve places, manage teachers, groups,
  timetables, attendance, course material and fees. CONFIRMED
- **Core concepts / vocabulary:**
  - *Level* (`levels`, Algerian school levels, `stage` primary/middle/high) and *Stream*
    (`streams`, filière, belongs to a level).
  - *Subject* (`subjects`, identified by a locale-independent `key`, e.g. `mathematics`).
  - *Group* (`groups`) = one class: subject + teacher + level (+ stream) + capacity +
    `price_dzd` + term window `start_date`/`end_date` + weekly `group_schedules`.
  - *Registration* (`registrations`) = a student's request for a place in a group:
    `pending` → `approved` / `rejected`. An approved registration **is** a place.
  - *Session* = a derived lesson occurrence, identified by `(group_id, session_date)`.
    There is **no sessions table** (ADR-003).
  - *Chapter* / *Resource* = course material per group.
  - *Payment* = money received against a registration.
- French is the default locale; UI labels are French (Présences, Inscriptions, Paiements…).

---

## 3. User roles

Exactly three roles: enum `app_role` = `admin`, `teacher`, `student`. CONFIRMED.
Roles live in `user_roles (user_id, role)` with `UNIQUE (user_id, role)` — multi-valued by
design. The client collapses them to one effective role with precedence
`admin > teacher > student` (`services/auth/supabase-auth-service.ts` `hydrate()`).

No secretary, parent, bursar or other roles exist. There is **no parent portal** — ADR-003
states this explicitly. Other roles are not rejected by an ADR except parent-portal; they
are simply not planned anywhere (UNKNOWN whether wanted).

| Role | How created | Can do (enforced by RLS / server) | Cannot |
|---|---|---|---|
| **admin** | Only by another admin via `createAdminFn` (server, service role) or by scripts; `provision_staff` | Everything in `public` via `private.is_admin()` branches; manage users/admins/teachers via server functions; record payments; branding | Deactivate/delete self; deactivate/delete the last active admin (`private.assert_admin_removable`) |
| **teacher** | Only by admin via `createTeacherFn` → `auth.admin.createUser` + `provision_staff` | Read all groups/schedules (`private.is_staff()`); read profiles/notes of **own approved** students; write attendance for own groups; write chapters/resources for own groups (`can_manage_group`); write notes + notifications for own students | Write groups/schedules/registrations; read payments (deliberately absent from every payments policy); read `audit_log` |
| **student** | Public signup (`/register`) → trigger `handle_new_user` | Read/edit own profile and onboarding fields; see only groups matching own level/stream; request places (`can_join_group`); withdraw; read own attendance, own payments, published resources of enrolled groups; record resource view/download events | Record attendance; approve own request (UPDATE blocked); see other students |

Database is the real boundary; `RequireAuth` role checks and `navigation.ts` role filters
are UX only.

---

## 4. Feature inventory

Format: **Feature** — where — how — who — status.

### Identity & accounts
- **Public signup** — `routes/register.tsx`, `supabase-auth-service.ts` — sends only
  `full_name` metadata (no role); trigger makes profile + `student` role + `students` row —
  anyone — CONFIRMED implemented.
- **Login / logout / forgot / reset password** — `routes/login|forgot-password|reset-password.tsx` — Supabase Auth; reset handles recovery session and clears `password_change_required` — all — CONFIRMED.
- **Forced password change** — `features/auth/password-change.tsx`, `routes/change-password.tsx` — reads `profiles.password_change_required`, set true by `provision_staff` / password reset — staff — CONFIRMED (enforced in UI only; see §12).
- **Student onboarding wizard** — `routes/onboarding.tsx`, `features/onboarding/*`, `require-onboarding.tsx` — sets level, stream, gender, DOB, guardian, `onboarded_at` — student — CONFIRMED.
- **Teacher provisioning** — `features/teachers/provisioning.{functions,server}.ts`, `create-teacher-dialog.tsx`, `credentials-dialog.tsx` — server fn → `assertAdmin` → `auth.admin.createUser(email_confirm)` → RPC `provision_staff` → qualifications → audit; compensating `deleteUser` on failure; temporary password shown once — admin — CONFIRMED.
- **Teacher lifecycle** active/suspended/archived — `setTeacherLifecycleFn` → RPC `set_teacher_lifecycle` (state machine + audit; archive refused while groups assigned) + GoTrue ban (`ban_duration 876000h`) — admin — CONFIRMED.
- **Teacher permanent deletion** — `deleteTeacherFn` — re-runs `entity_dependencies` server-side, refuses on `blocking`/`reassignable`, audits then `auth.admin.deleteUser` — admin — CONFIRMED.
- **Teacher password reset** — `resetTeacherPasswordFn` — new temp password + flag — admin — CONFIRMED.
- **Administrator management** — `routes/dashboard.users.tsx`, `features/admins/*` — list all users (service role), create admin, send recovery mail, deactivate/reactivate (ban), delete; guards in `private.assert_admin_removable` — admin — CONFIRMED (depends on migration `20260821110000`, see §15).
- **Student account deletion / deactivation** — no server function, no UI. `entity_dependencies('student', …)` exists in DB. — NOT IMPLEMENTED (UNKNOWN whether planned).

### Academic structure
- **Levels, streams, subjects CRUD** — `dashboard.levels.tsx`, `streams.ts`, `dashboard.subjects.tsx` — direct Supabase writes, admin RLS — CONFIRMED. Levels/streams/subjects seeded by migrations. Each subject has a **domain** (set in the subject dialog, shown as a column) — see "Subject domains" below.
- **Groups CRUD + weekly schedule** — `dashboard.groups.tsx`, `dashboard.groups.$groupId.tsx`, `queries.ts` (`useGroups`, `useSaveGroup`, `useDeleteGroup`) — admin writes; teachers read-only view — CONFIRMED.
- **Teacher qualifications** (`teacher_subjects`) — a group's teacher must be qualified for its subject; a qualification in use cannot be removed — triggers `validate_teacher_qualification`, `protect_teacher_qualification_in_use` — CONFIRMED.

### Enrollment
- **Course catalogue / self-registration** — `dashboard.registration.tsx`, `eligible-groups.ts` — student sees only eligible groups (RLS), requests a place — CONFIRMED. Seat counts and prices were deliberately removed from student cards (commits `18eb7c5`, `30a1a14`).
- **Registration success page** — `dashboard.registration.success.$registrationId.tsx` — CONFIRMED.
- **My registrations + withdraw** — `dashboard.my-registrations.tsx` — withdraw = DELETE, offered in UI only while pending — CONFIRMED.
- **Admin approval / rejection with note** — `dashboard.registrations.tsx`, `useDecideRegistration` — trigger `notify_registration_decision` creates a notification — CONFIRMED.

### Sessions & attendance (ADR-003)
- **Session spine** — `features/school/session/*` (`session-key.ts`, `status.ts`, `use-sessions.ts`, `calendar-views.tsx`, `attendance-drawer.tsx`, `keyboard.ts`, `deep-link.ts`) — sessions derived client-side from `group_schedules` + term window; status derived (`empty/complete/partial/overdue/due/scheduled`, `cancelled` reserved) — admin, teacher — CONFIRMED.
- **Attendance marking** — `dashboard.attendance.tsx` calendar → drawer; saves only changed entries; keyboard marking; deep links — admin, own-group teacher — CONFIRMED.
- **Attendance report** — `dashboard.attendance-report.tsx` — admin, teacher — CONFIRMED.
- **Student attendance view** — `dashboard.my-attendance.tsx` — CONFIRMED.
- **Teacher workspace / dashboards** — `dashboard.index.tsx` dispatches per role; `teacher-workspace.ts`, `today-priorities.tsx`, `next-class-hero.tsx` — CONFIRMED. `/dashboard/teacher` now only redirects to `/dashboard`.
- **Student schedule / classes** — `dashboard.schedule.tsx`, `dashboard.my-classes.tsx` — CONFIRMED.

### Course resources
- **Chapters & resources per group** (files + links, pedagogical role ordering, pin, publish/schedule, allow_download, drag reorder, bulk upload queue with cancel, link providers with embeds/thumbnails, copy between groups) — `dashboard.resources.tsx`, `features/school/resources/*`, `storage.{functions,server}.ts` — admin & own-group teacher write; enrolled students read published — CONFIRMED.
- **Signed URLs** — `signResourceUrlFn` asks `can_view_resource`/`can_download_resource` **as the caller**, then signs with service role (1 h TTL) — CONFIRMED.
- **Upload guard** — `assertUploadAllowedFn` + `storage_quota_allows` (5 GB centre quota, 250 MB per file) — CONFIRMED.
- **Engagement analytics** ("who has not opened this?") — views `resource_engagement`, `resource_student_engagement`, `engagement-panel.tsx` — staff only — CONFIRMED.
- **Student resources page** — `dashboard.my-resources.tsx` — CONFIRMED.

### Sidebar roadmap (2026-10-01, `src/config/navigation.ts`)
- Admin sidebar groups: Gestion · **Pédagogie** (Présences, Rapport de présence, Ressources, Cahier de textes, Évaluations, Notes & bulletins, Progression — all live since 2026-10-08) · Gestion financière · **Communication** · Configuration. Teachers see the whole « Pédagogie » section; students unchanged.
- 1 **roadmap** entry remains (as of 2026-10-14): Sécurité (admin-only, `comingSoon`, never linked, excluded from global search). Everything else is live, Communication included (ADR-009).
- `src/config/navigation.test.ts` guards: unique keys per role, roadmap admin-only and non-navigable, roadmap never points at an existing route and every active entry does, implemented modules never « Bientôt », labels in fr/ar/en.
- **Resolved by ADR-004 (2026-10-03):** evaluations, grades and report cards are in scope; ADR-003's exclusion list is superseded (its session architecture is not). The roadmap entries are therefore legitimate.

### HR foundation (`20261001110000_hr_audit_actions.sql` + `20261001110100_hr_foundation.sql`, 2026-10-01)
- **One HR file per staff account:** `employees.profile_id` → `profiles` (UNIQUE, ON DELETE RESTRICT). Person data (name, email, phone, photo) stays on `profiles`; the sign-in role stays in `user_roles`; `staff_type` (teacher | trainer | administrative | other) is an HR classification that grants nothing — CONFIRMED.
- **Two lifecycles:** employment (`employees.employment_status`: active | on_leave | suspended | ended | archived; `ended` needs `end_date`) vs account (existing teacher status + GoTrue ban, admin ban). Neither changes the other.
- **History tables (RESTRICT, no DELETE policy):** `employee_contracts` (type permanent | fixed_term | temporary | freelance | other; separate `working_time` full/part; status active | ended | cancelled; one active per employee via partial unique index; fixed-term and ended need an end date), `employee_leaves` (annual | sick | unpaid | training | other; pending → approved | rejected | cancelled; overlapping pending/approved refused by trigger; type only, never a medical reason).
- **Deletable with audit:** `employee_availability` (weekday + time range + optional effective window; overlaps refused by trigger), `staff_attendance` (one record per employee per day; check-in/out CHECKs; `worked_minutes` GENERATED; no future dates), `employee_documents` (metadata; files in the PRIVATE `hr-documents` bucket, admin-only, 10 MB, PDF/PNG/JPEG/WebP, objects under `<employee_id>/`, read via 60-s signed URLs with the admin session).
- **Audit:** `audit_hr_change()` trigger on all six tables → `audit_log` (`hr_created|hr_updated|hr_deleted`, target = the person's profile, changed columns only, no-op updates skipped).
- **RLS:** every HR table and the bucket are administrator-only. Teachers (including for their own file), students and anon read nothing. Identity columns (`profile_id`, `employee_id`, recorders) are not updatable (column-level grants).
- **Deletion:** `private.entity_dependencies('teacher', …)` reports `employees` as **blocking**; the FK also refuses deleting a profile with an HR file. Teacher and admin deletion therefore refuse accounts with HR history (archive/deactivate instead).
- **Not duplicated:** teaching schedule, groups, programmes and workload are READ from `groups`/`group_schedules`; `slotsOutsideAvailability` compares them with availability. Staff time is not session attendance.
- **UI:** `/dashboard/hr/` (`dashboard.hr.index.tsx`: list, filters status/type/contract, six record-based summary cards, roster CSV, open-file dialog listing staff accounts without a file) and `/dashboard/hr/$employeeId` (tabs: overview, contracts, availability, schedule, working time + monthly CSV, leave, documents, activity). Code in `src/features/hr/` (`hr-model.ts` pure + tests, `hr.ts` data layer, `components/*-panel.tsx`).
- Tests: `hr-model.test.ts` (18), `scripts/e2e/verify-hr.mjs` (77). No payroll anywhere.

### Pré-inscriptions (`20261005110000`, 2026-10-05, branch `product-completion/pre-inscriptions`)
- Flow: formation's link / QR code -> public page `/preinscription/<id>` (no account) -> `applications` row -> admin review on `/dashboard/admissions` -> accept = student created (login disabled) or linked + APPROVED registration in a group of that formation. Details: ADR-004 section 7 ("As implemented").
- Files: `src/features/admissions/` (`application-model.ts` pure rules + tests, `admissions.server.ts` service-role intake/accept, `admissions.functions.ts` server functions, `admissions.ts` admin hooks, `components/public-link-card.tsx`), routes `preinscription.$programId.tsx`, `dashboard.admissions.tsx`, dict `dicts/admissions.ts`.
- Security: `applications` readable/updatable by admins only (RLS); no client INSERT (server function only); anon has no access. Rate limits and honeypot in the server module. No raw IP stored.
- Tests: `scripts/e2e/verify-applications.sql` (22, roles + accept rules, rolled back), `scripts/e2e/verify-admissions-ui.mjs` (19, full journey), `src/features/admissions/application-model.test.ts` (9).

### Formation types (`20261005100000`, 2026-10-05)
- `formation_types(id, code UNIQUE, name, description, built_in, status, position)`; `programs.category` -> `formation_types.code` (FK, ON DELETE RESTRICT). A type = the purpose / educational context of a formation; independent of subject, subject domain and level system.
- **Built-in (9):** formal_education (Enseignement scolaire), academic_support, exam_preparation, language (Cours de langues), general_course (Formation générale), extracurricular (Activités parascolaires), professional_training, workshop (Atelier), other. Labels and descriptions translated by code (`programs.category.<code>`, `programs.typeDescription.<code>`). Cannot be deleted, renamed or re-described; can be deactivated.
- **Custom:** created on `/dashboard/programs/types` (button "Types de formation" on the Formations list). Code generated by the database (`custom_<slug>`, random suffix for an Arabic-only name); one name shown in every language; optional description; rename, deactivate, delete while unused. Duplicate names refused (case/space-insensitive unique index).
- **Lifecycle:** inactive = still valid, readable and editable on its formations (the form shows "Ce type est désactivé"), not offered to new formations, and refused by the database for a new formation or a type switch (`t_programs_type_active`, 23514). A used type cannot be deleted (23503); the page names the formations.
- **Form:** the type select lists active types (plus an existing formation's inactive type) and shows the type's description. Subject filter: built-in map (`subject-domain.ts`; formal education -> school subjects + languages; general course / extracurricular -> all); custom types offer every subject. Level-system suggestion (`level-model.ts`): formal education -> school, general course / extracurricular -> Training, dropped when it does not fit the subject.
- RLS: read = authenticated; write = admin (`private.is_admin()`); guard trigger `guard_formation_type` (built-in protection, code generation). Tests: `scripts/e2e/verify-formation-types.sql` (32, database + roles, runs inside the DB container), `scripts/e2e/verify-formation-types-ui.mjs` (browser), `formation-type-model.test.ts` (unit).

### Subject domains (`20261004130000`, 2026-10-04)
- `subjects.domain` NOT NULL, default `other`, CHECK `languages | school_subjects | computing | professional | other` (`other` = explicit "not classified"). Backfill by stable `key`: english/french/arabic → languages; mathematics/physics/natural_sciences → school_subjects; any other key → other (locally `mkt`, no description, not safely classifiable — reclassify it on the Subjects page). Ids, names, keys and every reference unchanged.
- **Formation type filters the subject list** (form rule, `subject-domain.ts`): language → languages; academic support / exam preparation → school subjects + languages; professional training → professional + computing + languages; workshop / other → all. Changing the type keeps a subject that still fits and clears one that does not, with a message; the validation refuses an unoffered subject (`programs.error.subjectOutsideType`). An existing formation always loads (and saves) its saved subject while its type is unchanged. **Not a database rule**: type + subject are free in the database, so reclassifying a subject never breaks a formation; level systems stay independent.
- **Level systems follow the subject** (2026-10-05, form rule, `level-model.ts` `LEVEL_SYSTEM_DOMAINS` / `isLevelSystemOffered`): form order name -> type -> subject (filtered by type) -> level system -> level. Offered systems: Algerian school for school subjects and languages; CEFR for languages only; Training for computing, professional and other subjects; custom systems for any; "Aucun niveau précis" always. Without a subject, the type's domains decide. A chosen system that stops fitting after a subject/type change is cleared with a message (`programs.form.systemClearedSubject` / `systemClearedType`); validation refuses a new unfitting combination (`programs.error.systemNotOffered`). An existing formation keeps its stored system while subject and type are unchanged, with a notice (`programs.form.systemLegacy`), and still saves. Not a database rule.
- RLS unchanged (read: authenticated; write: admin). Tests: `scripts/e2e/verify-subject-domains.mjs` (17, data + permissions), `scripts/e2e/verify-subject-domains-ui.mjs` (26, browser: filter, level-system rule, legacy), `src/features/school/subject-domain.test.ts` and `level-model.test.ts` (unit).

### Level systems (Phase 3A `20261004110000` + `20261004110100`; Phase 3B `20261004120000`; 2026-10-04)
- Built-in systems: Algerian School (12 levels 1AP..3AS, same ids, stages, streams), CEFR (A1..C2), Training (beginner / intermediate / advanced), Custom (empty). No stage outside the school system; a level never changes system; codes unique per system. `programs.level_system_id` (NULL = no specific level) must match the formation's level, and is filled from it when omitted. Details and rules: ADR-004 section 3 ("As implemented in Phase 3A").
- **Phase 3B (formation form + groups):** the formation type proposes a system (academic support / exam preparation → Algerian school, language → CEFR, professional training → Training, workshop / other → none); the proposal is a default, the administrator's choice wins. `LevelSystemPicker` (system → level; school: stage → year; "Aucun niveau précis" vs "Tous les niveaux" are distinct saved states). A formation's groups may only carry levels of its system (trigger, both directions); the group form lists only those levels. Hooks: `useLevelSystems()`, `useAllLevels()` (forms only); `useLevels()` stays school-only for every other screen. Pure rules: `src/features/school/level-model.ts`. Details: ADR-004 section 3 ("As implemented in Phase 3B").
- **Not yet built (3C):** a Levels page per system, catalogue/eligibility per system kind (students still see school-level groups only), statistics per system.
- Tests: `scripts/e2e/verify-level-systems.mjs` (40, DB), `scripts/e2e/verify-level-picker-ui.mjs` (27, browser), `src/features/school/level-model.test.ts` (unit).

### Formations (table `programs`; `20261001100000_programs.sql`, `20261003110000_create_formation.sql`)
- **Vocabulary (ADR-004, 2026-10-03):** UI says fr « Formation », ar « تكوين », en "Course"; groups are « Groupe » / « فوج » / "Group"; registrations « Inscription » / « تسجيل » / "Enrollment". Tables, keys (`programs.*`) and URLs (`/dashboard/programs`) keep their technical names. `src/lib/i18n-vocabulary.test.ts` fails if "programme", برنامج (on formation screens), مجموعة or "school groups" come back.
- **Programme = the educational offering above groups** (course, formation, exam preparation, workshop). `programs` table: name (live-unique, case/space-insensitive; archiving frees it), `category` = the formation's TYPE, a foreign key to `formation_types.code` (see "Formation types"), `status` (draft → active → completed | cancelled → archived; transitions in `program-model.ts` `nextStatuses`), `registration_open` (CHECK: only while active), optional level, subject, start/end dates, `duration_hours`, description, curriculum — CONFIRMED.
- **`groups.program_id`** (nullable, ON DELETE RESTRICT). One programme → many groups; every pre-existing group is standalone (NULL) and unchanged. Registrations stay student → group; the programme is reached through the group. Payments, attendance, resources untouched.
- **Not stored on a programme, by design:** capacity (sum of its ACTIVE groups' `max_students`), teachers (its groups' teachers), price (future Fee Types will reference `program_id`), stream (a group attribute). Derived in `summariseProgramGroups`.
- **Deleting a formation (2026-10-05):** row menu "Supprimer" on the Formations list (`ProgramDeleteDialog`, `useDeleteProgram`). Only a formation without groups can be deleted (confirmation, irreversible); with groups the dialog explains why and offers no delete button (`groups_program_id_fkey` ON DELETE RESTRICT keeps groups, enrollments and payments; a 23503 race is translated, `isFormationWithGroups`). Admin-only by RLS. Tests: `verify-programs` (database), `verify-program-groups-ui` step 9b (browser).
- **Consistency triggers:** `t_groups_program_consistent` (a group's level/subject must equal its programme's when the programme names them) and `t_programs_groups_consistent` (the reverse on programme edits) — 23514 with a readable sentence.
- **RLS:** admin all; a teacher reads only programmes of their own groups; students and anon nothing.
- **UI:** `/dashboard/programs/` (list, filters, create, edit, status) and `/dashboard/programs/$programId` (the formation page). The page adapts to its groups: **none** → an empty state offering "Ajouter le premier groupe" (zero groups is a valid state); **one** → the formation reads as one offering (teacher, slots with room, group term, places and free places, enrolled names with a link to the group) and its derived totals are not repeated in the details; **several** → one row per group (teacher, term, slots + room, places left, status, edit) and the formation totals in the details. Sidebar order: Formations before Groupes.
- **Creating a formation (Phase 2):** one form; the first group is an optional section (switch, off by default). Formation fields: name, type, subject, level, planned period, duration, description, content, initial status (draft | active). First-group fields (`components/group-delivery-fields.tsx`, shared with the group dialog): teacher (qualified for the formation's subject), places, stream (only when the formation's level has streams), term (follows the formation's period until edited), weekly slots with room; name suggested "<formation> — Groupe A" until edited. Subject and level are never asked for the group. Saved by **`public.create_formation(formation jsonb, first_group jsonb)`** — SECURITY INVOKER (RLS + all triggers apply), one transaction (formation, group, slots all-or-nothing), group subject/level copied from the formation (client values ignored), new formations only `draft`/`active`, registration closed; `anon` has no EXECUTE. Hook `useCreateFormation` (`programs.ts`), payload builder `createFormationPayload` (`program-model.ts`). Groups added later use the group dialog with the formation fixed and `groupDefaultsFromProgram` prefill; group validation is shared (`group-model.ts` `validateGroupDraft`).
- **Groups page:** the misleading "Groupes scolaires / Programmes et formations" tabs are gone (a group without a formation is just standalone, not "school"). A **formation filter** (all · each formation with its group count · "Sans formation") sits with the existing subject/level/status filters; search also matches formation names; each formation group links to its formation; the group detail page names its formation (link for admins). Helper `matchesFormationFilter` (`program-model.ts`).
- **Limitation:** student self-registration still requires `groups.level_id` matching the student (`private.can_join_group`), so a level-less formation group cannot yet be self-joined — the student formation catalogue is a future task.
- Tests: `program-model.test.ts` (27), `group-model.test.ts` (6), `src/lib/i18n-vocabulary.test.ts` (7), `scripts/e2e/verify-programs.mjs` (57; the old "every group is standalone" check is replaced by "every formation-linked group matches its formation" + standalone groups readable; `create_formation` atomicity, rules and refusals), `scripts/e2e/verify-program-groups-ui.mjs` (30, browser: formation alone, formation + first group, one/many groups, fixed fields, formation filter, standalone group, ar/en).

### Enrollment lifecycle and administration placement (Phase 4, `20261004100000` + `20261004100100`, 2026-10-04)
- **States (`registration_status`):** pending (request) · approved (a place; UI « inscrit ») · rejected (history) · **withdrawn** (held a place, then left; history, terminal). `completed` and `waitlisted` are deliberately NOT added yet (ADR-004: completed needs group-end/certificate semantics; waitlisted is the waiting-list task).
- **Uniqueness:** at most ONE active (pending/approved) registration per (student, group) — partial unique index `registrations_one_active_per_group`. Rejected and withdrawn rows never block a new request: a refused student can ask again (the catalogue's « Envoyer une nouvelle demande » now works) and a withdrawn student can be re-enrolled (new row; each stint keeps its own payments and dates). The one-per-subject+level rule (trigger + partial index) is unchanged and fires first, so a duplicate in the same group is usually refused by it (UI maps "same group" to « déjà inscrit dans ce groupe »).
- **Lifecycle trigger `t_registrations_0_lifecycle`** (`enforce_registration_lifecycle`, fires first): withdrawn only from approved; stamps `withdrawn_at`/`withdrawn_by`; withdrawn rows are closed (no status/group/student change; stamps frozen); a row never starts withdrawn.
- **Capacity:** `enforce_group_capacity` now locks the group row (`FOR UPDATE`) before counting approved rows — concurrent approvals into one group are serialised (verified: two racing for the last seat → one 23514).
- **Notification:** `t_registration_decided` now also fires AFTER INSERT, so an admin's direct placement (insert approved) notifies `registration_approved`. Withdrawal sends no notification (no `notification_kind` for it yet).
- **Payments & attendance on withdrawal:** the row stays; its payments stay attached (RESTRICT still blocks group deletion); no new payment can be recorded (insert requires approved); attendance (keyed on group/student/date) is untouched; every access granted through `status = 'approved'` (resources, teacher visibility, payments insert) ends. Refunds/arrears after a withdrawal are a finance decision (Phase 9). A re-enrolled student's attendance in the same group shares the (group, student, date) key across stints.
- **Admin UI:** « Inscrire un élève » dialog (`components/enrollment-dialogs.tsx`) from the group page, the single-group formation card and each row of a multi-group formation: server-side search (name/email/phone, ≤ 20), free places shown, student already in / waiting in the group shown, a pending request becomes « Approuver sa demande »; refusals named via `enrollmentProblem` (`registration-model.ts`) / `useEnrollmentErrors`. Group page: roster with « Retirer » (optional reason, visible to the student), pending requests approved/refused in place, « Historique des inscriptions » (refused + withdrawn, with dates and reasons). Inscriptions page: server-filtered tabs incl. « Retirées », exact counts, truncation notice. Student: « Mes inscriptions » has a « Retirées » tab with the reason; the catalogue shows « Vous avez quitté ce groupe » with a new-request button; `eligible-groups.ts` uses `currentRegistrationByGroup` (active row, else latest).
- **New students** are still created by the student (signup link); admin creation is Phase 5 (ADR-004 §5). The dialog says so and offers the registration link.
- **Transfer** is not implemented; the path is ready: one RPC = withdraw the old place (reason) + insert the new one (+ a `transferred_from` reference added then). Payments stay on the old registration.

### Fees and installments (`20261006100000` + `20261006100100`, 2026-10-06, ADR-005)
- What an enrollment OWES, beside (never inside) what it has PAID. `fee_types` (8 built-ins translated by code, read-only for clients), `charges` (one obligation on one approved enrollment; RESTRICT; `active`/`cancelled` with who/when/reason; partial unique per enrollment + type + label while active), `charge_installments` (1–24, whole dinars > 0, strictly increasing due dates 2000–2100, sum = charge, deferred constraint trigger).
- Writes ONLY through `save_charge` / `cancel_charge` (SECURITY DEFINER, admin check, audit `charge_created` / `charge_updated` / `charge_cancelled`); `authenticated` has no write privilege on the tables. Read: admin all, student own enrollments, teachers none.
- UI: « Frais et échéances » section on `/dashboard/students/$studentId`, admin only (`components/student-fees.tsx`, `charge-dialogs.tsx`; data `fees.ts`; pure `fee-model.ts` + `fee-types.ts`; labels `fee-labels.ts`; dict `dicts/fees.ts`). Per-installment Payé/Restant/Statut is DERIVED (payments cover installments oldest due date first) — display only, no allocation stored.
- Tests: `scripts/e2e/verify-fees.sql` (66, rolled back), `scripts/e2e/verify-fees-ui.mjs` (20), `fee-model.test.ts` (20). `fixtures.mjs` `cleanupFixtures()` deletes fixture charges before groups.

### Fee templates and « Formations & tarifs » (`20261006110000` + `20261006110100`, 2026-10-06, ADR-005)
- `fee_templates`: a formation's default fees (`group_id` NULL) or a group's override (group has >= 1 active item -> uses its own set). Schedule = months after enrollment, same rules as installments (`private.fee_schedule_error`). Writes: `save_fee_template` / `remove_fee_template` (deleted if unused, archived if charges came from it) / `customize_group_fees` (copy defaults). Admin-only, audited `fee_template_*`.
- Materialisation: trigger `t_registrations_z_fee_templates` on registrations becoming approved (any path, same transaction) -> `private.apply_fee_templates` creates charges (`charges.template_id`) + installments; never for an enrollment that already has charges; no backfill.
- UI: fee card on the formation page and the group page (`components/fee-templates-card.tsx`); catalogue page `/dashboard/pricing` (« Formations & tarifs »: price = sum of default fees or « Non configuré », edit through the same card, CSV export). Tests: `verify-fee-templates.sql` (53), `verify-fee-templates-ui.mjs` (27), `fee-template-model.test.ts` (7).

### Finance management (`20261006120000`..`20261006120500`, 2026-10-06, ADR-006)
- **Balance = active charges - active discounts - payments**, derived (`fee-model.ts` `balanceOf`, discounts embedded in `Charge.discounts`).
- Remises & bourses `/dashboard/discounts`: `discounts` (catalogue) + `charge_discounts` (grants, amount frozen, cancel with reason; sum <= charge, deferred check). Grant/cancel on the student page (fee menu). RPCs `save_discount`, `set_discount_active`, `grant_discount`, `cancel_discount`.
- Reçus `/dashboard/receipts` + print `/documents/receipts/$id`: one `receipts` row per payment by trigger (`REC-<year>-<6>` from `document_sequences`), payment edit -> void + new number, payment delete -> void. Existing payments got receipts at migration time.
- Factures `/dashboard/invoices` + print `/documents/invoices/$id`: `issue_invoice(registration)` snapshot (`FAC-<year>-<6>`, issuer incl. NIF/NIS/RC/article from `center_settings`), `void_invoice`. Billing identity dialog on the page; invoice button per enrollment on the student page.
- Soldes & impayés `/dashboard/balances` (view `enrollment_payment_totals`); Rapports `/dashboard/reports` (views `finance_payments_monthly`, `finance_charges_monthly`, ageing). All views security_invoker; all tables admin-read (students own receipts/invoices), no client writes; code in `src/features/finance/`.
- Tests: `verify-finance.sql` (56), `verify-finance-ui.mjs` (18), `finance-models.test.ts` (8). `cleanupFixtures()` removes fixture receipts, invoices and discounts.

### School operations (`20261007100000`..`20261007130000`, 2026-10-07, ADR-007)
- Prices for every course: `fee_templates.program_id` nullable -> a group without formation prices itself; « Formations & tarifs » lists formations AND such groups.
- Salles `/dashboard/rooms`: `rooms` + `group_schedules.room_id` (text `room` kept in sync; a slot written with a room name is linked by name). Room conflict trigger (one active group per room and time). Room chosen per slot in the group form. Slots saved atomically via `replace_group_schedules` (SECURITY INVOKER).
- Emplois du temps `/dashboard/timetables?view=&id=` (derived from slots; Saturday-first week; teacher conflicts) + print `/documents/timetables`.
- Documents officiels `/dashboard/official-documents` + print `/documents/certificates/$id`: `official_documents` (`ATT-<year>-<6>`, kinds enrollment / attendance / payment; snapshot; void with reason; RPCs `issue_official_document`, `void_official_document`).
- Statistiques `/dashboard/statistics` (view `attendance_monthly_stats`; pure `stats-model.ts`).
- Code in `src/features/operations/`; tests `verify-school-ops.sql` (38), `verify-operations-ui.mjs` (14), `operations-models.test.ts` (7).

### Communication (`20261014100000`, 2026-10-14, ADR-009) — SharePoint-style
- Actualités `/dashboard/news` + `/dashboard/news/$postId` (every role): `news_posts` (category, cover in public bucket `news` under `posts/`, audience everyone/students/teachers/staff/group/program/level, pinned, draft→published via `publish_news`, scheduling by `publish_at`), `news_recipients` (fan-out at publication; read/like). Feed = `news_feed()`: hero (newest pinned) + 3 side + grid by category. Teachers post to their own groups only; admins pin. Recipients get an `announcement` notice delivered at `publish_at`.
- Messagerie `/dashboard/messaging?c=` (every role): `conversations`, `conversation_participants`, `messages`; written only by `start_conversation` / `send_message` / `mark_conversation_read`; `private.can_message` = admin↔anyone, teacher↔own students. One-to-one without subject reuses the conversation. Admin supervision (`my_conversations(true)`, read-only). One unread `message_received` notice per conversation (partial unique index on notifications).
- E-mail & SMS `/dashboard/email-sms` (admin): `message_campaigns` + `outbound_messages` (address snapshot, `{name}` rendered, pending/sent/failed/cancelled). NO provider connected: per-row mailto/sms/WhatsApp links, CSV, `set_outbound_status`. Internal `@no-login.madrasti.local` e-mails skipped; SMS to `students.guardian_phone` or the profile phone.
- Rappels & alertes `/dashboard/reminders` (admin): `reminder_rules` (payment_overdue, payment_due_soon, absences, lesson_log_missing; threshold; channels in_app/email/sms), `preview_reminders()`, `run_reminders()` (idempotent through `reminder_log`), daily `pg_cron` job only if the extension is installed.
- Bell: new kinds `message_received`, `payment_reminder`, `absence_alert`, `lesson_log_reminder` (migration `20261009100000`); a message or post notice opens that conversation or post.
- Code in `src/features/communication/`; tests `verify-communication.sql` (79), `verify-communication-ui.mjs` (26), `comm-models.test.ts` (13). `cleanupFixtures()` removes fixture conversations, posts, campaigns and outbox rows.

### Pédagogie (`20261008100000`, 2026-10-08, ADR-008)
- Permission: `can_manage_group` (the group's teacher or an admin) reads and writes; enrolled students read the lesson log, published assessments and their own scores and remarks; other teachers see nothing. The four pages are admin + teacher (a teacher's pickers list only their groups).
- Session dates (lesson entries, assessments) checked by `validate_session_date(<column>)`: inside the group's term, on a slot weekday when the group has slots (same rule as attendance).
- Cahier de textes `/dashboard/lesson-log?group=`: `lesson_entries` (UNIQUE `(group_id, session_date)`, chapter of the same group, summary, homework + due date). Sessions held derived from slots up to today; missing ones flagged.
- Évaluations `/dashboard/assessments?group=`: `assessments` (kind exam/test/quiz/homework/oral/project, `max_score` ≤ 100, `coefficient` ≤ 10, `published`), `assessment_scores` (score ≤ max or absent, enrolled students only; the max cannot drop below a given score). Score sheet sends only changed lines.
- Notes & bulletins `/dashboard/grades?group=&period=`: `academic_periods` (admin), `report_comments` (per group by its teacher/admin; general = group NULL, admin). Averages /20 weighted by coefficient, absences excluded, competition ranks — DERIVED in `grades-model.ts`, never stored. Print `/documents/report-cards?period=&student=`.
- Progression `/dashboard/progression?group=`: lesson-log rate, chapter coverage (referenced by an entry or `chapters.completed_on`), class average per period.
- Code in `src/features/pedagogy/`; tests `verify-pedagogy.sql` (78), `verify-pedagogy-ui.mjs` (30), `pedagogy-models.test.ts` (17). `cleanupFixtures()` removes fixture periods.

### Payments
- **Payment ledger** — `dashboard.payments.tsx`, `features/school/payments.ts`, `payment-model.ts` — one row per PAYMENT (transaction); date-windowed (default: current month), server-side filters (method, group, student), client search/sort, `LEDGER_LIMIT` 1000 with a truncation notice; create / edit / details / delete; summary cards from `payment_daily_totals` (all-time, count, today, this month — local date). **No expected/outstanding amounts on the ledger** by design: what is owed lives in fees and installments (student page, ADR-005) — admin — CONFIRMED (2026-09-30; `verify-payments.mjs` 46/46, browser check fr/ar). The old `students.full_name` query bug (42703) is FIXED: the embed walks `registrations → students → profiles`.
- **Record / delete payment** — methods cash/transfer/cheque/other; whole dinars, `> 0`; `recorded_by` defaults to `auth.uid()` — admin — CONFIRMED.
- Students read own payments via RLS — CONFIRMED at DB. No student-facing payments screen exists (only the admin `/dashboard/payments` route references payments) — CONFIRMED.

### Documents & exports
- **Student roster** print / Word (.docx, real OOXML, RTL-aware) / PDF — `roster-export.ts`, `roster-print-document.tsx`, `student-roster-export.tsx`, `roster-model.ts` — scoped by whatever the caller can already read — admin, teacher — CONFIRMED.
- **Teacher roster export** — `teacher-roster-export.tsx`, `teacher-roster-model.ts` — admin — CONFIRMED.
- **CSV export** with formula-injection escaping — `lib/export-csv.ts` — CONFIRMED.

### Branding & public site
- **Admin identity screen** — `features/branding/branding-settings.tsx` (Paramètres → Identité visuelle) — admin — CONFIRMED.
- **Public school landing** — `routes/index.tsx`, `marketing/components/school-sections.tsx` — reads 13 anon-granted columns of `center_settings` — CONFIRMED.
- **SSR branding** — root loader calls `getPublicSchoolFn` (publishable key) and seeds `BrandProvider`, so first paint is branded — CONFIRMED.

### Other
- **Notifications** — `notifications` table, `notification-bell.tsx`, `features/school/notifications.ts` — kinds: registration approved/rejected, chapter/resource published (fan-out to enrolled students, deduplicated), `attendance_marked` (enum + i18n exist, **nothing emits it**) — CONFIRMED.
- **Student notes** (teacher/admin private notes on a student) — `student_notes`, student detail page — CONFIRMED.
- **Profile + avatar upload** — `dashboard.profile.tsx`, `features/profile/*`, `avatars` bucket — CONFIRMED.
- **Global search** — `components/layout/global-search.tsx` — CONFIRMED.
- **Level statistics** — `level-statistics.ts`, `dashboard.levels.tsx` — CONFIRMED.
- **Security headers + CSP** — `vite.config.ts` `nitro.routeRules` — CONFIRMED.
- **Coming soon (declared, not built):** `/dashboard/invoices`, `/dashboard/reports`, `/dashboard/security` (`comingSoon: true` in `config/navigation.ts`) — CONFIRMED placeholders.

---

## 5. Hidden / non-obvious functionality

Each: **what → where → why → what breaks if ignored.**

1. **`handle_new_user` trigger** → latest in `20260806190000` → on every `auth.users` insert creates profile + `student` role + `students` row, reads **no** metadata for authorisation; a post-condition block raises if a future version reads `raw_app_meta_data` or a `role` from user metadata → ignoring it: a "fix" that reads roles from metadata reopens self-registration as admin (ADR-001 P0-B).
2. **`private.provision_staff` / `private.grant_role`** → `20260806190000`, `20260806180000` → staff elevation replaces the provisional student identity (retires the empty `students` row only if `entity_is_deletable`) → calling `user_roles` inserts directly instead breaks the composite FK or leaves a stale student.
3. **Composite FK role integrity (ADR-002)** → `students.role` / `teachers.role` are `GENERATED ALWAYS` (`'student'`/`'teacher'`) with FK `(id, role) → user_roles(user_id, role)` → a students row for a non-student is unrepresentable, and a role cannot be revoked while its entity row exists → `authenticated` has no INSERT/DELETE on `students`/`teachers`; only service role creates them.
4. **Column-level UPDATE grants** on `students` (level, stream, status, gender, DOB, guardian, address, onboarded_at) and `teachers` (experience_years, bio, status) → `20260806180000` → adding a column does **not** make it editable by the client until granted.
5. **`private.entity_dependencies` severities** → `20260821090000` → `blocking` (history lost), `reassignable` (groups), `incidental` (cascades, e.g. teacher_subjects), `preserved` (audit_log, survives with email) → a DO-block asserts `audit_log` FKs are `ON DELETE SET NULL` and emails exist; `dependency-model.ts` names blocking severities **positively** → a rule "anything not incidental blocks" made deletion impossible once.
6. **Admin lock-out guard** → `private.assert_admin_removable` (+ service-role-only public wrapper) in `20260821110000` → refuses self-deactivation/deletion and removing the last admin who can sign in (counts `banned_until`) → documented non-atomic window: two admins deactivating each other simultaneously.
7. **Deactivation = GoTrue ban**, not a status column → `auth.users.banned_until` via `updateUserById({ban_duration})` → `teachers.status` is cosmetic; the ban is what blocks sign-in.
8. **Enrollment triggers on `registrations`** (order matters, `a_` prefix): `t_registrations_a_sync_academics` copies group subject/level onto the registration → `t_registrations_one_per_subject` + partial unique index `registrations_one_active_per_subject_level` (one pending/approved place per subject+level; rejected rows are history) → `t_registrations_capacity` (seat limit on approve) → `t_registration_decided` (notification). `t_groups_cascade_academics` keeps copies in sync when a group changes. Renaming triggers changes firing order.
9. **Eligibility** → `private.my_academic_identity()`, `private.can_join_group()`, `groups read` policy → students see and may request only active groups of their own level (and stream, if the group has one).
10. **Stream/level consistency** → `validate_stream_matches_level`, `require_stream_when_level_has_streams` triggers.
11. **One session per day** → `UNIQUE (group_id, weekday)` on `group_schedules` (`20260807140000`) → the foundation of `SessionKey`; `validate_attendance_occurrence` trigger refuses attendance on a date the group does not meet or outside its term window.
12. **Aggregate views with `security_invoker = true`** → `session_attendance_summary`, `group_enrollment_counts` (`20260808180000`), `resource_engagement`, `resource_student_engagement` (`20260812110000`) → migrations assert the option; a view without it would bypass RLS.
13. **Resource authority functions** → `can_manage_group`, `is_enrolled_in_group`, `can_view_resource`, `can_download_resource`, `can_record_resource_event` → RLS and the signing server fn share one rule.
14. **Publication notifications** → triggers `t_chapters_notify_publication`, `t_resources_notify_publication`, unique indexes `notifications_chapter_once` / `notifications_resource_once`; scheduled publication handled without a scheduler: the row is created at decision time with `notifications.deliver_at`, and the `notifications read` policy hides it until due (`20260812100000`) → re-publishing updates the pending row instead of spamming; filtering `deliver_at` in the client instead of RLS would leak upcoming material.
15. **Storage quota** → `center_storage_bytes()` sums `storage.objects` sizes in `course-resources` (not `resources` rows) → orphaned objects still count.
16. **Branding safety** → hex-only CHECKs on colours, https-only/`is_safe_asset_url` on URLs, `branding` bucket admin-only in `center/`, no SVG in public buckets → values are interpolated into CSS and `<img src>`.
17. **Anon column grant** → `20260813140000`: `anon` may SELECT **13 columns** of `center_settings` only; everything else in `public` is 401 for anon.
18. **Payments integrity (`20260930100100`)**: `recorded_by` defaults to `auth.uid()` and the insert policy requires `recorded_by = auth.uid()` **and an approved registration**; `registration_id` is **ON DELETE RESTRICT** (a registration/group/student carrying payments cannot be deleted — 23503); **column-level UPDATE** limits edits to amount, date, method, note, reference; trigger `t_payments_validate` refuses `paid_on` > tomorrow, CHECK refuses < 2000-01-01; trigger `t_payments_audit` writes `payment_recorded|updated|deleted` to `audit_log` (before/after on update, no-op updates skipped); view `payment_daily_totals` (security_invoker). Ignoring RESTRICT breaks any code that deletes groups/registrations with payments — delete payments first (see `scripts/e2e/fixtures.mjs`, `scripts/seed-demo-data.mjs`).
18a. **Self-service guards (`20261003100100`)** → `public.guard_self_service_columns()` (SECURITY INVOKER) on `students`, `teachers`, `profiles` → refuses, for `current_user = 'authenticated'` non-admins only: student status; student level/stream/`onboarded_at` once onboarded; teacher status; profile email → column grants cannot distinguish admin from owner, so the rule lives in one trigger with an admin bypass; service role and SECURITY DEFINER functions pass. Ignoring it: a new self-editable authorisation column must be added to this guard.
19. **CSRF middleware** for server functions re-registered in `src/start.ts`; `attachSupabaseAuth` sends the browser's bearer token to server functions; server fns additionally take `accessToken` in the body and verify it with `auth.getUser`.
19a. **PostgREST `max_rows` caps every response at 1000** (Supabase default). A `limit(N+1)` overflow probe silently fails above 1000; use `{ count: "exact" }` as `usePaymentLedger` does. Measured: `limit=1500` → `Content-Range: 0-999/2412`.
20. **Cache roots** → `schoolKeys.attendanceRoot = ["attendance"]`, `paymentKeys.root`, `resourceKeys.root` → one invalidation refreshes every consumer (three real stale-cache bugs led to this).
21. **Global query defaults** → `router.tsx`: `staleTime 60s`, `gcTime 5min`, no refetch on focus, retry only retriable errors.
22. **Error classification** → `lib/errors.ts`, `ErrorState`, `use-action-feedback.ts` → raw Postgres text is never shown to users.
23. **Local-date discipline** → `todayIso()` / `toLocalIso()` in `lib/format.ts`; never `toISOString().slice(0,10)`.
24. **Script guards** → `seed-demo-data.mjs` and `scripts/e2e/fixtures.mjs` refuse non-loopback URLs; e2e suites create/delete fixtures and must never target a hosted project.

---

## 6. Important data model

20 tables in `public`, all with RLS (19 verified on production at `32030b6` + `payments`).
Views: 4 (above). Buckets: `course-resources` (private), `avatars` (public), `branding`
(public).

| Table | Meaning | Key constraints / relations | RLS essentials | Deletion behaviour |
|---|---|---|---|---|
| `profiles` | one per auth user | PK → `auth.users` CASCADE; `locale` fr/ar/en; `password_change_required` | read: self, admin, teacher of own approved students, student reading teachers offered to them; update: self or admin | cascades from auth user |
| `user_roles` | authorisation source of truth | `UNIQUE(user_id, role)`; target of composite FKs | read self/admin; write admin | — |
| `students` / `teachers` | role-specific identity | PK → profiles; generated `role` + composite FK; `entity_status` active/inactive/suspended/archived | no client INSERT/DELETE; column-level UPDATE | students cascade → registrations, attendance, notes, resource_events |
| `level_systems` | level scales (Phase 3A) | `code` unique; `kind` school/cefr/training/custom; one built-in per kind | read: signed-in; write: admin (custom systems only; built-ins protected by trigger) | RESTRICT from levels and programs |
| `levels`, `streams`, `subjects` | academic reference data; **every level belongs to a level system** (`system_id`, `code`; `stage` = school stage, required for school levels only; streams and student levels must be school levels) | subjects `key` unique; `domain` CHECK (languages, school_subjects, computing, professional, other) | read all authenticated; admin write | |
| `teacher_subjects` | qualifications | PK (teacher, subject) | admin write | cascades |
| `groups` | a class | subject/teacher/level SET NULL; stream; capacity; `price_dzd` int; term window | staff read all; students read eligible/enrolled; admin write | **cascades** schedules, registrations, attendance, chapters, resources — **refused** (23503) if any registration carries payments |
| `group_schedules` | weekly slot | weekday 0–6; `UNIQUE(group_id, weekday)` | admin write | |
| `registrations` | a student's request for / place in a group, with its history | **`registrations_one_active_per_group`**: partial unique (student, group) over pending/approved only (the unconditional UNIQUE was dropped, `20261004100100`); denormalised subject/level; partial unique per subject+level; `withdrawn_at/by/withdrawal_reason` (CHECK: set iff withdrawn) | insert: admin (any state but withdrawn) or own + eligible + pending request only (SEC-01); update: admin; delete: admin, or the student's own pending request | refused while payments exist (RESTRICT) |
| `attendance` | marks | `UNIQUE(group_id, student_id, session_date)`; `marked_by` SET NULL | write: admin or group's teacher; read also own student | |
| `payments` | money received (a transaction) | → registrations **RESTRICT**; `amount_dzd > 0` int; method CHECK; note ≤ 500; `reference` 1–100 (cheque/transfer no.); `paid_on` ≥ 2000 and ≤ tomorrow | insert: admin + self as recorder + approved registration; update: admin, 5 columns only; delete: admin; student reads own; teachers none | every change audited |
| `fee_types` | kinds of fee (ADR-005) | `code` unique; 8 built-ins; `status` entity_status | read: signed-in; no client write | RESTRICT from charges |
| `charges` | what an enrollment owes | → registrations **RESTRICT**; → fee_types(code); `amount_dzd > 0`; `active`/`cancelled` + who/when/reason; `other` needs a label; partial unique (registration, type, label) while active | read: admin, student own; write: `save_charge` / `cancel_charge` only (admin, audited) | never deleted by clients — cancelled |
| `fee_templates` | a formation's default fees / a group override | program CASCADE; group CASCADE (must belong to the program); fee_type -> fee_types; schedule jsonb (months, amounts) CHECK-validated; active/archived | admin read; writes via RPC only | archived (not deleted) once charges came from it |
| `discounts` / `charge_discounts` | discount catalogue / grants on charges | grant amount frozen; sum of active grants <= charge (deferred); cancel with reason | admin read (student own grants); writes via RPC only | cancelled, never deleted by clients |
| `receipts` | one numbered receipt per payment (snapshot) | number unique; one issued per payment; void on payment edit/delete | admin + own student; no client write | kept forever (voided) |
| `rooms` | the institution's rooms | name unique; capacity 1-1000; active/inactive | read: signed-in; write: admin (RLS) | slots SET NULL |
| `official_documents` | numbered certificates (snapshot) | number unique; kind enrollment/attendance/payment; void with reason | admin + own student; writes via RPC only | voided, never deleted by clients |
| `invoices` | invoice snapshot per enrollment | number unique; lines/discounts jsonb; totals; issuer snapshot; void with reason | admin + own student; writes via RPC only | voided, never deleted by clients |
| `charge_installments` | the schedule of a charge | 1–24 per charge; `amount_dzd > 0`; `due_on` 2000–2100; UNIQUE (charge, position), (charge, due_on); deferred trigger: sum = charge, positions in due-date order | read with its charge; no client write | cascade from charge (service role only) |
| `student_notes` | staff notes | author → profiles CASCADE | admin or teacher of approved student | |
| `notifications` | in-app messages | user → profiles CASCADE | own read/update/delete | |
| `audit_log` | staff/account actions | actor/target SET NULL + emails kept; CHECK rejects password keys in details | admin read only; written by service role | never deleted by account deletion |
| `chapters`, `resources`, `resource_events` | course material & engagement | per group; `resources.group_id` synced by trigger | manage: `can_manage_group`; read: enrolled + published | cascade from group/chapter; **storage objects not removed** |
| `center_settings` | the school | singleton; hex/https checks | authenticated read; admin write; anon 13 columns | |

---

## 7. Domain relationships

```text
auth.users ─1:1─ profiles ─┬─ user_roles (1..n roles: admin | teacher | student)
                           ├─ students (only if role student)  ── level, stream
                           └─ teachers (only if role teacher)  ── teacher_subjects ── subjects

center_settings (single row = the school's identity)

levels ── streams
groups ── subject, teacher, level, stream, price_dzd, start/end_date
  ├── group_schedules (≤ 1 per weekday)      ⇒ derived Sessions (group_id, session_date)
  ├── registrations (student ↔ group, pending/approved/rejected)
  │     └── payments
  ├── attendance (group, student, session_date)   ← keyed on a Session
  └── chapters ── resources ── resource_events (student view/download)

notifications → a profile;  student_notes → student + author;  audit_log → actor/target (nullable)
```

---

## 8. Security knowledge

- **Trust boundary:** the browser talks to PostgREST directly with the publishable key and
  the user's JWT. **RLS is the primary enforcement layer.** Route guards (`RequireAuth`,
  render-time) and navigation filters are cosmetic.
- **Privileged operations** go through TanStack server functions using the service-role
  client (`client.server.ts`, `provisioning.server.ts`, `storage.server.ts`), each gated
  by `assertAdmin` (role read with the service client) or by evaluating a DB rule as the
  caller. Service-role key only in server env (Vercel), never `VITE_`.
- **SECURITY DEFINER functions** all pin `search_path`; most live in `private` (not exposed
  by PostgREST). Public-schema definer functions are either boolean checks
  (`can_*`, `is_enrolled_in_group`, `storage_quota_allows`) or service-role-only wrappers
  (`provision_staff`, `assert_admin_removable`, `set_teacher_lifecycle`, …).
- **School isolation** is physical: a separate Supabase project. There is no in-database
  tenant boundary and none should be added.
- **Sessions:** supabase-js default (tokens in `localStorage`). Cookie sessions were
  recommended in old docs but never adopted.

**If you change X, also review Y:**

| Change | Review |
|---|---|
| `handle_new_user` | its post-condition block, ADR-001/002, `provision_staff`, signup payload |
| `user_roles` writes | composite FKs, `grant_role` ordering, `assertAdmin`, `hydrate()` precedence |
| any `students`/`teachers` column | column-level UPDATE grants, generated `role` |
| any RLS policy using `registrations` | profiles/teachers/notes/notifications/groups policies that join through approved registrations |
| `registrations` delete/insert policy | payments RESTRICT, withdraw flow, capacity + one-per-subject triggers |
| `groups` delete | cascade to registrations, attendance, resources, orphaned storage objects; blocked by payments (RESTRICT) |
| audit_log FKs | DO-block in `20260821090000` (will raise), `entity_dependencies` |
| a new view | must be `security_invoker = true` (+ explicit staff filter if aggregate) |
| storage policies | `can_view_resource`/`can_download_resource`, `storage.server.ts` |
| `center_settings` columns | anon 13-column grant, BrandProvider, SSR loader, CSP |
| CSP / embeds | `vite.config.ts` and `link-provider.ts` allow-list together |

---

## 9. Architectural decisions

| Decision | Why | Prohibits | Affects |
|---|---|---|---|
| **README scope:** one deployment, one DB, one school; no multi-tenancy here | isolation is why the repo exists | adding `tenant_id`, multi-school features | everything |
| **ADR-001** (status *Proposed*): trigger owns only the invariant; roles decided server-side; never trust `user_metadata`; staff are admin-provisioned | P0 escalation findings | client-supplied roles; staff self-registration | auth, provisioning. Its §4 multi-tenancy recommendation is **superseded for this repo by the README** |
| **ADR-002** (Accepted): composite FK `(id, role) → user_roles`, `GENERATED ALWAYS` discriminator; generic `entity_dependencies` / `entity_lifecycle` | invalid identity must be unrepresentable | validation triggers for this, wide users table, client inserts into entity tables | students/teachers, provisioning, deletion |
| **ADR-003** (Accepted): Session = derived `(group_id, session_date)`; no sessions table; modules own their tables/hooks; `SessionInstance` never widened; aggregates as `security_invoker` views; windowed cache keys carry both ends | one key, one place to change | re-deriving the key inline; adding module data to the spine | attendance, calendar, future session modules |
| **ADR-003 exclusions** (exams/grades/evaluations) — **superseded by ADR-004**; parent portal still not planned | product direction 2026-10-01 | — | roadmap |
| **ADR-004** (Accepted 2026-10-03): Formation (`programs`) → Group → Registration; subject optional, not a parent; level systems owned by the formation with an effective copy on the group; enrollment lifecycle with partial uniqueness; students keep an auth identity, portal access is an admin-held state; separate `applications` table via a server function; no table renames | review of 2026-10-03 | renaming tables; subject as mandatory parent; applications inside `registrations`; hard-coded minor age | every Formation/Group/Enrollment phase |
| Programme above groups; capacity/teachers derived, no price column | one source of truth per fact; billing designed later | storing programme capacity or teachers; a programme price column; replacing groups | groups, future Fee Types |
| Money is admin-only; teachers see no payments | privacy | teacher payment reads | payments RLS |
| Balance derived, never stored; refunds are not negative payments | single source of truth | stored balances, negative amounts | payments |
| **ADR-005** (Accepted 2026-10-06): charges belong to the enrollment; fee types are data; installments sum exactly (deferred check); cancel, never delete; writes only through audited admin RPCs; no payment allocation (display coverage oldest due first) | owed vs paid kept apart; history kept | treating a payment as a fee; tying a payment to an installment without an allocation model; client writes to charges | fees, payments, student page |
| Deactivation via GoTrue ban | the field GoTrue actually checks | status-column-only deactivation | teachers, admins |

---

## 10. Do-not-break rules

- Do not introduce multi-tenancy or a `school_id` into this repository.
- Desktop offline cache (`src/features/desktop/`): keep `OFFLINE_CACHE_MAX_AGE` (the
  persister's `maxAge` AND the desktop `gcTime`) at or below `MAX_TIMER_DELAY` (2^31-1 ms,
  ~24.8 days). A longer `gcTime` overflows `setTimeout`, fires at once and deletes every
  restored query after an offline restart (the 30-day bug, fixed 2026-10-14; regression tests in
  `offline-model.test.ts`). And keep `gcTime: Infinity` when `window` is undefined in the
  desktop build (`router.tsx`): the build prerenders the start page in Node, and a valid long
  timer keeps the build process alive.
- Links that leave the app (e-mail redirects, copied registration links) are built with
  `publicUrl()` / `publicOrigin()` (`src/lib/desktop.ts`, rules in `src/lib/public-url.ts`), never
  from `window.location.origin`: inside the desktop app that is `http://tauri.localhost`. Desktop
  builds use the web deployment (`VITE_SERVER_ORIGIN`). A test in `public-url.test.ts` fails if a
  file other than `lib/desktop.ts` reads `location.origin`. (Fixed 2026-10-15.)
- Desktop offline cache is saved only while a user is signed in (`persistClient` gated on
  `readCachedUser()`); sign-out clears the saved user BEFORE clearing the cache, so no later
  save can recreate it. Verified by `verify-desktop-offline.mjs` (16/16).
- Do not point this repo, `.env`, or the Supabase CLI at any other project ref.
- Do not read roles from `raw_user_meta_data`; do not send a role from the client.
- Do not insert into `students`/`teachers`/`user_roles` except via `provision_staff`/`grant_role`.
- Do not create views without `security_invoker = true`.
- Do not bypass RLS from the browser; never expose `SUPABASE_SERVICE_ROLE_KEY` (no `VITE_` prefix, never in a committed file).
- Do not weaken audit_log `ON DELETE SET NULL` or delete audit rows.
- Do not re-derive `SessionKey` inline; use `session/session-key.ts`.
- Do not add a parent portal (ADR-003). Evaluations/grades are in scope (ADR-004) but must key on academic periods once they exist.
- Do not rename `programs`/`groups`/`registrations`; change UI labels only (ADR-004 §2).
- Do not add new single-teacher/single-subject assumptions beyond reading `groups.teacher_id`/`subject_id` (ADR-004 §8).
- Do not store derived state (session status, payment balance).
- Do not use `toISOString().slice(0, 10)` for dates.
- Do not hardcode the school's name, colours or logo in components; use `useBrand()`.
- Do not hardcode colours; use tokens (`styles.css`). Use logical CSS (`inline-start`) for RTL.
- Do not add strings without fr, ar and en.
- Do not rewrite published git history (README LOVABLE block / AGENTS.md).
- Do not run `seed-demo-data`, e2e suites or local provisioning scripts against production.
- Do not assume absence of UI means absence of backend capability (e.g. student payments read, `entity_dependencies('student')`).

---

## 11. Existing patterns to reuse

| Pattern | Example | Why |
|---|---|---|
| Query/mutation hooks with a key registry and a root key | `queries.ts` `schoolKeys`, `payments.ts` `paymentKeys`, `resources/queries.ts` `resourceKeys` | one invalidation refreshes all consumers |
| Per-domain data modules | `payments.ts`, `resources/queries.ts` separate from `queries.ts` | keep the shell light |
| Pure model + `node --test` unit tests | `payment-model.ts`, `roster-model.ts`, `session/status.ts`, `dependency-model.ts` | testable without a DB |
| Privileged server function | `*.functions.ts` (zod validator, dynamic import of `*.server.ts`, stable error codes) → `*.server.ts` (`assertAdmin`, service client, audit) | keeps service role out of the client bundle |
| DB rule evaluated as the caller, action as service role | `storage.server.ts` `signResource` | one authority for RLS and server |
| Guards that RAISE, not return booleans | `assert_admin_removable` | callers cannot ignore them |
| Migrations with header rationale + post-condition DO blocks | most migrations since `2026-08-06` | loud failure on partial apply |
| Enum value added in its own migration | `*_enums.sql` before use | Postgres `55P04` |
| Friendly errors | `lib/errors.ts`, `ErrorState`, `useActionFeedback` | no raw SQL text to users |
| Shared UI blocks | `components/common/*` (DataTable, ConfirmDialog, EmptyState, PageHeader, StatusBadge) | consistency |
| Roster/export scoped by caller data | `student-roster-export.tsx` | no re-implemented authorisation |
| Branding via hook | `useBrand()`, `BrandProvider`, `lib/brand.ts` | school = configuration |

---

## 12. Important edge cases

| Scenario | Current behaviour | Remember |
|---|---|---|
| Student withdraws a PENDING request | row DELETED (student flow unchanged) | an APPROVED place ends with status `withdrawn` (admin action), never a delete |
| Student DELETEs an approved or rejected registration over the API | **refused** (0 rows) by the delete policy since `20260930110000`; RESTRICT also refuses it when payments exist | only pending requests are withdrawable |
| Student INSERTs a registration with `status: 'approved'` (or a decision date/note) | **refused (42501)** since `20261003100000` (SEC-01) | regression in `verify-enrollment-security.mjs` |
| Transfer between groups of same subject | reject old, approve new (partial unique ignores rejected) | |
| Group with zero enrolments | session status `empty`, never `overdue` | |
| Group deleted | cascades registrations, attendance, chapters, resources; refused if payments exist (shown as "in use"); storage files orphaned | |
| Chapter deleted with `cascade` | resource rows go, storage objects stay and still count toward the 5 GB quota | |
| Teacher who took attendance / wrote notes | cannot be deleted (blocking); archive instead | |
| Suspended teacher | status set by RPC, then ban applied; the ban call's error is not checked | §15 |
| Admin deactivates self / last admin | refused in DB | two-admin race not closed |
| Staff with forced password change | enforced by UI; the user can clear `password_change_required` on their own row (needed by change/reset-password) | low risk (only affects themselves) |
| Student edits own level/stream/status after onboarding | **refused (42501)** by `t_students_guard_self_service` (`20261003100100`, SEC-02); allowed while `onboarded_at` is NULL (the wizard) and for admins/service role | `verify-self-service-guards.mjs` |
| Teacher sets own `teachers.status`; any user changes `profiles.email` | **refused (42501)** by the SEC-02 guards; admins and server functions unaffected | `verify-self-service-guards.mjs` |
| Arabic dates | Latin digits, `Intl`-based | `lib/format.ts` |
| SSR `<html lang="fr" dir="ltr">` | hardcoded; client corrects after hydration | brief LTR flash for Arabic |

---

## 13. Existing features easily missed

- Server functions exist and are used (`admins.functions.ts`, `provisioning.functions.ts`, `storage.functions.ts`, `branding.functions.ts`) — older docs claim there are none.
- `entity_dependencies` handles `student`; no UI uses it yet.
- Students can read their own payments at the DB level.
- `session_attendance_summary` and `group_enrollment_counts` views.
- Resource engagement views and panel; publication notifications with dedupe.
- Storage quota functions and per-file limit.
- `password_change_required` + `/change-password`.
- Teacher lifecycle states `suspended`/`archived`; `teacher_workload()`; `teacher_deletion_blockers()`.
- `/dashboard/teacher` exists only as a redirect (kept for bookmarks/notification links).
- `scripts/`: one-off operational scripts of the earlier deployment (staff provisioning with named accounts, password resets, group cleanup) were deliberately NOT carried into this repository (2026-10-14 clean copy).
- `supabase/snippets/`, rehearsal SQL under `scripts/e2e/rehearse-*`.

---

## 14. Features that do not exist by design

| Excluded | Evidence | Do not reintroduce unless… |
|---|---|---|
| Multi-tenancy / multiple schools per deployment | README "none is planned in this repository"; fork commit | the README scope is formally changed |
| ~~Exams, grades, evaluations~~ | **No longer excluded** — ADR-004 supersedes ADR-003's exclusion | — |
| Parent portal | ADR-003 header | a superseding ADR |
| Stored sessions table / stored session status | ADR-003 §2, §3.2 | ADR-003 reopened |
| Teacher access to payments | payments migration comment + policies | explicit product decision |
| Negative payments as refunds | payments migration | a refund model is designed |
| Seat counts / prices on student catalogue cards | commits `18eb7c5`, `30a1a14` (seat counts needed a migration that was never written — `docs/enrollment-seat-counts.md`) | INFERRED as a product choice; confirm |

---

## 15. Current state

**Implemented:** see §4. Typecheck passes; 283 unit tests pass (run 2026-09-30).

**Placeholders:** invoices, reports, security (`comingSoon`).

**Deferred (ADR-003 §8.2):** cancelled sessions / holidays (`session_exceptions`), two
sessions per day, `attendance_marked` notifications, report folding onto the spine,
`teacher-workspace.ts` consolidation.

**Confirmed open issues:**
1. ~~Student can delete own approved registration~~ — FIXED by `20260930110000`: the student branch of `registrations delete` requires `status = 'pending'` (approved and rejected rows are refused); asserted by `verify-enrollment-security.mjs`.
2. ~~Student can self-insert an `approved` registration~~ — FIXED by `20261003100000` (SEC-01): the student branch of `registrations student insert` requires `status = 'pending'`, `decided_at IS NULL`, `note IS NULL`; asserted by `verify-enrollment-security.mjs` (31 checks).
2a. **`students.status` gates nothing** (inactive students can still sign in and request places). Self-editing it is now refused (SEC-02, `20261003100100`); giving it an effect is the student-management phase (ADR-004). Also: students can no longer change level/stream after onboarding, and nobody but an admin changes `profiles.email`.
3. ~~Payment ledger query selects `students.full_name`~~ — FIXED 2026-09-30 (confirmed 42703 before; the query now embeds `profiles`, asserted by `verify-payments.mjs`).
4. ~~Group deletion silently destroys payments~~ — FIXED by RESTRICT. The confirmation copy explains that payments block deletion, and a refused delete shows `entity.groups.deleteBlockedByPayments` (`useDeleteGroup` now rethrows the Supabase error so `code` 23503 survives).
5. **Orphaned storage objects** after chapter/group cascade; they still consume quota. CONFIRMED by code.
6. **`setTeacherLifecycle` ignores the ban call's result**; suspension could succeed in DB while sign-in still works. CONFIRMED by code.
7. **First administrator bootstrap — documented (2026-10-14):** sign-up always creates students; the first admin is created in the Supabase dashboard (Add user) and elevated with `select private.provision_staff(<id>, 'admin')` (DEPLOYMENT.md §5). Verified on the local stack in a rolled-back transaction. CONFIRMED.
8. Allow-download is not a hard boundary: the storage read policy lets any viewer of a published resource read the object directly. INFERRED.
9. Unbounded list queries — **partly fixed (Phase 4, 2026-10-04):** `useGroups` now reads `group_enrollment_counts` + only its teachers' profiles; `useRegistrations` embeds names (no profiles scan) but is still one capped read for its dashboard/statistics consumers (teacher workspace, my-students, level statistics, students pages, global search, admin overview); enrollment management uses bounded hooks (`useGroupRegistrations`, `useRegistrationQueue` + `useRegistrationCounts`, `useStudentSearch` ≤ 20). Remaining: `useStudents`, `useRegistrations` consumers, attendance range/report.
10. SSR `lang`/`dir` hardcoded; all locales eagerly bundled. CONFIRMED.

**Deployment state:** production DB had 40/40 migrations at `32030b6` (2026-08-14). Three
later migrations — `20260820100000_student_payments`, `20260821090000_audit_never_blocks_deletion`,
`20260821110000_admin_lifecycle` — **UNKNOWN / REQUIRES VERIFICATION** on production. The
payments page and admin deactivate/delete depend on them. Local `main` = `origin/main` =
`4a8c5a9`. Whether Vercel has deployed `4a8c5a9`: UNKNOWN.

**Stale documentation:** see §15d.

---

## 15a. UI / design system

All CONFIRMED from `src/styles.css`, `components.json`, `src/lib/brand.ts`.

- **Stack:** Tailwind CSS v4 (CSS-first; **no `tailwind.config.*`** — tokens live in
  `@theme inline` in `src/styles.css`), `tw-animate-css`, shadcn/ui style `new-york`,
  base colour slate, Radix primitives, `lucide-react` icons.
- **Tokens** (`:root` in `styles.css`, oklch with hex comments): `--background #F8FAFC`,
  `--foreground #0F172A`, `--primary #0F766E` (the product's teal), `--secondary #14B8A6`,
  `--accent #F59E0B` (**means "pending/awaiting decision"**, not decoration),
  `--success #10B981`, `--destructive #EF4444`, `--border #E2E8F0`, `*-soft` tints, sidebar
  set, chart-1..5, `--radius: 1rem` with sm…4xl derived, shadows `soft/card/elevated/glow`,
  gradients `brand/surface`.
- **Brand overlay:** `brandCssVariables()` in `lib/brand.ts` overrides only
  institution-meaning tokens at runtime — `--primary`, `--primary-foreground` (computed
  contrast), `--primary-soft` (`color-mix`), `--ring`, sidebar primary/accent — plus
  `--brand-gold`/`--brand-gold-soft`. Emitted as `<style data-brand-tokens>` during SSR
  (`__root.tsx` loader → `getPublicSchoolFn` → `BrandProvider`). Unbranded = the product's teal.
  `--brand-gold` is a decorative material, **deliberately separate from `--accent`**.
- **Typography:** Inter (Latin), Cairo (Arabic, applied under RTL), loaded from Google Fonts
  in `__root.tsx`. Tokens `--font-sans`, `--font-arabic`, `--font-display`.
- **Surface utilities** (use these, don't re-invent cards): `surface-card`, `surface-hero`
  (the ONE elevated surface per page), `surface-panel`, `surface-row`, `surface-alert`
  (3px `border-inline-start` marker), `surface-done`, `surface-action`, `surface-live`,
  `focus-ring`, `bg-gradient-brand`, `text-gradient-brand`; motion `animate-rise`,
  `animate-float*`, `reveal`; landing `glass-panel`, `hero-glow`, `grid-backdrop`. All
  motion collapses under `prefers-reduced-motion`.
- **Print:** `@media print` rules in `styles.css` for roster documents (ink, not brand colour).
- **Dark mode:** `.dark` palette defined; **no toggle exposed** (comment in `styles.css`).
- **Shared components (never duplicate):** `components/common/*` — `DataTable` (search,
  sort, error branch), `PageHeader`, `SectionCard`, `StatCard`, `StatusBadge`,
  `EmptyState`, `ErrorState`, `FullPageLoader`, `ConfirmDialog`, `Brand`,
  `LanguageSwitcher`; `components/layout/*` — `AppSidebar`, `DashboardTopbar`,
  `GlobalSearch`, `NotificationBell`; `features/profile/person-avatar.tsx` (the one avatar);
  `features/school/components/registration-card.tsx` / `group-card.tsx` (one shared
  enrolment card); `features/school/resources/resource-thumb.tsx`.
- **Layouts:** `layouts/public-layout.tsx` (landing), `auth-layout.tsx` (split panel with
  brand gradient), `dashboard-layout.tsx` (sidebar + topbar). Dashboard children are wrapped
  in `RequireAuth` → `RequireOnboarding` → `RequirePasswordChange` (`routes/dashboard.tsx`).
- **Navigation:** single source `config/navigation.ts` (role filters, `comingSoon`).
- **i18n / RTL:** `lib/i18n/` — fr (default), ar (rtl), en; flat keys in `dicts/*.ts`;
  `I18nProvider` sets `document.documentElement.lang/dir`; `LocaleSync` persists to
  `profiles.locale`, guests use `localStorage` key `gestion-ecole.locale` (the legacy `madrasti.locale` is read once and moved). Directional styling
  uses logical utilities (48 uses) or explicit `ltr:`/`rtl:` pairs (16 uses, all paired).
- **Hard-coded visuals:** only 6 hex literals outside `ui/`/`brand.ts`, all the product's
  teal `#0F766E` as the default **subject colour** (`dashboard.subjects.tsx`,
  `dashboard.groups.tsx`) or in the branding form — data defaults, not styling.
- **Where a UI change belongs:** palette/shape → `styles.css` tokens; school identity →
  `center_settings` via the admin screen (never code); a repeated surface → the `surface-*`
  utility; a table/list look → `DataTable`; menu → `navigation.ts`; primitives → `components/ui`
  (vendored shadcn, 46 files, ~23 unused per `docs/COMPONENTS.md` — INFERRED still roughly true).
- Mobile: `use-mobile.tsx`, sidebar sheet on small screens; tap-target sizes were measured in
  resources phase 5 (`verify-resources-touch-targets.mjs`).

## 15b. Route map (from `src/routes/`)

Public: `/` landing (branded, SSR) · `/login` · `/register` (student signup) ·
`/forgot-password` · `/reset-password` · `/change-password` (forced change) ·
`/onboarding` (student academic identity).

`/dashboard` layout (auth + onboarding + password-change guards). Roles as declared by
`RequireAuth` in each file:

| Path | Roles | Purpose |
|---|---|---|
| `/dashboard` | any | role-dispatched overview (admin/teacher/student) |
| `/dashboard/teacher` | — | `beforeLoad` redirect to `/dashboard` (legacy links) |
| `/dashboard/students`, `/students/$studentId` | admin; detail admin+teacher | roster, detail, notes, exports |
| `/dashboard/teachers`, `/teachers/$teacherId` | admin | provisioning, lifecycle, deletion |
| `/dashboard/subjects`, `/levels`, `/groups` | admin | academic structure |
| `/dashboard/groups/$groupId` | admin, teacher | group detail, roster, export |
| `/dashboard/registrations` | admin | approve / reject |
| `/dashboard/attendance`, `/attendance-report` | admin, teacher | session calendar, report |
| `/dashboard/resources` | admin, teacher | chapters & resources |
| `/dashboard/lesson-log`, `/assessments`, `/grades`, `/progression` | admin, teacher | Pédagogie (ADR-008), `?group=` / `?period=` |
| `/documents/report-cards?period=&student=` | admin, teacher | printable report card |
| `/dashboard/news`, `/news/$postId`, `/dashboard/messaging` | every role | Actualités, Messagerie (ADR-009) |
| `/dashboard/email-sms`, `/dashboard/reminders` | admin | E-mail & SMS outbox, Rappels & alertes |
| `/dashboard/payments` | admin | ledger |
| `/dashboard/pricing` | admin | Formations & tarifs (formations and groups without formation, CSV) |
| `/dashboard/rooms` | admin | Salles |
| `/dashboard/timetables` | admin | Emplois du temps (`?view=&id=`) |
| `/dashboard/official-documents` | admin | Documents officiels |
| `/dashboard/statistics` | admin | Statistiques |
| `/documents/timetables`, `/documents/certificates/$documentId`, `/documents/reports` | admin (certificates: also own student) | printable documents |
| `/dashboard/balances` | admin | Soldes & impayés |
| `/dashboard/discounts` | admin | Remises & bourses |
| `/dashboard/receipts` | admin | receipts list |
| `/dashboard/invoices` | admin | invoices list, billing identity |
| `/dashboard/reports` | admin | financial reports |
| `/documents/receipts/$receiptId`, `/documents/invoices/$invoiceId` | admin, own student | printable documents (outside the dashboard layout) |
| `/dashboard/programs`, `/programs/$programId` | admin | programmes; one programme and its groups |
| `/dashboard/settings` | admin | settings + branding |
| `/dashboard/users` | admin | all accounts, admin lifecycle |
| `/dashboard/my-groups`, `/my-students` | teacher, admin | teacher views |
| `/dashboard/my-classes`, `/schedule`, `/my-attendance`, `/my-resources` | student | student views |
| `/dashboard/registration`, `/registration/success/$id`, `/my-registrations` | student | catalogue & requests |
| `/dashboard/profile` | any | profile & avatar |

Navigation-only placeholders (no route file): `/dashboard/invoices`, `/reports`, `/security`.
`docs/ROUTES.md` is OUTDATED (lists `/dashboard/student`, marks payments/users as coming soon).

## 15c. Testing

- **Unit:** Node's built-in `node --test` with TypeScript type stripping (Node ≥ 22; v24 here).
  15 `*.test.ts` files, **283 tests, all passing** (`npm run test:unit`, 2026-09-30). No DB
  needed. Pure modules only (anything importing `@/` aliases cannot be loaded by
  `node --test` — commit `85f6276`).
- **E2E / integration:** 39 `scripts/e2e/verify-*.mjs`; 23 use `playwright-core` with the
  cached Chromium; others hit PostgREST/SQL directly. All need the **local stack** and
  `.env.local` (service-role key); `*-ui` suites also need the dev server (`APP_URL`, default
  8080; four suites hard-code 5173). Only `npm run test:e2e:session` (4 suites) is wired in
  `package.json`. Security suites: `verify-role-integrity`, `verify-enrollment-security`,
  `verify-payments`, `verify-admin-lifecycle`, `verify-teacher-deletion`.
- **CI:** none (no `.github/`). CONFIRMED.
- **Known untested:** storage orphaning. (Student self-approval is now refused and tested — `verify-enrollment-security`; enrollment lifecycle — `verify-enrollment-lifecycle` 30, `verify-enrollment-admin-ui` 13.)

## 15d. Documentation classification

- **Current (rewritten for the clean copy, 2026-10-14):** `README.md`, `LOCAL_SETUP.md`,
  `DEPLOYMENT.md`, `docs/local-demo-data.md`, sections 1–1b of this file.
- **Current:** `AGENTS.md`, the ADRs (`docs/ADR-001`…`ADR-009`), `docs/MASTER_ROADMAP.md`,
  migration header comments, the rest of this file.
- **Current but superseded in part:** `docs/ADR-001` (multi-tenancy advice overridden: one
  installation per school).
- **Stale (pre-fork platform state, 2026-08-02/03):** `TECH_DEBT.md`, `docs/SECURITY.md`,
  `docs/ROUTES.md`, `docs/ROADMAP.md`, `docs/KNOWN_ISSUES.md`, `docs/PERFORMANCE.md`,
  `docs/COMPONENTS.md`.
- **Historical records by design:** `docs/SECURITY_RELEASE_001_analysis.md`,
  `docs/ATTENDANCE_PRODUCTION_AUDIT.md`, `docs/enrollment-seat-counts.md` (open proposal,
  never migrated).
- **Not in this repository** (kept in the archived earlier repository; older documents still
  cite them): `PHASE_*_REPORT.md`, `RESOURCE_MODULE_*.md`, `TEACHER_PROVISIONING_REPORT.md`,
  `SELF_HOSTING_MIGRATION_PLAN.md`, `docs/DATABASE.md`, `docs/PROJECT_ARCHITECTURE.md`.
- `src/routes/README.md` is generic TanStack routing convention guidance.

---

## 16. Change impact map

| If changing… | Also inspect… |
|---|---|
| Student model | column grants, composite FK, onboarding, eligibility (`my_academic_identity`), registrations, attendance, notes, roster exports, level statistics |
| Teacher lifecycle | `set_teacher_lifecycle`, `entity_lifecycle`, ban calls, `entity_dependencies`, `dependency-model.ts`, groups `teacher_id`, audit enum values |
| Admin management | `assert_admin_removable`, `active_admin_count`, `admins.functions.ts`, `hydrate()` precedence |
| Registrations | 4 triggers + order, partial unique index, RLS (insert/delete), payments cascade, notifications, every policy joining approved registrations, `group_enrollment_counts` |
| Programmes | `program-model.ts`, `programs.ts`, `groups.program_id` (RESTRICT) + both consistency triggers, Groups form (`toDraft` must carry `programId` — the save sends `program_id` explicitly), `useGroups` embed `programs(name)`, `verify-programs.mjs` |
| Payments | `payments.ts` embed (`LEDGER_SELECT`, duplicated in `verify-payments.mjs`), `payment-model.ts`, RESTRICT on registrations/groups, column grants, audit trigger, `payment_daily_totals`, RLS (no teacher), `verify-payments.mjs`, `types.ts` (hand-edited for `reference` + view) |
| Groups | schedules (one per weekday), qualifications trigger, stream triggers, cascade academics, capacity, sessions spine, resources, deletion cascade |
| Attendance | `validate_attendance_occurrence`, summary view, `attendanceRoot` invalidation, drawer changed-only saves |
| Resources | storage policies, `can_*` functions, signing server fn, quota, publication triggers, engagement views, CSP frame-src + `link-provider.ts` |
| Authentication | `handle_new_user`, `hydrate()`, `RequireAuth`, `require-onboarding`, password-change flow, server-fn token passing |
| Branding | `center_settings` checks, anon 13-column grant, SSR loader, BrandProvider, CSP img-src |
| i18n | three dictionaries, RTL logical CSS, `formatDate` |

---

## 17. Before-you-code checklist

1. Read README scope, ADR-002, ADR-003 (and ADR-001 context).
2. Search `src/` **and** `supabase/migrations/` for the capability (grep function, table, i18n key).
3. Check this file §4, §5, §13, §14.
4. Check RLS policies (latest definition wins — grep `create policy "<name>"` across migrations) and column grants.
5. Check triggers on the affected tables and their order.
6. Check existing hooks/query keys before adding a new fetch.
7. Check `scripts/e2e/verify-*.mjs` and `*.test.ts` for the area.
8. Confirm the target Supabase project: the app uses `.env.local` (local, 55321); the CLI is
   linked to **production** (`supabase/.temp/project-ref`). Check §1a/§1b.
9. Identify every workflow affected (§16).
10. Only then propose an implementation.

---

## 18. Instructions for future AI coding agents

- **Before changing code:** verify against code and migrations, not docs dated 2026-08-02/03.
  Reuse `components/common`, the key registries and the server-function pattern.
- **Before adding a feature:** grep for existing tables/functions/i18n keys; check §14 and
  ADR-003's exclusions; check `navigation.ts` for a `comingSoon` entry already reserved.
- **Before modifying the database:** new migration only (never edit applied ones); timestamp
  after `20260821110000`; add post-condition checks; split enum additions; rehearse on the
  local stack (553xx, `supabase db reset` without `--linked`). **The CLI is already linked
  to production** — `supabase db push` goes live; only run it with explicit user approval.
- **Before modifying RLS:** find the latest definition of that policy; list every policy
  that joins through the table; confirm table GRANTs exist (RLS does not grant access —
  the payments feature broke on exactly this); test as each role over HTTP.
- **Before deleting data/models:** follow FK cascades (§6); run `entity_dependencies`; never
  delete audit rows; remember storage objects are not cascaded.
- **Before creating an abstraction:** check `session/`, `resources/`, `lib/`, `hooks/`,
  `dependency-model.ts`; ADR-002 already provides generic lifecycle/dependency services.
- **Before proposing a roadmap item:** exclude multi-tenancy and the parent portal (exams,
  grades and evaluations exist since ADR-008); distinguish generic product ideas from one school's needs.

---

## 19. Verified vs unknown

### CONFIRMED KNOWLEDGE
- Local development runs on Docker + the Supabase CLI stack on ports 553xx; the app reads `.env.local`; local DB has all 43 migrations, the school's branding row and the demo accounts (2026-09-30).
- The Supabase CLI in this folder is linked to production.
- One installation per school; no multi-tenancy; no project ref committed.
- 43 migrations; 20 public tables; 4 security-invoker views; 3 buckets.
- Three roles; composite-FK identity integrity; trigger assigns only `student`.
- Staff/admin/teacher operations via server functions with `assertAdmin` + service role.
- Payments table and RLS as described; registrations delete policy allows own delete of any status.
- `tsc --noEmit` passes; `npm run test:unit` → 283 passing tests (2026-09-30).
- Local `main` equals the local `origin/main` ref at `4a8c5a9` (2026-08-20; remote not re-fetched during the audit); no local commits since.

### UNKNOWN / REQUIRES VERIFICATION
- Whether the last three migrations are applied on production.
- Whether Vercel serves `4a8c5a9`.
- Whether the payment ledger query fails at runtime (static evidence says it should).
- Whether a student can insert an `approved` registration (static evidence says yes).
- Lint status (not run); full production build (not run); e2e suites (not run in this audit, although the local stack is available).
- Whether students changing their own level/stream after onboarding is intended.
- UI/UX behaviour in a real browser (not observed in this audit).

---

> **Maintenance rule:** This document is a development memory/reference, not the source of
> truth. When it conflicts with an accepted ADR, current implementation, database schema, or
> explicit architectural decision, verify the conflict and update this document rather than
> blindly trusting it.

**Last updated:** 2026-10-14 (clean copy into GES-ECOLE: identity, environment map, local
development and documentation classification rewritten; earlier content dates from 2026-10-04)
**Origin:** copied from the earlier single-school repository's working tree on 2026-10-14,
without its git history, school identity, credentials or operational scripts.
