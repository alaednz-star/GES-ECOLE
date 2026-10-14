ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'fr';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_locale_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_locale_check CHECK (locale IN ('fr','ar','en'));