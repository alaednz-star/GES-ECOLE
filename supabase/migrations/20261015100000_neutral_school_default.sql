-- ==================================================================
-- Gestion École: a new installation has no school name until the school sets one.
--
-- The first migration created `center_settings.school_name` with DEFAULT 'Madrasti', the name of
-- the platform this product grew out of. The application already reads that value as "not set"
-- (`LEGACY_DEFAULT_SCHOOL_NAME` in src/lib/brand.ts), but it was still stored: copied into the
-- issuer data of invoices and official documents issued before a name was set, and shown in the
-- settings form of earlier versions.
--
-- Effects, exactly:
--   1. the column default becomes '' (the column stays NOT NULL; no constraint applies to it);
--   2. the single settings row is cleared ONLY if it still holds the untouched default
--      'Madrasti'. A name a school chose is never changed.
-- Nothing else. Invoices and documents already issued keep the issuer data they were issued with.
--
-- Verified by scripts/e2e/verify-neutral-school-default.mjs (local, always rolled back).
-- ==================================================================

ALTER TABLE public.center_settings ALTER COLUMN school_name SET DEFAULT '';

UPDATE public.center_settings SET school_name = '' WHERE school_name = 'Madrasti';
