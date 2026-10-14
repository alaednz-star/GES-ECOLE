# ADR-002 — Structural Role/Identity Integrity

**Status:** Accepted — implementation in progress (Phase 1)
**Date:** 2026-08-05
**Supersedes in part:** [ADR-001](./ADR-001-identity-and-provisioning.md) §4 ("Move the entity row to match")
**Related:** SECURITY_RELEASE_001_analysis.md

---

## 1. The problem

Teacher and admin accounts appeared in the Students page. Verified against the
live database:

```
admin@madrasti.local    role=admin    students=1  teachers=0   ← wrong
teacher.b@example.test  role=teacher  students=1  teachers=1   ← wrong (both)
teacher.c@example.test  role=teacher  students=1  teachers=1   ← wrong (both)
teacher@madrasti.local  role=teacher  students=1  teachers=1   ← wrong (both)
student@madrasti.local  role=student  students=1  teachers=0   ← correct
```

**4 of 5 `students` rows were contaminated. `teachers` was clean (0 wrong).**
That asymmetry mattered: it proved a single upstream source rather than a
general integrity collapse.

### Blast radius

Six consumers inherited the defect, because all read `students` unfiltered:

| Surface | Symptom |
|---|---|
| Students page | 5 rows shown, 1 correct |
| Admin dashboard stat | "Élèves: 5" — **inflated 5×** |
| Global search | staff listed under "Élèves" |
| Group detail | contaminated enrolment picker |
| Levels page | wrong per-level counts |
| Student profile route | reachable with a teacher's id |

### Not merely cosmetic

`private.can_join_group` → `my_academic_identity` reads `students`. A teacher
**could read their own student identity** (verified, HTTP 200). Only a null
`level_id` prevented enrolment. Set a level and a teacher becomes enrollable as
a student. This was a latent data-integrity defect, not a display bug.

---

## 2. Why the previous design failed

Three independent causes, each individually reasonable:

**a. `handle_new_user` creates a `students` row for every auth user.**
The trigger fires on `INSERT INTO auth.users`, before any role decision exists.
Correct for public signup (where every signup *is* a student); wrong for admin
provisioning, which travels the same path.

**b. `grant_role` added the new entity row but never removed the stale one.**
From the ADR-001 migration, verbatim:

> *"Move the entity row to match. **Keep the old row** rather than deleting it:
> a demoted teacher's history (groups taught) must survive."*

Sound for **demotion**. Wrong for **promotion**, where the student row is empty
by construction. The two cases were never distinguished.

**c. `useStudents()` queries `students` with no role filter.**

### The deeper cause

All three are symptoms of one structural gap: **nothing tied the subset tables
to the role table.** `students.id` references `profiles(id)` — "a person" — not
"a person who holds the student role." The invariant existed only in the minds
of the people writing each write path.

---

## 3. Alternatives considered

### A. Fix the provisioning pipeline only *(proposed, rejected on evidence)*

The preferred option: make provisioning correct and let the architecture
guarantee the invariant. **Rejected because provisioning is not the only write
path — demonstrated, not argued.** Signed in as an ordinary admin through
PostgREST:

```
POST /rest/v1/students {"id":"<teacher uuid>"}   →   HTTP 201
```

The RLS policy is `WITH CHECK (private.is_admin())`. It asks *"are you an
admin?"*, never *"is this person a student?"*. `authenticated` holds direct
INSERT/UPDATE/DELETE grants. Three standing bypasses: PostgREST, Studio, and any
future code writing the table directly — which is precisely how this arose.

A pipeline cannot guarantee an invariant it does not exclusively own.

### B. Validation trigger *(rejected)*

A trigger raising on mismatched inserts. Rejected on the project's instruction
and on merit:

- Procedural, not declarative — the rule is invisible in `\d students`
- Runs on every write for a condition that should be impossible
- Disableable: `ALTER TABLE ... DISABLE TRIGGER` silently removes the guarantee
- Expresses policy as an exception rather than as a fact about the data

### C. Single wide `users` table *(rejected)*

Collapse `students`/`teachers` into nullable columns on `profiles`. Rejected:
every role-specific column becomes nullable, `level_id` is meaningless for a
teacher, and the database can no longer express which fields are required for
whom. Strictly worse integrity than today.

### D. `EXCLUDE` constraint / partial unique index *(not viable)*

Neither can express a condition spanning two tables.

### E. Composite foreign key *(selected)*

```sql
ALTER TABLE public.students
  ADD COLUMN role public.app_role GENERATED ALWAYS AS ('student') STORED,
  ADD FOREIGN KEY (id, role) REFERENCES public.user_roles(user_id, role);
```

The invalid state becomes **unrepresentable** rather than *detected*.

---

## 4. Why the structural constraint was selected

| Property | Trigger (B) | Composite FK (E) |
|---|---|---|
| Invalid state | detected, then rejected | **cannot exist** |
| Visible in schema | no | **yes** (`\d students`) |
| Disableable | yes | no |
| Enforcement | custom plpgsql | same machinery as every FK |
| Cost per write | function call | index lookup |

`user_roles` already carries `UNIQUE (user_id, role)` — the exact key the FK
needs. No new index; the target already existed.

