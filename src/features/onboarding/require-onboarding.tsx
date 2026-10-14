import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { FullPageLoader } from "@/components/common/full-page-loader";
import { useOnboardingStatus } from "@/features/onboarding/queries";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";

/**
 * Keeps a student out of the product until their profile is complete.
 *
 * Composes with `RequireAuth` rather than replacing it: `RequireAuth` answers
 * "are you signed in and allowed here?", this answers "have you told us who you
 * are?". Wrapping the dashboard shell covers every dashboard route in one place.
 *
 * Admins and teachers have no `students` row, so the query is disabled for them
 * and they pass straight through.
 */
export function RequireOnboarding({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { user, status } = useAuth();
  const isStudent = user?.role === "student";
  const { data, isLoading } = useOnboardingStatus(user?.id, isStudent);

  if (status === "loading") return <FullPageLoader label={t("ui.loading")} />;
  if (!isStudent) return <>{children}</>;
  // Fail closed while unknown: showing the dashboard first and redirecting a
  // moment later would flash content the student is not meant to reach yet.
  if (isLoading) return <FullPageLoader label={t("ui.loading")} />;
  if (data?.needsOnboarding) return <Navigate to="/onboarding" replace />;

  return <>{children}</>;
}
