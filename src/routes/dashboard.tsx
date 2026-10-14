import { useEffect } from "react";
import {
  createFileRoute,
  Outlet,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/common/error-state";
import { RequireAuth } from "@/features/auth/require-auth";
import { RequireOnboarding } from "@/features/onboarding/require-onboarding";
import { RequirePasswordChange } from "@/features/auth/password-change";
import { DashboardLayout } from "@/layouts/dashboard-layout";
import { useI18n } from "@/hooks/use-i18n";
import { reportError } from "@/lib/error-reporting";

export const Route = createFileRoute("/dashboard")({
  component: DashboardShell,
  errorComponent: DashboardErrorBoundary,
});

function DashboardShell() {
  return (
    <RequireAuth>
      <RequirePasswordChange>
        <RequireOnboarding>
          <DashboardLayout>
            <Outlet />
          </DashboardLayout>
        </RequireOnboarding>
      </RequirePasswordChange>
    </RequireAuth>
  );
}

/**
 * Catches anything a dashboard page throws during render. Scoped here rather
 * than only at the root so the sidebar and topbar survive -- the user keeps
 * their navigation and can move to a working page instead of losing the shell.
 */
function DashboardErrorBoundary({ error, reset }: ErrorComponentProps) {
  const { t } = useI18n();
  const router = useRouter();

  useEffect(() => {
    reportError(error, { boundary: "dashboard_route" });
  }, [error]);

  return (
    <RequireAuth>
      <DashboardLayout>
        <ErrorState
          error={error}
          onRetry={() => {
            router.invalidate();
            reset();
          }}
        />
        <div className="flex justify-center">
          <Button
            variant="ghost"
            className="rounded-xl"
            onClick={() => router.navigate({ to: "/dashboard" })}
          >
            <RefreshCw className="size-4" aria-hidden />
            {t("error.backToDashboard")}
          </Button>
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
