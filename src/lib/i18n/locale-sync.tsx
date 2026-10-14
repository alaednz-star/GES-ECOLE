import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { LOCALES, type Locale } from "./config";

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Keeps the selected language in sync with the signed-in user's profile.
 * Guests keep their choice in localStorage (handled by the provider).
 */
export function LocaleSync() {
  const { user, isAuthenticated } = useAuth();
  const { locale, setLocale } = useI18n();
  const loadedFor = useRef<string | null>(null);

  // Pull the stored preference once per signed-in user.
  useEffect(() => {
    if (!isAuthenticated || !user?.id || loadedFor.current === user.id) return;
    loadedFor.current = user.id;
    let active = true;
    void supabase
      .from("profiles")
      .select("locale")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        if (isLocale(data?.locale) && data.locale !== locale) setLocale(data.locale);
      });
    return () => {
      active = false;
    };
    // `locale` intentionally excluded: this runs once per user session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.id, setLocale]);

  // Push every later change back to the profile.
  useEffect(() => {
    if (!isAuthenticated || !user?.id || loadedFor.current !== user.id) return;
    void supabase.from("profiles").update({ locale }).eq("id", user.id);
  }, [locale, isAuthenticated, user?.id]);

  return null;
}
