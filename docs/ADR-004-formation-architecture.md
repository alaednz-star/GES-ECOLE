# ADR-004 — Formation architecture: offers, groups, enrollments, applications

| | |
|---|---|
| **Status** | Accepted (direction and engineering decisions). Product-policy values marked **[policy]** are set by the product owner. |
| **Date** | 2026-10-03 |
| **Supersedes** | ADR-003's exclusion of exams, grades and evaluations (the session architecture of ADR-003 is unchanged). The "no level outside school levels" assumption of `20260803120000`/`20260804100000`. |
| **Related** | ADR-001 (identity), ADR-002 (role integrity), ADR-003 (sessions), `docs/MASTER_ROADMAP.md`, the architecture review of 2026-10-03 |

## Context

Gestion École is becoming an institution-management platform for academic support centres, private
schools, language institutes, exam preparation, professional training and workshops. The schema
grew around one use case, a support centre teaching Algerian school pupils:

- `levels` are the 12 Algerian school years (`level_stage` NOT NULL).
- Student eligibility requires a school level (`private.can_join_group`, policy `groups read`).
- Onboarding requires a school level and a guardian for everyone (CHECK
  `students_onboarding_complete`).
- A registration requires an account: `registrations.student_id → students.id → profiles.id →
  auth.users.id`, and `handle_new_user` creates the student row only with an auth user.
- `UNIQUE(student_id, group_id)` holds regardless of status, so a rejected or withdrawn student can
  never return to the same group.
- A group has exactly one subject and one teacher.
- `programs` (2026-10-01) introduced the offer above groups, as an optional link.

The 2026-10-03 review compared this with a proposed Subject → Formation → Class → Enrollment model.
This ADR records what was adopted, what was changed, and why.

## Decisions

### 1. Domain model

```text
Subject (optional classification; drives teacher qualification)
Level System ─ Level (─ Stream, school system only)
        ╲ optional ╱
     Formation  (table: programs)   — what the institution offers
        │ 1..n
      Group     (table: groups)     — one delivery: teacher, places, weekly slots, room, term, stream
        │ 1..n
   Registration (table: registrations) — a student's place in a group, with its lifecycle
        │ 1..n                         ▲ converts
      Payment                        Application (future table) — intake without an account
```

- **Subject is not the parent of Formation.** Multi-subject offers (a Bac Sciences pack) and
  subject-less offers (workshops) are real. Subject stays a classification on the group, which the
  formation may optionally fix. This is today's `t_groups_program_consistent` rule, kept.
- **Subject domains (2026-10-04, `20261004130000`).** A subject has a domain: what it IS
  (`subjects.domain`: `languages`, `school_subjects`, `computing`, `professional`, `other`; a
  CHECK list like `programs.category`, no taxonomy table; `other` is also the explicit "not
  classified" state). The domain is NOT the formation type, which says what an OFFER is. The type
  only **filters** the subjects the formation form offers (`SUBJECT_DOMAINS_BY_CATEGORY`,
  `src/features/school/subject-domain.ts`): language → languages; academic support and exam
  preparation → school subjects + languages; professional training → professional + computing +
  languages (professional English is a real offer, e.g. the existing "ENG B2"); workshop and other
  → every domain. It is a form rule, deliberately not a database coupling: a formation keeps the
  subject it was saved with, reclassifying a subject never invalidates a formation, and the level
  system stays independent of both (a language subject does not force CEFR). Adding a domain =
  extend the CHECK, add its labels and its place in the map.
- **Formation types are institution-managed data (2026-10-05, `20261005100000`).** A formation
  type is the PURPOSE / educational context of an offer, distinct from its subject (what is taught),
  the subject's domain (what kind of discipline) and the level system (how progression is
  measured); none of the four is the parent of another. Types live in `formation_types(code UNIQUE,
  name, description, built_in, status active/inactive, position)`; `programs.category` is a
  foreign key to `formation_types.code`, so no formation row was rewritten. Built-in types
  (researched for Algerian private schools and centres): `formal_education` (Enseignement scolaire:
  regular schooling, preparatory to secondary), `academic_support`, `exam_preparation`,
  `language` (Cours de langues; code kept), `general_course` (Formation générale),
  `extracurricular` (Activités parascolaires), `professional_training`, `workshop`, `other`.
  Preparatory is a stage of schooling, not a type. Built-in types are translated by code and cannot
  be deleted, renamed or re-described (an institution with other words creates its own type and
  deactivates the built-in one). Custom types get a database-generated code (`custom_<slug>`),
  one display name shown in every language (as custom subjects and level systems), an optional
  description, and can be deleted while unused (FK RESTRICT). An inactive type stays valid,
  readable and editable on the formations that use it, but cannot be given to a new formation or
  switched to (`t_programs_type_active`). Admin-only writes (RLS); everyone signed in reads. The
  type still only filters subjects (built-in maps; custom types offer every subject) and suggests
  a level system (dropped when it does not fit the subject): it never forces one.
