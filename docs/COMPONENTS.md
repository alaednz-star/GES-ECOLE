# Components

---

## `src/components/common/` — application building blocks

| Component | Purpose |
| --- | --- |
| `data-table.tsx` (288 ln) | Generic table: column defs, search, sort, client pagination, empty state |
| `page-header.tsx` | Title + description + action slot; used by every dashboard page |
| `section-card.tsx` | Titled content card |
| `stat-card.tsx` | KPI tile with icon, value, trend |
| `status-badge.tsx` | Coloured badge for `entity_status` / `registration_status` |
| `empty-state.tsx` | Icon + message + optional CTA |
| `confirm-dialog.tsx` | Destructive-action confirmation |
| `full-page-loader.tsx` | Route-level loading state |
| `language-switcher.tsx` | Locale dropdown |
| `brand.tsx` | Logo + wordmark |

This layer is the codebase's strongest asset. The abstractions are the right ones, they are used
consistently across all admin pages, and they are what keeps the 250–580 line route files as
readable as they are.

`data-table.tsx` is well designed but paginates **after** loading the full result set — see P5/P8
in `PERFORMANCE.md`.

## `src/components/layout/`

| Component | Purpose |
| --- | --- |
| `app-sidebar.tsx` | Role-filtered navigation from `config/navigation.ts`; renders `comingSoon` items disabled |
| `dashboard-topbar.tsx` | Sidebar toggle, global search trigger, language switcher, user menu |
| `global-search.tsx` | `cmdk` command palette over `navigableItems(role)` |

## `src/components/ui/` — shadcn/ui primitives

58 components, style `new-york`, Radix-based, `cn()` for class merging. These are vendored library
code: **do not hand-edit them**, and do not count them as project code when assessing quality.

### Unused (≈23)
`alert`, `aspect-ratio`, `breadcrumb`, `calendar`, `card`, `carousel`, `chart`, `context-menu`,
`drawer`, `hover-card`, `input-otp`, `menubar`, `navigation-menu`, `pagination`, `popover`,
`radio-group`, `resizable`, `scroll-area`, `slider`, `switch`, `tabs`, `toggle`, `toggle-group`

Removing these also releases `recharts`, `embla-carousel-react`, `input-otp`, `vaul`,
`react-resizable-panels`, and `react-day-picker` from `package.json`.

**Keep**, despite appearing unreferenced by application code — `sidebar.tsx` imports them:
`tooltip`, `separator`.
**Keep** — genuinely used: `command` (global search), `sonner`, `sheet`, `skeleton`, `dialog`,
`alert-dialog`, `dropdown-menu`, `select`, `input`, `label`, `button`, `badge`, `table`, `form`,
`checkbox`, `avatar`, `progress`, `textarea`, `collapsible`, `accordion`.

## `src/features/`

### `auth/`
`auth-provider.tsx` (context + session state), `require-auth.tsx` (guard), `schemas.ts` (Zod
factories taking a translator so messages are localized), `components/login-form.tsx`,
`components/register-form.tsx`.

### `school/`
`queries.ts` (639 ln — every hook for six domains), `types.ts` (row view models),
`schedule.ts` (weekday helpers), `components/student-overview.tsx`,
`components/teacher-overview.tsx`.

`queries.ts` is the main structural debt: six unrelated domains in one module. Splitting it into
`queries/levels.ts`, `queries/groups.ts`, etc. with a shared `schoolKeys` registry is mechanical and
low-risk.

### `marketing/`
`landing-sections.tsx` (655 ln of dictionary-driven copy), `hero-showcase.tsx`, `mockups.tsx`,
`reveal.tsx` (IntersectionObserver scroll animation).

## `src/hooks/`

| Hook | Purpose |
| --- | --- |
| `use-auth.ts` | `AuthContext` accessor; throws outside the provider |
| `use-i18n.ts` | `I18nContext` accessor |
| `use-mobile.tsx` | `matchMedia` breakpoint |
| `use-count-up.ts` | Animated number for landing stats |
| `use-in-view.ts` | IntersectionObserver wrapper |

All are small and single-purpose. No changes needed.

## Conventions worth preserving

- Business logic lives in `features/*/queries.ts`, not in components.
- Every user-facing string goes through `t()`. No hardcoded copy in components.
- Route files compose `common/` primitives rather than bespoke markup.
- `cn()` for all conditional class composition.
- Colours come from Tailwind CSS variables, not hex literals — with one exception: the default
  subject colour `#0F766E` is hardcoded in both `queries.ts` and the database default.
