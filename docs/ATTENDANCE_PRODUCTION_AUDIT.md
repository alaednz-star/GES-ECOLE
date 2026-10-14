# Attendance — Production Audit

**Status:** Audit only. No code changed while producing this.
**Method:** every claim below was executed against the running stack, not inferred.

---

## Summary

| Severity | Count | Theme |
|---|---|---|
| **P0** | 2 | Data can be silently overwritten; stale pending state across tabs |
| **P1** | 3 | UTC date shift in reports; unsaved work lost on navigation; no concurrency detection |
| **P2** | 4 | Offline UX, error copy, export/report reuse, notification hook |

**Verified sound and NOT issues** (tested, not assumed): RLS isolation, duplicate
prevention, save/reload persistence, double-click, optimistic rollback,
back/forward, refresh-during-mutation, one-record-per-student-per-session.

---

## P0-1 — RESOLVED by business rule, not by schema redesign

> **Status: eliminated.** Gestion École's rule is that a group meets **at most once
> per calendar day**. Migration `20260807140000_one_session_per_day` enforces it
> with `UNIQUE (group_id, weekday)` on `group_schedules`.
>
> This removes the defect at its source rather than building session-identity
> machinery for a case the business forbids. `(group_id, session_date)` now
> resolves to exactly one session, which is precisely what the existing
> attendance key assumes — so `UNIQUE (group_id, student_id, session_date)`
> becomes sufficient, not merely convenient.
>
> **No change to `attendance` was needed.** The original analysis below is kept
> because it explains why the invariant matters.

### Original analysis


**Root cause.** `attendance` has no time component:

```
columns:  id, group_id, student_id, session_date, status, marked_by, created_at, updated_at
unique:   UNIQUE (group_id, student_id, session_date)
```

Session identity is `(group, student, DATE)`. A group meeting twice on the same
weekday has **one row for both sessions**. Measured: **1 group already does this**
("WS Test 1", Wednesday 08:00 and 23:00).

**Impact.** Marking the 08:00 register `present`, then the 23:00 register
`absent`, leaves five rows all `absent` — the morning register is destroyed, not
merged. Reopening the morning session shows the evening's values. Reproduced:

```
STEP A: mark 08:00 PRESENT -> 5 rows = present
STEP B: mark 23:00 ABSENT  -> 5 rows = absent     (morning lost)
```

This is also the highest-impact blocker for the student and parent portals: a
student's attendance history is wrong for any twice-daily group, and no amount
of UI work can recover data the schema cannot represent.

**Solution.** Add session identity to the row, not to the UI:

1. `ALTER TABLE attendance ADD COLUMN session_start time` (nullable at first).
2. Backfill from `group_schedules` where the weekday resolves to exactly one
   slot — unambiguous for every existing row.
3. Extend the unique key to `(group_id, student_id, session_date, session_start)`.
4. `useAttendance` takes the slot; the attendance page gains a session picker,
   shown **only** when the chosen date has more than one slot (so single-session
   groups are unchanged).
5. `useMarkedSessions` returns the triple, so pending detection distinguishes the
   two sessions.

Nullable-then-tightened keeps the migration reversible and avoids a hard cutover.

---

## P0-2 — RESOLVED. Saving a register left other attendance caches stale

**Root cause.** `useSaveAttendance` invalidates exactly one key:

```ts
qc.invalidateQueries({ queryKey: schoolKeys.attendance(vars.groupId, vars.date) })
```

Three other caches read the same table and are never invalidated:

| Key | Consumer |
|---|---|
| `markedSessions(from)` | workspace pending-attendance widget |
| `myAttendance(studentId)` | student portal |
| `["attendance-today", date]` | admin dashboard |

With a global `staleTime: 60_000` (`router.tsx:15`), those stay stale for a
minute.

**Impact — reproduced across two tabs:**

```
TAB 1 workspace pending:                   6
TAB 2 saves 3 registers; DB rows:          3
TAB 1 pending after the other tab saved:   6   <-- stale
```

A teacher working in two tabs — or two teachers sharing a room — sees work they
have already completed still listed as owed. On single-tab navigation the router
remounts the route and refetches, which **masks** the bug; it is real, just not
visible on the happy path.

**Solution.** Invalidate by table prefix rather than by exact key. Give every
attendance-derived query a shared root (`["attendance", ...]`) and invalidate the
root once, so a future consumer is covered automatically instead of needing to be
remembered.

---

## P1-1 — RESOLVED. UTC date shift in the attendance report

