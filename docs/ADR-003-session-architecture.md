# ADR-003 — The Session as the Central Academic Object

**Status:** Accepted — Phase 1 (design). No implementation yet.
**Date:** 2026-08-07
**Related:** [ATTENDANCE_PRODUCTION_AUDIT.md](./ATTENDANCE_PRODUCTION_AUDIT.md),
migration `20260807140000_one_session_per_day.sql`,
migration `20260805170000_group_date_range.sql`
**Supersedes:** nothing. Additive to the existing model.

> This document is the reference architecture for **every** future feature that
> attaches to a session: attendance, homework, course resources, teacher notes,
> announcements. Read §2 and §8 before adding a module.
>
> **Explicitly out of scope:** exams, grades and evaluations. These were
> considered and rejected as product features -- do not add abstractions,
> types, tables or roadmap entries for them. There is also no parent portal.

---

## 1. Why this exists

Attendance, homework and course resources are each naturally addressed by
*"which lesson?"* — yet the current product answers that question differently in every
place it is asked. The Présences page makes the user name a group and a date
from memory, then answers a wrong guess with *"Ce groupe n'a pas cours à cette
date."* The tool demands knowledge of the timetable in order to use the
timetable.

The correction is not a better picker. It is to make the **session** a
first-class object that the user selects from a calendar, and to let features
hang off it. Attendance becomes an action performed *on* a session rather than
the result of a search.

The decision that follows: **do not build an attendance-specific architecture.**
Build a Session spine, and let attendance be its first module.

---

## 2. Session identity

### 2.1 The key

```
SessionKey = (group_id, session_date)
```

This is not a convenience chosen for this document. It is a **schema-guaranteed
invariant**, established by `20260807140000_one_session_per_day.sql`:

```sql
ALTER TABLE public.group_schedules
  ADD CONSTRAINT group_schedules_one_per_day UNIQUE (group_id, weekday);
```

That migration's own words:

> With this constraint, `(group_id, session_date)` identifies exactly one
> session, which is precisely what the attendance key already assumes.

Because a group meets **at most once per calendar day**, a group plus a date
resolves to exactly one lesson. The ambiguity that let a morning register be
destroyed by an evening one (audit finding P0-1) is structurally impossible, not
worked around.

**Consequences — the load-bearing part of this ADR:**

1. No `sessions` table is required. Sessions are *derived*, never stored.
2. Every future module keys on the same pair. Homework becomes
   `homework (group_id, session_date, …)` with its own
   `UNIQUE (group_id, session_date)`. No new identity concept is introduced,
   and no data migration is needed to adopt it.
3. `attendance (group_id, student_id, session_date)` already conforms.
   Attendance is a *child* of a session identity that predates this document.

### 2.2 The canonical encoding

For client-side maps, sets and React keys, the pair is encoded as one string:

```
sessionKey(groupId, date) === groupId + "|" + date
```

This encoding already exists, hand-inlined, in **three** files —
`teacher-workspace.ts` (3 uses), `teacher-overview.tsx` (2 uses), and
`useMarkedSessions` in `queries.ts` — which is precisely the duplication this
file removes. `session-key.ts` becomes its single definition, with a matching
`parseSessionKey`. Any module needing to group data by session uses it. The pipe
is safe: both halves are a UUID and an ISO date, neither of which can contain
one.

### 2.3 The one place that changes if the business rule changes

If Gestion École ever permits a group to meet twice in one day, **`SessionKey` is the
single point of change** — plus the constraint that guarantees it. Every module
that used the key correctly is fixed by fixing the key.

This is recorded deliberately. A `session_id` retrofit after six modules have
shipped would touch all of them; the cost of that future is bounded only because
identity lives in one file. **Never re-derive the key inline.**

---

## 3. Session lifecycle

A session has no stored row and therefore no stored state. Its status is
**derived on read** from three inputs: the timetable pattern, the calendar date,
and the attendance rows that exist for it.

