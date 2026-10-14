import { useContext } from "react";
import { I18nContext, type I18nContextValue } from "@/lib/i18n/i18n-provider";

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
