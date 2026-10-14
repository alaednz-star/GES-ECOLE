/**
 * Configuration → Utilisateurs.
 *
 * Who can reach the management area, and how another administrator is added.
 *
 * EVERY PRIVILEGED CALL GOES THROUGH A SERVER FUNCTION. This page never touches
 * `user_roles`, never calls the Supabase admin API, and never sees the service-role
 * key. It sends the caller's own access token to `admins.functions.ts`, which
 * re-verifies on the server that the caller is an administrator before doing
 * anything — the `roles={["admin"]}` guard below is UX, not security.
 *
 * THERE IS NO ROLE SELECTOR. "Administrateur" is displayed, never chosen: the role
 * is fixed in server code, and no field in the dialog can influence it.
 */

import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, MailCheck, ShieldCheck, UserCog, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { PersonAvatar } from "@/features/profile/person-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RequireAuth } from "@/features/auth/require-auth";
import {
  createAdminFn,
  deleteAdminFn,
  listUsersFn,
  sendRecoveryFn,
  setAdminActiveFn,
} from "@/features/admins/admins.functions";
import { AdminLifecycleActions } from "@/features/admins/components/admin-lifecycle-actions";
import type { AdminAction } from "@/features/admins/admin-lifecycle-model";
import { useAuth } from "@/hooks/use-auth";
import { currentAccessToken } from "@/integrations/supabase/access-token";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/users")({
  head: () => ({
    meta: [
      { title: "Utilisateurs" },
      { name: "description", content: "Gérez les comptes autorisés à accéder à la gestion." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <UsersPage />
    </RequireAuth>
  ),
});

const usersKey = ["managed-users"] as const;

function UsersPage() {
  const { t, locale } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const {
    data: users,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: usersKey,
    queryFn: async () => {
      const accessToken = await currentAccessToken();
      if (!accessToken) throw new Error(t("dash.users.sessionExpired"));
      const res = await listUsersFn({ data: { accessToken } });
      if (!res.ok) throw new Error(res.message);
      return res.users;
    },
  });

  const { user: viewer } = useAuth();

  /**
   * How many administrators can sign in right now.
   *
   * Counted from the list already on screen rather than asked for separately: it is the same
   * data, and a second source could disagree with what the administrator is looking at. The
   * count that actually decides is read inside the database guard, in the same statement that
   * performs the check -- this one only decides which buttons are offered.
   */
  const activeAdminCount = (users ?? []).filter((u) => u.role === "admin" && u.active).length;

  const lifecycle = useMutation({
    mutationFn: async ({ userId, action }: { userId: string; action: AdminAction }) => {
      const accessToken = await currentAccessToken();
      if (!accessToken) throw new Error(t("dash.users.sessionExpired"));
      const res =
        action === "delete"
          ? await deleteAdminFn({ data: { accessToken, userId } })
          : await setAdminActiveFn({
              data: { accessToken, userId, active: action === "reactivate" },
            });
      // The server's refusal is the one that matters, and it names the rule it applied.
      if (!res.ok) throw new Error(res.message);
      return action;
    },
    onSuccess: (action) => {
      notifySuccess(`dash.users.done.${action}`);
      void qc.invalidateQueries({ queryKey: usersKey });
    },
    onError: (e) => notifyError(e),
  });

  const recovery = useMutation({
    mutationFn: async (userId: string) => {
      const accessToken = await currentAccessToken();
      if (!accessToken) throw new Error(t("dash.users.sessionExpired"));
      const res = await sendRecoveryFn({
        data: { accessToken, userId, origin: window.location.origin },
      });
      if (!res.ok) throw new Error(res.message);
      return res.sent;
    },
    onSuccess: (sent) =>
      sent
        ? notifySuccess("dash.users.recoverySent")
        : notifyError(new Error(t("dash.users.recoveryFailed"))),
    onError: (e) => notifyError(e),
  });

  const header = (
    <PageHeader
      title={t("dash.users.title")}
      description={t("dash.users.description")}
      actions={
        <Button className="h-11 rounded-xl" onClick={() => setCreating(true)}>
          <UserPlus className="size-4" aria-hidden />
          {t("dash.users.create")}
        </Button>
      }
    />
  );

  if (error) {
    return (
      <>
        {header}
        <ErrorState error={error} onRetry={() => void refetch()} isRetrying={isFetching} />
      </>
    );
  }

  return (
    <>
      {header}

      {/*
        A school with one administrator is one forgotten password away from having nobody
        who can add a teacher, approve a registration or reach this page at all. The
        protections below refuse the click that would cause it; this says so before anyone
        has to be refused.
      */}
      {activeAdminCount === 1 && (
        <p
          role="status"
          className="rounded-2xl border border-accent/30 bg-accent/8 px-4 py-3 text-sm text-accent"
        >
          {t("dash.users.onlyOneAdmin")}
        </p>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : (users?.length ?? 0) === 0 ? (
        <EmptyState
          icon={UserCog}
          title={t("dash.users.emptyTitle")}
          description={t("dash.users.emptyBody")}
          action={
            <Button className="mt-2 rounded-xl" onClick={() => setCreating(true)}>
              {t("dash.users.create")}
            </Button>
          }
        />
      ) : (
        /*
          A list of cards, not a table. At 375px a five-column table either scrolls
          sideways or crushes the email; the same rows stack cleanly instead, which
          is why this page has no horizontal overflow on mobile.
        */
        <ul className="space-y-3">
          {users?.map((u) => (
            <li key={u.id} className="surface-card p-4 sm:p-5">
              <div className="flex flex-wrap items-start gap-4">
                <PersonAvatar name={u.fullName} url={null} className="size-11 shrink-0" />

                <div className="min-w-0 flex-1">
                  <p dir="auto" className="truncate font-semibold">
                    {u.fullName || t("dash.users.noName")}
                  </p>
                  {/* An address is direction-neutral; isolated so RTL cannot reorder it. */}
                  <p
                    dir="ltr"
                    style={{ unicodeBidi: "isolate" }}
                    className="truncate text-sm text-muted-foreground"
                  >
                    {u.email}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("dash.users.since", { date: formatDate(u.createdAt, locale) })}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="secondary"
                    className={cn(
                      "rounded-lg",
                      u.role === "admin" && "bg-primary-soft text-primary",
                    )}
                  >
                    {u.role === "admin" ? (
                      <ShieldCheck className="me-1 size-3.5" aria-hidden />
                    ) : null}
                    {t(u.role === "admin" ? "dash.users.roleAdmin" : "dash.users.roleTeacher")}
                  </Badge>

                  {/*
                    Status is what actually governs sign-in, not decoration. An
                    unconfirmed address cannot authenticate at all, and a pending
                    password means the account still holds one it did not choose.
                  */}
                  {/* Deactivation outranks the others: an account that cannot sign in at
                      all is not meaningfully "pending" or "unconfirmed". */}
                  {!u.active ? (
                    <Badge className="rounded-lg border-muted-foreground/30 bg-muted text-muted-foreground">
                      {t("dash.users.statusDeactivated")}
                    </Badge>
                  ) : !u.emailConfirmed ? (
                    <Badge className="rounded-lg border-destructive/25 bg-destructive/5 text-destructive">
                      {t("dash.users.statusUnconfirmed")}
                    </Badge>
                  ) : u.passwordChangeRequired ? (
                    <Badge className="rounded-lg border-accent/30 bg-accent/8 text-accent">
                      {t("dash.users.statusPending")}
                    </Badge>
                  ) : (
                    <Badge className="rounded-lg border-success/25 bg-success/5 text-success">
                      {t("dash.users.statusActive")}
                    </Badge>
                  )}

                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-xl"
                    onClick={() => recovery.mutate(u.id)}
                    disabled={recovery.isPending}
                  >
                    {recovery.isPending && recovery.variables === u.id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <KeyRound className="size-4" aria-hidden />
                    )}
                    <span className="hidden sm:inline">{t("dash.users.resetPassword")}</span>
                  </Button>

                  <AdminLifecycleActions
                    user={u}
                    ctx={{ viewerId: viewer?.id ?? "", activeAdminCount }}
                    pending={lifecycle.isPending && lifecycle.variables?.userId === u.id}
                    onRun={(action) => lifecycle.mutate({ userId: u.id, action })}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <CreateAdminDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          void qc.invalidateQueries({ queryKey: usersKey });
        }}
      />
    </>
  );
}

/** Name and email. Nothing else — and deliberately no role field. */
function CreateAdminDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const accessToken = await currentAccessToken();
      if (!accessToken) throw new Error(t("dash.users.sessionExpired"));
      const res = await createAdminFn({
        data: {
          accessToken,
          fullName: fullName.trim(),
          email: email.trim(),
          origin: window.location.origin,
        },
      });
      if (!res.ok) {
        throw new Error(res.code === "EMAIL_TAKEN" ? t("dash.users.emailTaken") : res.message);
      }
      return res.admin;
    },
    onSuccess: (created) => {
      // The account exists either way; whether the invitation reached them is a
      // separate fact, and saying so is the difference between "done" and "done,
      // but they cannot sign in yet".
      notifySuccess(created.recoveryEmailSent ? "dash.users.created" : "dash.users.createdNoMail");
      setFullName("");
      setEmail("");
      onCreated();
    },
    onError: (e) => notifyError(e),
  });

  const nameOk = fullName.trim().length >= 3;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const canSubmit = nameOk && emailOk && !create.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (create.isPending) return;
        if (!v) onClose();
      }}
    >
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-start">{t("dash.users.create")}</DialogTitle>
          <DialogDescription className="text-start">{t("dash.users.createBody")}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) create.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="admin-name">{t("dash.users.fullName")}</Label>
            <Input
              id="admin-name"
              className="h-11 rounded-xl"
              value={fullName}
              autoComplete="name"
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="admin-email">{t("dash.users.email")}</Label>
            <Input
              id="admin-email"
              type="email"
              dir="ltr"
              className="h-11 rounded-xl"
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
            />
            {email.trim() !== "" && !emailOk ? (
              <p className="text-xs text-destructive">{t("dash.users.emailInvalid")}</p>
            ) : null}
          </div>

          {/* The role, stated and not selectable. */}
          <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-3">
            <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("dash.users.roleAdmin")}</p>
              <p className="text-xs text-muted-foreground">{t("dash.users.roleFixed")}</p>
            </div>
          </div>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <MailCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{t("dash.users.inviteHint")}</span>
          </p>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-xl"
              onClick={onClose}
              disabled={create.isPending}
            >
              {t("ui.cancel")}
            </Button>
            <Button type="submit" className="h-11 rounded-xl" disabled={!canSubmit}>
              {create.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("dash.users.createConfirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
