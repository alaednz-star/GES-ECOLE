import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { ErrorState } from "@/components/common/error-state";
import { useTeachingAssignments, type EmployeeDetail } from "@/features/hr/hr";
import {
  formatMinutes,
  slotsOutsideAvailability,
  weeklyTeachingMinutes,
} from "@/features/hr/hr-model";
import { weekdayLabel } from "@/features/school/schedule";
import { useSubjectLabel } from "@/features/school/subject-label";
import { todayIso } from "@/lib/format";
import { useI18n } from "@/hooks/use-i18n";

/**
 * What the timetable says this person teaches. READ-ONLY: the source of truth is
 * groups/group_schedules, edited from the Groups page. HR adds only the comparison with the
 * declared availability.
 */
export function SchedulePanel({ employee }: { employee: EmployeeDetail }) {
  const { t } = useI18n();
  const subjectLabel = useSubjectLabel();
  const teaching = useTeachingAssignments(employee.profileId);
  const groups = teaching.data ?? [];
  const slots = groups.flatMap((g) => g.slots);
  const outside = slotsOutsideAvailability(slots, employee.availability, todayIso());

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <SectionCard title={t("hr.schedule.title")} description={t("hr.schedule.hint")}>
        {teaching.isLoading ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        ) : teaching.error ? (
          <ErrorState error={teaching.error} onRetry={() => void teaching.refetch()} />
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("hr.schedule.noGroups")}</p>
        ) : (
          <ul className="space-y-2">
            {groups.map((g) => (
              <li
                key={g.groupId}
                className="surface-row flex flex-wrap items-center gap-3 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    to="/dashboard/groups/$groupId"
                    params={{ groupId: g.groupId }}
                    className="focus-ring block truncate rounded font-medium hover:text-primary"
                  >
                    {g.groupName}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {[
                      g.subjectKey || g.subjectName
                        ? subjectLabel(g.subjectKey, g.subjectName)
                        : null,
                      g.programName,
                    ]
                      .filter(Boolean)
                      .join(" · ") || t("hr.none")}
                  </p>
                  <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                    {g.slots
                      .map((s) => `${weekdayLabel(s.weekday, t)} ${s.startTime}–${s.endTime}`)
                      .join(" · ") || t("hr.none")}
                  </p>
                </div>
                <StatusBadge status={g.groupStatus} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <div className="space-y-4">
        <SectionCard title={t("hr.schedule.weekly")}>
          <p className="text-3xl font-semibold tabular-nums">
            {formatMinutes(weeklyTeachingMinutes(slots))}
          </p>
        </SectionCard>
        <SectionCard title={t("hr.schedule.outside")}>
          {employee.availability.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("hr.schedule.noAvailability")}</p>
          ) : outside.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("hr.schedule.outsideNone")}</p>
          ) : (
            <ul className="space-y-1.5">
              {outside.map((s) => (
                <li
                  key={`${s.groupId}-${s.weekday}-${s.startTime}`}
                  className="surface-alert px-3 py-2 text-sm"
                >
                  <span className="font-medium">{s.groupName}</span>
                  <span className="block text-xs tabular-nums text-muted-foreground">
                    {weekdayLabel(s.weekday, t)} {s.startTime}–{s.endTime}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
