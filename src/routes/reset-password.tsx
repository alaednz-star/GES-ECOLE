import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { AuthLayout } from "@/layouts/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authService } from "@/services/auth";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Nouveau mot de passe — Gestion École" },
      { name: "description", content: "Définissez un nouveau mot de passe pour votre compte." },
      { property: "og:title", content: "Nouveau mot de passe — Gestion École" },
      { property: "og:description", content: "Définissez un nouveau mot de passe Gestion École." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { t } = useI18n();
  const { notifyError } = useActionFeedback();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [reveal, setReveal] = useState(false);
  /*
    Whether Supabase has actually established a session from the recovery link.

    The page used to call `updateUser({ password })` unconditionally. Opened
    directly -- a bookmark, an expired link, a link already used -- that produced
    a raw Supabase error and a form that looked like it should work. The token
    arrives in the URL fragment and the client exchanges it on load, so the honest
    thing to check is whether a session exists once that has had a chance to run.
  */
  const [session, setSession] = useState<"checking" | "valid" | "missing">("checking");

  useEffect(() => {
    let active = true;

    // PASSWORD_RECOVERY fires when the link is exchanged; SIGNED_IN covers the
    // case where the exchange completed before this listener attached.
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || (s && event === "SIGNED_IN")) setSession("valid");
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession((prev) => (prev === "valid" ? prev : data.session ? "valid" : "missing"));
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error(t("auth.passwordTooShort"));
      return;
    }
    if (password !== confirm) {
      toast.error(t("auth.passwordsMismatch"));
      return;
    }
    if (session !== "valid") {
      toast.error(t("auth.resetNoSession"));
      return;
    }
    setLoading(true);
    try {
      await authService.updatePassword(password);

      /*
        A password chosen here is the user's own, so the "still holds an
        administrator-issued password" flag no longer describes the account.
        Without this the recovery link ends on /change-password asking for a
        new password immediately after one was just set -- which is what a
        newly invited administrator would otherwise walk into. Same update
        /change-password performs, and RLS restricts it to the owner's row.
      */
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        await supabase
          .from("profiles")
          .update({ password_change_required: false })
          .eq("id", auth.user.id);
      }

      toast.success(t("auth.passwordUpdated"));
      await navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title={t("auth.resetTitle")}
      subtitle={t("auth.resetSubtitle")}
      footer={
        <Link to="/login" className="focus-ring rounded font-medium text-primary">
          {t("auth.backToLogin")}
        </Link>
      }
    >
      {session === "checking" ? (
        <p className="text-sm text-muted-foreground">{t("ui.loading")}</p>
      ) : session === "missing" ? (
        /*
          No session means the link is missing, expired, or already spent. Saying
          so beats a form that fails on submit -- and the only way forward really
          is to request a fresh link.
        */
        <div className="space-y-4">
          <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">{t("auth.resetInvalidTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("auth.resetInvalidBody")}</p>
          </div>
          <Button asChild variant="outline" className="h-11 w-full rounded-xl">
            <Link to="/forgot-password">{t("auth.forgotPassword")}</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5" noValidate>
          <div className="space-y-2">
            <Label htmlFor="password">{t("auth.newPassword")}</Label>
            <Input
              id="password"
              type={reveal ? "text" : "password"}
              autoComplete="new-password"
              className="h-11 rounded-xl"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("auth.passwordRequirement")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">{t("auth.confirmPassword")}</Label>
            <Input
              id="confirm"
              type={reveal ? "text" : "password"}
              autoComplete="new-password"
              className="h-11 rounded-xl"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="focus-ring size-4 rounded border-border"
              checked={reveal}
              onChange={(e) => setReveal(e.target.checked)}
            />
            {t("auth.showPassword")}
          </label>
          <Button type="submit" className="h-11 w-full rounded-xl" disabled={loading}>
            {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("auth.update")}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
