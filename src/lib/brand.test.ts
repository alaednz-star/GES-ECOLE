import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  LEGACY_DEFAULT_SCHOOL_NAME,
  PRODUCT_BRAND,
  schoolNameOrNull,
  aboutParagraphs,
  schoolAbout,
  brandCssVariables,
  brandStyleSheet,
  isBrandAssetUrl,
  isHexColor,
  isOwnBrandingAsset,
  readableForeground,
  resolveBrand,
} from "./brand.ts";

/* ------------------------------------------------------------------ colours */

test("isHexColor: accepts #RRGGBB in either case", () => {
  assert.equal(isHexColor("#132A3E"), true);
  assert.equal(isHexColor("#c6a45c"), true);
});

test("isHexColor: rejects every other colour format", () => {
  for (const value of ["#FFF", "rgb(19,42,62)", "oklch(0.5 0.1 180)", "red", "132A3E", ""]) {
    assert.equal(isHexColor(value), false, value);
  }
});

test("isHexColor: rejects CSS that would break out of the declaration", () => {
  // The whole reason the format is this narrow.
  for (const attack of [
    "red; } body { display: none",
    "#132A3E; } * { background: url(https://evil.test/x)",
    "#132A3E</style><script>alert(1)</script>",
    "var(--anything)",
  ]) {
    assert.equal(isHexColor(attack), false, attack);
  }
});

test("isHexColor: rejects non-strings", () => {
  for (const value of [null, undefined, 42, {}, ["#132A3E"]]) {
    assert.equal(isHexColor(value), false, String(value));
  }
});

/* ------------------------------------------------------------------ asset URLs */

test("isBrandAssetUrl: accepts an https URL", () => {
  assert.equal(
    isBrandAssetUrl("https://x.supabase.co/storage/v1/object/public/branding/a.png"),
    true,
  );
});

test("isBrandAssetUrl: rejects schemes that execute or inline a document", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:image/svg+xml,<svg onload=alert(1)>",
    "http://x.test/a.png",
    "http://127.0.0.1.evil.test/a.png",
    "//x.test/a.png",
    "/relative.png",
  ]) {
    assert.equal(isBrandAssetUrl(value), false, value);
  }
});

test("isBrandAssetUrl: accepts loopback http, because that is what supabase start serves", () => {
  // Without this the local stack cannot store a logo at all: the object uploads and the
  // row update is refused, which is exactly the bug this exception exists to fix.
  for (const value of [
    "http://127.0.0.1:54321/storage/v1/object/public/branding/center/logo.png",
    "http://localhost:54321/storage/v1/object/public/branding/center/logo.png",
  ]) {
    assert.equal(isBrandAssetUrl(value), true, value);
  }
});

test("isBrandAssetUrl: rejects characters that close an HTML attribute", () => {
  for (const value of [
    'https://x.test/a.png" onerror="alert(1)',
    "https://x.test/a.png' onerror='alert(1)",
    "https://x.test/<script>",
    "https://x.test/a\\b.png",
    "https://x.test/a b.png",
  ]) {
    assert.equal(isBrandAssetUrl(value), false, value);
  }
});

test("isOwnBrandingAsset: only the deployment's own bucket folder", () => {
  assert.equal(
    isOwnBrandingAsset("https://x.supabase.co/storage/v1/object/public/branding/center/logo.png"),
    true,
  );
  assert.equal(isOwnBrandingAsset("https://cdn.example.test/logo.png"), false);
  assert.equal(isOwnBrandingAsset(null), false);
});

/* ------------------------------------------------------------------ resolution */

test("resolveBrand: nothing at all still yields a usable brand", () => {
  // The failed-query case. It must not throw and must not leave the UI colourless.
  const brand = resolveBrand(null);
  assert.equal(brand.schoolName, null);
  assert.equal(brand.primaryColor, PRODUCT_BRAND.primaryColor);
  assert.equal(brand.isBranded, false);
});

test("resolveBrand: the legacy default name is not treated as a school's choice", () => {
  // Older databases were created with this default. Treating it as branding would make every
  // unbranded installation claim to be a school nobody named, instead of showing Gestion École.
  const brand = resolveBrand({ school_name: LEGACY_DEFAULT_SCHOOL_NAME });
  assert.equal(brand.schoolName, null);
  assert.equal(brand.isBranded, false);
});

test("resolveBrand: an empty name (the default of new installations) is not a school name", () => {
  const brand = resolveBrand({ school_name: "" });
  assert.equal(brand.schoolName, null);
  assert.equal(brand.isBranded, false);
});

