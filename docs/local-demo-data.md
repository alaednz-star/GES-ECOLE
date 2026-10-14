# Local demo data

A complete, repeatable dataset for clicking through Gestion École as an admin, a teacher and a
student. **Local only** — the seed reaches the database through `scripts/e2e/fixtures.mjs`,
which refuses any Supabase URL that is not `127.0.0.1`/`localhost`, and writes through
`/pg/query`, an endpoint that exists only on the local stack.

## Prerequisites

```bash
supabase start          # local stack on 127.0.0.1:55321
npm run dev             # app on http://localhost:8080
```

`.env.local` must hold the local `SUPABASE_SERVICE_ROLE_KEY` and
`VITE_SUPABASE_PUBLISHABLE_KEY` — the same file the e2e suites read.

## Seed

```bash
npm run seed:demo          # reseed the demo data, leave any other local rows alone
npm run seed:demo:fresh    # also clear OTHER local groups and leftover e2e-fixture accounts
npm run verify:demo        # sign in as all three roles in a real browser and check what they see
```

Both seed modes are safe to run as often as you like. The three login accounts are **reused
and reset**, never duplicated; the six demo groups and everything hanging off them are removed
and rebuilt, so counts do not drift between runs.

`--fresh` deletes school **content** only. It never deletes a human's account — your own admin
login survives it and simply ends up with no groups. Use it when the local database has
accumulated junk from repeated development and you want the catalogue to show exactly the demo
set.

### Reset from scratch

```bash
supabase db reset                # rebuild the schema from supabase/migrations
node scripts/seed-demo-data.mjs --fresh
```

## Logins

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin.demo@demo.gestion-ecole.local` | `AdminDemo2026!` |
| Teacher | `teacher.demo@demo.gestion-ecole.local` | `TeacherDemo2026!` |
| Student | `student.demo@demo.gestion-ecole.local` | `StudentDemo2026!` |

Two more teacher accounts exist because a group needs a qualified owner and `teachers.id`
references a real account: `mehdi.demo@demo.gestion-ecole.local` and `sarah.demo@demo.gestion-ecole.local`, both
`TeacherDemo2026!`. The twenty filler students share `EleveDemo2026!` and are there to make the
capacity figures real rather than invented.

## What gets created

**Reference data is reused, never duplicated** — the level `3ème année secondaire`, the stream
`Sciences expérimentales` and the five subjects already exist from the migrations.

| Teacher | Subjects | Experience |
| --- | --- | --- |
| Karim Belkacem (`teacher.demo`) | Mathématiques | 14 years |
| Mehdi Saadi | Physique | 9 years |
| Sarah Benali | Sciences Naturelles, Français, Anglais | 6 years |

All three have a real photo, rendered as a PNG and uploaded to the `avatars` bucket at
`<uid>/avatar.png`, with `profiles.avatar_url` pointing at it. Nothing is hardcoded in React.

| Group | Teacher | Room | When | Approved / capacity |
| --- | --- | --- | --- | --- |
| 3AS Sciences — Mathématiques | Belkacem | A5 | Sunday 14:00–16:00 | **14 / 20** |
| 3AS Sciences — Mathématiques | Belkacem | A6 | Tuesday 16:00–18:00 | 0 / 18 |
| 3AS Sciences — Physique | Saadi | B2 | Monday 14:00–16:00 | **12 / 15** |
| 3AS Sciences — Sciences Naturelles | Benali | C1 | Wednesday 15:00–17:00 | **20 / 20 (full)** |
| 3AS Sciences — Français | Benali | A3 | Thursday 16:00–18:00 | 8 / 18 |
| 3AS Sciences — Anglais | Benali | A2 | Saturday 10:00–12:00 | 10 / 20 |

Chapters and resources sit on the maths A5 and physics B2 groups: nine resources across seven
chapters, including a downloadable PDF course, a PDF exercise sheet, two YouTube links, a
consultation-only corrigé (`allow_download = false`), an unpublished draft, and a **published
resource inside an unpublished chapter** so the "chapter published AND resource published" rule
has something to prove.

## The student's four states

Signed in as `student.demo`, `/dashboard/registration` shows all four at once:

| State | Where |
| --- | --- |
| **Approved** | Mathématiques A5 |
| **Pending** | Physique B2 |
| **Rejected**, with the administration's note | Français A3 |
| **`takenSubject`** | Mathématiques A6 — blocked because A5 is already held |

The last one is the real product rule: **one active enrolment per subject and level**, enforced
by `enforce_one_group_per_subject`. It is not a timetable clash, and no schedule-overlap wording
appears anywhere.

## What the seed refuses to fake

Every row goes in through the same constraints the application obeys. If the seed can produce a
state, the app can too.

- **Roles** come from `provision_staff`. Nothing writes `user_roles` directly, and no client
  chooses its own role.
- **Capacity**: only approved registrations consume a seat, so every enrolment is inserted as
  `pending` and then decided — which is also what makes the counts above trustworthy.
- **Notifications** are not inserted. They are produced by `t_registration_decided`,
  `t_resources_notify_publication` and `t_chapters_notify_publication`, which is why enrolments
  happen *before* content is published: a resource published to an empty group notifies nobody.
- **Files** are real. The PDFs are structurally valid single-page PDFs uploaded to
  `course-resources` at `<groupId>/<uuid>/<name>`, the path the app itself uses.
- **Student occupancy stays hidden.** A student cannot read other students' registrations, so
  the catalogue shows class *size*, never a ratio. See `docs/enrollment-seat-counts.md`.

The one deliberate step outside the production path: `provision_staff` sets
`password_change_required = true` so a real hire must rotate their temporary password. The seed
clears that flag, because a documented demo login has to work as documented. It changes a UX
flag, not an authorisation rule.

## Isolation from the test harness

Demo emails end in `@demo.gestion-ecole.local` and no demo group is named `e2e-fixture…`, so the e2e
harness's global `cleanupFixtures()` cannot touch any of this. Verified: after a full
`verify-enrollment-ui.mjs` run the six groups, seven chapters and nine resources were all still
there.
