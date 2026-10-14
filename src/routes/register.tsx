import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthLayout } from "@/layouts/auth-layout";
import { RegisterForm } from "@/features/auth/components/register-form";
import { useI18n } from "@/hooks/use-i18n";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Create your account — Gestion École" },
      {
        name: "description",
        content: "Create a Gestion École workspace for your private tutoring center.",
      },
      { property: "og:title", content: "Create your account — Gestion École" },
      { property: "og:description", content: "Start managing your tutoring center." },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const { t } = useI18n();

  return (
    <AuthLayout
      title={t("auth.registerTitle")}
      subtitle={t("auth.registerSubtitle")}
      footer={
        <>
          {t("auth.haveAccount")}{" "}
          <Link to="/login" className="focus-ring rounded font-medium text-primary">
            {t("action.signIn")}
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthLayout>
  );
}