- **Level systems follow the subject's domain (2026-10-05, form rule).** The form order is name ->
  type -> subject (filtered by the type) -> level system -> level. A level system is offered only
  when it fits the subject's domain, or, without a subject, one of the domains the type offers
  (`LEVEL_SYSTEM_DOMAINS`, `isLevelSystemOffered`, `src/features/school/level-model.ts`):
  Algerian school -> school subjects and languages; CEFR -> languages only; Training -> computing,
  professional, other; custom systems -> any domain; "no specific level" -> always. So Mathematics
  never gets A1..C2 or training levels, and Marketing never gets school years. A chosen system
  that stops fitting after a subject or type change is cleared with an explanation; the type's
  proposal is dropped when it does not fit the subject. Form rule only, **not a database
  constraint**: an existing formation opens with its stored system while its subject and type are
  unchanged (with a notice if that combination is no longer offered) and still saves.
  (A short-lived 2026-10-04 attempt to rename `language` to `general_course` and order the form
  subject-first was reverted at the product owner's request before it was committed.)
- **Students enrol in a group, never directly in a formation.** A formation's places, teachers and
  enrolled counts are always derived (`summariseProgramGroups`), never stored.
- **Table names stay** (`programs`, `groups`, `registrations`). Renaming them would touch policies,
  triggers, types, routes and suites for no behavioural gain; only the UI wording changes.
- A formation may have zero groups (planning), one group (most short courses), or many. The UI
  shows a single-group formation as one unit and exposes the group list only from the second group.
- `groups.program_id` stays nullable until existing standalone groups have been organised into
  formations through an admin-confirmed assistant (never a silent migration). NOT NULL is decided
  only after that.

### 2. Vocabulary

| Concept (table) | fr | ar | en |
|---|---|---|---|
| Formation (`programs`) | Formation | تكوين | Course |
| Group (`groups`) | Groupe | فوج | Group |
| Registration (`registrations`) | Inscription | تسجيل | Enrollment |
| Application (future) | Demande d'inscription | طلب تسجيل | Application |

- Arabic uses **فوج** everywhere. The current mix of "الأفواج" (menu) and "المجموعات"
  (`entities.ts`) is corrected in Phase 1.
- **"Classe" / "قسم" is reserved** for a future private-school section (see 8). Using it for
  single-subject groups now would collide with that concept.

### 3. Level systems

```text
level_systems (id, key, kind: school | cefr | training | custom, name i18n, built_in, status, position)
levels        (+ system_id NOT NULL after backfill, code; stage meaningful only for kind = school)
streams       unchanged — exist only under school-system levels
programs      (+ level_system_id; NULL = "no specific level"; level_id must belong to that system)
groups        level_id = the EFFECTIVE level (copied from the formation when it names one)
students      level_id / stream_id = school academic identity only
```

- **Built-in systems:**
  - Algerian school: the existing 12 levels, backfilled, with stages and streams;
  - CEFR: A1–C2;
  - Training: Beginner, Intermediate, Advanced.

  They are read-only for admins. Custom systems are created only when needed.
- **Ownership:** the formation owns the system and the level. The group keeps an effective copy,
  enforced by trigger in both directions (as today), because registrations
  (`sync_registration_academics`), the one-place rule, eligibility and level statistics all read
  the group's level. The formation is the source of truth whenever it names a level.
- **Stream** belongs to the group (one Bac formation can run one group per stream).
- The school system keeps its special behaviour: stage → year picking, streams, student academic
  identity, catalogue eligibility and level statistics. CEFR or training levels are not stable
  student attributes; they belong to an enrolment or a placement.

**As implemented in Phase 3A (2026-10-04):**

- `level_systems(id, code UNIQUE, kind CHECK school|cefr|training|custom, name, description, built_in, position, status)`. Built-ins: `algerian_school`, `cefr`, `training`, `custom` -- one built-in per kind; administrators may add further **custom** systems only (trigger `guard_level_system`); built-ins cannot be deleted or have code/kind changed. Read: every signed-in user; write: administrators (RLS).
- `levels.system_id` NOT NULL (default: the school system, `school_level_system_id()`), fixed for life; `levels.code` unique per system. The 12 existing rows kept their ids, names, stages and positions, joined the school system and got codes 1AP..5AP, 1AM..4AM, 1AS..3AS. Seeded: CEFR A1..C2 and Training `beginner`/`intermediate`/`advanced` (names Débutant/Intermédiaire/Avancé); Custom starts empty.
- `levels.stage` is nullable and means *school stage*: required for school levels, forbidden for all others (trigger `enforce_level_system`). The `level_stage` enum is unchanged.
- Streams and `students.level_id` accept only school levels (trigger `enforce_school_level`): streams are a school concept and a student's level is their school identity.
- `programs.level_system_id` (nullable, RESTRICT). **NULL = no specific level** (no fake "none" system). A formation may name a system without a level. When it names a level, the level must belong to its system; the system is filled from the level when omitted (trigger `sync_program_level_system`), so today's form, which sends only `level_id`, keeps working. Existing formations with a level were backfilled from it (verified on a rehearsal row: 3AM -> algerian_school). `create_formation` accepts `level_system_id`.
- Unchanged on purpose: groups (any level, still equal to the formation's when it names one), registrations, the subject+level rule, eligibility and every visibility policy (still school-level based), onboarding, statistics, the UI (`useLevels()` returns the school system only).

**As implemented in Phase 3B (2026-10-04):**

- **Formation type → level system is a proposal, never a restriction** (`DEFAULT_LEVEL_SYSTEM_BY_CATEGORY`, `src/features/school/level-model.ts`): academic support and exam preparation → Algerian school; language → CEFR; professional training → Training; workshop and other → none. While creating a formation, the proposal follows the type until the administrator picks a system or a level; from then on the type no longer changes it. An existing formation opens on what it holds. Not stored, not enforced in the database: any system (or none) may be saved for any type.
- **Level picker** (`LevelSystemPicker`): system first ("Aucun niveau précis" = no system), then a level of that system ("Tous les niveaux" = the system without a level). School levels go stage → year; the stage only narrows the years and is never stored, so a summary line under the fields states what will be saved. CEFR, Training and custom systems list their own levels. Inactive systems/levels are hidden unless they are the current value.
- **Two distinct "no level" states, both preserved by edits:** `level_system_id NULL, level_id NULL` (no specific level) and `level_system_id = X, level_id NULL` (system X, every level). The list shows "CECRL (langues) · tous niveaux" for the second; the formation page shows a "Système de niveaux" row.
- **Groups stay within their formation's system** (`20261004120000`): `validate_group_program()` refuses a group level outside the formation's system (insert, level change, joining a formation); `validate_program_groups()` refuses moving a formation to a system its groups' levels are not part of, and the trigger now also fires on `level_system_id`. Dropping a formation to "no specific level" is allowed (it constrains nothing). Groups of a formation without a system and standalone groups are unchanged (school levels in the form, any level in the database). The group form lists only the formation's system's levels and says so.
- Unchanged on purpose: student eligibility and every visibility policy (Phase 3C/6: students still see school-level groups only; CEFR/Training groups are placed by the administration), onboarding, statistics, the Levels page, streams (school only), `useLevels()` (school only, every other screen).

### 4. Enrollment lifecycle

| State | Capacity | Access | Notes |
|---|---|---|---|
| pending | no | no | the student may withdraw it (DELETE, current policy) |
| approved (UI "active") | yes | yes | |
| rejected | no | no | kept as history |
| withdrawn (new) | no | no (material access: **[policy]**) | held a place, then left; reason and date; payments stay attached |
| completed (new) | no | read-only **[policy]** | the group ended normally; basis for certificates |
| waitlisted (new, with the waiting-list task) | no | no | ordered queue for a full group |

- `UNIQUE(student_id, group_id)` is replaced by a **partial unique index over active states**
  (pending, approved, waitlisted). History rows no longer block re-application. Uniqueness is not
  dropped.
- **Transfer** = withdraw the old place and create the new one in one RPC, with a
  `transferred_from` reference. This covers group and formation changes.
- History is never deleted. Payments keep pointing at the original registration (RESTRICT).
- A student's own insert can only be a pending request (SEC-01, `20261003100000`).

### 5. Account model — incremental

- **Now:** a student keeps an auth identity row. ADR-002's composite-FK invariants and every
  `auth.uid() = student_id` policy (registrations, attendance, payments, resources, notifications)
  stay intact.
- **Portal access becomes an admin-held state:**
  - a student created by an administrator without email or phone gets an internal identity with
    login disabled (GoTrue ban);
  - enabling portal access sets a real email or phone and a password, and lifts the ban (existing
    server-function pattern of teacher provisioning, `assertAdmin` + service role).
- **Why not decouple now:** a separate `students.user_id` would rewrite every student-facing policy
  and the role-integrity design in one step. It remains the documented long-term path, through its
  own ADR, when guardians or multi-account families need it.

### 6. Minors and guardians

- Guardian data is required when the student is younger than an institution-configured age, stored
  on `center_settings`. No threshold is hard-coded in code or constraints. **[policy]** The default
  value is a product decision.
- The onboarding CHECK constraint is relaxed accordingly when the student-management phase
  implements this. Until then, behaviour is unchanged.
- A separate `guardians` entity (siblings sharing a guardian, sibling discounts) is anticipated, not
  yet introduced.

### 7. Public applications

- **Storage:** a separate `applications` table, because a registration requires an account-backed
  student. Applicant data, guardian data for minors, target formation and optional preferred
  group, source (link or QR token), consent, review state, and links to the resulting student and
  registration.
- **Intake:** through a **server function** with validation, rate limiting and spam control.
  `anon` keeps zero table privileges (today it holds only 13 `center_settings` columns). Public
  formation data comes from a limited server projection.
- **Links:** one public link and QR code per **formation**, with an optional preferred group,
  gated by the formation's intake setting (the natural use of today's unused
  `programs.registration_open`).
- **Duplicates:** matched at review, never revealed at submission. The admin links the application
  to an existing student, creates a new one, or marks it duplicate.
- **Acceptance:** follows the same path as admin "Add student", then creates an approved
  registration, or a waitlisted one when the group is full. Rejected applications stay as history
  and can be re-opened.

**As implemented (2026-10-05, `20261005110000`, branch `product-completion/pre-inscriptions`):**

- `applications`: learner (name, birth date, optional phone/e-mail, current school level and school),
  guardian (name, phone, relationship), requested formation (+ name snapshot) and optional preferred
  group, availability, message, `consent_at`, a salted hash of the network origin (rate limiting only),
  review state `new -> reviewing -> accepted | rejected | duplicate` (re-openable), decision note,
  resulting student and registration. Institution-owned; the formation is only the entry point.
- Public page `/preinscription/<formation id>` (no account): served by `getPublicFormationFn` (minimal
  projection: offer, active groups with schedule and places left; no teacher, student or price) and
  posts to `submitApplicationFn` (validation again, honeypot, minimum fill time, 5 per origin per 15 min,
  3 per phone per formation per day). Open only while the formation is active and "Inscriptions
  ouvertes" is on. Formation page: link, copy, QR code (generated in the browser, `qrcode`).
- Guardian required below `center_settings.guardian_required_under_age` (default 18; no screen yet).
- Administration `/dashboard/admissions`: list (open by default), detail, call/WhatsApp, duplicate
  hints (same phone, same name + birth date, same name), start review, decline (reason), mark
  duplicate, reopen, accept. Accept (`acceptApplicationFn`, admin-checked) creates the student from
  the request (internal e-mail, login disabled -- portal access later) or links an existing one, then
  `accept_application` (SECURITY INVOKER) creates the APPROVED registration in a group of that
  formation and closes the request in one transaction; a student created by a failed acceptance is
  removed again. Admins get an `application_received` notification.
- Not built: waiting list (a full group refuses the placement; the request stays open), fees, replies
  by SMS/e-mail, documents, the guardian-age setting screen, a standalone "Add student".

### 8. Private schools — prepared, not built

- A private-school section (3AM-A) is a cohort taught many subjects by many teachers. The future
  model is a **teaching assignment** (group × subject × teacher).
- Today's `groups.subject_id` and `groups.teacher_id` are the single-assignment case and stay valid.
- Sessions are keyed `(group_id, session_date)` (ADR-003). Multi-subject cohorts will need an
  ADR-003 extension keying sessions by assignment.
- **Rule from now on:** new code must not add further single-teacher or single-subject assumptions
  beyond reading those two columns.

### 9. Finance

- `groups.price_dzd` is **legacy**. It is a price without a period, on the delivery entity, and is
  already hidden in the UI.
- It is replaced by fee items attached to the formation (default) with an optional group override.
  Charges are generated from registrations and balances are derived (never stored).
- Payments stay transactions against a registration.
- The column is kept until the fee model exists, because `my-registrations.ts` and
  `student-portal.ts` still read it.

**As implemented (2026-10-06, [ADR-005](./ADR-005-fees-and-installments.md)):** the charge layer
exists. `charges` sit on the **enrollment**, with installments (1 to 24, summing exactly), typed by
`fee_types` (data, translated by code), and are cancelled rather than deleted. They are written only
through the audited admin functions `save_charge` and `cancel_charge`. Balances are derived; there
is no payment allocation. Formation fee templates and the group override are the next, additive
step: they will pre-fill charges and change no table. `groups.price_dzd` is still legacy and unread
by the fee model.

### 10. Academic scope

Exams, evaluations, grades, report cards and progression are **in scope**. They will key on
academic periods (Phase: academic years/periods) and on groups/registrations. ADR-003's session
spine is unchanged; only its exclusion list is superseded.

**Implemented 2026-10-08** in ADR-008 (`20261008100000`): lesson log, assessments and scores,
academic periods, derived averages and report cards, progression.

## Implementation order

| Phase | Content |
|---|---|
| 0 | SEC-01, SEC-02, backlog commit, this ADR (done 2026-10-03) |
| 1 | **Done 2026-10-03.** Vocabulary and information architecture (labels per section 2; the Groups page stops treating "no formation" as "school group"; `verify-programs` standalone check updated) |
| 2 | **Done 2026-10-03** (`create_formation`, 20261003110000). Formation + optional first group in one atomic flow; single-group formations shown as one unit |
| 3 | Level systems. **3A done 2026-10-04** (`20261004110000`, `20261004110100`): `level_systems`, levels in systems, nullable stage, CEFR/Training seeds, `programs.level_system_id`. **3B done 2026-10-04** (`20261004120000`): formation type proposes a system, level picker scoped to the system (school: stage → year), groups' levels within the formation's system. **3C** (levels page per system, catalogue/eligibility per kind) remains. |
| 4 | **Done 2026-10-04** (`20261004100000`, `20261004100100`): `withdrawn` state, partial uniqueness, serialised capacity, admin placement/withdrawal UI, bounded enrollment reads. `completed`, `waitlisted` and transfer deferred (path documented in the knowledge base). |
| 5 | Student management: admin "Add student", portal access, guardian policy |
| 6 | Catalogue eligibility per level-system kind |
| 7 | Public applications. **First version 2026-10-05** (`20261005110000`, branch `product-completion/pre-inscriptions`, not merged): public formation page + form, admin review and acceptance into a group. |
| 8 | Organise-into-formations assistant, then decide `program_id NOT NULL` |
| 9 | Finance on the formation model. **Fees and installments 2026-10-06** (`20261006100000`, `20261006100100`, ADR-005): charges per enrollment, installments, fee types, admin section on the student page. Formation fee templates, discounts, allocation, receipts and invoices remain. |

## Consequences

- **No table rename.** Labels change in the UI only.
- **Additive schema evolution:** new tables (`level_systems`, `applications`), nullable columns,
  looser constraints. The behaviour changes are limited to the eligibility policies and are shipped
  with role-by-role tests.
- **Existing data stays valid:** programmes are already formations, groups are untouched, and
  registrations keep their rows.
- **The pre-fork `docs/ROADMAP.md`** and ADR-003's exclusion list are no longer planning sources.
