/**
 * The public site.
 *
 * This deployment belongs to one school, so the URL a student or a parent types is that
 * school's website -- not a page that sells them school-management software. The hero was
 * "Gérez tout votre centre de soutien depuis une seule interface", addressed to whoever
 * buys the product; the people who arrive here are the ones who study at the school.
 *
 * Gestion École stays where it belongs: a line in the footer saying what runs the site.
 */

import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PublicLayout } from "@/layouts/public-layout";
import {
  SchoolAbout,
  SchoolAccessSection,
  SchoolHero,
  SchoolJoinSection,
  SchoolPortalSection,
} from "@/features/marketing/components/school-sections";
import { useBrand } from "@/hooks/use-brand";
import { useI18n } from "@/hooks/use-i18n";

export const Route = createFileRoute("/")({
  /*
    The title is static because `head()` is resolved per route, before any query has run --
    there is no route-level hook that can wait for the school's name. `SchoolHead` below
    corrects it once branding resolves, which is the same approach the favicon takes in
    `BrandProvider`. The static value therefore has to be neutral rather than a platform
    pitch: it is what a search engine sees if the row is unreachable.
  */
  head: () => ({
    meta: [
      { title: "Espace élève" },
      { name: "description", content: "Accès élèves et parents : inscriptions, cours et suivi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LandingPage,
});

/**
 * Puts the school's name in the tab and in the shareable metadata.
 *
 * Written to the DOM rather than through `head()`, for the reason above. Only the fields a
 * school actually supplies are touched, so an unbranded deployment keeps what the route
 * declared.
 */
function SchoolHead() {
  const { brand } = useBrand();
  const { t } = useI18n();
  const name = brand.schoolName;
  const tagline = brand.tagline;

  useEffect(() => {
    if (typeof document === "undefined" || !name) return;
    const title = tagline ? `${name} — ${tagline}` : name;
    document.title = title;
    document.querySelector('meta[property="og:title"]')?.setAttribute("content", title);
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", `${name} — ${t("landing.school.metaDescription")}`);
  }, [name, tagline, t]);

  return null;
}

function LandingPage() {
  return (
    <PublicLayout>
      <SchoolHead />
      <SchoolHero />
      <SchoolAbout />
      <SchoolPortalSection />
      <SchoolJoinSection />
      <SchoolAccessSection />
    </PublicLayout>
  );
}
