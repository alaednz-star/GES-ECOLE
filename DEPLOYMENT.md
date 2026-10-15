# Deployment — Gestion École

How to install Gestion École for a school: one **new** Supabase project, one web deployment
(Vercel), then the Windows desktop installers built against those two. One installation serves
one school; nothing is shared between schools, and no earlier project or credential is reused.

---

## Release checklist (in order)

| # | Step | Section |
|---|---|---|
| 1 | Create a new, empty Supabase project for the school | §1 |
| 2 | Collect the project URL, publishable key and secret key | §2 |
| 3 | (Optional) enable `pg_cron` so daily reminders run automatically | §3 |
| 4 | Link this folder to the new project and apply the migrations (`--dry-run` first) | §3 |
| 5 | Configure Auth: Site URL, redirect URLs, custom SMTP | §4 |
| 6 | Create the Vercel project, set the environment variables, deploy | §5 |
| 7 | Create the first administrator | §6 |
| 8 | Configure the school (branding, billing identity) | §7 |
| 9 | Verify the deployment | §8 |
| 10 | Build and check the Windows installers against the deployed endpoints | §9 |

**Before a desktop release:** the web deployment (§5) must exist; the installers are built
against its address.

---

## 1. Create the Supabase project

Supabase Dashboard → **New project**, in the school's (or your) organisation. Choose the region
closest to the school (e.g. `eu-central`/Frankfurt for Algeria) and a strong database password
(stored in a password manager, never in this repository).

**Plan and limits to decide now:**

- **File size.** The `course-resources` bucket accepts files up to **250 MB** (migration
  `20260811100000`), but the project's global upload limit wins: **50 MB on the Free plan**.
  For larger course material, use a paid plan and raise **Storage → Settings → Upload file size
  limit**; otherwise uploads above 50 MB are refused.
- **E-mail.** The built-in mail service is for testing only (a few messages per hour). A custom
  SMTP provider is required (§4).

---

## 2. Values to collect

All from the new project's dashboard. None of them is committed to this repository.

