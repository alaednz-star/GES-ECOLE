import { useState } from "react";
import { Check, Copy, Printer, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";

export interface Credentials {
  fullName: string;
  email: string;
  temporaryPassword: string;
}

/**
 * Shows a newly issued temporary password exactly once.
 *
 * The password lives only in this component's props, which come straight from
 * the server response. It is never persisted, never re-fetchable, and closing
 * the dialog discards it -- so the admin is warned before that happens.
 */
export function CredentialsDialog({
  credentials,
  onClose,
}: {
  credentials: Credentials | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { notifyError } = useActionFeedback();
  const [copied, setCopied] = useState(false);

  if (!credentials) return null;

  const asText = [
    `${t("teachers.credentials.name")}: ${credentials.fullName}`,
    `${t("teachers.credentials.email")}: ${credentials.email}`,
    `${t("teachers.credentials.password")}: ${credentials.temporaryPassword}`,
  ].join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      notifyError(e);
    }
  };

  /**
   * Prints from a detached window rather than the app, so no dashboard chrome
   * or unrelated data ends up on a sheet handed to a teacher.
   */
  const print = () => {
    const w = window.open("", "_blank", "width=600,height=400");
    if (!w) {
      notifyError(new Error(t("teachers.credentials.printBlocked")));
      return;
    }
    const esc = (s: string) =>
      s.replace(/[&<>"]/g, (c) =>
        c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
      );
    w.document.write(
      `<!doctype html><html><head><title>${esc(t("teachers.credentials.title"))}</title>` +
        `<style>body{font-family:system-ui,sans-serif;padding:32px;line-height:1.7}` +
        `h1{font-size:18px;margin:0 0 16px}dt{font-size:12px;color:#666}` +
        `dd{margin:0 0 12px;font-size:16px;font-weight:600}` +
        `code{font-family:ui-monospace,monospace;font-size:18px}` +
        `.note{margin-top:24px;font-size:12px;color:#666}</style></head><body>` +
        `<h1>${esc(t("teachers.credentials.title"))}</h1><dl>` +
        `<dt>${esc(t("teachers.credentials.name"))}</dt><dd>${esc(credentials.fullName)}</dd>` +
        `<dt>${esc(t("teachers.credentials.email"))}</dt><dd>${esc(credentials.email)}</dd>` +
        `<dt>${esc(t("teachers.credentials.password"))}</dt>` +
        `<dd><code>${esc(credentials.temporaryPassword)}</code></dd></dl>` +
        `<p class="note">${esc(t("teachers.credentials.printNote"))}</p>` +
        `</body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>{t("teachers.credentials.title")}</DialogTitle>
        </DialogHeader>

        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-accent-soft px-4 py-3 text-xs leading-relaxed text-accent"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t("teachers.credentials.warning")}</span>
        </div>

        <dl className="space-y-3">
          <Row label={t("teachers.credentials.name")} value={credentials.fullName} />
          <Row label={t("teachers.credentials.email")} value={credentials.email} />
          <div className="rounded-xl bg-muted/60 px-4 py-3">
            <dt className="text-xs text-muted-foreground">{t("teachers.credentials.password")}</dt>
            <dd className="mt-1 select-all font-mono text-lg font-semibold tracking-tight">
              {credentials.temporaryPassword}
            </dd>
          </div>
        </dl>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="rounded-xl" onClick={copy}>
            {copied ? (
              <Check className="size-4 text-success" aria-hidden />
            ) : (
              <Copy className="size-4" aria-hidden />
            )}
            {copied ? t("teachers.credentials.copied") : t("teachers.credentials.copy")}
          </Button>
          <Button variant="outline" className="rounded-xl" onClick={print}>
            <Printer className="size-4" aria-hidden />
            {t("teachers.credentials.print")}
          </Button>
          <Button className="rounded-xl" onClick={onClose}>
            {t("teachers.credentials.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{value}</dd>
    </div>
  );
}