```
group_schedules (weekly pattern)
  + groups.start_date / end_date (term window)
  + a requested [from, to] window
        │
        ▼  occurrencesForGroups()  — pure, already exists
   SessionOccurrence  (group, slot, date, startsAt)
        │
        + attendance aggregate for (group_id, session_date)
        + enrolled count for group_id
        ▼  deriveStatus()  — pure
   SessionInstance  (the Spine)
```

### 3.1 Derived status

Status is a **function**, never a column. Given `enrolled`, `markedCount` and
the session's date relative to today:

| Condition | Status | Semantic |
|---|---|---|
| `enrolled === 0` | `empty` | Nothing to mark; points at Inscriptions |
| `markedCount === enrolled` (and `enrolled > 0`) | `complete` | Done |
| `0 < markedCount < enrolled` | `partial` | Started, unfinished |
| `markedCount === 0` and `date < today` | `overdue` | **Owed** |
| `markedCount === 0` and `date === today` | `due` | Actionable now |
| `markedCount === 0` and `date > today` | `scheduled` | Nothing owed yet |

Ordering matters: `empty` is tested first, so a group with no enrolments never
reports as `overdue` and never inflates the "en retard" counter. A session
nobody can attend is not a debt.

`cancelled` is reserved as a seventh state (§8.2). It is excluded from all
counters. No storage exists for it yet; the type admits it so adding it later is
not a breaking change to consumers' exhaustive switches.

### 3.2 Why derived and not stored

Storing status would require a write for every session that merely *becomes*
overdue by the passage of midnight — a cron job, or a lie. Deriving it means the
answer is always correct as of the moment it is read, and a year of lessons
still costs the handful of `group_schedules` rows the current model already
keeps. This mirrors the reasoning already documented in `schedule.ts`.

### 3.3 Counters

The three header counters are a fold over the visible sessions, computed *after*
filtering, so they always describe what the user is looking at:

- **`séances`** — all sessions in the period, `cancelled` excluded.
- **`à pointer`** — `due` + `partial`. Work available now.
- **`en retard`** — `overdue` only. Work owed.

`en retard` reaching zero must mean *every past session in the period has
attendance*. This is an acceptance criterion, and §5.2 exists because the
obvious implementation silently violates it.

---

## 4. Data flow and module responsibilities

### 4.1 The Spine, and what is deliberately not in it

`useSessions()` returns the **Session Spine** and nothing else:

```ts
interface SessionInstance {
  key: string;                    // groupId + "|" + date
  groupId: string;
  groupName: string;
  subjectId: string | null;
  subjectKey: string | null;      // i18n identity — see §6
  subjectName: string | null;     // DB fallback for custom subjects
  subjectColor: string | null;    // tint source — see §6
  teacherId: string | null;
  teacherName: string | null;
  room: string | null;
  date: string;                   // ISO YYYY-MM-DD, local
  startTime: string;              // "08:00"
  endTime: string;                // "10:00"
  startsAt: Date;                 // local, for ordering and past/future
  enrolled: number;
  attendance: AttendanceRollup;   // { marked, present, absent, late, excused }
  status: SessionStatus;          // derived, §3.1
}
```

**Homework, course resources, notes and announcements are not in this type and
must never be added to it.** The rule:

> The session is the **hub**, not the owner. Each module owns its own table, its
> own query, its own cache key, and its own hook. A module contributes at most a
> *lightweight summary* to the calendar, fetched by its own hook keyed on the
> same window — never by `useSessions` reaching into it.

Concretely, **course resources** -- the next module planned -- will let a
teacher attach PDFs, images and videos to a session, and let students read them.
It ships `useResourceSummaries({from, to})` returning
`Map<SessionKey, {count}>`, and the calendar composes:

```
useSessions(window)             → the spine
useResourceSummaries(window)    → optional badge overlay
```

