# Gestion École

**Gestion École** is a school-management application for private schools and tutoring
centres: online pre-registration and enrolment, groups and timetables, attendance, lesson
log and grades, fees, payments and invoices, staff, course material, and communication with
students and families.

Trilingual (French, Arabic, English) with full right-to-left support. Runs in the browser
and as a Windows desktop application that keeps classroom work going without internet.

## One installation, one school

Each installation serves one school, with its own Supabase project and its own database.
There is no multi-tenancy.

The school's identity is **configuration, not code**. Its name, logo, colours, description
and contact details live in the single `center_settings` row and reach the interface through
`BrandProvider`, set by the administrator in **Paramètres → Identité visuelle**. Until a
school is configured, the application presents itself as Gestion École.

## Stack

| Layer | Technology |
| --- | --- |
| Framework | TanStack Start (React 19, SSR, server functions) |
| Language | TypeScript, strict mode |
| Data | Supabase (PostgreSQL, Auth, Storage, Row Level Security) |
| Server state | TanStack Query |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Build | Vite 8 |
| Desktop | Tauri 2 (Windows, WebView2) |

## Getting started

```sh
npm ci
npm run dev
```

The app runs at **http://localhost:8080** and needs a Supabase database: a local stack for
development (Docker + Supabase CLI). Full setup: [LOCAL_SETUP.md](LOCAL_SETUP.md).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server on :8080 |
| `npm run build` | Production web build |
| `npm run test:unit` | Unit tests (`node --test`) |
| `npx tsc --noEmit` | Typecheck |
| `npm run lint` | ESLint |
| `npm run seed:demo` | Optional local demo data (refuses non-local databases) |
| `npm run desktop:ui:local` | Desktop UI against the local stack (`dist-desktop/`) |
| `npm run desktop:build` | Desktop installers (NSIS `.exe`, `.msi`) from the values in `.env` |

## Environment

Copy [.env.example](.env.example). The Supabase URL and the **publishable** key are public by
design: they ship in the browser bundle, and Row Level Security protects the data.

**Never commit `SUPABASE_SERVICE_ROLE_KEY`.** It bypasses Row Level Security. It is read only
by server code (`*.server.ts`), from a server-side environment variable, and never reaches
the browser or the desktop bundle.

## Database

Schema, policies and reference data live in [supabase/migrations/](supabase/migrations/),
applied in filename order. Every table has Row Level Security enabled: the rules are enforced
in the database, not only in the interface.

## Documentation

| Document | Contents |
| --- | --- |
| [LOCAL_SETUP.md](LOCAL_SETUP.md) | Local development: prerequisites, database, tests, desktop builds |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Installing for a school: Supabase, hosting, first administrator, desktop release |
| [docs/PROJECT_KNOWLEDGE_BASE.md](docs/PROJECT_KNOWLEDGE_BASE.md) | Engineering memory: features, data model, rules, hazards |
| [docs/MASTER_ROADMAP.md](docs/MASTER_ROADMAP.md) | Roadmap and status |
| `docs/ADR-*.md` | Architecture decisions, by domain |
| [docs/SECURITY.md](docs/SECURITY.md) | Security model |
| [TECH_DEBT.md](TECH_DEBT.md) | Technical debt register |
