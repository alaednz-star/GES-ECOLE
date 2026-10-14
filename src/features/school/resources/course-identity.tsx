/**
 * Who a set of chapters belongs to: GROUP, SUBJECT, TEACHER.
 *
 * Shared by the teacher page and the student page on purpose. Both need to answer
 * "whose course is this material?", and answering it the same way in both places is
 * most of what makes the hierarchy feel intentional rather than incidental.
 *
 * All three facts come from `groups` -- subject through `subject_id`, teacher
 * through `teacher_id`. Nothing here is stored on a chapter or a resource.
 */

import { GraduationCap, User } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";

export function CourseIdentity({
  groupName,
  subjectName,
  teacherName,
  levelName,
  accent,
  className,
  /** Counters or actions, laid out at the end of the row. */
  trailing,
}: {
  groupName: string;
  subjectName: string | null;
  teacherName: string | null;
  levelName?: string | null | undefined;
  accent: string;
  className?: string | undefined;
  trailing?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className={cn("flex items-start gap-3", className)}>
      {/* The subject tint, the same one the chapters below use. */}
      <span
        aria-hidden
        className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl"
        style={{
          backgroundColor: `color-mix(in oklch, ${accent} 12%, var(--color-card))`,
          color: accent,
        }}
      >
        <GraduationCap className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">
          {groupName}
        </h2>
        <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className="truncate font-medium" style={{ color: accent }}>
            {subjectName ?? t("resources.hier.noSubject")}
          </span>
          {levelName && <span className="truncate text-muted-foreground">{levelName}</span>}
          <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
            <User className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{teacherName ?? t("resources.hier.noTeacher")}</span>
          </span>
        </p>
      </div>

      {trailing && <div className="shrink-0 text-end">{trailing}</div>}
    </div>
  );
}