Note what does NOT enter the spine: file names, URLs, MIME types, sizes. A count
is enough to render a badge; the files themselves load when a session is
opened.

The dependency arrow points **inward**: modules know about `SessionKey`;
`useSessions` knows about no module. This is what keeps Phase 2 closed once it
ships — adding course resources later does not reopen `use-sessions.ts`.

### 4.2 Layer responsibilities

| Layer | File | Owns | Must not |
|---|---|---|---|
| Identity | `session/session-key.ts` | encode/parse the pair | know about attendance |
| Types | `session/types.ts` | `SessionInstance`, `SessionStatus` | import React or Supabase |
| Derivation | `session/status.ts` | status + counters, **pure** | fetch anything |
| Assembly | `session/use-sessions.ts` | join occurrences + aggregates | derive status inline |
| Recurrence | `school/schedule.ts` *(existing)* | pattern → dates | know about attendance |
| Persistence | `school/queries.ts` *(existing)* | Supabase reads/writes | derive status |

`status.ts` being **pure** is a hard requirement, not a preference: it is the
only way Phase 3 can be *validated with unit tests and no database*, which is
what "no UI yet" demands.

---

## 5. Query strategy

### 5.1 Three inputs, three queries

| Need | Source | Notes |
|---|---|---|
| Timetable + term + subject + teacher + room | `useGroups()` *(existing, unchanged)* | already cached, already used by 14 call sites |
| Per-session attendance aggregate | **new** `useSessionSummaries(from, to)` | reads the new view, §5.2 |
| Enrolled count per group | **new**, from the enrollment view, §5.3 | replaces a full table scan |

Recurrence expansion stays **client-side** via `occurrencesForGroups()`. A
deliberate reaffirmation: the pattern is tiny, the expansion is pure and already
bounded by `MAX_OCCURRENCES`, and there is no server API layer in this
architecture to move it to. Supabase is queried directly from the client by
design.

### 5.2 Why the aggregate must be SQL — a correctness bug, not a performance one

The existing `useMarkedSessions` selects `group_id, session_date` and collapses
them to a boolean *"was this marked?"*. That shape cannot express
`6/14 pointés`; partial is undetectable. Its narrowness was correct for its
consumer and is simply insufficient for a calendar.

The naive fix — fetch attendance rows for the window and count client-side — is
**wrong**, and this is the most important finding in this design:

`useAttendanceRange` caps at `.limit(2000)` with no truncation detection. A
month view for a whole school is plausibly 30 groups × 4 sessions × 20 students
≈ **2,400 rows**. Past the cap, rows silently vanish, sessions appear unmarked
or partially marked, and **`en retard` reads low**. The acceptance criterion
*"`en retard` reaches 0 only when every past session has attendance"* would be
satisfiable while sessions are genuinely unmarked.

A silent under-count of owed work is a correctness failure wearing a
performance costume. Aggregating in Postgres removes the row cap as a concept:
~2,400 rows collapse to ~120, one per session.

**Decision: an aggregated view, not an RPC.** A view is composable — PostgREST
gives `.gte()` / `.lte()` / `.in()` filtering for free, so one view serves the
calendar window, a single session, and future reports without a signature per
caller. An RPC would fix the argument list at design time.

The view must be **`security_invoker = true`**. This is critical, and this
codebase has no view precedent to copy, so it is stated explicitly: a view
created without it runs as its owner and would **bypass the `attendance` RLS
policies**, exposing every group's attendance to every authenticated user. With
`security_invoker`, the caller's own policies apply and existing teacher scoping
continues to hold unchanged.

### 5.3 Enrollment count

`useGroups` currently fetches **every** `registrations` row to compute integer
counts; `useRegistrations` fetches every row *plus* every profile for the same
purpose. Two independent unbounded scans of the fastest-growing table, behind 14
`useGroups()` call sites.

