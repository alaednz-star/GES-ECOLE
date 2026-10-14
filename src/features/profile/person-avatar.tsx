/**
 * One person's face, everywhere.
 *
 * The fallback order is the same in every surface that shows a person: the stored photo,
 * then their initials. There is no third step and no external avatar service -- a
 * gravatar-style fallback would leak the user's email hash to a third party, and a
 * generic silhouette is worse than initials at telling two teachers apart.
 *
 * `profiles.avatar_url` is the only source. Nothing here invents a second field.
 */

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initialsOf } from "@/lib/format";
import { cn } from "@/lib/utils";

export function PersonAvatar({
  name,
  url,
  className,
  /** Tints the initials, so a subject-coloured card keeps its identity. */
  accent,
  ring = false,
}: {
  name: string | null | undefined;
  url: string | null | undefined;
  className?: string | undefined;
  accent?: string | undefined;
  /** A white ring, for an avatar sitting across a coloured banner. */
  ring?: boolean | undefined;
}) {
  return (
    <Avatar
      // A stable hook for the browser suites. The vendored shadcn `Avatar` here predates
      // `data-slot`, and adding it there would touch every consumer; marking the wrapper
      // this project actually renders makes every avatar addressable without that.
      data-person-avatar=""
      className={cn(
        ring && "border-[3px] border-card shadow-[0_4px_12px_rgba(18,33,29,.12)]",
        className,
      )}
    >
      {/* `alt=""` on purpose: the name is always rendered as text beside the avatar, so
          repeating it here would make a screen reader say it twice. */}
      {url ? <AvatarImage src={url} alt="" className="object-cover" /> : null}
      <AvatarFallback
        className="font-semibold"
        style={
          accent
            ? {
                // `in oklab`, NOT `in oklch`, and the difference is visible.
                //
                // `--color-card` is `oklch(100% 0 0)` -- white with an EXPLICIT hue of 0.
                // Mixing 14% of a colour into it in a polar space interpolates the hue
                // towards 0, so a green subject (hue 149) lands at hue 21: a pink disc on
                // a green card. Measured, not guessed:
                //   in oklch -> oklch(0.948 0.024  20.9)   pink
                //   in oklab -> oklab(0.948 -0.020  0.012) green
                // oklab is rectangular, so a zero-chroma endpoint has no hue to pull with,
                // and it stays correct when `--color-card` is dark.
                backgroundColor: `color-mix(in oklab, ${accent} 14%, var(--color-card))`,
                color: accent,
              }
            : undefined
        }
      >
        {initialsOf((name ?? "").trim())}
      </AvatarFallback>
    </Avatar>
  );
}
