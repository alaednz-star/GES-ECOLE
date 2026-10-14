/**
 * The school's public identity, resolved on the SERVER, before the first byte of HTML.
 *
 * WHY THIS EXISTS. `usePublicSchool` reads `center_settings` from the browser, so the
 * server render and the first client render both saw `undefined` and both fell back to
 * `resolveBrand(null)` -- the product's identity. The initial HTML therefore shipped the
 * platform's name, the platform's logo and the platform's teal palette, and the school's
 * identity replaced them a commit later. On a single-tenant deployment that is another
 * organisation's brand on the school's own front page, for as long as the round trip takes.
 *
 * The row is public by design: `20260813140000` grants `anon` a column-level SELECT on
 * exactly these thirteen columns, which is what lets the landing page and the login screen
 * be the school's rather than the platform's. So this reads with the PUBLISHABLE key, not
 * the service-role one -- it needs no privilege the browser does not already have, and it
 * keeps working on a deployment where `SUPABASE_SERVICE_ROLE_KEY` has not been set.
 *
 * NEVER THROWS, for the same reason the client query does not: a branding failure must not
 * become an error boundary in front of the homepage. On any failure this returns null, the
 * loader hands null to the provider, and the application renders exactly as it does today.
 * The flash is a regression back to current behaviour, not an outage.
 */

import { createServerFn } from "@tanstack/react-start";
import { PUBLIC_BRANDING_COLUMNS, type BrandingRow } from "@/lib/brand";

export const getPublicSchoolFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<BrandingRow | null> => {
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key) return null;

    try {
      /*
        Imported inside the handler, the way `admins.functions.ts` imports its server
        module: this file is reachable from the client graph because `__root` imports it,
        and a top-level import would pull a second Supabase client into the browser bundle
        next to the one `integrations/supabase/client.ts` already ships.
      */
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(url, key, {
        // No session, no storage, no refresh timer: this client answers one anonymous
        // question per request and is discarded.
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });

      const { data, error } = await supabase
        .from("center_settings")
        .select(PUBLIC_BRANDING_COLUMNS)
        .maybeSingle();

      if (error) return null;
      return (data as BrandingRow | null) ?? null;
    } catch {
      return null;
    }
  },
);
