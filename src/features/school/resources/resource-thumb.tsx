/**
 * The square in front of a resource: its still image when one exists, its type icon
 * otherwise.
 *
 * WHY A COMPONENT AND NOT FOUR COPIES. The same tinted square is drawn in four places --
 * the chapter list, the dense table, the compact card below 768px, and the student's
 * shelf. Each already computed `faceOf(...)` and rendered the icon itself. Adding an
 * image branch in four files would have been four chances for the fallback to drift, so
 * the branch lives here once and the callers keep passing the sizes they already used.
 *
 * NO LAYOUT SHIFT, BY CONSTRUCTION. The image does not get its own box: it fills the
 * square the icon already occupied, at the size the caller asks for. Nothing reflows when
 * it arrives, because nothing was waiting for it -- the tinted square is painted first and
 * the picture lands on top of it. That also makes the tint a free placeholder: there is no
 * spinner, because there is no empty space to cover.
 *
 * FAILURE IS EXPECTED, NOT EXCEPTIONAL. `i.ytimg.com` can 404 for a deleted or private
 * video, and a school's network may block it outright. `onError` is the only way to learn
 * that, and it arrives after the first paint -- so the icon is swapped back in rather than
 * left as a broken-image glyph. The same reasoning, and the same shape, as `Brand`'s
 * `logoFailed`.
 */

import { useEffect, useState } from "react";
import { faceOf } from "./resource-icon";
import type { ResourceRow } from "./types";
import { cn } from "@/lib/utils";

export function ResourceThumb({
  resource,
  accent,
  className,
  iconClassName,
}: {
  resource: Pick<ResourceRow, "kind" | "mimeType" | "linkThumbnailUrl">;
  /** The subject colour the caller already resolved; tints the square and the icon. */
  accent: string;
  /** The box: the caller keeps the size and radius it used for the icon alone. */
  className?: string;
  iconClassName?: string;
}) {
  const face = faceOf(resource.kind, resource.mimeType);
  const Icon = face.icon;
  const src = resource.linkThumbnailUrl;

  // A stored URL can be perfectly valid and still fail to load. Reset when the row's
  // picture changes, or a failure would stick to whatever is rendered next.
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  const showImage = Boolean(src) && !failed;

  return (
    <span
      className={cn("grid shrink-0 place-items-center overflow-hidden", className)}
      style={{
        backgroundColor: `color-mix(in oklch, ${accent} 12%, var(--color-card))`,
        color: accent,
      }}
    >
      {showImage ? (
        /*
          `alt=""` is deliberate, not an omission. The resource's title is rendered
          immediately beside this square in every one of the four callers, so a described
          image would make a screen reader announce the same resource twice. An empty alt
          is the standard way to say "decorative", and it is exactly the treatment the
          `aria-hidden` icon it replaces already had -- the accessible behaviour is
          unchanged, which is the point.
        */
        <img
          src={src ?? ""}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <Icon className={iconClassName} aria-hidden />
      )}
    </span>
  );
}
