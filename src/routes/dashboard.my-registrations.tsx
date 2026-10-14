import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Loader2,
  LogOut,
  Search,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RequireAuth } from "@/features/auth/require-auth";
import { CARD_GRID, StatePanel } from "@/features/school/components/group-card";
import { RegistrationCard } from "@/features/school/components/registration-card";
import { useMyRegistrationCards, type MyRegistration } from "@/features/school/my-registrations";
import { useCancelRegistration } from "@/features/school/queries";
import type { RegistrationStatus } from "@/features/school/types";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/my-registrations")({
  head: () => ({
    meta: [
      { title: "Mes inscriptions — Gestion École" },
      { name: "description", content: "Suivez l'état de vos demandes d'inscription." },
    ],
  }),
  component: () => (
    <RequireAuth roles={["student"]}>
      <MyRegistrationsPage />
    </RequireAuth>
  ),
});

type Tab = "all" | RegistrationStatus;
const TABS: Tab[] = ["all", "pending", "approved", "rejected", "withdrawn"];

const TAB_LABEL_KEYS: Record<Tab, string> = {
  all: "myReg.tabAll",
  pending: "myReg.tabPending",
  approved: "myReg.tabApproved",
  rejected: "myReg.tabRejected",
  withdrawn: "myReg.tabWithdrawn",
};

function MyRegistrationsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { notifySuccess, notifyError } = useActionFeedback();
  const { items, isLoading, isFetching, error, refetch } = useMyRegistrationCards(user?.id);
  const cancel = useCancelRegistration();
  const [tab, setTab] = useState<Tab>("all");
  const [withdrawing, setWithdrawing] = useState<MyRegistration | null>(null);

  /**
   * Withdraws a request the administration has not decided yet.
   *
   * A DELETE: `registration_status` has no `cancelled` value, and the row's own delete
   * policy already allows `student_id = auth.uid()`. Removing it also frees the
   * (student, group) pair, so the student can apply again -- which a tombstone would block.
   */
  const withdraw = async (item: MyRegistration) => {
    if (!user) return;
    try {
      await cancel.mutateAsync({ id: item.id, studentId: user.id });
      setWithdrawing(null);
      notifySuccess("dash.registration.withdrawn");
    } catch (e) {
      notifyError(e);
    }
  };

  const counts = useMemo(
    () => ({
      all: items.length,
      pending: items.filter((i) => i.status === "pending").length,
      approved: items.filter((i) => i.status === "approved").length,
      rejected: items.filter((i) => i.status === "rejected").length,
      withdrawn: items.filter((i) => i.status === "withdrawn").length,
    }),
    [items],
  );

  const visible = tab === "all" ? items : items.filter((i) => i.status === tab);

  const header = (
    <PageHeader
      title={t("myReg.title")}
      description={t("myReg.description", { count: String(items.length) })}
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
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[420px] rounded-2xl" />
          ))}
        </div>
      </>
    );
  }

  if (items.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={ClipboardList}
          title={t("myReg.emptyTitle")}
          description={t("myReg.emptyBody")}
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

      <div
        role="tablist"
        aria-label={t("myReg.filterAria")}
        className="flex flex-wrap gap-1.5 rounded-xl bg-muted/60 p-1"
      >
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "focus-ring rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors",
              tab === value && "bg-card text-foreground shadow-sm",
            )}
          >
            {t(TAB_LABEL_KEYS[value])}
            <span className="ms-1.5 text-xs tabular-nums opacity-70">{counts[value]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={t("myReg.noneInTabTitle")}
          description={t("myReg.noneInTabBody")}
          className="border-none shadow-none"
        />
      ) : (
        <div className={CARD_GRID}>
          {visible.map((item) => (
            <RegistrationCard
              key={item.id}
              item={item}
              actions={
                <CardActions
                  status={item.status}
                  rejectionReason={item.rejectionReason}
                  withdrawalReason={item.withdrawalReason}
                  onWithdraw={() => setWithdrawing(item)}
                />
              }
            />
          ))}
        </div>
      )}

      <AlertDialog
        open={withdrawing !== null}
        onOpenChange={(v) => {
          if (cancel.isPending) return;
          if (!v) setWithdrawing(null);
        }}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-start">
              {t("dash.registration.withdrawTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-start">
              {t("dash.registration.withdrawBody", { group: withdrawing?.groupName ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-xl" disabled={cancel.isPending}>
              {t("ui.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                // Radix closes on click; keep it open so the pending state is visible and
                // a second click cannot fire a second DELETE.
                e.preventDefault();
                if (withdrawing) void withdraw(withdrawing);
              }}
              disabled={cancel.isPending}
            >
              {cancel.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("dash.registration.withdrawConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * What the student can do next, by status.
 *
 * Pending used to offer nothing. It now offers the one thing that is genuinely available
 * while the administration reviews: withdrawing the request. Changing your mind before a
 * decision is a real need, and the alternative was emailing the centre.
 */
function CardActions({
  status,
  rejectionReason,
  withdrawalReason,
  onWithdraw,
}: {
  status: RegistrationStatus;
  rejectionReason: string | null;
  withdrawalReason: string | null;
  onWithdraw: () => void;
}) {
  const { t } = useI18n();

  // The same `StatePanel` the catalogue uses, so "en attente" reads identically on both
  // surfaces. The CONTENT differs on purpose: from here an approved student wants their
  // timetable, whereas from the catalogue they want the course itself.
  if (status === "approved") {
    return (
      <StatePanel
        tone="success"
        icon={CheckCircle2}
        title={t("dash.registration.state.approved")}
        hint={t("myReg.approvedHint")}
        action={
          <Button asChild variant="outline" size="sm" className="h-11 w-full rounded-xl">
            <Link to="/dashboard/schedule">
              <CalendarDays className="size-4" aria-hidden />
              {t("myReg.openSchedule")}
            </Link>
          </Button>
        }
      />
    );
  }

  if (status === "rejected") {
    return (
      <StatePanel
        tone="rejected"
        icon={XCircle}
        title={t("dash.registration.state.rejected")}
        // The administration's own words, where the refusal is explained.
        hint={rejectionReason ?? undefined}
        action={
          <Button asChild variant="outline" size="sm" className="h-11 w-full rounded-xl">
            <Link to="/dashboard/registration">
              <Search className="size-4" aria-hidden />
              {t("myReg.registerAnother")}
            </Link>
          </Button>
        }
      />
    );
  }

  // A place the student held and no longer holds. History, not an error: they can ask again.
  if (status === "withdrawn") {
    return (
      <StatePanel
        tone="neutral"
        icon={LogOut}
        title={t("dash.registration.state.withdrawn")}
        hint={withdrawalReason ?? undefined}
        action={
          <Button asChild variant="outline" size="sm" className="h-11 w-full rounded-xl">
            <Link to="/dashboard/registration">
              <Search className="size-4" aria-hidden />
              {t("myReg.registerAnother")}
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <StatePanel
      tone="pending"
      icon={Clock3}
      title={t("dash.registration.state.pending")}
      hint={t("myReg.pendingHint")}
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 w-full rounded-xl text-muted-foreground hover:text-destructive"
          onClick={onWithdraw}
        >
          {t("myReg.withdraw")}
        </Button>
      }
    />
  );
}
