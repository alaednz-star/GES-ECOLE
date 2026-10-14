/**
 * File-type presentation. PURE.
 *
 * Icon and label per resource, derived from MIME type rather than from the file
 * extension: the extension is user-supplied and a renamed `.pdf` would get the
 * wrong affordance, while the MIME type comes from the upload itself.
 */

import { FileText, FileType2, Film, ImageIcon, Link2, Music, Presentation } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ResourceKind } from "./types";

export interface ResourceFace {
  icon: LucideIcon;
  /** i18n key for the human type name. */
  labelKey: string;
  /** Whether the browser can show it inline; drives preview vs download-only. */
  previewable: boolean;
}

export function faceOf(kind: ResourceKind, mimeType: string | null): ResourceFace {
  if (kind === "link") {
    return { icon: Link2, labelKey: "resources.type.link", previewable: true };
  }
  const m = mimeType ?? "";
  if (m === "application/pdf")
    return { icon: FileText, labelKey: "resources.type.pdf", previewable: true };
  if (m.startsWith("image/"))
    return { icon: ImageIcon, labelKey: "resources.type.image", previewable: true };
  if (m.startsWith("video/"))
    return { icon: Film, labelKey: "resources.type.video", previewable: true };
  if (m.startsWith("audio/"))
    return { icon: Music, labelKey: "resources.type.audio", previewable: true };
  if (m.includes("presentation") || m.includes("powerpoint"))
    return { icon: Presentation, labelKey: "resources.type.slides", previewable: false };
  if (m.includes("word") || m === "text/plain")
    return { icon: FileType2, labelKey: "resources.type.document", previewable: false };
  return { icon: FileText, labelKey: "resources.type.file", previewable: false };
}

/** "2,4 Mo" style size. Locale-aware, and null-safe for links. */
export function formatBytes(bytes: number | null | undefined, locale: string): string | null {
  if (bytes === null || bytes === undefined) return null;
  const tag = locale === "ar" ? "ar-DZ-u-nu-latn" : locale === "en" ? "en-GB" : "fr-FR";
  const units = ["B", "kB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value < 10 && unit > 0 ? 1 : 0;
  return `${new Intl.NumberFormat(tag, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}
