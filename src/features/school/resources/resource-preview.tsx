/**
 * Resource preview, in the same right-hand Sheet the attendance drawer uses.
 *
 * The signed URL is minted when the drawer opens and never stored: the bucket is
 * private precisely so a copied link stops working, so re-opening mints a fresh
 * one rather than reusing a stale token.
 */

import { useEffect, useState } from "react";
import { Download, Eye, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useI18n } from "@/hooks/use-i18n";
import { formatBytes, faceOf } from "./resource-icon";
import { signResourceUrl } from "./queries";
import { linkFaceOf } from "./link-provider";
import type { ResourceRow } from "./types";

export function ResourcePreview({
  resource,
  onClose,
  canDownload,
}: {
  resource: ResourceRow | null;
  onClose: () => void;
  /** Staff always may; a student only when the teacher allowed it. */
  canDownload: boolean;
}) {
  const { t, locale } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!resource) {
      setUrl(null);
      setError(null);
      return;
    }
    if (resource.kind === "link") {
      setUrl(resource.url);
      return;
    }
    if (!resource.storagePath) return;

    let active = true;
    setLoading(true);
    setError(null);
    void signResourceUrl(resource.id)
      .then((signed) => {
        if (active) setUrl(signed);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [resource]);

  const face = resource ? faceOf(resource.kind, resource.mimeType) : null;
  const size = resource ? formatBytes(resource.sizeBytes, locale) : null;
  const allowDownload = canDownload && (resource?.allowDownload ?? false);
  const linkFace = linkFaceOf(resource?.url);

  return (
    <Sheet open={resource !== null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        {resource && (
          <>
            <header className="border-b border-border px-5 py-4 pe-12">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t(face?.labelKey ?? "resources.type.file")}
                {size ? (
                  <>
                    {" · "}
                    {/* Bidi-isolated: "2,3 MB" would reorder under RTL. */}
                    <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
                      {size}
                    </span>
                  </>
                ) : null}
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight">{resource.title}</h2>
              {resource.description && (
                <p className="mt-1 text-sm text-muted-foreground">{resource.description}</p>
              )}
            </header>

            <div className="min-h-0 flex-1 overflow-auto bg-muted/30">
              {loading ? (
                <div className="grid h-full place-items-center p-8">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
                </div>
              ) : error ? (
                <p role="alert" className="p-6 text-sm text-destructive">
                  {error}
                </p>
              ) : !url ? null : !face?.previewable ? (
                <div className="flex flex-col items-center gap-2 p-10 text-center">
                  <p className="text-sm font-medium">{t("resources.preview.unavailable")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("resources.preview.downloadInstead")}
                  </p>
                </div>
              ) : resource.mimeType?.startsWith("image/") ? (
                <img src={url} alt={resource.title} className="mx-auto block max-w-full" />
              ) : resource.mimeType?.startsWith("video/") ? (
                <video src={url} controls className="mx-auto block max-h-full max-w-full">
                  <track kind="captions" />
                </video>
              ) : resource.mimeType?.startsWith("audio/") ? (
                <div className="p-6">
                  <audio src={url} controls className="w-full">
                    <track kind="captions" />
                  </audio>
                </div>
              ) : resource.kind === "link" ? (
                // A link is not one thing. A YouTube WATCH url cannot be framed at all
                // -- YouTube answers with X-Frame-Options and the student saw a
                // refused-to-connect box -- so the embeddable form is used where one
                // exists, and where none does the honest answer is a button.
                linkFace.embedUrl ? (
                  <iframe
                    src={linkFace.embedUrl}
                    title={resource.title}
                    // `allowFullScreen` is what makes an embedded lesson watchable on a
                    // phone; the rest is the minimum a video embed needs.
                    allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="h-full min-h-[70vh] w-full border-0"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3 p-10 text-center">
                    <p className="text-sm font-medium">{t("resources.link.notEmbeddable")}</p>
                    <p className="text-xs text-muted-foreground">{t(linkFace.labelKey)}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      onClick={() => globalThis.open(url, "_blank", "noopener,noreferrer")}
                    >
                      <ExternalLink className="size-4" aria-hidden />
                      {t("resources.preview.openExternal")}
                    </Button>
                  </div>
                )
              ) : (
                // PDFs: an iframe keeps the student on the page.
                <iframe
                  src={url}
                  title={resource.title}
                  className="h-full min-h-[70vh] w-full border-0"
                />
              )}
            </div>

            <footer className="flex items-center gap-2 border-t border-border px-5 py-3">
              {/* Say why, where the button would have been. `allow_download = false`
                  is enforced server-side (the database refuses to mint an attachment
                  URL), but silence looks like a bug -- a student assumes the button is
                  missing rather than withheld. */}
              {!allowDownload && resource.kind === "file" && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Eye className="size-3.5 shrink-0" aria-hidden />
                  {t("resources.preview.onlineOnly")}
                </p>
              )}
              {allowDownload && resource.kind === "file" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => {
                    if (!resource.storagePath) return;
                    void signResourceUrl(resource.id, "download").then((u) =>
                      globalThis.open(u, "_blank", "noopener,noreferrer"),
                    );
                  }}
                >
                  <Download className="size-4" aria-hidden />
                  {t("resources.resource.download")}
                </Button>
              )}
              {url && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ms-auto rounded-xl"
                  onClick={() => globalThis.open(url, "_blank", "noopener,noreferrer")}
                >
                  <ExternalLink className="size-4" aria-hidden />
                  {t("resources.preview.openExternal")}
                </Button>
              )}
            </footer>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
