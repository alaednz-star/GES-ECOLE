import type { ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FullPageLoader } from "@/components/common/full-page-loader";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";

export const passwordChangeKeys = {
  required: (userId: string) => ["password-change-required", userId] as const,
};

/**
 * Whether this account must change its password before continuing.
 *
 * The flag lives on `profiles`, so the answer comes from the database rather
 * than from client state the user could tamper with. RLS restricts the row to
 * its owner, so a user can only ever read their own flag.
 */
export function usePasswordChangeRequired(userId: string | undefined) {
  return useQuery({
    queryKey: passwordChangeKeys.required(userId ?? "anon"),
    enabled: !!userId,
    // Deliberately short: the answer flips exactly once, and a stale `true`
    // would trap the user on the change screen after they succeeded.
    staleTime: 0,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("password_change_required")
        .eq("id", userId as string)
        .maybeSingle();
      if (error) throw error;
      return data?.password_change_required ?? false;
    },
  });
}

/**
 * Blocks the dashboard until a pending password change is completed.
 *
 * Composes with `RequireAuth` and `RequireOnboarding` in the same style: each
 * answers one question. This one asks "is this credential still temporary?".
 *
 * Note this is a *rendering* guard. The real enforcement is that the account
 * still holds an admin-issued password until the user replaces it -- the flag
 * is read from the database on every mount, not trusted from the session.
 */
export function RequirePasswordChange({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { user, status } = useAuth();
  const { data: required, isLoading } = usePasswordChangeRequired(user?.id);

  if (status === "loading") return <FullPageLoader label={t("ui.loading")} />;
  if (!user) return <>{children}</>;
  // Fail closed while unknown rather than flashing the dashboard.
  if (isLoading) return <FullPageLoader label={t("ui.loading")} />;
  if (required) return <Navigate to="/change-password" replace />;

  return <>{children}</>;
}
