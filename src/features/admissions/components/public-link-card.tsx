/**
 * The public pre-registration entry of a formation: its link and QR code (ADR-004 section 7).
 *
 * Open only while the formation is ACTIVE and "Inscriptions ouvertes" is on -- the switch that
 * already exists on the formation, now meaning "this formation accepts pre-registrations". The QR
 * code is generated in the browser (no external service); the download is a PNG to print or share.
 */

import { useEffect, useState } from "react";
import { Check, Copy, Download, ExternalLink, Loader2 } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";

function publicPreRegistrationUrl(origin: string, programId: string): string {
  return `${origin.replace(/\/$/, "")}/preinscription/${programId}`;
}

function fileName(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `preinscription-${slug || "formation"}.png`;
}

export function PublicLinkCard({
  programId,
  programName,
  open,
}: {
  programId: string;
  programName: string;
  /** Active formation with registrations open. */
  open: boolean;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // The origin is only known in the browser; the QR code is drawn there too.
  useEffect(() => {
    const link = publicPreRegistrationUrl(window.location.origin, programId);
    setUrl(link);
    let cancelled = false;
    void import("qrcode").then(({ default: QRCode }) =>
      QRCode.toDataURL(link, { width: 640, margin: 2, errorCorrectionLevel: "M" }).then((data) => {
        if (!cancelled) setQr(data);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [programId]);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <SectionCard title={t("admissions.link.title")}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1 space-y-3 text-sm">
          <p
            data-testid="public-link-state"
            className={open ? "text-success" : "text-muted-foreground"}
          >
            {t(open ? "admissions.link.open" : "admissions.link.closed")}
          </p>
          {url && (
            <p
              dir="ltr"
              className="truncate rounded-lg bg-muted px-3 py-2 font-mono text-xs"
              data-testid="public-link-url"
            >
              {url}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl"
              onClick={() => void copy()}
              disabled={!url}
            >
              {copied ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <Copy className="size-4" aria-hidden />
              )}
              {t(copied ? "admissions.link.copied" : "admissions.link.copy")}
            </Button>
            {url && (
              <Button asChild variant="outline" size="sm" className="rounded-xl">
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" aria-hidden />
                  {t("admissions.link.openPage")}
                </a>
              </Button>
            )}
            {qr && (
              <Button asChild variant="outline" size="sm" className="rounded-xl">
                <a href={qr} download={fileName(programName)}>
                  <Download className="size-4" aria-hidden />
                  {t("admissions.link.downloadQr")}
                </a>
              </Button>
            )}
          </div>
        </div>
        <div className="grid size-32 shrink-0 place-items-center rounded-xl border border-border bg-white p-1">
          {qr ? (
            <img
              src={qr}
              alt={t("admissions.link.qrAlt", { name: programName })}
              className="size-full"
            />
          ) : (
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
          )}
        </div>
      </div>
    </SectionCard>
  );
}
