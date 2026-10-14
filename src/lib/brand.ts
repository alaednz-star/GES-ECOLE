/**
 * What a school's branding is, and what it becomes.
 *
 * Everything here is PURE. No React, no Supabase, no DOM -- so the rules that decide
 * whether a stored value is safe to render can be tested directly, and so the same
 * fallback path serves two different failures: a column that is null, and a branding
 * query that never came back. One code path, both cases.
 *
 * THE SECOND GATE, NOT THE ONLY ONE. `20260813100000_center_branding.sql` carries check
 * constraints that refuse anything but `#RRGGBB` and a plain https URL. These functions
 * repeat that check on the way out of the database rather than trusting it, because the
 * values end up in a CSS custom property and an <img src>, and a stylesheet built from a
 * string is exactly where "it was validated on write" stops being reassuring.
 */

/** The product's own identity (Gestion École). Also the fallback whenever branding is absent or broken. */
export const PRODUCT_BRAND = {
  /** null means "the i18n `brand.name` key decides", so the fallback stays translated. */
  schoolName: null,
  tagline: null,
  logoUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  /** `#0F766E` -- the teal already in `styles.css`. Kept in sync by the unit test. */
  primaryColor: "#0F766E",
  /**
   * The product has no gold of its own. Unbranded, the decorative material IS the primary,
   * which is what the interface already looks like -- so an unbranded deployment renders
   * byte-identically to today.
   */
  brandGold: null,
  brandGoldSoft: null,
} as const;

export interface Brand {
  /** null = fall back to the translated platform name. */
  schoolName: string | null;
  tagline: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  /**
   * Whether `primaryColor` is the SCHOOL's choice or the platform's fallback.
   *
   * The distinction matters more than it looks. `primaryColor` is never null, because every
   * consumer wants a usable colour -- but emitting an override for a value nobody chose
   * would restate the shipped palette in a different notation (`#0F766E` for the authored
   * `oklch(0.512 0.096 180.2)`, and a `color-mix` for the authored `--primary-soft`). Close,
   * not identical. An unbranded deployment has to render exactly as it did before this
   * feature existed, so it must emit no rule at all.
   */
  hasCustomPrimary: boolean;
  /** null = no separate decorative colour; the primary plays that role. */
  brandGold: string | null;
  brandGoldSoft: string | null;
  /**
   * The school's own description of itself, per language.
   *
   * Kept as three raw fields rather than one resolved string because the resolution
   * depends on who is reading -- and on what to do when the school has written only one
   * language, which is the normal case. `schoolAbout()` answers that.
   */
  about: { ar: string | null; fr: string | null; en: string | null };
  /** The centre's own contact details. Public by nature; shown only when set. */
  contactPhone: string | null;
  contactAddress: string | null;
  /** True when the school has actually set something. Drives "is this deployment branded?". */
  isBranded: boolean;
}

/** The shape the database returns. Every field optional: a failed query supplies none. */
/**
 * The columns `anon` holds a privilege on, in one place.
 *
 * The grant in `20260813140000` is per COLUMN, so asking for one outside this list is a
 * 42501 from Postgres rather than a null field -- the whole request fails. It lives here
 * rather than in `branding-queries.ts` because the server loader needs the identical list
 * and must not import the browser client to get it. This constant and that GRANT have to
 * say the same thing.
 */
export const PUBLIC_BRANDING_COLUMNS =
  "school_name, tagline, logo_url, logo_dark_url, favicon_url, primary_color, brand_gold, brand_gold_soft, about_ar, about_fr, about_en, phone, address";

export interface BrandingRow {
  school_name?: string | null;
  tagline?: string | null;
  logo_url?: string | null;
  logo_dark_url?: string | null;
  favicon_url?: string | null;
  primary_color?: string | null;
  brand_gold?: string | null;
  brand_gold_soft?: string | null;
  about_ar?: string | null;
  about_fr?: string | null;
  about_en?: string | null;
  phone?: string | null;
  address?: string | null;
}

/**
 * `#RRGGBB`, and nothing else.
 *
 * Not a "does it look like a colour" test -- a format test. `rgb()`, `oklch()`, `red`
 * and `red; } body { display: none` all fail identically, which is the point: the
 * accepted grammar has no syntax in it, so nothing that reaches a stylesheet can carry
 * a declaration, a selector or a closing brace.
 *
 * Three-digit `#RGB` is rejected too. It is valid CSS and harmless, but two accepted
 * formats mean two parsers, and the admin form emits six digits.
 */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value);
}

