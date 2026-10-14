# Routes

File-based routing via TanStack Router. `src/routeTree.gen.ts` is generated — never edit it.

---

## Public

| File | URL | Notes |
| --- | --- | --- |
| `index.tsx` | `/` | Marketing landing page |
| `login.tsx` | `/login` | |
| `register.tsx` | `/register` | Always creates a `student` |
| `forgot-password.tsx` | `/forgot-password` | Sends reset email |
| `reset-password.tsx` | `/reset-password` | Consumes recovery link |

## Dashboard

`dashboard.tsx` is the parent layout: `<RequireAuth>` → `<DashboardLayout>` → `<Outlet />`.
Every child therefore requires authentication; the `roles` column below is the *additional*
restriction each child declares.

| File | URL | Roles | Notes |
| --- | --- | --- | --- |
| `dashboard.index.tsx` | `/dashboard` | any | Dispatches by role to Admin/Teacher/Student overview |
| `dashboard.students.tsx` | `/dashboard/students` | admin | CRUD + CSV export |
| `dashboard.teachers.tsx` | `/dashboard/teachers` | admin | CRUD + subject assignment |
| `dashboard.subjects.tsx` | `/dashboard/subjects` | admin | CRUD |
| `dashboard.levels.tsx` | `/dashboard/levels` | admin | CRUD |
| `dashboard.groups.tsx` | `/dashboard/groups` | **admin, teacher** | ⚠️ see below |
| `dashboard.registrations.tsx` | `/dashboard/registrations` | admin | Approve / reject |
| `dashboard.attendance.tsx` | `/dashboard/attendance` | admin, teacher | Daily marking |
| `dashboard.settings.tsx` | `/dashboard/settings` | admin | Centre configuration |
| `dashboard.teacher.tsx` | `/dashboard/teacher` | admin, teacher | Teacher workspace |
| `dashboard.student.tsx` | `/dashboard/student` | admin, teacher, student | Student workspace |
| `dashboard.registration.tsx` | `/dashboard/registration` | student | Self-enrolment |

### ⚠️ `dashboard.groups.tsx` role mismatch
The route admits teachers, but `config/navigation.ts` lists Groups as `roles: ["admin"]` and RLS
permits `groups` writes to admins only. There is no in-component gating, so a teacher who navigates
directly sees the full CRUD UI and every write fails at the database. Either restrict the route to
`admin`, or render a read-only view for teachers. Tracked as M1 in `SECURITY.md`.

## Declared in navigation but not implemented

`config/navigation.ts` marks these `comingSoon: true`; no route files exist. `navigableItems()`
filters them out of global search, and the sidebar renders them as non-navigable.

`/dashboard/payments`, `/dashboard/invoices`, `/dashboard/reports`, `/dashboard/users`,
`/dashboard/security`

## Guard mechanics

`RequireAuth` (`src/features/auth/require-auth.tsx`):
1. `status === "loading"` → `<FullPageLoader />`
2. not authenticated → `<Navigate to="/login" replace />`
3. `roles` given and unmatched → `<Navigate to="/dashboard" replace />`
4. otherwise render children

This runs at **render time in the browser**, not in `beforeLoad`. Route code is fetched and
executed before the check. Data remains protected by RLS; see H1 in `SECURITY.md`.

`ROLE_HOME` in `types/auth.ts` maps each role to its landing route
(`admin → /dashboard`, `teacher → /dashboard/teacher`, `student → /dashboard/student`).

## Error handling

`__root.tsx` supplies `notFoundComponent` (translated 404) and `errorComponent` (reports to the telemetry host
telemetry, offers retry/home). `src/server.ts` additionally recovers SSR errors that h3 would
otherwise flatten into an opaque JSON 500, rendering `lib/error-page.ts` instead.