### Verified on a working prototype (6 tests)

| # | Scenario | Result |
|---|---|---|
| 1 | Multi-role user (teacher+admin) → `teachers` | ✅ allowed |
| 2 | Same user → `students` (no student role) | ✅ blocked `23503` |
| 3 | Grant student role too → `students` | ✅ **allowed, holds both** |
| 4 | Revoke `teacher` while `teachers` row exists | ✅ blocked |
| 5 | Promotion, no entity row | ✅ allowed |
| 6 | Revoke role while entity row exists | ✅ blocked |

**Test 4 was an unplanned benefit:** role and identity cannot drift apart in
*either* direction. Revoking a role is blocked while the identity row lives.

**Test 6 changed the implementation.** `grant_role` currently runs
`DELETE FROM user_roles` then `INSERT`. Under the FK that fails whenever an
entity row remains. Corrected ordering:

```
1. evaluate entity_dependencies for the current role's entity row
2. if nothing blocking  → drop the stale entity row
3. update user_roles
4. insert the new entity row
```

Found by testing, not at runtime.

---

## 5. Why `GENERATED ALWAYS`, and not a simpler column

Both candidate shapes were built and attacked:

```sql
role ... GENERATED ALWAYS AS ('student') STORED     -- chosen
role text NOT NULL DEFAULT 'student' CHECK (role='student')  -- alternative
```

| Attack | GENERATED | DEFAULT + CHECK |
|---|---|---|
| `INSERT (id, role) VALUES (..., 'teacher')` | `428C9` cannot insert non-DEFAULT | `23514` check violation |
| `UPDATE SET role='teacher'` | `428C9` only updatable to DEFAULT | `23514` check violation |
| `information_schema.is_generated` | **`ALWAYS`** | `NEVER` |

Both block the attacks, so the choice is not about safety. It is about
**intent**:

- `GENERATED ALWAYS` states *"this column is not data — it is a fact derived
  from the table's identity."* The value is not the caller's to supply at all.
- `DEFAULT + CHECK` states *"this is data, which happens to be constrained."*
  It invites a future migration to relax the CHECK, and clients see a writable
  column they must remember not to set.

`is_generated = ALWAYS` also lets tooling (PostgREST, codegen, ORMs) omit the
column from write payloads automatically. With DEFAULT+CHECK every client must
be told not to send it.

**Confirmed: `GENERATED ALWAYS` is the simplest structural solution.** The
alternative is equally safe but semantically weaker, and pushes a rule into
every client that the schema should own.

Cost: one small immutable column per entity table. Accepted.

---

## 6. Future multi-role support

**The constraint is multi-role by construction and does not impede it.**

`user_roles` is `UNIQUE (user_id, role)` — not unique on `user_id`. The FK
targets that pair, so it answers *"does this person hold **this** role?"* and
never *"how many roles do they hold?"*.

Test 3 demonstrated a single user simultaneously holding `teacher`, `admin` and
`student` roles **with rows in both `teachers` and `students`**. Every scenario
raised — Admin+Teacher, Teacher+Parent, staff enrolled as a learner — is
supported today with no schema change.

What the constraint forbids is exactly what should be forbidden: an identity row
for a role the person does not hold.

**Note for multi-tenancy:** when `user_roles` becomes
`(user_id, tenant_id, role)`, these FKs must extend to the triple. Trivial with
today's five accounts; a project after real data. Sequencing matters.

---

## 7. Impact on future entities

The pattern generalises with no new thinking:

```sql
ALTER TABLE public.<entity>
  ADD COLUMN role public.app_role GENERATED ALWAYS AS ('<role>') STORED,
  ADD FOREIGN KEY (id, role) REFERENCES public.user_roles(user_id, role);
```

Applies unchanged to `parents`, `staff`, `administrators`.

Paired with two generic services introduced alongside this decision — so no
entity-specific lifecycle code is written twice:

- **`private.entity_dependencies(entity, id)`** → `(table, relationship, count,
  severity)` where severity is `blocking` (history: attendance, registrations,
  notes, audit), `reassignable` (needs a new owner: groups), or `incidental`
  (regenerable: teacher_subjects). Deletability is decided by *relationships*,
  never by "the columns are null" — which matters because `attendance`,
  `registrations` and `student_notes` all **CASCADE** from `students`, so a
  naive delete silently destroys academic history.
- **`private.entity_lifecycle(entity, id, state, reason)`** — one audited state
  machine; per-entity functions are thin wrappers.

### Consequences

**Positive**
- The original bug class becomes impossible, not merely detected
- Role/identity drift blocked in both directions
- Invariant visible in the schema; new engineers cannot miss it
- Zero new indexes

**Negative / accepted**
- One generated column per entity table
- `grant_role` must order its writes correctly (§4)
- Direct client INSERTs into entity tables must be revoked — an intentional
  narrowing that makes provisioning the sole write path
- Backfill required: 4 contaminated rows, verified to carry **no** level,
  onboarding, registrations, attendance or notes, so the generic dependency
  rule permits their removal

**Neutral**
- `_probe_val` remains in `entity_status` from earlier diagnostics: unused by
  every row, unreachable from the app, accepted rather than rebuild the type
