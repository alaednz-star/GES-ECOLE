import { useState } from "react";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { KeyRound, Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Brand } from "@/components/common/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FullPageLoader } from "@/components/common/full-page-loader";
import { LanguageSwitcher } from "@/components/common/language-switcher";
import { RequireAuth } from "@/features/auth/require-auth";
import { usePasswordChangeRequired } from "@/features/auth/password-change";
import { supabase } from "@/integrations/supabase/client";
import { authService } from "@/services/auth";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";

export const Route = createFileRoute("/change-password")({
  head: () => ({
    meta: [{ title: "Changer le mot de passe — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth>
      <ChangePasswordPage />
    </RequireAuth>
  ),
});

const MIN_LENGTH = 8;

function ChangePasswordPage() {
  const { t, locale, dir } = useI18n();
  const { user, signOut, refresh } = useAuth();
  const { notifySuccess, notifyError } = useActionFeedback();
  const navigate = useNavigate();

  const { data: required, isLoading } = usePasswordChangeRequired(user?.id);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;

    if (next.length < MIN_LENGTH) {
      toast.error(t("changePassword.tooShort", { min: String(MIN_LENGTH) }));
      return;
    }
    if (next !== confirm) {
      toast.error(t("changePassword.mismatch"));
      return;
    }
    if (next === current) {
      toast.error(t("changePassword.sameAsCurrent"));
      return;
    }

    setPending(true);
    try {
      // Re-authenticate with the current password. Supabase's updateUser does
      // not verify the old password, so without this a hijacked session could
      // silently change the credential.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user?.email ?? "",
        password: current,
      });
      if (signInError) {
        toast.error(t("changePassword.currentWrong"));
        return;
      }

      await authService.updatePassword(next);

      // Clear the flag only after the password actually changed.
      const { error: flagError } = await supabase
        .from("profiles")
        .update({ password_change_required: false })
        .eq("id", user?.id ?? "");
      if (flagError) throw flagError;

      notifySuccess("changePassword.done");
      await refresh();
      await navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      notifyError(err);
    } finally {
      setPending(false);
    }
  };

  if (isLoading) return <FullPageLoader label={t("ui.loading")} />;
  // Nothing pending -- do not let this page become a second dashboard entrance.
  if (required === false) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-dvh bg-muted/30" dir={dir} lang={locale}>
      <header className="flex h-16 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
        <Brand size="sm" />
        <div className="ms-auto flex items-center gap-1.5">
          <LanguageSwitcher />
          <Button
            variant="ghost"
            size="sm"
            className="rounded-xl"
            onClick={async () => {
              await signOut();
              await navigate({ to: "/login", replace: true });
            }}
          >
            <LogOut className="size-4" aria-hidden />
            <span className="hidden sm:inline">{t("action.signOut")}</span>
          </Button>
        </div>
      </header>

      <main className="px-4 py-8 sm:px-6 sm:py-12">
        <div className="mx-auto w-full max-w-md">
          <div className="space-y-2 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary">
              <KeyRound className="size-6" aria-hidden />
            </span>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {t("changePassword.title")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("changePassword.body")}</p>
          </div>

          <form onSubmit={submit} className="surface-card mt-6 space-y-5 p-5 sm:p-7" noValidate>
            <div className="space-y-2">
              <Label htmlFor="cp-current">{t("changePassword.current")}</Label>
              <Input
                id="cp-current"
                type="password"
                autoComplete="current-password"
                className="h-12 rounded-xl"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cp-new">{t("changePassword.new")}</Label>
              <Input
                id="cp-new"
                type="password"
                autoComplete="new-password"
                className="h-12 rounded-xl"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("changePassword.hint", { min: String(MIN_LENGTH) })}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cp-confirm">{t("changePassword.confirm")}</Label>
              <Input
                id="cp-confirm"
                type="password"
                autoComplete="new-password"
                className="h-12 rounded-xl"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>

            <Button type="submit" className="h-12 w-full rounded-xl text-base" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {pending ? t("ui.saving") : t("changePassword.submit")}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