/**
 * A URL safe to put in `<img src>` or `<link href>`.
 *
 * https, or http on loopback. `data:` inlines a document (an SVG with an `onload`),
 * `javascript:` executes, and a protocol-relative `//host` follows the page down to http.
 * Quotes and angle brackets are refused because these land in an HTML attribute, and a
 * quote is how you leave one; backslash because it escapes inside a CSS `url()`;
 * whitespace because a URL has none and its presence means something was concatenated.
 *
 * The loopback exception exists because `supabase start` serves storage from
 * `http://127.0.0.1:54321`. Without it a logo uploaded on a developer machine is stored
 * and then silently refused on the way back out -- and 127.0.0.1 is the one host whose
 * traffic never reaches a network to be downgraded or intercepted. This mirrors
 * `public.is_safe_asset_url()`; the two must agree.
 */
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//;

export function isBrandAssetUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false;
  if (!/^https:\/\/[^\s]+$/.test(value) && !LOOPBACK.test(value)) return false;
  if (/\s/.test(value)) return false;
  if (/["'<>\\]/.test(value)) return false;
  return true;
}

/** True for an asset served from this deployment's own branding bucket. */
export function isOwnBrandingAsset(url: string | null | undefined): boolean {
  return typeof url === "string" && url.includes("/storage/v1/object/public/branding/center/");
}

/**
 * The school name older databases were created with (the column default of the platform this
 * product grew out of). It is not a name any school chose, so it reads as "not set" everywhere:
 * the brand, the page title, the settings form. Kept only for databases created before the
 * neutral default; new installations store an empty name.
 */
export const LEGACY_DEFAULT_SCHOOL_NAME = "Madrasti";

/**
 * The school's own name, or null when none was set (empty, too long, or the legacy default).
 * The one rule every reader of `center_settings.school_name` goes through.
 */
export function schoolNameOrNull(value: unknown): string | null {
  const name = text(value, 80);
  return name === LEGACY_DEFAULT_SCHOOL_NAME ? null : name;
}

/** Keeps a stored name from becoming a paragraph in the sidebar. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

/**
 * A database row -- or nothing at all -- becomes the brand the application renders.
 *
 * Field by field, never all-or-nothing: a school that set a colour but whose logo URL is
 * malformed keeps its colour and falls back to the built-in mark. The alternative is an
 * interface that reverts entirely because one field is wrong.
 */
export function resolveBrand(row: BrandingRow | null | undefined): Brand {
  const schoolName = schoolNameOrNull(row?.school_name);
  const tagline = text(row?.tagline, 120);
  const logoUrl = isBrandAssetUrl(row?.logo_url) ? row.logo_url : null;
  const logoDarkUrl = isBrandAssetUrl(row?.logo_dark_url) ? row.logo_dark_url : null;
  const faviconUrl = isBrandAssetUrl(row?.favicon_url) ? row.favicon_url : null;
  // Narrowed through the guard rather than re-tested, so the null case is a type, not a cast.
  const customPrimary = isHexColor(row?.primary_color) ? row.primary_color : null;
  const hasCustomPrimary = customPrimary !== null;
  const primaryColor = customPrimary ?? PRODUCT_BRAND.primaryColor;
  const brandGold = isHexColor(row?.brand_gold) ? row.brand_gold : null;
  const brandGoldSoft = isHexColor(row?.brand_gold_soft) ? row.brand_gold_soft : null;

  return {
    // The legacy default is filtered by `schoolNameOrNull`: an unbranded installation shows
    // the product's name, not a school that nobody named.
    schoolName,
    tagline,
    logoUrl,
    logoDarkUrl,
    faviconUrl,
    primaryColor,
    hasCustomPrimary,
    brandGold,
    brandGoldSoft,
    about: {
      ar: text(row?.about_ar, 4000),
      fr: text(row?.about_fr, 4000),
      en: text(row?.about_en, 4000),
    },
    contactPhone: text(row?.phone, 40),
    contactAddress: text(row?.address, 200),
    isBranded:
      schoolName !== null ||
      tagline !== null ||
      logoUrl !== null ||
      hasCustomPrimary ||
      brandGold !== null,
  };
}

/**
 * The school's description, in the best language available for this reader.
 *
 * Returns the LANGUAGE as well as the text, and callers must use it. A school that has
 * written only Arabic will serve Arabic to a French visitor -- which is the honest
 * outcome, since translating an institution's own words without its approval is worse
 * than showing them untranslated -- but the paragraph then has to declare `lang` and
 * `dir` itself, or it renders left-to-right inside a French page with its punctuation at
 * the wrong end.
 *
 * Falls back requested -> ar -> fr -> en, and returns null when the school has written
 * nothing, in which case the section is not rendered at all rather than filled with
 * placeholder prose.
 */
export function schoolAbout(
  brand: Brand,
  locale: string,
): { text: string; lang: "ar" | "fr" | "en" } | null {
  const order: ("ar" | "fr" | "en")[] = ["ar", "fr", "en"];
  const preferred = order.find((l) => l === locale);
  const chain = preferred ? [preferred, ...order.filter((l) => l !== preferred)] : order;
  for (const lang of chain) {
    const text = brand.about[lang];
    if (text) return { text, lang };
  }
  return null;
}

/** The description split into the paragraphs the school wrote. Blank lines separate them. */
export function aboutParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Perceived lightness of a hex colour, 0..1. Rec. 709 luma on gamma-encoded channels. */
function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * What text on top of this colour should be.
 *
 * A school picking a pale primary would otherwise get white-on-pale buttons. Measured
 * rather than assumed: above the midpoint the surface is light and takes the product's
 * own dark foreground, below it takes near-white.
 */
export function readableForeground(hex: string): string {
  return luminance(hex) > 0.55 ? "#0F172A" : "#FFFFFF";
}

/**
 * The CSS custom properties a brand overrides -- and, just as deliberately, the ones it
 * does not.
 *
 * OVERRIDDEN: the tokens that mean "this institution". `--primary` and everything that
 * derives from it, the sidebar's active colour, the brand gradient, and the two new gold
 * tokens.
 *
 * NEVER OVERRIDDEN: `--success`, `--destructive`, `--accent`, `--border`, `--muted`.
 * These are the semantic set. `--accent` in particular is not decoration -- it is the
 * colour of a registration awaiting a decision, in `group-card.tsx`. A school whose brand
 * is gold must not turn "en attente de validation" gold, or the amber/green/red vocabulary
 * a student reads their enrolment through stops meaning anything.
 *
 * Returns an object rather than a string so the caller can serialise it and the test can
 * assert on it without parsing CSS.
 */
export function brandCssVariables(brand: Brand): Record<string, string> {
  const vars: Record<string, string> = {};
  const primary = brand.primaryColor;

  /*
    Nothing at all when the school chose nothing.

    Restating the platform's own palette in hex would be a different value from the authored
    `oklch` one -- visually close, not identical -- and `--primary-soft` would become a
    `color-mix` rather than the tuned colour beside it in `styles.css`. An unbranded
    deployment gets no rule, so it is not merely similar to what shipped: it is the same.

    It also keeps dark mode honest. `.dark` redefines `--primary`; an override written at
    `:root` would win over it, so a deployment that never branded must not emit one.
  */
  if (!brand.hasCustomPrimary || !isHexColor(primary)) {
    if (brand.brandGold) {
      vars["--brand-gold"] = brand.brandGold;
      vars["--brand-gold-soft"] =
        brand.brandGoldSoft ?? `color-mix(in oklab, ${brand.brandGold} 14%, white)`;
    }
    return vars;
  }

  vars["--primary"] = primary;
  vars["--primary-foreground"] = readableForeground(primary);
  // `in oklab`, not `in oklch`: `--color-card` is white with an explicit hue of 0, and a
  // polar mix drags the hue towards it -- the bug `person-avatar.tsx` documents, where a
  // green tint rendered pink. Rectangular space has no hue to drag.
  vars["--primary-soft"] = `color-mix(in oklab, ${primary} 8%, white)`;
  vars["--ring"] = primary;
  vars["--sidebar-primary"] = primary;
  vars["--sidebar-primary-foreground"] = readableForeground(primary);
  vars["--sidebar-ring"] = primary;
  vars["--sidebar-accent"] = `color-mix(in oklab, ${primary} 8%, white)`;
  vars["--sidebar-accent-foreground"] = primary;
  // A tonal gradient of the school's own colour. The shipped gradient runs primary ->
  // secondary, and secondary is the platform teal: left alone, a navy school would get a
  // navy-to-teal wash on its own login screen.
  vars["--gradient-brand"] =
    `linear-gradient(135deg, ${primary} 0%, color-mix(in oklab, ${primary} 72%, white) 100%)`;

  if (brand.brandGold) {
    vars["--brand-gold"] = brand.brandGold;
    vars["--brand-gold-soft"] =
      brand.brandGoldSoft ?? `color-mix(in oklab, ${brand.brandGold} 14%, white)`;
  }

  return vars;
}

/**
 * The variables as a `:root` rule.
 *
 * Every value is re-checked on the way in. A hex that passed `resolveBrand` cannot fail
 * here, and a `color-mix(...)` this file built cannot either -- which is the reason the
 * guard is cheap enough to keep: it costs nothing and it means no future caller can hand
 * this function a string from elsewhere and have it reach a stylesheet.
 */
export function brandStyleSheet(brand: Brand): string {
  const entries = Object.entries(brandCssVariables(brand)).filter(
    ([, value]) => !/[;{}<>]/.test(value),
  );
  if (entries.length === 0) return "";
  return `:root{${entries.map(([k, v]) => `${k}:${v}`).join(";")}}`;
}
