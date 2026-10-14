import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, GraduationCap, Search } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RequireAuth } from "@/features/auth/require-auth";
import { CARD_GRID, StatePanel } from "@/features/school/components/group-card";
import { RegistrationCard } from "@/features/school/components/registration-card";
import { useStudentPortal } from "@/features/school/student-portal";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/dashboard/my-classes")({
  head: () => ({
    meta: [
      { title: "Mes cours — Gestion École" },
      { name: "description", content: "Les cours auxquels vous êtes inscrit." },
    ],
  }),
  component: () => (
    <RequireAuth roles={["student"]}>
      <MyClassesPage />
    </RequireAuth>
  ),
});

/**
 * Answers exactly one question: which classes am I actually enrolled in?
 *
 * Same card as the catalogue and "Mes inscriptions", same grid, same column width -- a
 * student moving between the three screens should not feel they changed product. What
 * differs is the tense. Here the request is settled, so the card is informational: the
 * footer states the next session instead of offering a decision, and the meta line says
 * since when rather than replaying the request's two dates.
 *
 * With one enrolled class the page is mostly empty, and that is left alone. The card holds
 * one grid column, the width it has on the other two screens; stretching it across 1184px
 * or centring it in the viewport would make one course look like a landing page.
 */
function MyClassesPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { enrolled, nextByGroup, isLoading, isFetching, error, refetch } = useStudentPortal(
    user?.id,
  );

  const header = (
    <PageHeader
      title={t("myClasses.title")}
      description={t("myClasses.description", { count: String(enrolled.length) })}
      actions={
        <Button asChild variant="outline" className="h-11 rounded-xl">
          <Link to="/dashboard/registration">
            <Search className="size-4" aria-hidden />
            {t("myReg.browse")}
          </Link>
        </Button>
      }
    />
  );

  if (error) {
    return (
      <>
        {header}
        <ErrorState error={error} onRetry={refetch} isRetrying={isFetching} />
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        {header}
        <div className={CARD_GRID}>
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-[400px] rounded-2xl" />
          ))}
        </div>
      </>
    );
  }

  if (enrolled.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={GraduationCap}
          title={t("myClasses.emptyTitle")}
          description={t("myClasses.emptyBody")}
          action={
            <Button asChild className="mt-2 rounded-xl">
              <Link to="/dashboard/registration">{t("myReg.browse")}</Link>
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      <div className={CARD_GRID}>
        {enrolled.map((item) => {
          const next = nextByGroup.get(item.groupId);
          return (
            <RegistrationCard
              key={item.id}
              item={item}
              /* Registration information in this page's tense. "Demande envoyée le … ·
                 réponse le …" is the story of getting in, and it belongs on the page about
                 requests; once you are in, the fact is since when. */
              meta={
                item.decidedAt ? (
                  <p className="text-xs text-muted-foreground">
                    {t("myClasses.enrolledSince", {
                      date: formatDate(item.decidedAt, locale),
                    })}
                  </p>
                ) : undefined
              }
              /*
                The same panel the other two screens use for state, carrying a fact instead
                of a decision: neutral tone, no button, nothing to accept or withdraw. It
                replaces a centred 12px line that was the only centred text on any of the
                three cards.
              */
              actions={
                <StatePanel
                  tone="neutral"
                  icon={CalendarDays}
                  title={t("myClasses.nextSession")}
                  value={
                    next ? (
                      // ONE isolate around the whole date-and-range run. Every part of it is
                      // direction-neutral, so isolating them separately lets RTL reorder them
                      // against each other -- the same trap the HORAIRE column documents.
                      <span dir="ltr" style={{ unicodeBidi: "isolate" }} className="tabular-nums">
                        {formatDate(next.date, locale)} · {next.slot.startTime.slice(0, 5)}–
                        {next.slot.endTime.slice(0, 5)}
                      </span>
                    ) : undefined
                  }
                  hint={next ? undefined : t("myClasses.noNextLesson")}
                />
              }
            />
          );
        })}
      </div>
    </>
  );
}
