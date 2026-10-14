# Deployment — Gestion École

How to install Gestion École for a school: one Supabase project, one web deployment
(Vercel), optionally the Windows desktop app. One installation serves one school; nothing is
shared between schools.

---

## 0. Before you start

| You need | Why |
|---|---|
| A new, empty Supabase project | The school's database, auth and storage (§2) |
| A Vercel project pointed at this repository | Web build and hosting (§1) |
| The school's logo as a **transparent** PNG or WebP, and a square icon | Branding (§6) |
| An SMTP provider | Password-reset and invitation e-mails (§4) |

---

## 1. Web hosting — environment variables

**Vercel → Project → Settings → Environment Variables**, scope **Production** (and Preview if
previews should authenticate).

| Name | Value | In the browser bundle? |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` | yes |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable key | yes |
| `VITE_SUPABASE_PROJECT_ID` | `<ref>` | yes |
| `SUPABASE_URL` | `https://<ref>.supabase.co` | no (server) |
| `SUPABASE_PUBLISHABLE_KEY` | the same publishable key | no (server) |
| `SUPABASE_SERVICE_ROLE_KEY` | **service role / secret** key | **never** |

Both prefixes are required: `VITE_*` is inlined into the browser bundle at build time, the
unprefixed copies are read by the server at runtime. `VITE_*` variables cannot be marked
"secret" in Vercel; they are public by design.

**The service-role key is required.** Creating staff accounts, public pre-registration,
branding uploads and course-resource storage run as server functions with that key
(`src/integrations/supabase/client.server.ts`). Without it the site loads but those actions
fail. It is read only in `*.server.ts` modules and never reaches a bundle.

---

## 2. Database — apply the migrations

All migrations in `supabase/migrations/`, in filename order, to the empty project:

```bash
supabase link --project-ref <ref>
supabase db push
```

`supabase/config.toml` carries `project_id = "gestion-ecole"`, a local slug, not a project
ref. Check `supabase/.temp/project-ref` (created by `link`) before every `db push`: a linked
folder pushes to that project.

Ordering facts that matter:

- `20260806155000_teacher_lifecycle_enums.sql` then `20260806160000_teacher_lifecycle.sql` —
  split deliberately: Postgres cannot use a new enum value in the transaction that adds it.
- `20260811110000_resources_drop_is_important.sql` drops a column: harmless on an empty
  database, but it must run in sequence.
- Several migrations end with post-condition blocks that raise on failure, so a partial apply
  is loud rather than silent.
- `20261015100000_neutral_school_default.sql`: a new installation starts with an empty school
  name. On an existing database it clears the name only if it still holds the previous
  default (`'Madrasti'`); a name the school chose is never touched.

> ⚠️ Rehearse first: run the full sequence against a throwaway project (or `supabase db reset`
> on the local stack) and read the output before pointing it at a school's real project.

---

## 3. Storage

Buckets are **created by migrations** — confirm, do not create by hand:
`avatars`, `branding`, `course-resources`, `hr-documents`, `news`. None accepts SVG (on a
public bucket an SVG is a script container).

---

## 4. Supabase Auth settings

**Authentication → URL Configuration**

| Setting | Value |
|---|---|
| Site URL | `https://<your-domain>` |
| Redirect URLs | `https://<your-domain>/**` |

Password-reset links are built from the page's origin, so the deployed origin must be
allow-listed or reset mail fails with `redirect_to not allowed`.

**Providers:** e-mail only. **SMTP:** Supabase's built-in mail is limited to a few messages per
hour and for testing only — configure a custom SMTP provider (**Authentication → Emails →
SMTP Settings**) before real use, or password resets and invitations will not arrive.

---

## 5. The first administrator

Every account created by sign-up is a **student** (`handle_new_user()`); there is no
"first account becomes admin" rule. The school's first administrator is created once, from the
Supabase dashboard:

1. **Authentication → Users → Add user**: the administrator's e-mail and a temporary password,
   **Auto Confirm User** ticked.
2. **SQL Editor**:

   ```sql
   select private.provision_staff(
     (select id from auth.users where email = 'admin@your-school.example'),
     'admin'
   );
   ```

   This replaces the provisional student identity with the admin role and flags the account
   so the administrator must choose their own password at first sign-in.

Every other staff account is then created from the application (Enseignants, Utilisateurs).

---

## 6. Configure the school

Sign in as the administrator → **Paramètres → Identité visuelle**: school name, slogan,
description (ar / fr / en), colours, logo (light and dark), favicon, contact details. Billing
identity (legal name, NIF, NIS, RC, tax article) is set from the invoices screen.

Until this is done the application presents itself as **Gestion École**.

---

## 7. Reference data

Levels, streams, subjects and the built-in formation types are seeded by the migrations.

**Never run `scripts/seed-demo-data.mjs` or `scripts/reset-demo-data.sql` against a school's
database.** The seed refuses non-local URLs; the rule stands on its own: real data is created
through the application, by the school.

---

## 8. Verify after deploying

On the Supabase project:

- every table under `public` reports `rowsecurity = true`;
- an anonymous request to `/rest/v1/profiles` returns no rows;
- an anonymous request to `/rest/v1/center_settings?select=school_name` returns the school,
  and `?select=academic_year` returns **401** (the anonymous grant is per column).

In a browser:

1. `/` shows the school's name, logo, slogan and description;
2. العربية switches the layout to right-to-left; Français back to left-to-right;
3. a provisioned staff account is forced to change its password at first sign-in;
4. reloading a deep link (`/dashboard/groups`) returns 200;
5. the console is clean.

The suites in `scripts/e2e/` target a **local** stack only: they create and delete accounts.

---

## 9. Desktop app (Windows)

The desktop app is the same interface packaged with Tauri. It talks to the school's Supabase
project directly (publishable key, RLS) and sends server-function calls to the web deployment.

**Server side.** The web deployment must accept the desktop app's origin
(`http://tauri.localhost`) on server functions: CORS and the CSRF exception for that one origin
are in `src/server.ts` and `src/start.ts`. Deploy the web app before distributing a desktop
build.

**Build** (Rust, Visual Studio C++ build tools and WebView2 required; see LOCAL_SETUP.md):

1. `.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` of the school's project, and
   `DESKTOP_SERVER_ORIGIN` = the web deployment's address.
2. `npm run desktop:build` → `src-tauri/target/release/bundle/nsis/*.exe` and `msi/*.msi`.

The build writes `src-tauri/tauri.build.conf.json`: the window's Content Security Policy for
exactly that project and server. It refuses to finish if the bundle contains secret material.
The service-role key is removed from the build environment.

**Not configured yet:** code signing (Windows SmartScreen warns on first install) and
automatic updates. The app identifier `dz.gestionecole.desktop` decides where the app keeps
its data on Windows; do not change it once real installations exist.
