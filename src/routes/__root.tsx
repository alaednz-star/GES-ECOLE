import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportError } from "../lib/error-reporting";
import { useI18n } from "@/hooks/use-i18n";
import { BrandProvider } from "@/features/branding/brand-provider";
import { getPublicSchoolFn } from "@/features/branding/branding.functions";
import { isBrandAssetUrl, schoolNameOrNull } from "@/lib/brand";
import { I18nProvider } from "@/lib/i18n/i18n-provider";
import { LocaleSync } from "@/lib/i18n/locale-sync";
import { AuthProvider } from "@/features/auth/auth-provider";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="text-gradient-brand text-7xl font-semibold tracking-tight">404</p>
        <h1 className="mt-4 text-xl font-semibold text-foreground">{t("notFound.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("notFound.body")}</p>
        <div className="mt-6">
          <Link
            to="/"
            className="focus-ring inline-flex items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("action.backHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="focus-ring inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="focus-ring inline-flex items-center justify-center rounded-xl border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/10"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

/*
  The platform's own metadata, used only where no school has been configured.

  A deployment that HAS branded itself must not announce another company in its tab, its
  search result or its link previews -- that is the same defect as the logo flash, just in
  a place a screenshot does not show.
*/
const PLATFORM_TITLE = "Gestion École — School management for tutoring centers";
const PLATFORM_DESCRIPTION =
  "A premium, bilingual (Arabic/French) management platform built for private tutoring centers in Algeria.";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  /*
    The school, resolved on the server before any HTML is produced.

    This is the whole fix. `BrandProvider` used to learn the school's identity from a
    browser query, so the server render had nothing to go on and emitted the product's name,
    logo and palette; the school replaced them one round trip later. A root loader runs
    during SSR, and TanStack Start serialises its result into the document, so the value is
    already present for the first client render -- no second commit, nothing to swap.

    It is on the ROOT route deliberately. Every surface that shows the school -- the public
    header, the hero, the footer, the login screen, the dashboard sidebar -- reads the one
    `BrandProvider` below, so fixing the shell fixes all of them at once and no page gets
    its own branding path that could drift.
  */
  // A failed read (the desktop app offline, ADR-010) falls back to null: BrandProvider then uses
  // its own query, which the desktop app keeps in its offline cache.
  loader: async () => ({ school: await getPublicSchoolFn().catch(() => null) }),
  /*
    Branding changes when an administrator edits it, which is roughly never. Without this
    the root loader would re-run on every client-side navigation to fetch a row the query
    cache already holds for ten minutes.
  */
  staleTime: 5 * 60_000,
  head: ({ loaderData }) => {
    const school = loaderData?.school ?? null;
    const name = schoolNameOrNull(school?.school_name);
    const tagline = school?.tagline?.trim() || null;

    const title = name ? (tagline ? `${name} — ${tagline}` : name) : PLATFORM_TITLE;
    const description = name ? (tagline ?? name) : PLATFORM_DESCRIPTION;

    /*
      The tab icon, in the initial HTML rather than swapped by an effect afterwards.
      `isBrandAssetUrl` has already refused anything that is not a plain https URL on a
      Supabase storage host, which is what makes it safe to put a stored value in `href`.
    */
    const storedFavicon = school?.favicon_url ?? null;
    const favicon = isBrandAssetUrl(storedFavicon) ? storedFavicon : "/favicon.ico";

    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title },
        { name: "description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { property: "og:title", content: title },
        { name: "twitter:title", content: title },
        { property: "og:description", content: description },
        { name: "twitter:description", content: description },
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Cairo:wght@400;500;600;700&display=swap",
        },
        { rel: "icon", href: favicon },
      ],
    };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" dir="ltr">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  // Resolved by the loader above, on the server, before this component first rendered.
  const school = Route.useLoaderData()?.school ?? null;

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <AuthProvider>
          <LocaleSync />
          {/*
            Inside AuthProvider so a signed-in user's branding refetches with their
            session, but it no longer DEPENDS on one: `20260813140000` grants anon the
            school's public identity, which is what makes the landing page and the login
            screen the school's rather than the platform's.
          */}
          <BrandProvider initialData={school}>
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <Outlet />
            <Toaster position="top-center" richColors />
          </BrandProvider>
        </AuthProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
