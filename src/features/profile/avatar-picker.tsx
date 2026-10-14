/**
 * The profile photo control.
 *
 * Replaces a text input that asked the user for an `https://` URL -- which only worked
 * if they happened to host an image somewhere. Clicking the photo now opens a file
 * picker, shows the chosen image immediately, and uploads it into the user's own folder.
 *
 * The preview is a local `blob:` URL so the face changes the instant a file is chosen,
 * before any network call. It is revoked when it is replaced, because a blob URL holds
 * the file in memory until it is.
 */

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";
import { AVATAR_ACCEPT, rejectAvatar } from "./avatar-upload";

export function AvatarPicker({
  url,
  fallback,
  busy,
  onPick,
  onClear,
  className,
}: {
  /** The stored photo, or null. */
  url: string | null;
  /** Initials shown when there is no photo. */
  fallback: string;
  busy: boolean;
  /** Called with a validated file. Rejections never reach here. */
  onPick: (file: File) => void;
  onClear: () => void;
  className?: string | undefined;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A blob URL pins the file in memory until it is revoked.
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  // Once the upload lands, the stored URL takes over and the local preview is dropped.
  useEffect(() => {
    if (!busy && url) setPreview(null);
  }, [busy, url]);

  const choose = (file: File | undefined) => {
    if (!file) return;
    const rejection = rejectAvatar(file);
    if (rejection) {
      setError(t(rejection === "size" ? "profile.avatarTooLarge" : "profile.avatarBadType"));
      return;
    }
    setError(null);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    onPick(file);
  };

  const shown = preview ?? url;

  return (
    <div className={cn("flex flex-col items-center gap-3 sm:items-start", className)}>
      <div className="relative">
        {/* The photo IS the button: a 96px target that says what it does on hover, which
            is how every other product does this and therefore needs no explaining. */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-label={t("profile.avatarChange")}
          className="focus-ring group relative block rounded-full disabled:cursor-wait"
        >
          <Avatar className="size-24 border-[3px] border-card shadow-[0_4px_12px_rgba(18,33,29,.12)]">
            {shown ? <AvatarImage src={shown} alt="" className="object-cover" /> : null}
            <AvatarFallback className="bg-primary-soft text-xl font-semibold text-primary">
              {fallback}
            </AvatarFallback>
          </Avatar>
          <span
            aria-hidden
            className={cn(
              "absolute inset-0 grid place-items-center rounded-full bg-foreground/45 text-card opacity-0 transition-opacity",
              "group-hover:opacity-100 group-focus-visible:opacity-100",
              busy && "opacity-100",
            )}
          >
            {busy ? <Loader2 className="size-6 animate-spin" /> : <Camera className="size-6" />}
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={AVATAR_ACCEPT}
          className="sr-only"
          onChange={(e) => {
            choose(e.target.files?.[0]);
            // Reset, so choosing the same file twice still fires a change.
            e.target.value = "";
          }}
        />
      </div>

      <div className="flex flex-col items-center gap-1 sm:items-start">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 rounded-xl"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <Camera className="size-4" aria-hidden />
          {t(url ? "profile.avatarReplace" : "profile.avatarChange")}
        </Button>
        {url && !busy && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-11 rounded-xl text-muted-foreground hover:text-destructive"
            onClick={onClear}
          >
            <Trash2 className="size-4" aria-hidden />
            {t("profile.avatarRemove")}
          </Button>
        )}
        <p className="text-xs text-muted-foreground">{t("profile.avatarLimits")}</p>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
