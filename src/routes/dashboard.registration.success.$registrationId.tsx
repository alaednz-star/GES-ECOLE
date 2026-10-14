import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, ClipboardList, LayoutDashboard } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RequireAuth } from "@/features/auth/require-auth";
import { RegistrationCard } from "@/features/school/components/registration-card";
import { useMyRegistrationCards } from "@/features/school/my-registrations";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";

export const Route = createFileRoute("/dashboard/registration/success/$registrationId")({
  head: () => ({
    meta: [{ title: "Demande envoyée — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["student"]}>
      <RegistrationSuccessPage />
    </RequireAuth>
  ),
});

function RegistrationSuccessPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { registrationId } = useParams({
    from: "/dashboard/registration/success/$registrationId",
  });

  const { byId, isLoading, isFetching, error, refetch } = useMyRegistrationCards(user?.id);
  const item = byId(registrationId);

  if (error) {
    return (
      <>
        <PageHeader title={t("regSuccess.title")} />
        <ErrorState error={error} onRetry={refetch} isRetrying={isFetching} />
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        <PageHeader title={t("regSuccess.title")} />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </>
    );
  }

  // The id came from a redirect we issued, so a miss means the row was removed
  // or the link was shared. Fail gracefully rather than rendering a blank page.
  if (!item) {
    return (
      <>
        <PageHeader title={t("regSuccess.title")} />
        <EmptyState
          icon={ClipboardList}
          title={t("regSuccess.notFoundTitle")}
          description={t("regSuccess.notFoundBody")}
          action={
            <Button asChild className="mt-2 rounded-xl">
              <Link to="/dashboard/my-registrations">{t("regSuccess.viewAll")}</Link>
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      {/* The banner carries the confirmation, so it is the page's live region:
          a screen reader announces the outcome without the user hunting for it. */}
      <section
        role="status"
        aria-live="polite"
        className="surface-card flex flex-col items-center gap-4 p-8 text-center"
      >
        <span className="grid size-16 place-items-center rounded-2xl bg-success/10 text-success">
          <CheckCircle2 className="size-8" aria-hidden />
        </span>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {t("regSuccess.heading")}
          </h1>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
            {t("regSuccess.body")}
          </p>
        </div>
      </section>

      <RegistrationCard item={item} />

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button asChild className="h-11 rounded-xl sm:px-6">
          <Link to="/dashboard/my-registrations">
            <ClipboardList className="size-4" aria-hidden />
            {t("regSuccess.viewAll")}
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-11 rounded-xl sm:px-6">
          <Link to="/dashboard">
            <LayoutDashboard className="size-4" aria-hidden />
            {t("regSuccess.backToDashboard")}
          </Link>
        </Button>
        <Button asChild variant="ghost" className="h-11 rounded-xl sm:px-6">
          <Link to="/dashboard/registration">
            {t("regSuccess.registerAnother")}
            <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
          </Link>
        </Button>
      </div>
    </>
  );
}