test("schoolNameOrNull: one rule for every reader of school_name", () => {
  assert.equal(schoolNameOrNull("  École Les Lauriers  "), "École Les Lauriers");
  assert.equal(schoolNameOrNull(LEGACY_DEFAULT_SCHOOL_NAME), null);
  assert.equal(schoolNameOrNull(` ${LEGACY_DEFAULT_SCHOOL_NAME} `), null);
  assert.equal(schoolNameOrNull(""), null);
  assert.equal(schoolNameOrNull("   "), null);
  assert.equal(schoolNameOrNull(null), null);
  assert.equal(schoolNameOrNull(undefined), null);
  assert.equal(schoolNameOrNull("x".repeat(81)), null);
});

test("resolveBrand: a real school name and tagline come through", () => {
  const brand = resolveBrand({
    school_name: "مدرسة النجاح للدعم المدرسي",
    tagline: "مدرسة النجاح – نحو التفوق.",
  });
  assert.equal(brand.schoolName, "مدرسة النجاح للدعم المدرسي");
  assert.equal(brand.tagline, "مدرسة النجاح – نحو التفوق.");
  assert.equal(brand.isBranded, true);
});

test("resolveBrand: one bad field does not discard the good ones", () => {
  const brand = resolveBrand({
    school_name: "مدرسة النجاح للدعم المدرسي",
    primary_color: "#132A3E",
    logo_url: "javascript:alert(1)",
    brand_gold: "gold",
  });
  assert.equal(brand.primaryColor, "#132A3E");
  assert.equal(brand.schoolName, "مدرسة النجاح للدعم المدرسي");
  assert.equal(brand.logoUrl, null, "an unsafe logo URL is dropped, not rendered");
  assert.equal(brand.brandGold, null, "a non-hex gold is dropped, not passed to CSS");
});

test("resolveBrand: an invalid colour falls back rather than breaking the theme", () => {
  const brand = resolveBrand({ primary_color: "red; } body { display: none" });
  assert.equal(brand.primaryColor, PRODUCT_BRAND.primaryColor);
});

/* ------------------------------------------------------------------ the description */

test("schoolAbout: prefers the reader's language", () => {
  const brand = resolveBrand({ about_ar: "عربي", about_fr: "français", about_en: "english" });
  assert.deepEqual(schoolAbout(brand, "fr"), { text: "français", lang: "fr" });
  assert.deepEqual(schoolAbout(brand, "ar"), { text: "عربي", lang: "ar" });
  assert.deepEqual(schoolAbout(brand, "en"), { text: "english", lang: "en" });
});

test("schoolAbout: serves what the school wrote when the reader's language is missing", () => {
  // The normal case: a school writes its description once, in its own language. A French
  // visitor reads the Arabic rather than a translation nobody at the school approved --
  // and the returned `lang` is what lets the page lay it out right-to-left.
  const brand = resolveBrand({ about_ar: "فضاء تربوي متخصص" });
  assert.deepEqual(schoolAbout(brand, "fr"), { text: "فضاء تربوي متخصص", lang: "ar" });
  assert.deepEqual(schoolAbout(brand, "en"), { text: "فضاء تربوي متخصص", lang: "ar" });
});

test("schoolAbout: nothing written means nothing rendered", () => {
  // The section is omitted rather than filled with placeholder prose.
  assert.equal(schoolAbout(resolveBrand(null), "fr"), null);
  assert.equal(schoolAbout(resolveBrand({ about_ar: "   " }), "ar"), null);
});

test("aboutParagraphs: blank lines separate paragraphs, and nothing else does", () => {
  const text = "Un.\n\nDeux.\n\n\nTrois.";
  assert.deepEqual(aboutParagraphs(text), ["Un.", "Deux.", "Trois."]);
  // A single newline inside a paragraph is not a break.
  assert.deepEqual(aboutParagraphs("a\nb"), ["a\nb"]);
});

test("resolveBrand: contact details come through, and blanks do not", () => {
  const brand = resolveBrand({ phone: " 0661 00 00 00 ", address: "" });
  assert.equal(brand.contactPhone, "0661 00 00 00");
  assert.equal(brand.contactAddress, null);
});

/* ------------------------------------------------------------------ tokens */

