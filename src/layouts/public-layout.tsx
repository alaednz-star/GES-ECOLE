import { Link } from "@tanstack/react-router";
import { MapPin, Menu, Phone } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Brand } from "@/components/common/brand";
import { LanguageSwitcher } from "@/components/common/language-switcher";
import { useBrand } from "@/hooks/use-brand";
import { useI18n } from "@/hooks/use-i18n";

/*
  The public navigation, for a school's own site.

  It used to be Features / Pricing / About, and a footer of five columns advertising
  modules, a product preview and a vendor support address. None of that is addressed to a
  student or a parent, and a school does not sell its own timetable software to its
  pupils. What is left points at the parts of the page that concern them, plus the two
  doors into the product.
*/
const publicLinks = [
  { labelKey: "landing.school.nav.about", href: "#about" },
  { labelKey: "landing.school.nav.portal", href: "#portal" },
  { labelKey: "landing.school.nav.join", href: "#join" },
] as const;

type FooterLink = { labelKey: string; to?: "/login" | "/register"; href?: string };

const footerColumns: { titleKey: string; links: FooterLink[] }[] = [
  {
    titleKey: "landing.school.footer.school",
    links: [
      { labelKey: "landing.school.nav.about", href: "#about" },
      { labelKey: "landing.school.nav.portal", href: "#portal" },
      { labelKey: "landing.school.nav.join", href: "#join" },
    ],
  },
  {
    titleKey: "landing.school.footer.space",
    links: [
      { labelKey: "landing.school.hero.signIn", to: "/login" },
      { labelKey: "landing.school.hero.join", to: "/register" },
    ],
  },
];

export function PublicLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { brand } = useBrand();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header
        className={`sticky top-0 z-40 border-b transition-all duration-300 ${
          scrolled
            ? "border-border/70 bg-background/70 shadow-soft backdrop-blur-xl"
            : "border-transparent bg-background/40 backdrop-blur-sm"
        }`}
      >
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          {/*
            The mark alone below `sm`.

            "مدرسة النجاح للدعم المدرسي" is 25 characters, and beside a language switcher, a
            call to action and a menu button at 375px there is no width left for it -- it
            clamped to "مدرسة / النجاح…", which loses the half of the name that says what
            the school does. The hero states it in full a hundred pixels lower, so the
            header does not have to. Two elements rather than a prop because `Brand` is
            shared with the dashboard, whose sidebar decides this for itself.
          */}
          <Link to="/" className="focus-ring rounded-xl">
            <Brand showWordmark={false} className="sm:hidden" />
            <Brand className="hidden sm:flex" />
          </Link>

          <nav aria-label="Primary" className="ms-6 hidden items-center gap-1 lg:flex">
            {publicLinks.map((link) => (
              <a
                key={link.labelKey}
                href={link.href}
                className="focus-ring rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {t(link.labelKey)}
              </a>
            ))}
          </nav>

          <div className="ms-auto flex items-center gap-2">
            <LanguageSwitcher />
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link to="/login">{t("nav.login")}</Link>
            </Button>
            <Button asChild size="sm" className="rounded-xl">
              <Link to="/register">{t("nav.register")}</Link>
            </Button>

            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label={t("action.toggleSidebar")}
                >
                  <Menu className="size-5" aria-hidden />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72">
                <SheetTitle className="sr-only">{brand.schoolName ?? t("brand.name")}</SheetTitle>
                <nav className="mt-10 flex flex-col gap-1">
                  {publicLinks.map((link) => (
                    <a
                      key={link.labelKey}
                      href={link.href}
                      className="focus-ring rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {t(link.labelKey)}
                    </a>
                  ))}
                  <Link
                    to="/login"
                    className="focus-ring rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-muted"
                  >
                    {t("nav.login")}
                  </Link>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[1.3fr_2fr]">
            <div className="max-w-xs">
              <Brand size="sm" />
              {/*
                The school's tagline alone. `footer.tagline` -- "conçu pour les centres de
                soutien scolaire en Algérie" -- describes the PLATFORM, and a school's own
                footer is not where its software vendor introduces itself.
              */}
              <p dir="auto" className="mt-4 text-sm leading-relaxed text-muted-foreground">
                {brand.tagline ?? t("brand.tagline")}
              </p>
              {(brand.contactPhone || brand.contactAddress) && (
                <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
                  {brand.contactPhone && (
                    <li className="flex items-center gap-2">
                      <Phone className="size-4 shrink-0 text-primary" aria-hidden />
                      <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
                        {brand.contactPhone}
                      </span>
                    </li>
                  )}
                  {brand.contactAddress && (
                    <li className="flex items-start gap-2">
                      <MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      <span dir="auto">{brand.contactAddress}</span>
                    </li>
                  )}
                </ul>
              )}
            </div>

            <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2">
              {footerColumns.map((column) => (
                <div key={column.titleKey}>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground">
                    {t(column.titleKey)}
                  </p>
                  <ul className="mt-4 space-y-2.5">
                    {column.links.map((link) => {
                      const text = t(link.labelKey);
                      return (
                        <li key={link.labelKey}>
                          {link.to ? (
                            <Link
                              to={link.to}
                              className="focus-ring rounded text-sm text-muted-foreground transition-colors hover:text-foreground"
                            >
                              {text}
                            </Link>
                          ) : (
                            <a
                              href={link.href ?? "#"}
                              className="focus-ring rounded text-sm text-muted-foreground transition-colors hover:text-foreground"
                            >
                              {text}
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-12 flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
            {/*
              The school owns the copyright line. Gestion École appears once, underneath, as the
              platform -- which is the honest place for it: a parent should know whose site
              this is, and an auditor should be able to see what runs it.
            */}
            <div className="space-y-1">
              <p dir="auto" className="text-xs text-muted-foreground">
                © {new Date().getFullYear()} {brand.schoolName ?? t("brand.name")}
              </p>
              <p className="text-[11px] text-muted-foreground/70">
                {t("landing.school.footer.poweredBy")}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{t("action.changeLanguage")}</span>
              <LanguageSwitcher />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
