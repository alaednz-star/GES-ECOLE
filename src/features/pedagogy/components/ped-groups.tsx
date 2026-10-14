/**
 * The groups a pedagogy screen works on, and their picker.
 *
 * Administrators see every group; a teacher sees the groups they teach. This is a convenience
 * filter only: the database (can_manage_group) refuses any other group's pedagogy anyway.
 * Active groups first, then the others (their history stays readable).
 */

import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useGroups } from "@/features/school/queries";
import type { GroupRow } from "@/features/school/types";
import type { SessionPattern } from "../lesson-model";

export function usePedGroups() {
  const { user } = useAuth();
  const groups = useGroups();
  const isAdmin = user?.role === "admin";
  const list = useMemo(() => {
    const mine = (groups.data ?? []).filter((g) => isAdmin || g.teacherId === user?.id);
    return [...mine].sort(
      (a, b) =>
        Number(b.status === "active") - Number(a.status === "active") ||
        a.name.localeCompare(b.name),
    );
  }, [groups.data, isAdmin, user?.id]);
  return {
    groups: list,
    isAdmin,
    isLoading: groups.isLoading,
    error: groups.error,
    refetch: groups.refetch,
  };
}

export function patternOf(group: GroupRow): SessionPattern {
  return {
    startDate: group.startDate,
    endDate: group.endDate,
    weekdays: [...new Set(group.schedules.map((s) => s.weekday))],
  };
}

export const ALL_GROUPS = "__all__";

export function GroupSelect({
  groups,
  value,
  onChange,
  allowAll = false,
  className,
  testId = "ped-group",
}: {
  groups: GroupRow[];
  value: string | null;
  onChange: (id: string | null) => void;
  allowAll?: boolean;
  className?: string;
  testId?: string;
}) {
  const { t } = useI18n();
  return (
    <Select
      value={value ?? (allowAll ? ALL_GROUPS : "")}
      onValueChange={(v) => {
        if (!v) return;
        const next = v === ALL_GROUPS ? null : v;
        if (next === value) return;
        onChange(next);
      }}
    >
      <SelectTrigger className={className ?? "h-10 w-full rounded-xl sm:w-72"} data-testid={testId}>
        <SelectValue placeholder={t("ped.pickGroup")} />
      </SelectTrigger>
      <SelectContent>
        {allowAll && <SelectItem value={ALL_GROUPS}>{t("ped.allGroups")}</SelectItem>}
        {groups.map((g) => (
          <SelectItem key={g.id} value={g.id}>
            {g.name}
            {g.status !== "active" ? ` (${t(`ui.status.${g.status}`)})` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Small "label / value" figure used in the pages' headers. */
export function Figure({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string | number;
  tone?: "danger" | "accent" | "success" | undefined;
  testId?: string;
}) {
  const color =
    tone === "danger"
      ? "text-destructive"
      : tone === "accent"
        ? "text-accent"
        : tone === "success"
          ? "text-success"
          : "text-foreground";
  return (
    <div className="surface-card min-w-28 flex-1 px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${color}`} data-testid={testId}>
        {value}
      </p>
    </div>
  );
}
