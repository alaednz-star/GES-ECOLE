import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/hooks/use-i18n";
import type { AttendanceSummary } from "@/features/school/types";
import { cn } from "@/lib/utils";

/**
 * Present / late / excused / absent counts with the attendance rate.
 * Shared by the student profile, group detail and attendance report so the
 * numbers are computed and presented identically everywhere.
 */
export function AttendanceBreakdown({
  summary,
  className,
}: {
  summary: AttendanceSummary;
  className?: string | undefined;
}) {
  const { t } = useI18n();

  const cells = [
    { key: "present", value: summary.present, tone: "text-success" },
    { key: "late", value: summary.late, tone: "text-accent" },
    { key: "excused", value: summary.excused, tone: "text-muted-foreground" },
    { key: "absent", value: summary.absent, tone: "text-destructive" },
  ] as const;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{t("attendance.rate")}</span>
        <span className="font-semibold tabular-nums">{summary.rate}%</span>
      </div>
      <Progress value={summary.rate} className="h-2" />
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cells.map((c) => (
          <div key={c.key} className="rounded-lg bg-muted/60 px-3 py-2">
            <dt className="text-[0.7rem] text-muted-foreground">{t(`attendance.${c.key}`)}</dt>
            <dd className={cn("text-sm font-semibold tabular-nums", c.tone)}>{c.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
