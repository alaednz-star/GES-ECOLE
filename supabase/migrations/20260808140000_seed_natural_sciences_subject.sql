-- Natural Sciences was missing from the canonical subject set.
--
-- The original seed (20260801203305) created five subjects: Mathématiques,
-- Physique, Français, Anglais, Arabe. `natural_sciences` was never among them,
-- and 20260808100000_subject_locale_keys only BACKFILLS keys onto existing
-- rows -- it does not insert any.
--
-- Locally the row was created by hand, so local and production drifted: the
-- provisioning run failed on production with
--   subject "natural_sciences" not found on this project
-- because a teacher being provisioned there teaches it.
--
-- Inserted here as a migration so every environment converges on the same
-- canonical set. `on conflict (key)` makes it idempotent and guarantees no
-- duplicate is created where the row already exists (e.g. local).
--
-- The localisation contract is unchanged: `key` is the stable identity, and the
-- UI renders `t('subject.' || key)` from the i18n dictionaries, which already
-- carry subject.natural_sciences in fr / ar / en. `name` is only the admin
-- fallback for subjects that have no dictionary entry.

insert into public.subjects (key, name, color, description)
values (
  'natural_sciences',
  'Sciences Naturelles',
  '#16A34A',
  'Biologie, géologie et sciences de la vie et de la terre'
)
on conflict (key) do nothing;
