import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AuthLayout } from "@/layouts/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authService } from "@/services/auth";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Mot de passe oublié — Gestion École" },
      {
        name: "description",
        content: "Recevez un lien sécurisé pour réinitialiser votre mot de passe.",
      },
      { property: "og:title", content: "Mot de passe oublié — Gestion École" },
      { property: "og:description", content: "Réinitialisez l'accès à votre espace Gestion École." },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { t } = useI18n();
  const { notifyError } = useActionFeedback();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authService.requestPasswordReset(email, `${window.location.origin}/reset-password`);
      setSent(true);
      toast.success(t("auth.linkSent"));
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title={t("auth.forgotTitle")}
      subtitle={t("auth.forgotSubtitle")}
      footer={
        <Link to="/login" className="focus-ring rounded font-medium text-primary">
          {t("auth.backToLogin")}
        </Link>
      }
    >
      {sent ? (
        <p className="rounded-xl bg-success-soft px-4 py-3 text-sm text-success">
          {t("auth.linkSentBody", { email })}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-5" noValidate>
          <div className="space-y-2">
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              placeholder="vous@centre.dz"
              className="h-11 rounded-xl"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" className="h-11 w-full rounded-xl" disabled={loading}>
            {t("auth.sendLink")}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
