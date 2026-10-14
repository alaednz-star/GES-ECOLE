import { supabase } from "@/integrations/supabase/client";

/**
 * The caller's current access token, for server functions that re-verify it.
 *
 * Sending it grants nothing: the server validates the token independently and
 * checks the admin role against the database. This exists so the several call
 * sites that need it do not each re-implement the session lookup.
 */
export async function currentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
