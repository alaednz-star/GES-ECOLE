/**
 * The school's identity, wherever the shell shows it.
 *
 * ONE component, still. The sidebar, the auth layout, onboarding and the password screens
 * all render this, so "what does this deployment call itself" is answered in a single file
 * -- which is the whole reason a school logo could be added without touching any of them.
 *
 * The fallback is the point. `BrandProvider` hands back the product's own identity (Gestion École) whenever
 * branding is absent, unresolved or malformed, and a logo that fails to LOAD falls back
 * here too. There is no state in which this renders a broken image or an empty box.
 */

import { useEffect, useState } from "react";
import { GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/use-i18n";
import { useBrand } from "@/hooks/use-brand";

interface BrandProps {
  className?: string | undefined;
  showWordmark?: boolean | undefined;
  size?: "sm" | "md" | "lg" | undefined;
  /** The school's own line, under the name. Off by default: it does not fit a sidebar header. */
  showTagline?: boolean | undefined;
}

/** The fallback mark is square; a school's logo is whatever shape the school's logo is. */
const MARK = { sm: "size-8", md: "size-9", lg: "size-12" } as const;
const ICON = { sm: "size-4", md: "size-5", lg: "size-6" } as const;
/*
  A logo is sized by HEIGHT, with a ceiling on width.

  The square box the fallback uses is wrong for an uploaded file: "مدرسة النجاح" is a
  464x243 wordmark, and `object-contain` inside `size-8` renders it at 32x17 -- legible as a
  smudge. Height plus `w-auto` gives a wide mark its length and leaves a square one square.
*/
const LOGO = {
  sm: "h-8 w-auto max-w-[132px]",
  md: "h-9 w-auto max-w-[160px]",
  lg: "h-12 w-auto max-w-[220px]",
} as const;

export function Brand({ className, showWordmark = true, size = "md", showTagline }: BrandProps) {
  const { t } = useI18n();
  const { brand } = useBrand();

  // A stored URL can be perfectly valid and still 404, or be a file the browser cannot
  // decode. `onError` is the only way to know, and it arrives after the first paint --
  // so the mark is swapped back rather than left as a broken-image glyph.
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => setLogoFailed(false), [brand.logoUrl]);

  const logo = brand.logoUrl && !logoFailed ? brand.logoUrl : null;
  const name = brand.schoolName ?? t("brand.name");
  const tagline = brand.tagline ?? t("brand.tagline");

  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      {logo ? (
        // `object-contain` on a square box: a school's wordmark is rarely square, and
        // cropping someone's logo to fit a tile is not a thing to do to a customer.
        <img
          src={logo}
          alt=""
          aria-hidden
          onError={() => setLogoFailed(true)}
          className={cn("shrink-0 object-contain", LOGO[size])}
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            "grid shrink-0 place-items-center rounded-xl bg-gradient-brand text-primary-foreground shadow-soft",
            MARK[size],
          )}
        >
          <GraduationCap className={ICON[size]} />
        </span>
      )}

      {showWordmark && (
        <span className="flex min-w-0 flex-col leading-none">
          {/*
            `line-clamp-2`, and the name sets its own leading.

            "مدرسة النجاح للدعم المدرسي" is 25 characters. On one line in a 260px sidebar it
            would either overflow or be truncated to "مدرسة النجاح لدرو…", which loses the
            half of the name that says what the school does.
          */}
          {/*
            `dir="auto"`: the school's own name, in whatever language it is written. An
            Arabic name inside a French page has to take its direction from its first
            strong character, or its punctuation lands at the wrong end.
          */}
          <span
            dir="auto"
            className="line-clamp-2 text-[0.95rem] font-semibold leading-tight tracking-tight"
          >
            {name}
          </span>
          {/*
            The second line is the tagline (the school's, or the product's), or nothing. The old
            "SMS" descriptor is gone: next to "Gestion École" it read as text messaging.
          */}
          {showTagline ? (
            <span
              dir="auto"
              className="mt-1 line-clamp-2 text-[0.68rem] leading-snug text-muted-foreground"
            >
              {tagline}
            </span>
          ) : null}
        </span>
      )}
    </span>
  );
}
