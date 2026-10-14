/**
 * Who a news post or a campaign goes to. Administrators: every audience; a teacher: one of the
 * groups they teach (the database refuses anything else).
 */

import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useAllLevels, useGroups } from "@/features/school/queries";
import { usePrograms } from "@/features/school/programs";
import { AUDIENCES_WITH_ID, allowedAudiences } from "../comm-model";
import type { Audience, AudienceType } from "../types";

export function AudiencePicker({
  value,
  onChange,
  disabled = false,
  error,
  idPrefix = "audience",
}: {
  value: Audience;
  onChange: (a: Audience) => void;
  disabled?: boolean;
  error?: string | undefined;
  idPrefix?: string;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const groups = useGroups();
  const programs = usePrograms();
  const levels = useAllLevels();
  const types = allowedAudiences(isAdmin);

  const targets = useMemo(() => {
    if (value.type === "group")
      return (groups.data ?? [])
        .filter((g) => isAdmin || g.teacherId === user?.id)
        .filter((g) => g.status === "active")
        .map((g) => ({ id: g.id, label: g.name }));
    if (value.type === "program")
      return (programs.data ?? []).map((p) => ({ id: p.id, label: p.name }));
    if (value.type === "level")
      return (levels.data ?? [])
        .filter((l) => l.status === "active")
        .map((l) => ({ id: l.id, label: l.name }));
    return [];
  }, [value.type, groups.data, programs.data, levels.data, isAdmin, user?.id]);

  const needsTarget = AUDIENCES_WITH_ID.includes(value.type);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-type`}>{t("comm.audience")}</Label>
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          value={value.type}
          disabled={disabled}
          onValueChange={(v) => {
            if (!v || v === value.type) return;
            onChange({ type: v as AudienceType, id: null });
          }}
        >
          <SelectTrigger
            id={`${idPrefix}-type`}
            className="h-11 rounded-xl"
            data-testid={`${idPrefix}-type`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {types.map((ty) => (
              <SelectItem key={ty} value={ty}>
                {t(`comm.audience.${ty}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {needsTarget && (
          <Select
            value={value.id ?? ""}
            disabled={disabled}
            onValueChange={(v) => {
              if (!v || v === value.id) return;
              onChange({ type: value.type, id: v });
            }}
          >
            <SelectTrigger className="h-11 rounded-xl" data-testid={`${idPrefix}-target`}>
              <SelectValue placeholder={t(`comm.audience.pick.${value.type}`)} />
            </SelectTrigger>
            <SelectContent>
              {targets.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  {t("comm.audience.none")}
                </div>
              ) : (
                targets.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{t(error)}</p>}
    </div>
  );
}

/** The audience as one readable line ("Groupe : 3AS Maths", "Tous les élèves"). */
export function useAudienceText() {
  const { t } = useI18n();
  return (type: AudienceType, label: string | null) =>
    label ? `${t(`comm.audience.${type}`)} : ${label}` : t(`comm.audience.${type}`);
}
