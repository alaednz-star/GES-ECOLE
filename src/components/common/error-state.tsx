import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { toMessageKey } from "@/lib/errors";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  error: unknown;
  /** Wired to react-query's `refetch`. Omit when there is nothing to retry. */
  onRetry?: (() => void) | undefined;
  isRetrying?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Shown whenever a read fails. The point is that a failed query must never look
 * like an empty result -- "no students yet" and "we could not load students"
 * demand completely different reactions from the user.
 */
export function ErrorState({ error, onRetry, isRetrying, className }: ErrorStateProps) {
  const { t } = useI18n();

  return (
    <div
      role="alert"
      className={cn(
        "surface-card flex flex-col items-center justify-center gap-3 px-6 py-14 text-center",
        className,
      )}
    >
      <span className="grid size-12 place-items-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" aria-hidden />
      </span>
      <h3 className="text-base font-semibold">{t("error.title")}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{t(toMessageKey(error))}</p>
      {onRetry && (
        <Button
          variant="outline"
          className="mt-1 rounded-xl"
          onClick={onRetry}
          disabled={isRetrying}
        >
          <RefreshCw className={cn("size-4", isRetrying && "animate-spin")} aria-hidden />
          {isRetrying ? t("error.retrying") : t("error.retry")}
        </Button>
      )}
    </div>
  );
}