| Value | Where to find it | Used as |
|---|---|---|
| Project URL `https://<ref>.supabase.co` | **Project Settings → Data API** (or the Connect dialog) | `VITE_SUPABASE_URL`, `SUPABASE_URL` |
| Project ref `<ref>` | the URL above, or **Project Settings → General** | `supabase link --project-ref` |
| Publishable key `sb_publishable_…` (or legacy `anon` key) | **Project Settings → API Keys** | `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY` |
| Secret key `sb_secret_…` (or legacy `service_role` key) | **Project Settings → API Keys** | `SUPABASE_SERVICE_ROLE_KEY` — **server only** |
| Web address of the deployment | Vercel, after §5 (e.g. `https://<project>.vercel.app` or the school's domain) | Auth Site URL (§4), `DESKTOP_SERVER_ORIGIN` (§9) |

The publishable key is public by design (it ships in the browser bundle and the desktop app; Row
Level Security protects the data). The secret key bypasses RLS: it goes only into the Vercel
server environment, never into `.env`, a desktop build, or a chat or e-mail.

---

## 3. Database — apply the migrations to the new project only

**3a. Optional: daily reminders.** The Communication migration schedules the daily reminders job
(07:00 UTC, `public.run_reminders()`) **only if `pg_cron` is already installed**. To have it
scheduled automatically, enable it first: **Database → Extensions → `pg_cron` → Enable**. If you
enable it later, schedule it once in the SQL Editor:

```sql
select cron.schedule('gestion-ecole-reminders', '0 7 * * *', 'select public.run_reminders()');
```

Without `pg_cron` everything else works; reminders simply are not sent automatically.

**3b. Link and push.** From this repository's folder, with the Supabase CLI:

```bash
supabase link --project-ref <ref>        # asks for the database password
cat supabase/.temp/project-ref           # must print the NEW project's ref
supabase db push --dry-run               # lists the migrations it would apply: all of them
supabase db push
```

- `supabase/config.toml` carries `project_id = "gestion-ecole"`, a local slug, not a ref: a push
  without `link` fails instead of reaching some other database.
- `link` writes `supabase/.temp/` (git-ignored). After linking, every `db push` goes to that
  project: re-check `supabase/.temp/project-ref` before any later push.
- The migrations create everything a fresh project needs: schema, RLS policies, functions,
  reference data (levels, streams, subjects, formation types), the `center_settings` row and
  the storage buckets. They need no existing data and no other extension.
- Many migrations end with post-condition checks that raise on failure: a partial apply stops
  loudly. If a push fails, read the error before retrying; do not `migration repair` to skip a
  failed file.
- Ordering facts: `20260806155000_teacher_lifecycle_enums.sql` precedes
  `20260806160000_teacher_lifecycle.sql` (an enum value cannot be used in the transaction that
  adds it); `20260811110000_resources_drop_is_important.sql` drops a column and must run in
  sequence. `supabase db push` applies them in filename order.

> **Rehearse once.** Migrations up to `20261009100000` have run on a hosted Supabase project;
> `20261014100000_communication.sql` and `20261015100000_neutral_school_default.sql` have only
> run on a local stack. The full sequence has not been applied in one go to an empty hosted
> project. Rehearse on a throwaway project (link it, `db push`, check, delete it), or with
> `supabase db reset` on a local stack, before the school's project.

---

## 4. Supabase Auth

**Authentication → URL Configuration**

| Setting | Value |
|---|---|
| Site URL | `https://<your-domain>` (the web deployment, §5) |
| Redirect URLs | `https://<your-domain>/**` |

Password-reset, account-setup and confirmation links redirect to the web deployment; an origin
missing from this list makes Supabase fall back to the Site URL, so the user lands on the wrong
page.

**Authentication → Sign In / Providers:** e-mail only. Students register themselves (sign-up
enabled); staff accounts are created by the administrator.

**Authentication → Emails → SMTP Settings → Enable custom SMTP** — required before real use:

| Field | Value |
|---|---|
| Sender e-mail / name | e.g. `no-reply@your-school.example` / the school's name |
| Host, port, username, password | from your SMTP provider (Brevo, Resend, Mailgun, Gmail Workspace…) |

The sender domain should have SPF/DKIM records at the provider, or messages land in spam. Then
send a test: request a password reset from the login page once the site is deployed.

---

## 5. Web deployment (Vercel)

1. **Add New → Project**, import this GitHub repository, branch `main`. No `vercel.json` is
   needed: the build uses Nitro's `vercel` preset and writes the Build Output API format.
   Vercel installs with Bun (`bun.lock`, with the 24-hour release-age guard in `bunfig.toml`);
   `package-lock.json` is kept in sync for npm.
2. **Settings → Environment Variables**, scope **Production** (and Preview if previews should
   authenticate):

   | Name | Value | Visibility |
   |---|---|---|
   | `VITE_SUPABASE_URL` | Project URL | public (inlined in the browser bundle) |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable key | public |
   | `SUPABASE_URL` | Project URL | server |
   | `SUPABASE_PUBLISHABLE_KEY` | publishable key | server |
   | `SUPABASE_SERVICE_ROLE_KEY` | secret key | **server, sensitive** |

   `VITE_*` values cannot be marked "sensitive" in Vercel: they are public by design. The build
   **fails** without an `https` `SUPABASE_URL`/`VITE_SUPABASE_URL` (the Content Security Policy is
   built from it). `SUPABASE_SERVICE_ROLE_KEY` is required at runtime: staff creation, public
   pre-registration, branding uploads and course-resource storage run as server functions with
   it (`src/integrations/supabase/client.server.ts`); without it those actions fail.
3. **Deploy**, then put the deployment's address in Auth's Site URL and redirect URLs (§4).

**Desktop support is part of this deploy.** The server accepts server-function calls from the
desktop app's exact origin `http://tauri.localhost` (CORS in `src/server.ts`, CSRF exception in
`src/start.ts`), and nothing else cross-origin. It needs no configuration, but a desktop release
must point at a deployment that includes it (any deployment of this repository from
2026-10-14 on).

---

## 6. The first administrator

Every account created by sign-up is a **student** (`handle_new_user()`); there is no "first
account becomes admin" rule. Create the first administrator once:

1. **Authentication → Users → Add user**: the administrator's e-mail and a temporary password,
   **Auto Confirm User** ticked.
2. **SQL Editor**:

   ```sql
   select private.provision_staff(
     (select id from auth.users where email = 'admin@your-school.example'),
     'admin'
   );
   ```

   This replaces the provisional student identity with the admin role and flags the account so
   the administrator must choose a new password at first sign-in. (Verified on a local stack.)

Give the temporary password to the administrator by a separate channel. Every other staff
account is then created from the application (Enseignants, Utilisateurs).

---

## 7. Configure the school