A grouped view returning `(group_id, approved_count)` replaces both for counting
purposes. `enrolled === 0` drives a real product behaviour (§3.1, `empty`), so
this number must be exact, not approximate.

### 5.4 Index

Existing coverage: `UNIQUE (group_id, student_id, session_date)` serves
group-first lookups; `idx_attendance_session_date` serves date-only. The
calendar's access pattern is **date-range across many groups**, which uses the
date index then filters. A composite `(session_date, group_id)` serves it
directly and matches the new view's grouping.

### 5.5 Backward compatibility

Non-negotiable, per the accepted decisions:

- **No table or column is altered.** The migration adds two views and one index.
- **`useMarkedSessions`, `useAttendance`, `useAttendanceRange`,
  `useMyAttendance`, `useTodayAttendance`, `useGroups` and `useRegistrations`
  keep their current signatures and behaviour.** `teacher-workspace.ts` depends
  on `useMarkedSessions`' exact semantics; the new aggregate ships **alongside**
  it rather than editing it.
- Existing RLS, the `validate_attendance_occurrence` trigger and the
  `one_session_per_day` constraint are untouched and remain the authority.

Migrating `teacher-workspace.ts` onto the Spine is a *later, optional*
simplification — it currently re-derives much of §3 by hand — and is explicitly
out of scope here.

---

## 6. i18n and RTL

Three locales from day one: **fr, ar, en**. No hardcoded strings anywhere.

- All session vocabulary lives under a new `entity.session.*` namespace:
  statuses, counters, view switch, filters, drawer labels, quick actions.
- **Status keys are locale-independent identities.** `SessionStatus` is
  `"overdue"`, never `"Non pointée"`. The label is
  `t("entity.session.status.overdue")`. A status is data; its French rendering
  is presentation.
- Subjects already solve this: the DB stores `key` (`mathematics`) and
  `useSubjectLabel()` resolves it, falling back to the stored `name` for custom
  subjects. Sessions reuse that hook. This is why the Spine carries
  `subjectKey` *and* `subjectName`.
- **Colours come from tokens and from the database.** `subjects.color` already
  exists and `useGroups` already reads it; tints derive from it via
  `color-mix`. The fallback cycle applies only when a subject has no colour.
  `styles.css` states the rule — *"Tokens only. Never hardcode colors in
  components."*
- **RTL is structural, not a coat of paint.** Every directional property in the
  calendar and drawer uses logical CSS: `border-inline-start`, `padding-inline`,
  `margin-inline-start`, `inset-inline-end`. A literal `border-left` on a
  session card inverts wrongly in Arabic. `styles.css` already holds this line
  (`surface-alert` uses `border-inline-start`). Getting the grid right in Arabic
  from the start is far cheaper than retrofitting it.
- Weekday and month labels come from `Intl` with the active locale, not a
  hand-written array. `formatDate` in `lib/format.ts` already establishes the
  per-locale tag choice, including Latin digits for Arabic scannability.
- Dates are **local** calendar dates throughout. `todayIso()` / `toLocalIso()`
  only; never `toISOString().slice(0, 10)`, which shifts a day east of
  Greenwich after ~22:00 — a silent data bug in an attendance system, and
  already the subject of audit finding P1-1.

---

## 7. Cache strategy

### 7.1 Keys

All session-derived keys nest under the existing `attendanceRoot`
(`["attendance"]`) so that **one write invalidates every consumer**, including
ones added later:

```
["attendance", "session-summaries", from, to]   // the aggregate view
["attendance", "roster", groupId, date]         // existing, unchanged
["group-enrollment-counts"]                     // enrollment view
```

The `attendanceRoot` comment in `queries.ts` documents three real bugs caused by
naming caches individually — a stale pending count, a stale student portal and a
stale admin dashboard, reproduced across two tabs. That pattern is inherited
deliberately, not re-litigated.

### 7.2 The window must be in the key

