# ADR-001 — Identity, Roles and User Provisioning

**Status:** Proposed — awaiting decision. No code written.
**Date:** 2026-08-05
**Context:** `handle_new_user` hardcodes every new user as `student`, which broke
admin-driven teacher provisioning. That symptom led to a full review of the
identity architecture; the review found problems more serious than the symptom.

---

## 1. Current architecture, as it actually behaves

Verified against the running local database, not inferred from migrations.

```
                    ┌──────────────┐
  signUp(role) ────▶│  auth.users  │  GoTrue owns credentials
  admin.createUser  └──────┬───────┘
                           │ AFTER INSERT
                    ┌──────▼──────────────┐
                    │ handle_new_user()   │  SECURITY DEFINER
                    └──────┬──────────────┘
                           │ always, unconditionally:
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        profiles     user_roles    students
                     role='student' (hardcoded)
```

**Live trigger body:**
```sql
INSERT INTO public.profiles (id, full_name, email, phone) VALUES (...);
INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'student');
INSERT INTO public.students (id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
```

`raw_user_meta_data->>'role'` is **never read**. Neither migration that defines
this function has ever been role-aware.

**Observed result** after creating three accounts with `role` metadata set:

| Account | Intended | Actual role | teachers row | students row |
|---|---|---|---|---|
| admin@ | admin | **student** | no | yes |
| teacher@ | teacher | **student** | no | yes |
| student@ | student | student | no | yes |

`user_roles`: 0 admin, 0 teacher, 3 student. `teachers`: 0 rows.

### Correction to earlier reports

Previous reports of mine stated that `handle_new_user` "assigns the role from
`raw_user_meta_data->>'role'` and inserts the matching `teachers` row", and used
that to argue teacher provisioning was atomic and needed no extra work. **That was
wrong.** I read the calling code's comment rather than the function body. The
architectural claim built on it — "provisioning is one privileged call, the
database does the rest" — does not hold.

---

## 2. Problems found

Ordered by severity. P1 is the reported bug; **P0 is worse and was not reported.**

### P0-A — Privilege escalation: any user can create their own teacher record

`teachers admin insert` has `WITH CHECK (private.is_admin() OR id = auth.uid())`.
The `id = auth.uid()` clause lets any authenticated user insert a `teachers` row
for themselves.

**Verified by executing the attack** as `student@madrasti.local`:
```
POST /rest/v1/teachers  {"id":"<own uid>","status":"active"}
  → HTTP 201   row created
```

Blast radius is **currently limited** — I tested the follow-on steps rather than
assuming the worst:

- Self-granting `admin` in `user_roles` → **HTTP 403** (correctly blocked)
- Creating a group with self as teacher → **HTTP 403** (correctly blocked)

So this is *not* full account takeover today. It is a **latent** escalation: the
system now contains a user who is a `student` in `user_roles` but a `teacher` in
`teachers`. Any current or future code that authorises on "has a teachers row"
rather than `user_roles` — a natural thing for a developer to write — turns this
into real privilege escalation. `students` has the same `id = auth.uid()` clause.

*(Test artifact was removed; `teachers` is back to 0 rows.)*

### P0-B — The client sends its own role at signup

`supabase-auth-service.ts:48` passes `data: { full_name, role }` into `signUp`.
`role` originates in the browser. Today the hardcoded trigger silently discards
it — **the bug is what's protecting you.** The instant the trigger is "fixed"
naively to honour metadata, self-registration as `admin` becomes possible.

This is the single most important finding: **the obvious fix to P1 introduces a
critical vulnerability** unless P0-B is fixed in the same change.

### P0-C — `user_metadata` is attacker-controlled by design

Supabase splits `raw_user_meta_data` (user-writable via `updateUser`) from
`raw_app_meta_data` (service-role only). Authorisation input must never come from
the former. Current code uses `user_metadata` for `role` on both paths, including
admin provisioning at `provisioning.server.ts:245`.

