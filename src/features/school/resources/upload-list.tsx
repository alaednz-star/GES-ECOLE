/**
 * The per-file rows of a multi-file upload.
 *
 * Each file carries its own state because each can fail on its own. The five states
 * are visually distinct on purpose: a teacher who uploads five sheets and walks away
 * needs to see, at a glance, which one needs doing again -- "four of five" is not an
 * answer if you cannot tell which.
 *
 * Cancel is offered while pending or uploading; retry only after a genuine failure. A
 * cancelled file offers neither, because the teacher already decided.
 */

import { AlertCircle, Check, Loader2, RotateCcw, Slash, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";
import { formatBytes } from "./resource-icon";
import type { UploadItem, UploadStatus } from "./use-upload-queue";

const STATUS_TONE: Record<UploadStatus, string> = {
  pending: "text-muted-foreground",
  uploading: "text-primary",
  done: "text-success",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
};

export function UploadList({
  items,
  onCancel,
  onRetry,
  onRemove,
}: {
  items: UploadItem[];
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  /** Only offered before anything has started. */
  onRemove: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  if (items.length === 0) return null;

  const done = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "failed").length;

  return (
    <div className="space-y-2 rounded-xl border border-border p-2.5">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <p className="text-xs font-medium text-secondary-foreground">
          {t("resources.upload.fileCount", { count: items.length })}
        </p>
        <p className="text-[11px] tabular-nums text-muted-foreground">
          {done > 0 && (
            <span className="text-success">{t("resources.upload.doneCount", { count: done })}</span>
          )}
          {done > 0 && failed > 0 && " · "}
          {failed > 0 && (
            <span className="text-destructive">
              {t("resources.upload.failedCount", { count: failed })}
            </span>
          )}
        </p>
      </div>

      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.id} className="rounded-lg bg-muted/40 px-2.5 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <StatusIcon status={item.status} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium" title={item.file.name}>
                  {item.file.name}
                </span>
                {/* Direction-neutral, so RTL does not reorder "2,4 MB" into "MB 2,4". */}
                <span
                  className={cn("block text-[11px] tabular-nums", STATUS_TONE[item.status])}
                  dir="ltr"
                  style={{ unicodeBidi: "isolate" }}
                >
                  {item.status === "uploading"
                    ? `${Math.round(item.progress * 100)}% · ${formatBytes(item.file.size * item.progress, locale)} / ${formatBytes(item.file.size, locale)}`
                    : `${formatBytes(item.file.size, locale)} · ${t(`resources.upload.status.${item.status}`)}`}
                </span>
              </span>

              {(item.status === "pending" || item.status === "uploading") && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 rounded-lg"
                  aria-label={`${t("resources.upload.stop")} ${item.file.name}`}
                  onClick={() =>
                    item.status === "pending" ? onRemove(item.id) : onCancel(item.id)
                  }
                >
                  <X className="size-3.5" aria-hidden />
                </Button>
              )}
              {item.status === "failed" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 rounded-lg"
                  aria-label={`${t("resources.upload.retry")} ${item.file.name}`}
                  onClick={() => onRetry(item.id)}
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                </Button>
              )}
            </div>

            {item.status === "uploading" && (
              <Progress value={Math.round(item.progress * 100)} className="mt-1.5 h-1" />
            )}
            {/* The reason lives on the row, not in a toast: with five files a toast
                cannot say which one it is about. */}
            {item.status === "failed" && item.error && (
              <p className="mt-1 text-[11px] text-destructive">{item.error}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusIcon({ status }: { status: UploadStatus }) {
  const cls = cn("size-4 shrink-0", STATUS_TONE[status]);
  if (status === "uploading") return <Loader2 className={cn(cls, "animate-spin")} aria-hidden />;
  if (status === "done") return <Check className={cls} aria-hidden />;
  if (status === "failed") return <AlertCircle className={cls} aria-hidden />;
  if (status === "cancelled") return <Slash className={cls} aria-hidden />;
  return <span className={cn(cls, "rounded-full border border-current opacity-40")} aria-hidden />;
}
