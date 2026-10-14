import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthLayout } from "@/layouts/auth-layout";
import { LoginForm } from "@/features/auth/components/login-form";
import { useI18n } from "@/hooks/use-i18n";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Gestion École" },
      { name: "description", content: "Sign in to your Gestion École workspace." },
      { property: "og:title", content: "Sign in — Gestion École" },
      { property: "og:description", content: "Access your tutoring center workspace." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { t } = useI18n();

  return (
    <AuthLayout
      title={t("auth.welcome")}
      subtitle={t("auth.loginSubtitle")}
      footer={
        <>
          {t("auth.noAccount")}{" "}
          <Link to="/register" className="focus-ring rounded font-medium text-primary">
            {t("action.signUp")}
          </Link>
        </>
      }
    >
      <LoginForm />
    </AuthLayout>
  );
}
