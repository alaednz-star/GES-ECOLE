import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Brand } from "@/components/common/brand";
import { LanguageSwitcher } from "@/components/common/language-switcher";
import { useBrand } from "@/hooks/use-brand";
import { useI18n } from "@/hooks/use-i18n";

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  const { t } = useI18n();
  const { brand } = useBrand();

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col px-4 py-8 sm:px-8">
        <div className="flex items-center justify-between">
          <Link to="/" className="focus-ring rounded-xl">
            <Brand />
          </Link>
          <LanguageSwitcher />
        </div>

        <div className="animate-rise mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <div className="mt-6 text-sm text-muted-foreground">{footer}</div>
        </div>
      </div>

      <aside className="relative hidden overflow-hidden bg-gradient-brand lg:block">
        <div className="absolute inset-0 opacity-25 [background:radial-gradient(60%_60%_at_30%_20%,white,transparent)]" />
        <div className="relative flex h-full flex-col justify-end gap-4 p-12 text-primary-foreground">
          {/*
            The school's line if there is one. On /login there is not: `center_settings` is
            readable only by an authenticated role, so a logged-out visitor sees the
            platform's. Making it visible earlier is a security decision, reported rather
            than taken -- see the Phase 2A notes on pre-auth branding.
          */}
          <p dir="auto" className="max-w-md text-3xl font-semibold leading-tight tracking-tight">
            {brand.tagline ?? t("brand.tagline")}
          </p>
          <p className="max-w-md text-sm opacity-85">{t("auth.demoNotice")}</p>
        </div>
      </aside>
    </div>
  );
}
