# Security Release 001 — Pre-Implementation Analysis

**Scope:** ADR-001 steps 1–5. Multi-tenancy (step 7) explicitly excluded.
**Status:** Analysis complete. Migration written but **not applied**.

---

## 1. Security impact analysis

### What changes, and what it closes

| ID | Issue | Today | After |
|---|---|---|---|
| P0-A | Any user can insert their own `teachers` row | `WITH CHECK (is_admin() OR id = auth.uid())` → **HTTP 201 verified** | admin-only |
| P0-A' | Same on `students` | `id = auth.uid()` permitted | admin-only |
| P0-B | Client transmits `role` at signup | `signUp(data:{role})` | field removed from the wire |
| P0-C | Admin provisioning uses `user_metadata.role` | user-writable field | `app_metadata.role` |
| P1 | Role/entity row not derived from intent | trigger hardcodes `student` | `private.grant_role()` |
| P2 | `teachers read USING (true)` | every authenticated user reads every teacher | staff + own-group students |

### Findings that changed the plan

Two Step-2 assumptions in the brief did not survive verification. Reporting them
because they *reduce* scope, and acting on them anyway would have caused harm.

**Authorization already uses `user_roles` exclusively.** All four helpers resolve
from `user_roles`, none from entity-row existence:

```
private.has_role   → SELECT FROM user_roles WHERE user_id AND role
private.is_admin   → private.has_role(auth.uid(),'admin')
private.is_staff   → user_roles WHERE role IN ('admin','teacher')
private.can_join_group → groups × my_academic_identity()
```

`private.my_academic_identity()` reads `students`, but for *academic data*
(level_id, stream_id) — not permission. Client-side, `RequireAuth` gates on
`hasAnyRole`, hydrated from `user_roles`. **No code path authorises on the
existence of a `teachers`/`students` row.**

This is why P0-A was latent rather than active: the fake teacher row I created
granted no capability (self-granting admin → 403, creating a group → 403). The
fix is still required — it closes the hole before code starts trusting those
tables — but the correct severity is *latent escalation*, not active takeover.

**Step 2 therefore requires no code change.** Its requirement is already met. The
migration adds a regression guard instead (§3, item 6).

### Regression risk identified and designed around