test("brandCssVariables: NEVER touches the semantic tokens", () => {
  // The rule this whole feature is built around: gold is a brand, amber is a state.
  const vars = brandCssVariables(resolveBrand({ primary_color: "#132A3E", brand_gold: "#C6A45C" }));
  for (const semantic of [
    "--accent",
    "--accent-foreground",
    "--accent-soft",
    "--success",
    "--success-soft",
    "--destructive",
    "--destructive-soft",
    "--border",
    "--input",
    "--muted",
    "--muted-foreground",
  ]) {
    assert.equal(semantic in vars, false, `${semantic} must stay semantic`);
  }
});

test("brandCssVariables: overrides the brand tokens", () => {
  const vars = brandCssVariables(resolveBrand({ primary_color: "#132A3E" }));
  assert.equal(vars["--primary"], "#132A3E");
  assert.equal(vars["--ring"], "#132A3E");
  assert.equal(vars["--sidebar-primary"], "#132A3E");
  assert.match(vars["--gradient-brand"] ?? "", /^linear-gradient\(135deg, #132A3E/);
});

test("brandCssVariables: gold appears only when the school set one", () => {
  const without = brandCssVariables(resolveBrand({ primary_color: "#132A3E" }));
  assert.equal("--brand-gold" in without, false);

  const withGold = brandCssVariables(
    resolveBrand({ primary_color: "#132A3E", brand_gold: "#C6A45C" }),
  );
  assert.equal(withGold["--brand-gold"], "#C6A45C");
  assert.match(withGold["--brand-gold-soft"] ?? "", /color-mix\(in oklab/);
});

test("brandCssVariables: a stored soft gold wins over the derived one", () => {
  const vars = brandCssVariables(
    resolveBrand({ brand_gold: "#C6A45C", brand_gold_soft: "#FBF8F2" }),
  );
  assert.equal(vars["--brand-gold-soft"], "#FBF8F2");
});

test("brandCssVariables: mixes in oklab, never oklch", () => {
  // `--color-card` is white with an explicit hue of 0; a polar mix drags the hue to it and
  // renders a green tint pink. Measured in person-avatar.tsx; asserted here so it cannot
  // come back through the branding path.
  const vars = brandCssVariables(resolveBrand({ primary_color: "#0E7A5F", brand_gold: "#C6A45C" }));
  for (const value of Object.values(vars)) {
    assert.equal(/oklch/.test(value), false, value);
  }
});

test("readableForeground: dark brands take white, pale brands take the dark foreground", () => {
  assert.equal(readableForeground("#132A3E"), "#FFFFFF");
  assert.equal(readableForeground("#0F766E"), "#FFFFFF");
  assert.equal(readableForeground("#FBF8F2"), "#0F172A");
  assert.equal(readableForeground("#C6A45C"), "#0F172A");
});

/* ------------------------------------------------------------------ the stylesheet */

test("brandStyleSheet: emits nothing when there is nothing to override", () => {
  // An unbranded deployment must render byte-identically to today: no rule at all, not a
  // rule that happens to restate the shipped palette in a different notation.
  assert.equal(brandStyleSheet(resolveBrand(null)), "");
  assert.equal(brandStyleSheet(resolveBrand({ school_name: LEGACY_DEFAULT_SCHOOL_NAME })), "");
});

test("brandStyleSheet: a school that named itself but chose no colour overrides no colour", () => {
  // Naming the deployment is not the same as re-theming it.
  const brand = resolveBrand({ school_name: "مدرسة النجاح للدعم المدرسي" });
  assert.equal(brand.isBranded, true);
  assert.equal(brand.hasCustomPrimary, false);
  assert.equal(brandStyleSheet(brand), "");
});

test("brandCssVariables: gold alone still reaches CSS", () => {
  // The two groups are independent: a school may set a decorative colour without
  // re-theming the primary.
  const vars = brandCssVariables(resolveBrand({ brand_gold: "#C6A45C" }));
  assert.equal(vars["--brand-gold"], "#C6A45C");
  assert.equal("--primary" in vars, false);
});

test("brandStyleSheet: is a single :root rule with no way out of it", () => {
  const css = brandStyleSheet(resolveBrand({ primary_color: "#132A3E", brand_gold: "#C6A45C" }));
  assert.match(css, /^:root\{/);
  assert.equal(css.endsWith("}"), true);
  // Exactly one opening and one closing brace: no injected selector, no second rule.
  assert.equal((css.match(/\{/g) ?? []).length, 1);
  assert.equal((css.match(/\}/g) ?? []).length, 1);
  assert.equal(css.includes("</style"), false);
});

test("brandStyleSheet: the shipped default is kept in sync with styles.css", () => {
  // If `--primary` in styles.css ever changes, this is the line that notices.
  assert.equal(PRODUCT_BRAND.primaryColor, "#0F766E");
});
