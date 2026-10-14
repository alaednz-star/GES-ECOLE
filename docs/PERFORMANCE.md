# Performance Audit

Measured from a real production build (`npm run build`) on 2026-08-02.

---

## 1. Bundle

| Chunk | Size (uncompressed) |
| --- | --- |
| `index-*.js` (vendor: router, react, supabase) | 579 KB |
| `use-i18n-*.js` (**all three locale dictionaries**) | 120 KB |
| `auth-*.js` | 91 KB |
| `routes-*.js` | 47 KB |
| `dashboard-*.js` | 47 KB |
| `createLucideIcon-*.js` | 32 KB |
| **Total client JS** | **~1.18 MB** |

For a dashboard SaaS this is acceptable but not lean. Three concrete wins:

### P1 — All three locales ship to every user (~120 KB, ~80 KB wasted)
`dictionaries.ts` statically imports French, Arabic, and English. Every visitor downloads all three
and uses one. Dynamic-import the non-default locales and load on switch.

### P2 — ~23 unused shadcn components are compiled in
Verified unused by the application (after excluding `tooltip` and `separator`, which `sidebar.tsx`
imports transitively): `alert`, `aspect-ratio`, `breadcrumb`, `calendar`, `carousel`, `chart`,
`context-menu`, `drawer`, `hover-card`, `input-otp`, `menubar`, `navigation-menu`, `pagination`,
`popover`, `radio-group`, `resizable`, `scroll-area`, `slider`, `switch`, `tabs`, `toggle`,
`toggle-group`, `card`.

Tree-shaking removes most unreferenced code, but these keep six dependencies in `package.json` that
would otherwise go: `recharts` (the largest), `embla-carousel-react`, `input-otp`, `vaul`,
`react-resizable-panels`, `react-day-picker`. `date-fns` has **zero** imports anywhere.

`cmdk` **is** used (`global-search.tsx`) — keep it.

### P3 — No route-level code splitting beyond the router default
Admin-only routes are in the shared `dashboard-*.js` chunk, so students download admin screens they
can never open.

---

## 2. Database query patterns

### P4 — Client-side joins instead of SQL joins (N+1-shaped)

Three hooks fetch entire tables to resolve a name or count in JavaScript:

| Location | Pattern |
| --- | --- |
| `useTeachers` | Fetches **every** row of `groups` to count each teacher's groups |
| `useStudents` | Fetches **every** approved registration to count each student's groups |
| `useGroups` | Fetches **every** profile and **every** registration to map names and enrolment |
| `useRegistrations` | Fetches **every** profile to resolve student names |

`useGroups` issues three full-table reads on each load. With 500 students and 2,000 registrations
this transfers megabytes to render one table.

Fix: resolve names through PostgREST's embedded selects (already used correctly elsewhere in the
same file), and move counts into a Postgres view or an RPC returning aggregates.

### P5 — No pagination anywhere
`useStudents`, `useTeachers`, `useGroups`, and `useRegistrations` fetch unbounded result sets. The
only `limit()` in the entire data layer is `useMyAttendance`'s `.limit(50)`. `data-table.tsx`
paginates **after** the full set is in memory.

Fix: `.range()` with server-side pagination, wired to the table's page state.

### P6 — Zero indexes (see `DATABASE.md` §6)
Every filtering foreign key is unindexed, and RLS subqueries execute per scanned row. This is the
single highest-leverage database change and is a pure additive migration.

### P7 — No `staleTime` configured
`getRouter()` creates a bare `QueryClient`. Every query defaults to `staleTime: 0`, so reference
data that changes monthly — levels, subjects — refetches on every mount and window focus. Set a
sensible default (e.g. 5 minutes) and raise it further for static lookups.

---

## 3. React rendering

Largely fine. `AuthProvider` and `I18nProvider` correctly `useMemo` their context values and
`useCallback` their handlers, avoiding whole-tree re-renders.

### P8 — `data-table.tsx` re-filters and re-sorts on every render
Filtering and sorting run inline in the render body without `useMemo`. Invisible at 12 rows, a
problem at 500 combined with P5.

### P9 — No virtualization
Acceptable once P5 lands; would matter for long rosters rendered in one page.

---

## 4. Network

- `hydrate()` runs two sequential-in-effect queries per sign-in — correctly parallelized with
  `Promise.all`. Good.
- `LocaleSync` writes `profiles.locale` on **every** locale change with no debounce. Minor.
- Google Fonts are loaded from a third-party origin with `preconnect`. Self-hosting would remove
  two DNS/TLS round-trips and a privacy dependency.

---

## Priority order

| # | Item | Effort | Impact |
| --- | --- | --- | --- |
| P6 | Add indexes | Trivial | Very high at scale |
| P7 | Configure `staleTime` | Trivial | Immediate |
| P4 | Replace client-side joins | Medium | Very high at scale |
| P5 | Server-side pagination | Medium | Very high at scale |
| P2 | Delete unused components + deps | Low | Moderate |
| P1 | Lazy-load locales | Low | Moderate |
| P3 | Split admin routes | Low | Moderate |
| P8 | Memoize table derivations | Trivial | Low now |
