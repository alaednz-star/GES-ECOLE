-- Subjects: stable internal keys, not display names.
--
-- `subjects.name` held French text ("Mathématiques"), which made business data
-- depend on the display language: the same subject reads differently per locale
-- and cannot be matched across them. The key is now the identity; the UI
-- resolves it through the i18n dictionaries (`subject.<key>`).
--
-- `name` is KEPT as the admin-facing fallback for custom subjects that have no
-- dictionary entry. It is no longer what the UI shows for known subjects.
--
-- This migration does not delete or duplicate any subject: existing rows are
-- matched by their current name and given the corresponding key.

alter table public.subjects
  add column if not exists key text;

-- Backfill from the French names currently stored. Accent- and case-insensitive
-- so a row saved as "Francais" or "FRANÇAIS" still matches.
update public.subjects set key = 'mathematics'
 where key is null and translate(lower(name),'àâäéèêëîïôöùûüç','aaaeeeeiioouuuc') like 'math%';
update public.subjects set key = 'physics'
 where key is null and translate(lower(name),'àâäéèêëîïôöùûüç','aaaeeeeiioouuuc') like 'physi%';
update public.subjects set key = 'natural_sciences'
 where key is null and (translate(lower(name),'àâäéèêëîïôöùûüç','aaaeeeeiioouuuc') like '%sciences naturelles%'
                     or translate(lower(name),'àâäéèêëîïôöùûüç','aaaeeeeiioouuuc') like '%natural science%'
                     or translate(lower(name),'àâäéèêëîïôöùûüç','aaaeeeeiioouuuc') like 'svt%');
update public.subjects set key = 'arabic'
 where key is null and translate(lower(name),'àâäéèêëîïôöùûüç','aaaeeeeiioouuuc') like 'arab%';
update public.subjects set key = 'french'
 where key is null and translate(lower(name),'àâäéèêëîïôöùûüç','aaaeeeeiioouuuc') like 'fran%';
update public.subjects set key = 'english'
 where key is null and (translate(lower(name),'àâäéèêëîïôöùûüç','aaaeeeeiioouuuc') like 'angl%'
                     or translate(lower(name),'àâäéèêëîïôöùûüç','aaaeeeeiioouuuc') like 'english%');

-- Anything unmatched (a custom subject) gets a slug of its own name rather than
-- being left null, so the column can be made NOT NULL.
update public.subjects
   set key = regexp_replace(translate(lower(trim(name)),'àâäéèêëîïôöùûüç','aaaeeeeiioouuuc'), '[^a-z0-9]+', '_', 'g')
 where key is null;

alter table public.subjects
  alter column key set not null;

-- One row per subject, enforced by the database rather than by convention.
create unique index if not exists subjects_key_unique on public.subjects (key);

comment on column public.subjects.key is
  'Stable locale-independent identity (mathematics, physics, ...). The UI '
  'displays t(''subject.'' || key) and falls back to `name` when absent.';
comment on column public.subjects.name is
  'Admin-facing fallback label. Not shown for subjects that have a dictionary '
  'entry -- those are rendered from `key` so the name follows the UI language.';
