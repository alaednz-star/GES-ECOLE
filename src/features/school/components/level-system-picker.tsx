/**
 * A formation's level: first the level system, then a level of that system (ADR-004 section 3,
 * Phase 3B). School levels go stage -> year; CEFR, training and custom systems list their own
 * levels. Both steps may stay open:
 *
 *   "Aucun niveau précis"   no system, no level          (level_system_id NULL)
 *   "Tous les niveaux"      a system, none of its levels (e.g. CEFR, groups at A1 and B1)
 *
 * The stage is only a way to narrow the years: a formation stores a system and a level, never a
 * stage, so the summary line under the fields always says what will be saved.
 *
 * `isOffered` withholds the systems that do not fit the formation's subject (or type); the caller
 * keeps an existing formation's stored system offered. `notice` explains a system that was
 * cleared, or a stored combination that is no longer offered.
 */

import { useState, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  levelAfterSystemChange,
  levelChoiceState,
  levelsOfSystem,
  selectableSystems,
  stagesOf,
  type LevelOption,
  type LevelSystemOption,
  type SchoolStage,
} from "@/features/school/level-model";
import { useLevelSystemLabel } from "@/features/school/level-system-label";
import { useI18n } from "@/hooks/use-i18n";

const NONE = "__none__";
const ALL = "__all__";

/*
  Radix Select reports "" when its controlled value changes before the matching item has
  rendered (here: the proposed system arrives once the systems have loaded). That is not a
  choice, and "" is not a uuid: every handler ignores it.
*/
const ignoreEmpty =
  (handler: (v: string) => void) =>
  (v: string): void => {
    if (v) handler(v);
  };

const STAGE_KEY: Record<SchoolStage, string> = {
  primary: "entity.levels.stagePrimary",
  middle: "entity.levels.stageMiddle",
  high: "entity.levels.stageHigh",
};

export interface LevelChoice {
  levelSystemId: string | null;
  levelId: string | null;
}

export function LevelSystemPicker({
  systems,
  levels,
  value,
  onChange,
  suggested,
  error,
  leading,
  isOffered,
  notice,
}: {
  systems: readonly LevelSystemOption[];
  levels: readonly LevelOption[];
  value: LevelChoice;
  onChange: (next: LevelChoice) => void;
  /** True while the system shown is the one proposed by the formation type. */
  suggested: boolean;
  error?: string | null;
  /** A field rendered first in the same grid (the formation's subject), so the rows line up. */
  leading?: ReactNode;
  /** Whether a system may be chosen; every system when omitted. */
  isOffered?: (system: LevelSystemOption) => boolean;
  /** A non-destructive explanation shown under the fields. */
  notice?: string | null;
}) {
  const { t } = useI18n();
  const systemLabel = useLevelSystemLabel();
  const system = systems.find((s) => s.id === value.levelSystemId) ?? null;
  const systemLevels = levelsOfSystem(levels, value.levelSystemId, value.levelId);
  const isSchool = system?.kind === "school";
  const stages = isSchool ? stagesOf(systemLevels) : [];

  // Narrows the years only. Follows the chosen year; otherwise remembers the last pick.
  const [stageFilter, setStageFilter] = useState<SchoolStage | null>(null);
  const selectedLevel = systemLevels.find((l) => l.id === value.levelId) ?? null;
  const stage = selectedLevel?.stage ?? stageFilter;
  const yearOptions =
    isSchool && stage ? systemLevels.filter((l) => l.stage === stage) : systemLevels;

  const pickSystem = (id: string | null) => {
    setStageFilter(null);
    onChange({ levelSystemId: id, levelId: levelAfterSystemChange(levels, value.levelId, id) });
  };

  const pickStage = (next: SchoolStage | null) => {
    setStageFilter(next);
    if (selectedLevel && next && selectedLevel.stage !== next) {
      onChange({ levelSystemId: value.levelSystemId, levelId: null });
    }
  };

  const state = levelChoiceState(value.levelSystemId, value.levelId);
  const summary =
    state === "none"
      ? t("programs.form.levelSummary.none")
      : state === "system"
        ? t("programs.form.levelSummary.system", { system: system ? systemLabel(system) : "" })
        : t("programs.form.levelSummary.level", {
            system: system ? systemLabel(system) : "",
            level: selectedLevel?.name ?? "",
          });

  return (
    <div className="space-y-2">
      <div className="grid gap-4 sm:grid-cols-2">
        {leading}
        <div className="space-y-2">
          <Label htmlFor="prog-level-system">{t("programs.form.levelSystem")}</Label>
          <Select
            value={value.levelSystemId ?? NONE}
            onValueChange={ignoreEmpty((v) => pickSystem(v === NONE ? null : v))}
          >
            <SelectTrigger id="prog-level-system" className="h-11 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("programs.form.noLevel")}</SelectItem>
              {selectableSystems(systems, value.levelSystemId)
                .filter((s) => s.id === value.levelSystemId || !isOffered || isOffered(s))
                .map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {systemLabel(s)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        {system && isSchool && (
          <div className="space-y-2">
            <Label htmlFor="prog-stage">{t("form.levels.stage")}</Label>
            <Select
              value={stage ?? ALL}
              onValueChange={ignoreEmpty((v) => pickStage(v === ALL ? null : (v as SchoolStage)))}
            >
              <SelectTrigger id="prog-stage" className="h-11 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("programs.form.allStages")}</SelectItem>
                {stages.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(STAGE_KEY[s])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {system && (
          <div className="space-y-2">
            <Label htmlFor="prog-level">
              {t(isSchool ? "programs.form.year" : "programs.form.level")}
            </Label>
            <Select
              value={value.levelId ?? ALL}
              onValueChange={ignoreEmpty((v) =>
                onChange({ levelSystemId: value.levelSystemId, levelId: v === ALL ? null : v }),
              )}
            >
              <SelectTrigger id="prog-level" className="h-11 rounded-xl" aria-invalid={!!error}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("programs.form.allLevels")}</SelectItem>
                {yearOptions.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {systemLevels.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("programs.form.systemEmpty")}</p>
            )}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground" data-testid="level-summary">
        {summary}
        {suggested && system ? ` ${t("programs.form.levelSuggested")}` : ""}
      </p>
      {notice && (
        <p className="text-xs text-muted-foreground" role="status" data-testid="level-notice">
          {notice}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