### P1 — Role and entity row are not derived from intent

The reported bug. Admin-provisioned teachers land as students with no `teachers`
row, so `provisioning.server.ts:270`'s `.from("teachers").update(...)` matches
**zero rows** and silently succeeds. Teacher provisioning is non-functional on
this schema regardless of the env/migration issues found earlier.

### P2 — `teachers read` is `USING (true)`

Every authenticated user can read every teacher row, including `bio`. Not a
credential leak, but broader than needed and inconsistent with `students`, which
is properly scoped.

### P3 — Role model cannot express one user, two roles

`user_roles` is correctly a separate table (good — not an enum on `profiles`),
but nothing else treats it as multi-valued. A teacher who also administers the
centre is common in small tutoring centres.

### P4 — No tenant boundary

`center_settings` exists as a singleton. No `tenant_id` anywhere. Every RLS policy
scopes by user identity only. This is fine for one centre and blocks the stated
multi-centre goal entirely.

### P5 — Provisioning logic split across two layers

The trigger creates rows; `provisioning.server.ts` then updates them. Neither is
the single source of truth, which is exactly how the P1 mismatch went unnoticed —
the server code's comment described behaviour the trigger did not implement.

---

## 3. Answers to the questions posed

**Should roles come from user metadata?**
No — not from `user_metadata`. That field is user-writable and is authorisation
input. `app_metadata` is acceptable for *transporting* an admin-set role into a
JWT claim, but `user_roles` must stay the authoritative store.

**Should users ever send their own role?**
Never. The signup payload should carry no role at all. Public signup implies
exactly one role: `student`.

**Should teacher/admin accounts only be created by existing admins?**
Yes. Teacher and admin are *staff* roles and must be admin-provisioned server-side
via the service role. This is already the intent of the teacher provisioning
feature; the schema simply doesn't enforce it.

**Triggers or server-side services?**
**Both, with a strict split** — this is the core recommendation:

- **Trigger** owns the *invariant*: every `auth.users` row gets a `profiles` row.
  Atomic, unconditional, no branching.
- **Server-side service** owns the *decision*: which role, which entity row.
  Runs under the service role, after an explicit admin check.

The trigger currently does both, and the branching is where it went wrong. A
trigger cannot know whether a signup is legitimate self-registration or admin
provisioning — it sees only a row. Pushing that decision into the trigger means
encoding trust in `user_metadata`, which is precisely P0-B.

**How does this scale to multiple centres?**
It does not today. Multi-tenancy must be introduced before there is production
data, because retrofitting `tenant_id` onto 16 tables and 43 policies with live
data is a far harder migration.

---

## 4. Recommended architecture

### Principle: one writer per fact

| Fact | Owner | Never written by |
|---|---|---|
| Credentials | GoTrue (`auth.users`) | app code |
| Profile exists | trigger | app code |
| Role | server-side service (service role) | client, trigger |
| Staff entity rows | server-side service | client |
| Student entity row | trigger (the default role) | client |

### Database changes

**a. Trigger reduced to the invariant only**
```
handle_new_user():
  INSERT INTO profiles (...)                 -- always
  INSERT INTO user_roles (user_id,'student') -- default, least privilege
  INSERT INTO students (id)                  -- matches the default role
```
Unchanged in shape from today, but now *deliberate* rather than accidental: the
default is least-privilege, and elevation is a separate, audited action.

**b. Remove self-insert from staff tables**
`teachers admin insert` → `WITH CHECK (private.is_admin())`. Drop `id = auth.uid()`.
Closes P0-A. Review the same clause on `students`.

**c. Elevation as an explicit, audited operation**
A `SECURITY DEFINER` function — `private.grant_role(target, role)` — that asserts
`private.is_admin()`, moves the entity row (delete `students`, insert `teachers`),
updates `user_roles`, and writes to `audit_log`. Callable only from the server
functions, never from the client. This makes "student → teacher" one atomic,
logged transaction instead of three client-visible writes.