`markedSessions: (from) => [..., from]` omits the upper bound while its queryFn
filters `.gte(from)` with no `to`. Harmless for one open-ended consumer;
**wrong** the moment a bounded window is requested, because August and September
would share a cache entry and serve each other's rows.

**Every windowed key carries both ends.** A rule for all future session
modules, not just attendance.

### 7.3 Freshness

The global default (`staleTime: 60_000`, `gcTime: 5 * 60_000` in `router.tsx`)
is correct for a timetable and needs no override. Navigating between weeks
produces distinct keys and therefore distinct cache entries; stepping back to a
visited week is instant.

### 7.4 Optimistic writes

A Phase 6 concern, recorded here because the cache shape must anticipate it:

- Save posts **only changed entries**, per audit finding P1-3. Two people with
  the same register open then merge instead of last-write-wins. Sending the
  whole roster would reintroduce a resolved bug.
- The optimistic update patches the aggregate entry for one `SessionKey`, so a
  card's status changes in place without a refetch.
- Rollback restores the previous cache snapshot and surfaces a toast. The audit
  notes that no optimistic update exists today, so there is nothing to roll back
  — introducing one means introducing the rollback in the same change.
- Unsaved-marks protection carries over to the drawer. Closing on scrim-click or
  `Esc` can discard a marked register exactly as switching groups once did
  (finding P1-2); the guard must cover all three exits.

---

## 8. Future extension points

### 8.1 Adding a module

The checklist, in order:

1. Own table, keyed `(group_id, session_date)` + `UNIQUE`, with an FK to
   `groups` and `ON DELETE CASCADE`.
2. RLS mirroring `attendance`: **write** for an admin or the group's own
   teacher; **read** additionally for enrolled students. Attendance already
   works this way -- students can view their own attendance but never record
   it -- and course resources will need the same asymmetry.
3. A `validate_*_occurrence` trigger if the module must not attach to an
   unscheduled date — reuse the existing function's shape.
4. Its own hook and its own cache key under its own root.
5. Optionally, a `Map<SessionKey, Summary>` hook for a calendar badge.
6. `entity.session.<module>.*` i18n keys in all three locales.
7. **No edit to `use-sessions.ts` or `SessionInstance`.**

If a module cannot be added without touching the Spine, that is the signal the
Spine's boundary was drawn wrong — reopen this ADR rather than widening the type.

### 8.2 Known future work, deliberately deferred

- **`cancelled` sessions / holidays** — needs a `session_exceptions` table keyed
  on `(group_id, date)`. `SessionStatus` already admits the state; nothing
  stores it yet.
- **Two sessions per day** — see §2.3. Bounded to `SessionKey` plus one
  constraint.
- **Course resources** — teacher-uploaded PDFs / images / videos per session,
  readable by enrolled students. Follows §8.1 exactly: own table keyed
  `(group_id, session_date)`, own hook, own cache key, a count-only summary for
  the calendar. Requires a Supabase Storage bucket with its own policies; no
  change to the spine.
- **`attendance_marked` notifications** — the enum value exists and nothing
  emits it (finding P2-4). A session-shaped payload is what that finding was
  waiting for.
- **Report/export reuse** — the report re-derives its own range logic (P2-3); it
  should fold onto the Spine when next touched.
- **RLS error copy** — `42501` renders as a generic error (P2-2); the drawer
  should say *"this group is not yours"*.
- **`teacher-workspace.ts` consolidation** — see §5.5.

---

## 9. What this ADR does not change

- Recurrence stays client-side and derived.
- No server API is introduced.
- `validate_attendance_occurrence` remains the authority on whether a date is
  valid, so *"Ce groupe n'a pas cours à cette date"* is impossible at the data
  layer rather than merely hidden in the UI.
- RLS remains the authority on visibility. Teacher scoping in the UI is
  cosmetic; the server already enforces it, which is the correct order.
- The `one_session_per_day` constraint remains the foundation of §2.
