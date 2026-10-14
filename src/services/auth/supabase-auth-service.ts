import { supabase } from "@/integrations/supabase/client";
import type { AuthSession, AuthUser, Credentials, RegisterPayload, Role } from "@/types/auth";
import type { AuthService } from "./auth-service";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { IS_DESKTOP } from "@/lib/desktop";
import { clearCachedUser, readCachedUser, writeCachedUser } from "@/features/desktop/user-cache";

async function hydrate(userId: string, email: string | undefined): Promise<AuthUser> {
  const [{ data: profile, error: profileError }, { data: roleRows, error: rolesError }] =
    await Promise.all([
      supabase.from("profiles").select("full_name, avatar_url, phone").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);

  // Desktop app offline (ADR-010): the reads failed, so use the user saved at the last
  // successful sign-in instead of guessing (an unknown role would otherwise fall to "student").
  if (IS_DESKTOP && (profileError || rolesError)) {
    const cached = readCachedUser(userId);
    if (cached) return cached;
  }

  const roles = (roleRows ?? []).map((r) => r.role as Role);
  const role: Role = roles.includes("admin")
    ? "admin"
    : roles.includes("teacher")
      ? "teacher"
      : "student";

  const user: AuthUser = {
    id: userId,
    fullName: profile?.full_name || (email?.split("@")[0] ?? "Utilisateur"),
    email: email ?? "",
    role,
    avatarUrl: profile?.avatar_url ?? null,
  };
  if (IS_DESKTOP && !profileError && !rolesError) writeCachedUser(user);
  return user;
}

export const supabaseAuthService: AuthService = {
  async getSession() {
    const { data, error } = await supabase.auth.getSession();
    const session = data.session;
    if (!session?.user) {
      // Desktop app offline with an expired access token: Supabase keeps the session on disk
      // but cannot refresh it until the network is back. Open as the saved user meanwhile; the
      // token refreshes on its own once online (ADR-010).
      const offline =
        (error && isAuthRetryableFetchError(error)) ||
        (typeof navigator !== "undefined" && navigator.onLine === false);
      if (IS_DESKTOP && offline) {
        const cached = readCachedUser();
        if (cached) return { user: cached, expiresAt: 0 };
      }
      return null;
    }
    return {
      user: await hydrate(session.user.id, session.user.email ?? undefined),
      expiresAt: (session.expires_at ?? 0) * 1000,
    };
  },

  async signIn({ email, password }: Credentials) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    if (!data.user) throw new Error("Connexion impossible.");
    return {
      user: await hydrate(data.user.id, data.user.email ?? undefined),
      expiresAt: (data.session?.expires_at ?? 0) * 1000,
    } satisfies AuthSession;
  },

  async signUp({ email, password, fullName }: RegisterPayload) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        // No role: `user_metadata` is writable by the account holder, so it must
        // never carry authorisation input. handle_new_user() assigns `student`
        // unconditionally; elevation is admin-only via private.grant_role().
        data: { full_name: fullName },
      },
    });
    if (error) throw new Error(error.message);
    if (!data.session || !data.user) return null;
    return {
      user: await hydrate(data.user.id, data.user.email ?? undefined),
      expiresAt: (data.session.expires_at ?? 0) * 1000,
    } satisfies AuthSession;
  },

  async signOut() {
    if (IS_DESKTOP) clearCachedUser();
    await supabase.auth.signOut();
  },

  async requestPasswordReset(email, redirectTo) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw new Error(error.message);
  },

  async updatePassword(password) {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
  },

  onAuthChange(handler) {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") handler();
    });
    return () => data.subscription.unsubscribe();
  },
};
