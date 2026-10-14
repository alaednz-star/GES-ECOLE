/**
 * Reading and writing this deployment's branding.
 *
 * A separate module from `features/school/queries.ts` -- not a separate DATA LAYER. It
 * uses the same `supabase` client, the same React Query conventions and the same singleton
 * row; it lives apart because branding is consumed by the application shell, and the shell
 * should not import the module that also carries every group, registration and attendance
 * query with it.
 *
 * TWO READS OF ONE ROW, and the difference is the point.
 *
 * `usePublicSchool` reads the thirteen columns `20260813140000` grants to `anon`: the
 * school's name, description, logo, colours and contact details -- everything a landing
 * page publishes anyway. It needs no session, so the public site and the login screen are
 * branded like the rest of the product.
 *
 * `useBranding` reads the same row as an authenticated administrator, and exists for the
 * settings form. It is not the shell's source: making the shell depend on a session would
 * mean the logged-out half of the product could never look like the school.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PUBLIC_BRANDING_COLUMNS, type BrandingRow } from "@/lib/brand";

export const brandingKeys = {
  branding: ["center-branding"] as const,
  publicSchool: ["public-school"] as const,
};

/** The columns the shell needs. Named explicitly so a new column cannot leak in unread. */
const BRANDING_COLUMNS =
  "school_name, tagline, logo_url, logo_dark_url, favicon_url, primary_color, brand_gold, brand_gold_soft, about_ar, about_fr, about_en, phone, address";

/** Shared with the server loader, so the two reads cannot drift. See `lib/brand.ts`. */
const PUBLIC_COLUMNS = PUBLIC_BRANDING_COLUMNS;

/**
 * The branding row, or null.
 *
 * NEVER THROWS. A branding failure must not surface as an error boundary, a toast, or a
 * blocked render -- the interface simply stays as Gestion École. `useQuery` would otherwise put
 * the provider into an error state that some future caller reads and reacts to; returning
 * null keeps "we could not load it" and "nothing is set" on the same, already-tested path.
 */
export function useBranding(enabled: boolean) {
  return useQuery({
    queryKey: brandingKeys.branding,
    enabled,
    // Branding changes when an administrator edits it, which is roughly never. The window
    // is long so the shell does not refetch it on every navigation.
    staleTime: 10 * 60 * 1000,
    retry: 1,
    queryFn: async (): Promise<BrandingRow | null> => {
      try {
        const { data, error } = await supabase
          .from("center_settings")
          .select(BRANDING_COLUMNS)
          .maybeSingle();
        if (error) return null;
        return (data as BrandingRow | null) ?? null;
      } catch {
        return null;
      }
    },
  });
}

/**
 * The school's public identity, with or without a session.
 *
 * Never throws, for the same reason `useBranding` does not: the landing page rendering at
 * all matters more than it being branded, and an anonymous visitor hitting a cold database
 * should get the page, not an error boundary.
 */
export function usePublicSchool(initialData?: BrandingRow | null) {
  return useQuery({
    queryKey: brandingKeys.publicSchool,
    staleTime: 10 * 60 * 1000,
    retry: 1,
    /*
      Seeded from the root loader, which resolved this row on the server.

      This is what removes the flash rather than hiding it: with `initialData` the cache
      is populated before the first render instead of after the first round trip, so the
      server HTML and the first client render produce the same branded output and React
      has nothing to swap. Seeded data counts as fresh for `staleTime`, so there is no
      refetch on mount either -- one render, one identity.

      Only a real row is passed through. `null` means the server could not answer, and
      seeding that would cache the failure for ten minutes and stop the browser from
      trying again on its own.
    */
    ...(initialData ? { initialData } : {}),
    queryFn: async (): Promise<BrandingRow | null> => {
      try {
        const { data, error } = await supabase
          .from("center_settings")
          .select(PUBLIC_COLUMNS)
          .maybeSingle();
        if (error) return null;
        return (data as BrandingRow | null) ?? null;
      } catch {
        return null;
      }
    },
  });
}

export interface BrandingInput {
  schoolName: string;
  tagline: string | null;
  aboutAr: string | null;
  aboutFr: string | null;
  aboutEn: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  brandGold: string | null;
  brandGoldSoft: string | null;
}

/**
 * Saves branding. Admin-only, and not because this file says so.
 *
 * `center_settings` carries `settings admin write` as its only write policy, so a student's
 * token updates zero rows however this mutation is called. The check constraints added in
 * `20260813100000` reject a colour that is not `#RRGGBB` and a URL that is not plain https,
 * so a crafted request is refused by Postgres rather than by the form.
 */
export function useSaveBranding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BrandingInput) => {
      const { error } = await supabase
        .from("center_settings")
        .update({
          school_name: input.schoolName,
          tagline: input.tagline,
          about_ar: input.aboutAr,
          about_fr: input.aboutFr,
          about_en: input.aboutEn,
          logo_url: input.logoUrl,
          logo_dark_url: input.logoDarkUrl,
          favicon_url: input.faviconUrl,
          primary_color: input.primaryColor,
          brand_gold: input.brandGold,
          brand_gold_soft: input.brandGoldSoft,
        })
        .eq("id", true)
        .select();
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: brandingKeys.branding });
      // The shell reads the public projection, so it has to be invalidated too or the
      // sidebar keeps the old name until the next reload.
      void qc.invalidateQueries({ queryKey: brandingKeys.publicSchool });
      // The settings page reads the same row through its own key.
      void qc.invalidateQueries({ queryKey: ["center-settings"] });
    },
  });
}