**d. Scope `teachers read`** to staff, plus students enrolled in that teacher's
groups — mirroring the existing `students read` policy shape. Closes P2.

**e. `app_metadata.role` as a JWT claim** *(optional, later)*
Set server-side at provisioning. Lets RLS read the role from the JWT instead of a
`user_roles` subquery on every policy evaluation. Meaningful performance win at
scale; adds token-staleness complexity. **Not now.**

### Multi-tenancy (design now, implement before production data)

Add `tenant_id uuid NOT NULL REFERENCES tenants(id)` to every domain table, plus
a `private.current_tenant()` helper resolved from `user_roles`. Every policy gains
`AND tenant_id = private.current_tenant()`. `user_roles` becomes
`(user_id, tenant_id, role)` — which also solves P3, since the same person can
hold different roles in different centres.

**Recommendation: do this as a separate, dedicated migration**, not bundled with
the security fix. It touches every table and policy; mixing it with a P0 fix makes
both harder to review and to roll back.

### User lifecycle

```
Public signup      → auth.users → trigger → profile + student role + students row
                     (no role accepted from client)

Admin provisions   → assertAdmin() → auth.admin.createUser (app_metadata.role)
teacher/admin      → grant_role() → user_roles + teachers row + audit_log
                     → password_change_required = true

Role change        → admin only → grant_role() → entity row moved + audited

Deactivation       → status='inactive' (never hard delete; preserves history)
```

---

## 5. Migration strategy

Ordered so the system is never less secure than it is now.

| # | Change | Risk | Notes |
|---|---|---|---|
| 1 | Stop sending `role` from the client at signup | **Low** | Client-only; trigger already ignores it. Do this **first** — it makes step 3 safe |
| 2 | Drop `id = auth.uid()` from `teachers`/`students` insert policies | **Low** | Closes P0-A. Verify no legitimate flow relies on self-insert |
| 3 | Add `private.grant_role()`; rewire provisioning to call it | Medium | Makes teacher provisioning actually work (P1) |
| 4 | Move admin provisioning to `app_metadata` | Low | Closes P0-C |
| 5 | Scope `teachers read` | Low | Closes P2. Check no UI depends on the open read |
| 6 | Backfill: correct the 3 local test accounts | Low | Local only, no production data exists |
| 7 | Multi-tenancy | **High** | Separate migration. Before production data |

Steps 1–5 are a coherent security release. Step 7 is a project.

**Ordering matters:** step 1 before step 3. If the trigger were made metadata-aware
while the client still sends `role`, self-registration as admin opens up. Doing
step 1 first means step 3 can never regress into P0-B.

---

## 6. Security considerations

- **Never trust `user_metadata` for authorisation.** Use `app_metadata`, or better,
  a server-side lookup.
- **Least privilege by default.** An unrecognised or absent role means `student`,
  never staff.
- **Elevation is audited.** Every role change writes to `audit_log` with actor,
  target and timestamp.
- **Defence in depth.** RLS is the enforcement boundary; server-side checks are
  the usability layer. Neither substitutes for the other — P0-A exists precisely
  because a *policy* permitted what application code never intended.
- **Verify by attacking.** Every claim in §2 was tested against the running
  database. The P0-A finding came from executing the insert, not from reading the
  policy — and the blast-radius limits came from executing the *follow-on* attacks
  and finding them blocked. Both halves matter.

---

## 7. Recommendation

Adopt steps 1–5 as one reviewed security change, then treat multi-tenancy (7) as
a separate project before production data exists.

The reported bug (P1) is real but is **not the most urgent finding**. P0-A is a
live policy hole, and P0-B means the naive fix to P1 would create a critical
vulnerability. They must be fixed together, in the stated order.

One judgement call worth surfacing: the currently-broken behaviour is *safe*
precisely because it is broken. There is no urgency to ship a partial fix, and
strong reason not to — a metadata-honouring trigger without step 1 would be
materially worse than today.