Sign in as the administrator → **Paramètres → Identité visuelle**: school name, slogan,
description (ar / fr / en), colours, logo (light and dark, transparent PNG or WebP), favicon,
contact details. Billing identity (legal name, NIF, NIS, RC, tax article) is set from the
invoices screen. Until this is done the application presents itself as **Gestion École**.

Levels, streams, subjects and the built-in formation types come from the migrations.
**Never run `scripts/seed-demo-data.mjs` or `scripts/reset-demo-data.sql` against a school's
project** (the seed refuses non-local URLs; the rule stands on its own).

---

## 8. Verify the deployment

On the Supabase project (SQL Editor / REST):

- every table under `public` has RLS enabled (`select relname from pg_class c join
  pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and
  not c.relrowsecurity;` returns no rows);
- an anonymous `GET /rest/v1/profiles` returns no rows;
- an anonymous `GET /rest/v1/center_settings?select=school_name` answers, and
  `?select=academic_year` returns **401** (the anonymous grant is per column);
- **Storage** lists `avatars`, `branding`, `course-resources`, `hr-documents`, `news`.

In a browser:

1. `/` shows the school's name, logo, slogan and description;
2. العربية switches the layout to right-to-left; Français back to left-to-right;
3. the administrator is forced to change the temporary password at first sign-in;
4. a password reset requested from `/forgot-password` arrives (SMTP) and its link opens
   `/reset-password` on the deployment;
5. reloading a deep link (`/dashboard/groups`) returns 200;
6. the console is clean.

The suites in `scripts/e2e/` target a **local** stack only: they create and delete accounts.

---

## 9. Windows desktop installers

The desktop app is the same interface packaged with Tauri 2. It talks to the school's Supabase
project directly (publishable key, RLS) and sends server-function calls to the web deployment
from §5.

**Links created from the desktop app** (password reset, staff account setup, sign-up
confirmation, copied registration and pre-registration links) point at the web deployment
(`DESKTOP_SERVER_ORIGIN`), not at the app's internal origin `http://tauri.localhost`:
`publicUrl()` / `publicOrigin()` in `src/lib/desktop.ts`, rules in `src/lib/public-url.ts`. The
web app keeps using its own address. That deployment's address must be in Supabase Auth's
redirect URLs (§4).

**Prerequisites on the build machine:** Node ≥ 22.12, Rust (MSVC), Visual Studio C++ build
tools, WebView2 (see LOCAL_SETUP.md). The installers use the WebView2 download bootstrapper:
installing on a PC without WebView2 (older Windows 10) needs internet once.

**Build:**

1. Create `.env` (git-ignored) in this folder with the deployed values only:

   ```env
   VITE_SUPABASE_URL="https://<ref>.supabase.co"
   VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_…"
   DESKTOP_SERVER_ORIGIN="https://<your-domain>"
   ```

   No secret key: the build removes `SUPABASE_SERVICE_ROLE_KEY` from its environment and refuses
   to finish if secret material reaches the bundle (`scripts/secret-scan.mjs`).
2. `npm ci` (if not done), then `npm run desktop:build`.
3. Output:
   - `src-tauri/target/release/bundle/nsis/Gestion École_<version>_x64-setup.exe`
   - `src-tauri/target/release/bundle/msi/Gestion École_<version>_x64_en-US.msi`

The build writes `src-tauri/tauri.build.conf.json` (git-ignored): the window's Content Security
Policy for exactly that Supabase project and server. Check it names the production hosts:

```bash
node -e "console.log(require('./src-tauri/tauri.build.conf.json').app.security.csp['connect-src'])"
```

**Check the installer before distributing it:** install on a clean Windows PC (or VM), sign in as
the administrator, open a few screens, export a CSV, print a receipt, then disconnect the network,
restart the app and confirm the cached screens still open and a lesson entry is queued;
reconnect and confirm it is sent.

**Versioning.** Raise `version` in `src-tauri/tauri.conf.json` (and `src-tauri/Cargo.toml`) for
each release. Keep the identifier `dz.gestionecole.desktop`: it decides where the app keeps its
data on Windows, and changing it after real installations loses saved sessions and the offline
cache.

**Not configured yet:** code signing (Windows SmartScreen warns on first install until the
installer is signed with a code-signing certificate) and automatic updates (users install new
versions by running the new installer).

**Test-only installers.** Builds made with `--local` point at a developer machine (`127.0.0.1`,
`localhost:8080`) and must never be distributed. The ones built on 2026-10-14 are kept apart in
`src-tauri/target/TEST-ONLY-local-installers/` (git-ignored, with a README).
