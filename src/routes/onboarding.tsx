import { useEffect } from "react";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { Brand } from "@/components/common/brand";
import { Button } from "@/components/ui/button";
import { FullPageLoader } from "@/components/common/full-page-loader";
import { LanguageSwitcher } from "@/components/common/language-switcher";
import { RequireAuth } from "@/features/auth/require-auth";
import { OnboardingWizard } from "@/features/onboarding/components/onboarding-wizard";
import { useOnboardingStatus } from "@/features/onboarding/queries";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Compléter mon profil — Gestion École" },
      { name: "description", content: "Renseignez votre profil pour accéder à votre espace." },
      // The wizard is behind a login; nothing here should be indexed.
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <OnboardingPage />
    </RequireAuth>
  ),
});

function OnboardingPage() {
  const { t } = useI18n();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const isStudent = user?.role === "student";
  const { data, isLoading } = useOnboardingStatus(user?.id, isStudent);

  // Keep the document direction in step with the chosen language, since this
  // page renders outside the dashboard shell that normally handles it.
  const { locale, dir } = useI18n();
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  const handleSignOut = async () => {
    await signOut();
    await navigate({ to: "/login", replace: true });
  };

  // Staff never onboard; send them to their dashboard rather than a wizard
  // that has nothing to write to.
  if (!isStudent) return <Navigate to="/dashboard" replace />;
  if (isLoading) return <FullPageLoader label={t("ui.loading")} />;
  // Already complete -- prevents re-running the wizard from a stale link.
  if (data && !data.needsOnboarding) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="flex h-16 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
        <Brand size="sm" />
        <div className="ms-auto flex items-center gap-1.5">
          <LanguageSwitcher />
          <Button variant="ghost" size="sm" className="rounded-xl" onClick={handleSignOut}>
            <LogOut className="size-4" aria-hidden />
            <span className="hidden sm:inline">{t("action.signOut")}</span>
          </Button>
        </div>
      </header>

      <main className="px-4 py-8 sm:px-6 sm:py-12">
        <OnboardingWizard />
      </main>
    </div>
  );
}
