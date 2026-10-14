import { useCallback } from "react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/use-i18n";
import { toMessage } from "@/lib/errors";

/**
 * One place for "the action succeeded / the action failed" feedback.
 *
 * Every mutation in the app reports through this hook so the wording, the
 * translation, and the error mapping stay identical everywhere -- and so no
 * page accidentally shows a raw Postgres message again.
 */
export function useActionFeedback() {
  const { t } = useI18n();

  const notifySuccess = useCallback(
    (messageKey: string, vars?: Record<string, string | number>) => {
      toast.success(t(messageKey, vars));
    },
    [t],
  );

  const notifyError = useCallback(
    (error: unknown) => {
      toast.error(toMessage(error, t));
    },
    [t],
  );

  /** Handlers ready to spread into a react-query `mutate(vars, { ... })` call. */
  const handlers = useCallback(
    (successKey: string, onDone?: () => void) => ({
      onSuccess: () => {
        toast.success(t(successKey));
        onDone?.();
      },
      onError: (error: unknown) => {
        toast.error(toMessage(error, t));
      },
    }),
    [t],
  );

  return { notifySuccess, notifyError, handlers };
}