**Root cause.** `dashboard.attendance-report.tsx` lines 50 and 58 still use
`toISOString().slice(0, 10)`, which converts to UTC first.

**Impact.** East of Greenwich after ~22:00 local, the default range starts and
ends a day late; a session marked "today" falls outside "today". The same bug was
fixed in `dashboard.attendance.tsx` but not here — I fixed the page I was looking
at rather than the pattern.

**Solution.** One shared `todayIso()` helper in `lib/format`, used everywhere.
Remove the local copy in `dashboard.attendance.tsx` so a single definition exists.

---

## P1-2 — RESOLVED. Navigating away silently discarded unsaved marks

**Root cause.** No dirty tracking. `marks` is local state; changing group, date,
or route replaces it with no warning.

**Impact.** A teacher marks 25 students, clicks a sidebar link by reflex, and the
register is gone with no indication it was ever at risk.

**Solution.** Compare `marks` against the loaded roster to derive `isDirty`; warn
on group/date change and on route navigation. Not a `beforeunload` handler alone —
that only covers tab close, not in-app navigation, which is the common case.

---

## P1-3 — RESOLVED. Concurrent edits silently overwrote, last write wins

**Root cause.** The upsert carries no version or timestamp precondition.

**Impact.** Two teachers (or the admin and a teacher) with the same register open
each save the full roster. The second save overwrites the first with no conflict
signalled. Distinct from P0-1: this is same-session concurrency, not session
identity.

**Solution.** Send only *changed* entries rather than the whole roster, so
independent edits merge instead of colliding. Full optimistic locking
(`updated_at` precondition) is the complete answer but heavier; sending a diff
removes most of the collision surface at far lower cost, and is a prerequisite for
locking later either way.

---

## P2 findings

| # | Issue | Note |
|---|---|---|
| P2-1 | **Offline** — a save during a network drop shows a generic toast; marks stay on screen but nothing invites a retry | Wire the mutation to a retry action |
| P2-2 | **Error copy** — RLS denial (`42501`) reads "Une erreur est survenue" rather than "This group is not yours" | Extend the `23514` special-case pattern already in `errors.ts` |
| P2-3 | **Report/export reuse** — the report re-derives its own range logic instead of sharing the attendance hooks | Fold into a shared hook when the report is next touched |
| P2-4 | **Notifications** — `attendance_marked` exists in `notification_kind` but nothing emits it | Emit on save once P0-1 lands, so the payload can name the session |

---

## Business rules — verified

| Rule | Status | Evidence |
|---|---|---|
| One record per student per session | ⚠️ **per DAY, not per session** | P0-1 |
| Attendance cannot disappear | ⚠️ **can, via P0-1** | overwrite reproduced |
| Reopening loads latest saved values | ✅ | save → reload → values intact |
| Teacher cannot modify another's groups | ✅ | cross-teacher read `[]`, write **403** |
| History remains correct | ⚠️ | correct except P0-1 |
| Widgets match attendance data | ⚠️ | correct after refetch; stale cross-tab (P0-2) |

---

## Items checked and found sound

Tested directly, no action needed:

- **Duplicate writes** — `UNIQUE (group_id, student_id, session_date)` holds; re-saving updates in place
- **Wrong query keys** — keys are correctly parameterised; the defect is missing invalidation, not wrong keys
- **Missing optimistic rollback** — no optimistic update exists, so there is nothing to roll back. The UI waits for the server, which is the safer default here
- **Double-click save** — button disabled on `save.isPending`
- **Refresh during mutation** — the write is a single atomic upsert; a refresh mid-flight either lands or does not
- **Back/forward** — route remount refetches; no stale render observed
- **RLS assumptions** — policies match the code's assumptions exactly

---

## Architecture review

**No duplicated queries.** `useAttendance` (one group/date roster),
`useMarkedSessions` (which registers exist), `useMyAttendance` (student view),
`useTodayAttendance` (admin) each answer a different question at a different
granularity.

**One duplicated derivation:** `todayIso()` exists in `dashboard.attendance.tsx`
and inline in three other files. P1-1 consolidates it.

**Future compatibility.** The model supports student/parent portals, reports,
statistics and exports **once P0-1 lands**. Without session identity, every
consumer inherits ambiguous history — which is the argument for fixing it before
the Student module rather than after.

---

## Recommendation

Implement **P0-1, P0-2, P1-1, P1-2, P1-3** before the Student module. P0-1 is the
schema change; doing it now means student attendance is built on a correct model
instead of migrating portal code later. P2 items are genuine but can follow.
