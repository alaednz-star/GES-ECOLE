/**
 * The administrator's branding form, inside the existing settings screen.
 *
 * Not a settings system of its own: it is a `SectionCard` like the three already on
 * `/dashboard/settings`, saving to the same singleton row through the same client.
 *
 * THE PREVIEW IS THE POINT. It renders the chosen colours by scoping the very same custom
 * properties `BrandProvider` writes to `:root` onto one container instead -- so what an
 * admin sees before saving is produced by the mechanism that will produce the real thing,
 * not by an approximation of it. It deliberately includes the three registration states,
 * because the question a school's gold raises is "does this break the status colours?" and
 * the honest way to answer it is to show them sitting next to the brand, unchanged.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CheckCircle2, Clock3, GraduationCap, ImageUp, Loader2, XCircle } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBranding, useSaveBranding } from "@/features/branding/branding-queries";
import {
  BRANDING_ACCEPT,
  brandingPathFromUrl,
  rejectBrandingFile,
  removeBrandingAsset,
  uploadBrandingAsset,
  type BrandingAsset,
} from "@/features/branding/branding-upload";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useI18n } from "@/hooks/use-i18n";
import {
  LEGACY_DEFAULT_SCHOOL_NAME,
  brandCssVariables,
  isHexColor,
  resolveBrand,
} from "@/lib/brand";
import { cn } from "@/lib/utils";

interface FormState {
  schoolName: string;
  tagline: string;
  aboutAr: string;
  aboutFr: string;
  aboutEn: string;
  primaryColor: string;
  brandGold: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
}

const EMPTY: FormState = {
  schoolName: "",
  tagline: "",
  aboutAr: "",
  aboutFr: "",
  aboutEn: "",
  primaryColor: "",
  brandGold: "",
  logoUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
};

export function BrandingSettings() {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  // The same query key the provider uses, so one save updates the form, the sidebar and
  // the auth layout together.
  const { data: settings } = useBranding(true);
  const save = useSaveBranding();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [uploading, setUploading] = useState<BrandingAsset | null>(null);

  useEffect(() => {
    if (!settings) return;
    setForm({
      // The legacy default is not a name the school chose: show the field empty.
      schoolName:
        settings.school_name === LEGACY_DEFAULT_SCHOOL_NAME ? "" : (settings.school_name ?? ""),
      tagline: settings.tagline ?? "",
      aboutAr: settings.about_ar ?? "",
      aboutFr: settings.about_fr ?? "",
      aboutEn: settings.about_en ?? "",
      primaryColor: settings.primary_color ?? "",
      brandGold: settings.brand_gold ?? "",
      logoUrl: settings.logo_url ?? null,
      logoDarkUrl: settings.logo_dark_url ?? null,
      faviconUrl: settings.favicon_url ?? null,
    });
  }, [settings]);

  /** What the preview renders: the form as it stands, through the real resolver. */
  const preview = resolveBrand({
    school_name: form.schoolName || null,
    tagline: form.tagline || null,
    logo_url: form.logoUrl,
    primary_color: isHexColor(form.primaryColor) ? form.primaryColor : null,
    brand_gold: isHexColor(form.brandGold) ? form.brandGold : null,
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((p) => ({ ...p, [key]: value }));

  const upload = async (asset: BrandingAsset, file: File) => {
    const rejection = rejectBrandingFile(file);
    if (rejection) {
      notifyError(new Error(t(`dash.branding.reject.${rejection}`)));
      return;
    }
    setUploading(asset);
    try {
      const { url } = await uploadBrandingAsset(asset, file);
      // The row points at the new object BEFORE the old one is removed, so a failure
      // anywhere leaves an orphan rather than a school with no logo.
      const next = { ...form };
      const previous =
        asset === "logo"
          ? form.logoUrl
          : asset === "logo-dark"
            ? form.logoDarkUrl
            : form.faviconUrl;
      if (asset === "logo") next.logoUrl = url;
      else if (asset === "logo-dark") next.logoDarkUrl = url;
      else next.faviconUrl = url;
      setForm(next);
      await persist(next);
      await removeBrandingAsset(brandingPathFromUrl(previous));
    } catch (e) {
      notifyError(e);
    } finally {
      setUploading(null);
    }
  };

  const persist = async (state: FormState) => {
    if (!state.schoolName.trim()) throw new Error(t("dash.settings.schoolNameRequired"));
    await save.mutateAsync({
      schoolName: state.schoolName.trim(),
      tagline: state.tagline.trim() || null,
      aboutAr: state.aboutAr.trim() || null,
      aboutFr: state.aboutFr.trim() || null,
      aboutEn: state.aboutEn.trim() || null,
      logoUrl: state.logoUrl,
      logoDarkUrl: state.logoDarkUrl,
      faviconUrl: state.faviconUrl,
      // An empty field clears the column, which is how a school returns to the platform
      // palette. A malformed one is refused below rather than silently dropped.
      primaryColor: state.primaryColor.trim() || null,
      brandGold: state.brandGold.trim() || null,
      brandGoldSoft: null,
    });
  };

  const submit = () => {
    if (save.isPending) return;
    for (const value of [form.primaryColor, form.brandGold]) {
      if (value.trim() && !isHexColor(value.trim())) {
        notifyError(new Error(t("dash.branding.colorInvalid")));
        return;
      }
    }
    persist(form)
      .then(() => notifySuccess("dash.settings.saved"))
      .catch((e: unknown) => notifyError(e));
  };

  return (
    <SectionCard
      title={t("dash.branding.title")}
      description={t("dash.branding.description")}
      actions={
        <Button className="h-11 rounded-xl" onClick={submit} disabled={save.isPending}>
          {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t("dash.settings.save")}
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="brand-school-name">{t("dash.branding.schoolName")}</Label>
            <Input
              id="brand-school-name"
              className="h-11 rounded-xl"
              value={form.schoolName}
              onChange={(e) => set("schoolName", e.target.value)}
              placeholder="مدرسة النجاح للدعم المدرسي"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="brand-tagline">{t("dash.branding.tagline")}</Label>
            <Input
              id="brand-tagline"
              className="h-11 rounded-xl"
              maxLength={120}
              value={form.tagline}
              onChange={(e) => set("tagline", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("dash.branding.taglineHint")}</p>
          </div>

          {/*
            The school's own description, one field per language.

            Three fields rather than one, because the public page serves whichever exists
            and declares its language when it does -- a school that has written only Arabic
            should not have a French translation invented for it. Empty is a real answer:
            the section simply does not render.
          */}
          <div className="space-y-3">
            <Label htmlFor="brand-about-ar">{t("dash.branding.about")}</Label>
            <p className="text-xs text-muted-foreground">{t("dash.branding.aboutHint")}</p>
            {(
              [
                ["aboutAr", "ar", "العربية"],
                ["aboutFr", "fr", "Français"],
                ["aboutEn", "en", "English"],
              ] as const
            ).map(([key, lang, label]) => (
              <div key={key} className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">{label}</span>
                <textarea
                  id={`brand-about-${lang}`}
                  dir="auto"
                  rows={key === "aboutAr" ? 6 : 3}
                  maxLength={4000}
                  value={form[key]}
                  onChange={(e) => set(key, e.target.value)}
                  className="focus-ring w-full rounded-xl border border-input bg-card px-3 py-2 text-sm leading-relaxed"
                />
              </div>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField
              id="brand-primary"
              label={t("dash.branding.primary")}
              hint={t("dash.branding.primaryHint")}
              value={form.primaryColor}
              onChange={(v) => set("primaryColor", v)}
            />
            <ColorField
              id="brand-gold"
              label={t("dash.branding.gold")}
              hint={t("dash.branding.goldHint")}
              value={form.brandGold}
              onChange={(v) => set("brandGold", v)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <AssetField
              asset="logo"
              label={t("dash.branding.logo")}
              url={form.logoUrl}
              busy={uploading === "logo"}
              onPick={(f) => void upload("logo", f)}
            />
            <AssetField
              asset="logo-dark"
              label={t("dash.branding.logoDark")}
              url={form.logoDarkUrl}
              busy={uploading === "logo-dark"}
              onPick={(f) => void upload("logo-dark", f)}
            />
            <AssetField
              asset="favicon"
              label={t("dash.branding.favicon")}
              url={form.faviconUrl}
              busy={uploading === "favicon"}
              onPick={(f) => void upload("favicon", f)}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("dash.branding.assetHint")}</p>
        </div>

        <BrandPreview
          name={preview.schoolName ?? t("brand.name")}
          tagline={preview.tagline ?? t("brand.tagline")}
          logoUrl={preview.logoUrl}
          vars={brandCssVariables(preview) as CSSProperties}
          hasGold={preview.brandGold !== null}
        />
      </div>
    </SectionCard>
  );
}

/** A hex field and a swatch, bound to the same value. */
function ColorField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const valid = value.trim() === "" || isHexColor(value.trim());

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        {/* The native picker can only ever produce `#rrggbb`, which is exactly the format
            the column accepts -- so the common path cannot produce an invalid value. */}
        <input
          type="color"
          aria-label={label}
          value={isHexColor(value.trim()) ? value.trim() : "#0F766E"}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="focus-ring size-11 shrink-0 cursor-pointer rounded-xl border border-border bg-card p-1"
        />
        <Input
          id={id}
          className={cn("h-11 rounded-xl font-mono", !valid && "border-destructive")}
          placeholder="#132A3E"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      <p className={cn("text-xs", valid ? "text-muted-foreground" : "text-destructive")}>
        {valid ? hint : t("dash.branding.colorInvalid")}
      </p>
    </div>
  );
}

/** One uploadable asset. The image itself is the button, as on the profile page. */
function AssetField({
  asset,
  label,
  url,
  busy,
  onPick,
}: {
  asset: BrandingAsset;
  label: string;
  url: string | null;
  busy: boolean;
  onPick: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-2">
      <Label htmlFor={`brand-asset-${asset}`}>{label}</Label>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="focus-ring flex h-20 w-full items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 p-2 transition-colors hover:border-primary/40"
      >
        {busy ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        ) : url ? (
          <img src={url} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <ImageUp className="size-5 text-muted-foreground" aria-hidden />
        )}
      </button>
      <input
        id={`brand-asset-${asset}`}
        ref={input}
        type="file"
        accept={BRANDING_ACCEPT}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/**
 * The school's identity and the product's semantics, side by side.
 *
 * `vars` scopes the brand tokens to this container, so the preview is live without
 * touching the page around it. The three status rows are here to be looked at: they use
 * `--success`, `--accent` and `--destructive`, none of which branding may override, and
 * seeing them stay green, amber and red under a navy-and-gold brand is the proof.
 */
function BrandPreview({
  name,
  tagline,
  logoUrl,
  vars,
  hasGold,
}: {
  name: string;
  tagline: string;
  logoUrl: string | null;
  vars: CSSProperties;
  hasGold: boolean;
}) {
  const { t } = useI18n();

  return (
    <div data-brand-preview="" style={vars} className="surface-card space-y-4 overflow-hidden p-0">
      <div className="h-16 bg-gradient-brand" aria-hidden />
      <div className="-mt-10 space-y-4 px-5 pb-5">
        <div className="flex items-end gap-3">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              className="size-14 shrink-0 rounded-xl border-[3px] border-card bg-card object-contain shadow-soft"
            />
          ) : (
            <span
              aria-hidden
              className="grid size-14 shrink-0 place-items-center rounded-xl border-[3px] border-card bg-gradient-brand text-primary-foreground shadow-soft"
            >
              <GraduationCap className="size-6" />
            </span>
          )}
          <div className="min-w-0 pb-1">
            <p dir="auto" className="line-clamp-2 text-sm font-semibold leading-tight">
              {name}
            </p>
            <p dir="auto" className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
              {tagline}
            </p>
          </div>
        </div>

        {/* Gold as a hairline: the whole of its job in the interface. */}
        {hasGold && <div className="h-px w-full bg-brand-gold" aria-hidden />}

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-9 items-center rounded-xl bg-primary px-4 text-xs font-medium text-primary-foreground">
            {t("dash.branding.previewCta")}
          </span>
          <span className="inline-flex h-9 items-center rounded-xl border border-border px-4 text-xs font-medium">
            {t("dash.branding.previewSecondary")}
          </span>
        </div>

        <div className="space-y-1.5">
          <StatusRow
            tone="border-success/25 bg-success/5 text-success"
            icon={CheckCircle2}
            label={t("dash.registration.state.approved")}
          />
          <StatusRow
            tone="border-accent/30 bg-accent/8 text-accent"
            icon={Clock3}
            label={t("dash.registration.state.pending")}
          />
          <StatusRow
            tone="border-destructive/25 bg-destructive/5 text-destructive"
            icon={XCircle}
            label={t("dash.registration.state.rejected")}
          />
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t("dash.branding.previewNote")}
        </p>
      </div>
    </div>
  );
}

function StatusRow({
  tone,
  icon: Icon,
  label,
}: {
  tone: string;
  icon: typeof CheckCircle2;
  label: string;
}) {
  const [border, bg, text] = tone.split(" ");
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium",
        border,
        bg,
        text,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{label}</span>
    </p>
  );
}