`useTeachers()` is called by **students** at
[my-registrations.ts:43](src/features/school/my-registrations.ts#L43) to display
the teacher's name on their own registrations. A naive "staff-only" read policy
would blank those names.

The Step-5 policy therefore permits three readers: staff, the teacher themselves,
and students enrolled in that teacher's groups — mirroring the shape already used
by `students read`.

### Design change made during implementation

The first version called `private.provision_staff` directly over PostgREST RPC.
Testing the assumption showed **PostgREST does not expose the `private` schema**
(`Accept-Profile: private` → **HTTP 406**), so that call would have failed at
runtime — the same class of bug as the original defect: code written against
assumed behaviour.

Two options were available. Exposing `private` to PostgREST would have put
`is_admin()`, `has_role()` and `my_academic_identity()` on the public API
surface — unacceptable. Instead a thin `public.provision_staff` wrapper delegates
to the private one, with `EXECUTE` granted to **`service_role` only**;
`authenticated` and `anon` have none, so it is unreachable with a user JWT
despite living in an exposed schema.

### Non-risk confirmed

Student onboarding writes with `.update()`, not `.insert()`
([onboarding/queries.ts:70](src/features/onboarding/queries.ts#L70)) — the row
already exists from the trigger. Removing the self-insert clause **does not break
onboarding**. This was the main suspected regression; it does not apply.

### Residual risks after this release

- **Multi-tenancy still absent.** Single-centre only. Deliberately out of scope.
- **`profiles admin insert` keeps `id = auth.uid()`.** Retained: it is the
  documented Supabase pattern for self-service profile creation and grants no
  privilege. Flagged, not changed.
- **The trigger still auto-creates a `students` row for every signup.** Correct
  for a student-signup product; revisit if staff-only signup is ever added.

---

## 2. Exact files, tables and functions affected

### Database (one migration)

| Object | Change |
|---|---|
| `public.handle_new_user()` | Rewritten: profile + default student identity. Explicitly documents that it must never read `user_metadata.role` |
| `private.grant_role(uuid, app_role)` | **New.** SECURITY DEFINER. Admin-asserted, atomic role change + entity-row move + audit |
| `private.provision_staff(uuid, app_role, ...)` | **New.** Used by the server after `auth.admin.createUser` |
| `public.provision_staff(...)` | **New.** Thin RPC wrapper — see note below. `service_role` only |
| Policy `teachers admin insert` | `WITH CHECK (private.is_admin())` — drops `id = auth.uid()` |
| Policy `students insert` | `WITH CHECK (private.is_admin())` — drops `id = auth.uid()` |
| Policy `teachers read` | `USING (true)` → staff OR self OR enrolled student |
| `public.audit_log` | Two new enum values: `role_granted`, `role_revoked` |

**Not changed:** all 16 tables' structure, 8 enums (values added only), the other
41 policies, 24 triggers, `private.is_admin/has_role/is_staff/can_join_group`.

### Application code

| File | Change |
|---|---|
| `src/types/auth.ts` | Drop `role` from `RegisterPayload` |
| `src/services/auth/supabase-auth-service.ts` | Remove `role` from `signUp` metadata |
| `src/features/auth/components/register-form.tsx` | Stop passing `role: "student"` |
| `src/features/teachers/provisioning.server.ts` | `app_metadata.role`; call `private.provision_staff`; correct the docstring that misdescribed the trigger |

---

## 3. Migration plan

Ordered so the system is never less secure mid-flight.

1. **Client stops sending `role`** — must precede any trigger change. If the
   trigger honoured metadata while the client still sent it, self-registration as
   admin would open. Doing this first makes that regression impossible.
2. **Tighten INSERT policies** (`teachers`, `students`) — closes P0-A.
3. **Add `private.grant_role()` / `private.provision_staff()`** — the audited
   elevation path.
4. **Rewrite `handle_new_user()`** — narrowed to the invariant, with the
   metadata prohibition stated in the body.
5. **Scope `teachers read`** — closes P2 without breaking student views.
6. **Post-conditions block** — the migration verifies its own outcome and raises
   if any policy still contains `auth.uid()` in a staff INSERT check, or if the
   trigger body references `role`. Acts as the Step-2 regression guard.

Backfilling the three mis-roled local accounts is **deliberately not** in the
migration: it is local test data, not schema. It runs separately, after review.

---

## 4. Rollback considerations

| Change | Reversible? | Notes |
|---|---|---|
| Policy tightening | **Yes** — trivially | Re-create prior policy text; recorded in the migration header |
| `handle_new_user` rewrite | **Yes** | Prior body preserved verbatim in the header comment |
| New functions | **Yes** | `DROP FUNCTION`; nothing depends on them until server code calls them |
| Enum values | **No** | Postgres cannot remove enum values. Additive and inert — acceptable, but genuinely one-way |
| Client `role` removal | **Yes** | Pure code revert |

**The enum addition is the only irreversible element.** It is additive, unused by
existing rows, and harmless if the rest is rolled back.

**Rollback sequence** (if needed): revert client code → restore prior policies →
restore prior `handle_new_user` → drop new functions. The enum values stay.

**Data safety:** no `DROP TABLE`, no `DROP COLUMN`, no `DELETE`, no `UPDATE` of
existing rows. Zero data loss on either apply or rollback.

**Forward-only caveat:** once staff accounts are provisioned through
`grant_role()`, rolling back the functions leaves those `user_roles` rows intact
and correct — they simply lose the audited path for future changes.

---

## 5. Verification plan (post-apply)

Re-run the exact attacks that proved the vulnerabilities:

1. Student self-insert into `teachers` → expect **403** (was 201)
2. Student self-insert into `students` → expect **403**
3. Student self-grant `admin` → expect **403** (regression check, was already 403)
4. Signup → exactly one `student` role, one `students` row, no `teachers` row
5. Signup with forged `role:"admin"` in the request → still `student`
6. `grant_role()` as non-admin → raises; as admin → moves row + writes audit
7. Student reads own registrations → teacher name still visible (regression check)
8. Student lists all teachers → restricted (was: full table)
