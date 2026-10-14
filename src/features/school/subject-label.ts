import { useCallback } from "react";
import { useI18n } from "@/hooks/use-i18n";

/**
 * Resolve a subject's DISPLAY name from its stable key.
 *
 * The database stores `mathematics`; the label shown depends entirely on the UI
 * language. Falling back to the stored `name` keeps custom subjects (which have
 * no dictionary entry) readable instead of rendering a raw key.
 *
 * Returns a stable callback so it can be used inside `useMemo` deps without
 * re-running derivations on every render.
 */
export function useSubjectLabel() {
  const { t } = useI18n();

  return useCallback(
    (key: string | null | undefined, fallbackName?: string | null): string => {
      if (!key) return fallbackName ?? "—";
      const translated = t(`subject.${key}`);
      // `t` returns the key itself when there is no entry for it.
      return translated === `subject.${key}` ? (fallbackName ?? key) : translated;
    },
    [t],
  );
}
