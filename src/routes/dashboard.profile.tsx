import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, KeyRound, Loader2, Mail, Phone } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { ErrorState } from "@/components/common/error-state";
import { AvatarPicker } from "@/features/profile/avatar-picker";
import { avatarPathFromUrl, removeAvatar, uploadAvatar } from "@/features/profile/avatar-upload";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { LanguageSwitcher } from "@/components/common/language-switcher";
import { RequireAuth } from "@/features/auth/require-auth";
import { useMyProfile, useUpdateMyProfile } from "@/features/school/profiles";
import { authService } from "@/services/auth";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { formatDate, initialsOf } from "@/lib/format";
import { publicUrl } from "@/lib/desktop";

export const Route = createFileRoute("/dashboard/profile")({
  head: () => ({
    meta: [
      { title: "Mon profil — Gestion École" },
      { name: "description", content: "Vos informations personnelles et préférences." },
    ],
  }),
  component: () => (
    <RequireAuth>
      <ProfilePage />
    </RequireAuth>
  ),
});

function ProfilePage() {
  const { t, locale } = useI18n();
  const { user, refresh } = useAuth();
  const { notifySuccess, notifyError } = useActionFeedback();
  const { data, isLoading, error, refetch, isFetching } = useMyProfile(user?.id);
  const update = useUpdateMyProfile(user?.id);

  const [form, setForm] = useState({ fullName: "", phone: "", avatarUrl: "" });
  const [sendingReset, setSendingReset] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!data) return;
    setForm({
      fullName: data.fullName,
      phone: data.phone ?? "",
      avatarUrl: data.avatarUrl ?? "",
    });
  }, [data]);

  /**
   * Uploads the chosen photo and points the profile at it.
   *
   * ORDER: upload, then update the profile, then remove the old object. Deleting first
   * would leave a failed upload with no photo at all -- worse than the one it had. A
   * failure at the last step leaves one orphaned 40 kB file, which is the cheap end of
   * that trade.
   *
   * Saved immediately rather than on the form's Save button: choosing a file already
   * expressed the intent, and a preview that is not yet stored is a preview that lies.
   */
  const pickAvatar = async (file: File) => {
    if (!user?.id || uploading) return;
    const previous = avatarPathFromUrl(form.avatarUrl);
    setUploading(true);
    try {
      const { url } = await uploadAvatar(user.id, file);
      await update.mutateAsync({
        fullName: form.fullName.trim() || (data?.fullName ?? ""),
        phone: form.phone.trim() || null,
        avatarUrl: url,
      });
      setForm((prev) => ({ ...prev, avatarUrl: url }));
      notifySuccess("profile.avatarSaved");
      void refresh();
      // Only now, and only if it was ours. An externally hosted URL from the old
      // paste-a-link field yields null and is left alone.
      await removeAvatar(previous);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message === "avatar-too-large") toast.error(t("profile.avatarTooLarge"));
      else if (message === "avatar-bad-type") toast.error(t("profile.avatarBadType"));
      else notifyError(e);
    } finally {
      setUploading(false);
    }
  };

  /** Detaches the photo, then removes the object it pointed at. */
  const clearAvatar = async () => {
    if (!user?.id || uploading) return;
    const previous = avatarPathFromUrl(form.avatarUrl);
    setUploading(true);
    try {
      await update.mutateAsync({
        fullName: form.fullName.trim() || (data?.fullName ?? ""),
        phone: form.phone.trim() || null,
        avatarUrl: null,
      });
      setForm((prev) => ({ ...prev, avatarUrl: "" }));
      notifySuccess("profile.avatarRemoved");
      void refresh();
      await removeAvatar(previous);
    } catch (e) {
      notifyError(e);
    } finally {
      setUploading(false);
    }
  };

  const submit = () => {
    if (update.isPending) return;
    if (!form.fullName.trim()) {
      toast.error(t("profile.nameRequired"));
      return;
    }
    update.mutate(
      {
        fullName: form.fullName.trim(),
        phone: form.phone.trim() || null,
        // The photo is saved when it is chosen; this keeps whatever is stored.
        avatarUrl: form.avatarUrl.trim() || null,
      },
      {
        onSuccess: () => {
          notifySuccess("profile.saved");
          void refresh();
        },
        onError: (e) => notifyError(e),
      },
    );
  };

  const requestPasswordReset = async () => {
    if (!user?.email || sendingReset) return;
    setSendingReset(true);
    try {
      await authService.requestPasswordReset(user.email, publicUrl("/reset-password"));
      notifySuccess("profile.resetSent");
    } catch (e) {
      notifyError(e);
    } finally {
      setSendingReset(false);
    }
  };

  if (error) {
    return (
      <>
        <PageHeader title={t("profile.title")} description={t("profile.description")} />
        <ErrorState error={error} onRetry={() => void refetch()} isRetrying={isFetching} />
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        <PageHeader title={t("profile.title")} description={t("profile.description")} />
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("profile.title")}
        description={t("profile.description")}
        actions={
          <Button className="rounded-xl" onClick={submit} disabled={update.isPending}>
            {update.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {update.isPending ? t("ui.saving") : t("entity.common.save")}
          </Button>
        }
      />

      {/*
        WHO YOU ARE, before HOW TO EDIT IT.
        The page used to open with two text inputs, so the answer to "is this the right
        account?" was buried in a form field. The photo, name, role and email now come
        first and read as an identity card; editing happens below it.
      */}
      <section className="surface-card overflow-hidden p-0">
        <div
          className="h-20"
          style={{
            background:
              "linear-gradient(120deg, var(--color-primary) 0%, color-mix(in oklch, var(--color-primary) 68%, white) 100%)",
          }}
        />
        <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:gap-6">
          <AvatarPicker
            url={form.avatarUrl || null}
            fallback={initialsOf(form.fullName || user?.fullName || "?")}
            busy={uploading}
            onPick={(file) => void pickAvatar(file)}
            onClear={() => void clearAvatar()}
            className="-mt-12 shrink-0"
          />

          <div className="min-w-0 flex-1 space-y-2 sm:pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 truncate text-xl font-semibold tracking-tight">
                {form.fullName || user?.fullName || "—"}
              </h2>
              {user && (
                <Badge variant="secondary" className="rounded-lg">
                  {t(`role.${user.role}`)}
                </Badge>
              )}
            </div>

            <dl className="grid gap-1.5 text-sm sm:grid-cols-2">
              <HeroFact icon={Mail} label={t("profile.email")}>
                {/* An address is direction-neutral; isolate it so RTL does not reorder it. */}
                <span dir="ltr" style={{ unicodeBidi: "isolate" }} className="truncate">
                  {user?.email || "—"}
                </span>
              </HeroFact>
              <HeroFact icon={Phone} label={t("profile.phone")}>
                <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
                  {form.phone || t("profile.noPhone")}
                </span>
              </HeroFact>
              {data && (
                <HeroFact icon={CalendarDays} label={t("profile.memberSince")} showLabel>
                  <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
                    {formatDate(data.createdAt, locale)}
                  </span>
                </HeroFact>
              )}
            </dl>
          </div>
        </div>
      </section>

      <SectionCard title={t("profile.identityTitle")} description={t("profile.identityDesc")}>
        <div className="flex flex-col gap-6">
          <div className="grid flex-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="p-name">{t("profile.fullName")}</Label>
              <Input
                id="p-name"
                className="h-11 rounded-xl"
                value={form.fullName}
                onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-phone">{t("profile.phone")}</Label>
              <Input
                id="p-phone"
                className="h-11 rounded-xl"
                placeholder="0X XX XX XX XX"
                value={form.phone}
                onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
              />
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title={t("profile.securityTitle")} description={t("profile.securityDesc")}>
        <Button
          variant="outline"
          className="rounded-xl"
          onClick={requestPasswordReset}
          disabled={sendingReset || !user?.email}
        >
          {sendingReset ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <KeyRound className="size-4" aria-hidden />
          )}
          {sendingReset ? t("profile.sending") : t("profile.changePassword")}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">{t("profile.changePasswordHint")}</p>
      </SectionCard>

      <SectionCard title={t("profile.preferencesTitle")} description={t("profile.preferencesDesc")}>
        <div className="flex items-center gap-3">
          <Label className="text-sm">{t("profile.language")}</Label>
          <LanguageSwitcher />
        </div>
      </SectionCard>
    </>
  );
}

/** One labelled fact in the identity hero. */
function HeroFact({
  icon: Icon,
  label,
  showLabel = false,
  children,
}: {
  icon: typeof Mail;
  label: string;
  /**
   * Most rows carry their own meaning -- an address is obviously an address. A bare date
   * does not, so that one shows its label.
   */
  showLabel?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <dt className={showLabel ? "shrink-0 text-muted-foreground" : "sr-only"}>{label}</dt>
      <dd className="min-w-0 truncate text-muted-foreground">{children}</dd>
    </div>
  );
}
