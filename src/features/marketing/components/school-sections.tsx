/**
 * The public site, as the school's own.
 *
 * WHAT THIS IS NOT. It is not a page builder, and no school chooses anything here. Gestion École
 * owns the typography, the spacing, the rhythm, the responsive behaviour and the way a
 * section is put together; the school owns its name, its logo, its two colours, its words
 * and its contact details. Every school-specific value on this page arrives through
 * `useBrand()` from `center_settings` -- there is no string here that names this school, and
 * a second deployment becomes a different institution by editing a row.
 *
 * WHAT REPLACED WHAT. The first pass at this page was branded correctly and read like an
 * application template: four icon cards, three step cards, a card for the call to action.
 * A school's website is not a feature grid. The layout is editorial now -- a photographic
 * hero of a room of books, an ivory band for the school's own prose, hairline-separated
 * lists rather than boxes, and one navy band at the end where the contact details live.
 *
 * THE LOGO IS OPAQUE, which shapes the hero rather than the whole page. `SchoolHero` below
 * records how the mark is blended onto the photograph because of it, and why nothing on
 * this page draws a card around a logo any more.
 */

import type { ComponentType, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, GraduationCap, LogIn, MapPin, Phone, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/features/marketing/components/reveal";
import { useBrand } from "@/hooks/use-brand";
import { useI18n } from "@/hooks/use-i18n";
import { aboutParagraphs, schoolAbout } from "@/lib/brand";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ shared pieces */

/**
 * A section heading, at one size everywhere.
 *
 * Small caps eyebrow, then the heading, then an optional line. Repeated by every section so
 * the page has one voice -- which is the part of this the school does not get to change.
 */
function SectionHeading({
  eyebrow,
  title,
  lead,
  className,
  tone = "default",
}: {
  /** Omitted where the section's own heading is the label, rather than a category above it. */
  eyebrow?: string | undefined;
  title: string;
  lead?: string | undefined;
  className?: string | undefined;
  tone?: "default" | "inverse";
}) {
  return (
    <div className={cn("max-w-2xl", className)}>
      {eyebrow && (
        <p
          className={cn(
            "text-[0.7rem] font-semibold uppercase tracking-[0.22em]",
            tone === "inverse" ? "text-primary-foreground/60" : "text-muted-foreground",
          )}
        >
          {eyebrow}
        </p>
      )}
      <h2
        className={cn(
          "mt-3 text-[1.75rem] font-semibold leading-[1.2] tracking-tight sm:text-[2.1rem]",
          tone === "inverse" && "text-primary-foreground",
        )}
      >
        {title}
      </h2>
      {lead && (
        <p
          className={cn(
            "mt-4 text-base leading-[1.8]",
            tone === "inverse" ? "text-primary-foreground/75" : "text-muted-foreground",
          )}
        >
          {lead}
        </p>
      )}
    </div>
  );
}

/**
 * The school's mark: its own logo, or the platform's, at a size the caller chooses.
 *
 * `alt` is a parameter rather than a hardcoded empty string. In the hero the mark is the
 * only place the school is NAMED -- the headline deliberately is not -- so a reader on a
 * screen reader, and a crawler reading the markup, can only get the name from here.
 * Everywhere the name is already written beside the image, the empty default stays right.
 */
function SchoolMark({
  className,
  iconClassName,
  alt = "",
}: {
  className?: string;
  iconClassName?: string;
  alt?: string;
}) {
  const { brand } = useBrand();
  if (brand.logoUrl) {
    return <img src={brand.logoUrl} alt={alt} className={cn("object-contain", className)} />;
  }
  return (
    <span
      aria-hidden
      className={cn(
        "grid place-items-center rounded-2xl bg-gradient-brand text-primary-foreground",
        className,
      )}
    >
      <GraduationCap className={iconClassName} />
    </span>
  );
}

/* ------------------------------------------------------------------ hero */

/**
 * The hero, built on the school's own photograph.
 *
 * WHAT REPLACED WHAT. The previous hero drew its own academic world -- a navy panel, a white
 * plate, ruled texture, and four line-drawings of a parabola, Thales' circle, a sine and a
 * row of notation. It was carefully made and it still read as a product UI, because a card
 * on a tinted field IS a product UI no matter what is drawn inside it. A real room of books
 * says "school" in the time it takes to load, and says it without a single decorative mark.
 * All of that generated decoration is gone; the photograph is the whole visual argument.
 *
 * THE PHOTOGRAPH IS THE SECTION, NOT AN ORNAMENT IN IT. It is a background layer at
 * `inset-0`, so it fills whatever height the copy needs, and the content sits on top rather
 * than beside it. The room's own composition decided the layout: books at the lower left,
 * window and pencils at the right, and a bright bare wall through the middle. Centred type
 * is not a style choice here -- it is the one column of the picture that is empty.
 *
 * THE OVERLAY IS LIGHT ON PURPOSE. Two washes: a soft bright centre that gives the type a
 * clean field, and a navy settling into the corners that frames the picture. Both are built
 * from `--card` and `--primary`, so a different school's colour carries through. A heavy
 * dark scrim would have made the text trivially readable and thrown away the daylight that
 * is the reason for using this photograph at all.
 *
 * THE LOGO HAS NO PLATE, AND NO BLEND EITHER. `mix-blend-multiply` looked like the elegant
 * answer -- white multiplied against a backdrop is that backdrop, so the file's white ground
 * would vanish. It is the wrong answer for THIS mark: the artwork is white-heavy, a white
 * pillar and a white wordmark, and multiply erases those exactly as readily as it erases the
 * background. It was tried, rendered, and reverted.
 *
 * What works is a halo with no edge. The mark keeps its own white rectangle, and a wide,
 * heavily blurred near-white ellipse sits under it -- far wider than the file, so the file's
 * straight edge falls deep inside a soft white field and has nothing to be an edge against.
 * The room still reads through the halo, and the logo file was never touched.
 *
 * WHAT IS SAID, AND HOW OFTEN. Logo, then a benefit headline, then the tagline small, then
 * the school's approved opening paragraph, then the two actions. The name is not written out
 * as a heading anywhere -- the logo carries it, which was the point of this whole exercise.
 */
export function SchoolHero() {
  const { t, locale } = useI18n();
  const { brand } = useBrand();
  const name = brand.schoolName ?? t("brand.name");
  /*
    Every line in this hero is now interface copy, so one flag decides the Arabic type
    branch. The school's own stored description used to supply the paragraph here and had to
    declare its own `lang`/`dir`; that paragraph moved out, and the branching went with it.
  */
  const uiArabic = locale === "ar";

  return (
    <section className="relative isolate overflow-hidden">
      {/*
        The photograph, cropped by viewport rather than by one rule.

        A 3:2 picture in a 375-wide frame keeps roughly a third of its width, and centred
        that third is bare wall -- warm, but it could be any room. Biasing the phone crop to
        32% holds the shelves and the stack of books in frame, which is the half of this
        photograph that actually says "school". From `sm` up the frame is wide enough to
        carry the whole room, so it recentres.
      */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[position:32%_center] bg-cover bg-no-repeat sm:bg-center"
        style={{ backgroundImage: "url('/hero-study.jpg')" }}
      />

      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: [
            "radial-gradient(68% 62% at 50% 44%, color-mix(in oklab, var(--card) 84%, transparent) 0%, color-mix(in oklab, var(--card) 58%, transparent) 42%, color-mix(in oklab, var(--card) 14%, transparent) 72%, transparent 88%)",
            "radial-gradient(120% 105% at 50% 45%, transparent 52%, color-mix(in oklab, var(--primary) 20%, transparent) 100%)",
          ].join(","),
        }}
      />

      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center px-5 py-12 text-center sm:px-6 sm:py-16 lg:py-20">
        {/*
          The halo is a gradient, not a card.

          The work is done by the colour stops rather than by `blur`: a pure `--card` core
          held out to 62% of the ellipse, wide enough that the logo's own opaque rectangle
          sits entirely inside white, then a long fade to nothing. An earlier version leaned
          on a heavy blur instead and the blur ate into the core, so the file's straight edge
          reappeared at phone sizes -- visible in the render, not in the markup.
        */}
        <div className="animate-rise relative">
          <div
            aria-hidden
            className="absolute -inset-x-24 -inset-y-16 rounded-[50%] blur-lg sm:-inset-x-32 sm:-inset-y-20 lg:-inset-x-40 lg:-inset-y-24"
            style={{
              background:
                "radial-gradient(closest-side, var(--card) 0%, var(--card) 62%, color-mix(in oklab, var(--card) 74%, transparent) 78%, color-mix(in oklab, var(--card) 34%, transparent) 90%, transparent 100%)",
            }}
          />
          <SchoolMark
            alt={name}
            className="relative h-20 w-auto max-w-full sm:h-24 lg:h-28"
            iconClassName="size-11"
          />
        </div>

        {/*
          Arabic sets its own size and leading: `tracking-tight` closes up joined letterforms
          and a 1.12 leading crops descenders that Arabic has and Latin mostly does not.
        */}
        {/*
          The eyebrow says what the school does, in the smallest voice on the screen. It
          carries the two gold rules the tagline used to sit between -- the accent stays in
          the composition, on a hairline rather than on words, which is where gold can go
          without failing contrast.
        */}
        <p
          className={cn(
            "animate-rise mt-6 flex items-center justify-center gap-3 font-semibold text-foreground/70",
            uiArabic ? "text-[0.85rem]" : "text-[0.75rem] uppercase tracking-[0.18em]",
          )}
          style={{ animationDelay: "60ms" }}
        >
          <span aria-hidden className="hidden h-px w-8 shrink-0 bg-brand-gold sm:block" />
          {t("landing.school.hero.eyebrow")}
          <span aria-hidden className="hidden h-px w-8 shrink-0 bg-brand-gold sm:block" />
        </p>

        <h1
          className={cn(
            "animate-rise mt-4 text-balance font-semibold text-foreground",
            uiArabic
              ? "max-w-[22ch] text-[1.95rem] leading-[1.45] sm:text-[2.5rem] lg:text-[3rem]"
              : "max-w-[19ch] text-[2rem] leading-[1.14] tracking-tight sm:text-[2.6rem] lg:text-[3.1rem]",
          )}
          style={{ animationDelay: "110ms" }}
        >
          {t("landing.school.hero.headline")}
        </h1>

        {/*
          The tagline is NOT rendered here, and that is a display decision only.
          `brand.tagline` is still resolved, still stored in `center_settings`, and still
          drawn by `Brand` in the header and the footer. It opened with the school's name,
          which the logo directly above it already carries -- so on this screen it was the
          same sentence twice.

          The paragraph beneath is interface copy rather than the school's stored
          description. The stored one was five lines of prose restating the headline; this is
          one sentence, and being an i18n string it is written once per language instead of
          being served in whichever language the school happened to fill in.
        */}
        <p
          className={cn(
            "animate-rise mt-6 max-w-2xl text-pretty text-[0.98rem] text-foreground/80 sm:text-[1.05rem]",
            uiArabic ? "leading-[1.95] sm:leading-[2]" : "leading-[1.75] sm:leading-[1.8]",
          )}
          style={{ animationDelay: "170ms" }}
        >
          {t("landing.school.hero.description")}
        </p>

        <div
          className="animate-rise mt-8 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center"
          style={{ animationDelay: "220ms" }}
        >
          <Button asChild size="lg" className="h-12 rounded-xl px-7 text-base shadow-card">
            <Link to="/register">
              <UserPlus className="size-4" aria-hidden />
              {t("landing.school.hero.join")}
            </Link>
          </Button>
          {/*
            Translucent rather than solid: the secondary action stays legible while letting
            the room show through it, which is what keeps the two buttons from reading as a
            pair of chips pasted onto a picture.
          */}
          <Button
            asChild
            variant="outline"
            size="lg"
            className="h-12 rounded-xl border-border/70 bg-card/80 px-7 text-base backdrop-blur-sm hover:bg-card"
          >
            <Link to="/login">
              <LogIn className="size-4" aria-hidden />
              {t("landing.school.hero.signIn")}
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ about */

/**
 * The school's own words, unedited, on the ivory the brand supplies.
 *
 * `lang` and `dir` come from `schoolAbout()` rather than from the interface locale: a French
 * visitor reading an Arabic description still needs it laid out right to left. If the school
 * has written nothing, this renders nothing -- an empty section beats prose nobody approved.
 *
 * The first paragraph is in the hero, so this continues from the second. A school that wrote
 * a single paragraph therefore gets a hero and no duplicate below it.
 */
export function SchoolAbout() {
  const { t, locale } = useI18n();
  const { brand } = useBrand();
  const about = schoolAbout(brand, locale);
  if (!about) return null;

  const rest = aboutParagraphs(about.text).slice(1);
  if (rest.length === 0) return null;

  const rtl = about.lang === "ar";

  return (
    <section id="about" className="border-y border-border bg-brand-gold-soft/40">
      <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-6 sm:py-20">
        <Reveal>
          <SectionHeading
            eyebrow={t("landing.school.about.eyebrow")}
            title={t("landing.school.about.title")}
          />
        </Reveal>

        <Reveal delay={80}>
          {/* A gold rule on the reading edge -- the start side, so it flips with the text. */}
          <div
            lang={about.lang}
            dir={rtl ? "rtl" : "ltr"}
            className="mt-8 space-y-5 border-brand-gold/50 ps-5 text-start border-s-2"
          >
            {rest.map((paragraph, i) => (
              <p key={i} className="text-[1.05rem] leading-[2] text-foreground/80">
                {paragraph}
              </p>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ the student space */

const PORTAL_ITEMS = ["schedule", "groups", "followup", "requests"] as const;

/**
 * What a student gets after signing in.
 *
 * Four statements of fact about screens that exist, set as a list with hairline rules rather
 * than four cards -- the difference between a school describing its space and a product
 * advertising features. Nothing here claims anything about how the school teaches; the
 * school's own description does that, above.
 */
export function SchoolPortalSection() {
  const { t } = useI18n();

  return (
    <section id="portal" className="bg-card">
      <div className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-6 sm:py-20">
        <Reveal>
          {/* The section IS "Espace élève"; a category label above it would only repeat
              the heading, and the four items below say the rest. */}
          <SectionHeading title={t("landing.school.portal.title")} />
        </Reveal>

        <dl className="mt-12 grid gap-x-12 sm:grid-cols-2">
          {PORTAL_ITEMS.map((key, i) => (
            <Reveal key={key} delay={60 + i * 60}>
              <div
                className={cn(
                  "border-t border-border py-6",
                  // The first two open the list on desktop; on mobile every row has a rule.
                  i < 2 ? "sm:border-t" : "",
                )}
              >
                <dt className="flex items-baseline gap-3">
                  <span className="text-xs font-semibold tabular-nums text-brand-gold">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-lg font-semibold tracking-tight">
                    {t(`landing.school.portal.${key}.title`)}
                  </span>
                </dt>
                <dd className="mt-2 text-[0.95rem] leading-[1.85] text-muted-foreground ms-[2.1rem]">
                  {t(`landing.school.portal.${key}.body`)}
                </dd>
              </div>
            </Reveal>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ joining */

/**
 * How a student joins, in the order it happens.
 *
 * Step three is the honest one: `registrations` are created `pending` and an administrator
 * decides, so the page says the school reviews the request rather than implying an account
 * puts you in a class.
 */
export function SchoolJoinSection() {
  const { t } = useI18n();
  const steps = ["s1", "s2", "s3"] as const;

  return (
    <section id="join" className="border-y border-border bg-brand-gold-soft/40">
      <div className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-6 sm:py-20">
        <Reveal>
          <SectionHeading
            eyebrow={t("landing.school.join.eyebrow")}
            title={t("landing.school.join.title")}
          />
        </Reveal>

        <ol className="mt-12 grid gap-8 sm:grid-cols-3 sm:gap-6">
          {steps.map((step, i) => (
            <Reveal key={step} delay={60 + i * 70}>
              <li className="relative">
                <span
                  aria-hidden
                  className="grid size-11 place-items-center rounded-full border border-brand-gold/45 text-sm font-semibold text-brand-gold"
                >
                  {i + 1}
                </span>
                {/* One line per step, exactly as the school worded it. Step three names
                    the school as the decider, which is also what the database does: a
                    registration is created `pending` and an administrator resolves it. */}
                <p className="mt-5 text-[0.95rem] font-medium leading-[1.7]">
                  {t(`landing.school.join.${step}`)}
                </p>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ contact + closing */

/**
 * The closing band: navy, the school's name, its contact details when it has published any,
 * and the two doors into the product.
 *
 * The one place the interface is dark. `--primary` is the school's colour, so this band is
 * the school's colour by definition -- and `readableForeground()` has already guaranteed the
 * text on it contrasts, whichever colour that turns out to be.
 */
export function SchoolAccessSection() {
  const { t } = useI18n();
  const { brand } = useBrand();
  const name = brand.schoolName ?? t("brand.name");
  const hasContact = brand.contactPhone !== null || brand.contactAddress !== null;

  /*
    The school's name, isolated, because it is dropped into a translated sentence.
    
    "…votre inscription à {school}, ou connectez-vous…" puts an Arabic name inside a French
    paragraph. Without isolation the bidi algorithm resolves the neutral characters around
    it -- the comma, the spaces -- against the Arabic run instead of the French one, and the
    punctuation drifts to the wrong end of the name. U+2068/U+2069 are the string-level
    equivalent of <bdi>, which is what this would be if `t()` returned nodes instead of text.
  */
  // Escapes, not the literal characters: U+2068 and U+2069 are invisible, and an invisible
  // character in source is one nobody can see to preserve.
  const isolatedName = `\u2068${name}\u2069`;

  return (
    <section id="access" className="bg-primary text-primary-foreground">
      <div className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-6 sm:py-20">
        <div className="grid gap-12 lg:grid-cols-[1.35fr_1fr]">
          <Reveal>
            <div>
              <SectionHeading
                tone="inverse"
                eyebrow={t("landing.school.access.eyebrow")}
                title={t("landing.school.access.title")}
                lead={t("landing.school.access.body", { school: isolatedName })}
              />
              <div aria-hidden className="mt-8 h-px w-20 bg-brand-gold" />
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  className="h-12 rounded-xl bg-card px-7 text-base text-foreground hover:bg-card/90"
                >
                  <Link to="/register">
                    {t("landing.school.hero.join")}
                    <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="h-12 rounded-xl border-primary-foreground/30 bg-transparent px-7 text-base text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
                >
                  <Link to="/login">{t("landing.school.hero.signIn")}</Link>
                </Button>
              </div>
            </div>
          </Reveal>

          {hasContact && (
            <Reveal delay={80}>
              <div className="border-primary-foreground/15 lg:border-s lg:ps-10">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary-foreground/60">
                  {t("landing.school.access.contact")}
                </p>
                <ul className="mt-5 space-y-4 text-[0.95rem]">
                  {brand.contactPhone && (
                    <ContactLine icon={Phone}>
                      {/* A phone number is direction-neutral: isolated so RTL cannot
                          reorder its groups. */}
                      <a
                        href={`tel:${brand.contactPhone.replace(/\s+/g, "")}`}
                        dir="ltr"
                        style={{ unicodeBidi: "isolate" }}
                        className="focus-ring rounded hover:underline"
                      >
                        {brand.contactPhone}
                      </a>
                    </ContactLine>
                  )}
                  {brand.contactAddress && (
                    <ContactLine icon={MapPin}>
                      <span dir="auto">{brand.contactAddress}</span>
                    </ContactLine>
                  )}
                </ul>
              </div>
            </Reveal>
          )}
        </div>
      </div>
    </section>
  );
}

function ContactLine({
  icon: Icon,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 text-primary-foreground/80">
      <Icon className="mt-0.5 size-4 shrink-0 text-brand-gold" aria-hidden />
      <span className="min-w-0">{children}</span>
    </li>
  );
}
