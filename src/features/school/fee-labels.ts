/**
 * Display names for fees (ADR-005). Built-in fee types are translated by code, like formation
 * types; a custom type shows its own name.
 */

import { useI18n } from "@/hooks/use-i18n";
import type { Charge, FeeType } from "./fee-types";

/** A fee type's display name: built-in types through the dictionaries, custom ones by name. */
export function useFeeTypeName(types: readonly FeeType[]) {
  const { t } = useI18n();
  return (code: string): string => {
    const type = types.find((x) => x.code === code);
    if (type && !type.builtIn) return type.name;
    const key = `fees.type.${code}`;
    return t(key) === key ? (type?.name ?? code) : t(key);
  };
}

/** "Frais de formation · Trimestre 1": the type, and the label when there is one. */
export function useChargeTitle(types: readonly FeeType[]) {
  const typeName = useFeeTypeName(types);
  return (charge: Pick<Charge, "feeType" | "label">): string =>
    charge.label ? `${typeName(charge.feeType)} · ${charge.label}` : typeName(charge.feeType);
}
