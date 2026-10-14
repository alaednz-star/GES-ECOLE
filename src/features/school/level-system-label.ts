import { useCallback } from "react";
import { useI18n } from "@/hooks/use-i18n";

/**
 * A level system's DISPLAY name. Built-in systems (`algerian_school`, `cefr`, `training`,
 * `custom`) are translated from their code; a system an administrator added has no dictionary
 * entry and shows its stored name.
 */
export function useLevelSystemLabel() {
  const { t } = useI18n();

  return useCallback(
    (system: { code: string | null; name: string | null } | null | undefined): string => {
      if (!system) return "—";
      if (system.code) {
        const key = `levelSystem.${system.code}`;
        const translated = t(key);
        if (translated !== key) return translated;
      }
      return system.name ?? system.code ?? "—";
    },
    [t],
  );
}

/**
 * A formation's level as one short phrase: its level ("3ème année secondaire"), "<system> · all
 * levels" when it names a system only, or null when it has no specific level.
 */
export function useProgramLevelLabel() {
  const { t } = useI18n();
  const systemLabel = useLevelSystemLabel();

  return useCallback(
    (p: {
      levelName: string | null;
      levelSystemId: string | null;
      levelSystemCode: string | null;
      levelSystemName: string | null;
    }): string | null => {
      if (p.levelName) return p.levelName;
      if (!p.levelSystemId) return null;
      return t("programs.allLevelsOf", {
        system: systemLabel({ code: p.levelSystemCode, name: p.levelSystemName }),
      });
    },
    [t, systemLabel],
  );
}
