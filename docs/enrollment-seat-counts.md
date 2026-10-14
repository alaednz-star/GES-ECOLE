# Students cannot see how full a group is

**Status:** open. Needs one migration, which has **not** been written to
`supabase/migrations/` or applied. The SQL is at the bottom, ready for review.

**Found:** 2026-08-13, while verifying the redesigned catalogue at `/dashboard/registration`.

---

## The symptom

The catalogue card is built around scarcity — "Plus que 2 places !" in amber, a filling
progress bar, and a `Complet` state that withdraws the enrolment button. For a signed-in
student, all three are wrong: every group reports **0 enrolled**, every group looks empty,
and no group is ever full.

## Why

`useGroups()` derives `enrolled` by counting rows from:

```ts
supabase.from("registrations").select("group_id, status")
```

and the `registrations read` policy is:

```sql
USING (student_id = auth.uid() OR public.is_admin()
       OR EXISTS (SELECT 1 FROM public.groups g
                   WHERE g.id = group_id AND g.teacher_id = auth.uid()))
```

A student may read **their own** registrations and nothing else, so the count is
structurally 0 for every group they have not personally joined. This is the policy working
correctly: one student's enrolment is another student's private data.

`public.group_enrollment_counts` looks like the answer and is not. It is declared
`WITH (security_invoker = true)`, so the aggregate is computed over the rows *the caller*
can see — the same zero, arrived at one layer higher.

Measured against the local stack, on a group with 8 of 10 seats taken:

| read as | `registrations` rows | `group_enrollment_counts.enrolled_count` |
| --- | --- | --- |
| service role | 8 | 8 |
| the student | `[]` | **0** |

`groups` carries no denormalised counter (`select *` as the student returns
`max_students` and nothing seat-related), so there is no column to read instead.

This predates the redesign — the previous card drew the same bar from the same zero. The
redesign did not introduce it; it made it impossible to ignore.

## What ships in the meantime

`EligibleGroup.seatsKnown` is `false` for students and `true` for staff. When it is false
the card and the details sheet show the group's **size** ("Groupe de 20 élèves maximum")
instead of an occupancy bar, and `isFull` is not asserted. No fabricated number is
rendered. Admin and teacher surfaces are unaffected — their reads are complete, so they
keep the occupancy bar.

One consequence, accepted deliberately: a student may still request a seat in a group that
is actually full. That is already how the database behaves —
`enforce_group_capacity()` states "Only approved registrations consume a seat; pending ones
are requests", so the request is legal and capacity is enforced when an admin decides. The
student gets a rejection rather than a silent block. Verified in
`scripts/e2e/verify-enrollment-security.mjs`.

## The fix, when approved

One `SECURITY DEFINER` function exposing **only** the aggregate — no student identities, no
row access, no policy changes:

```sql
-- Seat counts a student may read: a number, never a name.
--
-- SECURITY DEFINER because the count is deliberately broader than the caller's row
-- access: how full a class is is public information at the centre, while WHO is in it is
-- not. Returning only (group_id, enrolled_count) is what makes that split safe -- there is
-- no row here to leak.
--
-- Scoped to groups the caller may already SEE, so it cannot be used to enumerate the
-- catalogue of another level or stream.
CREATE OR REPLACE FUNCTION public.group_seat_counts()
RETURNS TABLE (group_id uuid, enrolled_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT g.id,
         count(r.student_id) FILTER (WHERE r.status = 'approved')::integer
    FROM public.groups g
    LEFT JOIN public.registrations r ON r.group_id = g.id
   -- `visible` re-enters the caller's own policies: SECURITY DEFINER bypasses RLS, so
   -- without this the function would list every group in the school.
   WHERE EXISTS (SELECT 1 FROM public.groups visible WHERE visible.id = g.id)
   GROUP BY g.id;
$function$;

REVOKE ALL ON FUNCTION public.group_seat_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.group_seat_counts() TO authenticated, service_role;
```

⚠️ The `WHERE EXISTS` above does **not** work as written: inside a `SECURITY DEFINER`
function RLS is bypassed for `public.groups` too, so the subquery is always true. Getting
the scoping right needs either
`SECURITY INVOKER` on the visibility half (a second object), or an explicit repeat of the
level/stream predicate from `private.can_join_group`. Repeating a policy is the thing the
existing migrations deliberately avoid — "a copy of a policy is a policy that can drift"
(`20260808180000_session_aggregates.sql`).

**So this needs a design decision before it is written**, which is why it is documented
rather than applied. The two candidate shapes:

1. `SECURITY DEFINER` function taking `_group_ids uuid[]`, returning counts only for ids
   the caller passes, with an inner `private.can_join_group(id)` check per id. Authorisation
   stays in the one function that already owns it; the client already knows which groups it
   is showing.
2. A second view, `security_invoker`, that lists the group ids the caller may see, joined
   against a `SECURITY DEFINER` aggregate. Two objects, no duplicated predicate.

Option 1 reuses the existing authorisation helper and adds one object. It is the
recommendation.

## Checklist for whoever picks this up

- [ ] Decide between the two shapes above
- [ ] Write the migration; no changes to any existing policy, table or view
- [ ] Extend `scripts/e2e/verify-enrollment-security.mjs`: a student gets true counts for
      groups they may see, **and** cannot obtain counts for another level's group
- [ ] Flip `seatsKnown` in `src/features/school/eligible-groups.ts` to read the new source
- [ ] Re-run `scripts/e2e/verify-enrollment-ui.mjs`; the urgency assertions there are
      written against real counts and currently pass only for staff
