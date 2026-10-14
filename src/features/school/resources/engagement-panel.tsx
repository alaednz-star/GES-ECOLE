/**
 * Who has opened one resource, and who has not.
 *
 * A Sheet rather than a Dialog, matching the attendance drawer: this is a reading
 * task with a list in it, and a side panel keeps the chapter it belongs to on screen.
 *
 * The figures come from the `resource_engagement` views, which are staff-only inside
 * the database. So there is no permission branching here -- a student cannot reach
 * this component, and if they somehow did they would get empty results rather than
 * someone else's reading habits.
 *
 * The list is ordered NOT-OPENED FIRST on purpose. "Twelve students read it" is
 * pleasant; "these four did not" is the thing a teacher can act on.
 */

import { Eye, Download, UserCheck, UserX } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useResourceEngagement } from "./queries";
import { RoleBadge } from "./role-badge";
import type { ResourceRow } from "./types";

export function EngagementPanel({
  resource,
  onClose,
}: {
  /** Null closes the panel. */
  resource: ResourceRow | null;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const query = useResourceEngagement(resource?.id);
  const totals = query.data?.totals;
  const students = query.data?.students ?? [];
  const opened = students.filter((s) => s.opened);
  const notOpened = students.filter((s) => !s.opened);

  return (
    <Sheet open={resource !== null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        {resource && (
          <>
            <SheetHeader className="border-b border-border px-5 py-4">
              <div className="flex min-w-0 items-center gap-2">
                <RoleBadge role={resource.role} />
                <SheetTitle className="min-w-0 truncate text-base">{resource.title}</SheetTitle>
              </div>
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {query.isPending ? (
                <div className="space-y-3 p-5">
                  <Skeleton className="h-16 rounded-xl" />
                  <Skeleton className="h-40 rounded-xl" />
                </div>
              ) : (
                <>
                  {/* Three figures, the same "value over a quiet label" as the
                      attendance counters. */}
                  <dl className="grid grid-cols-3 gap-2 border-b border-border px-5 py-4">
                    <Figure
                      icon={Eye}
                      value={totals?.views ?? 0}
                      label={t("resources.engagement.views")}
                    />
                    <Figure
                      icon={UserCheck}
                      value={totals?.distinctStudents ?? 0}
                      label={t("resources.engagement.students")}
                    />
                    <Figure
                      icon={Download}
                      value={totals?.downloads ?? 0}
                      label={t("resources.engagement.downloads")}
                    />
                  </dl>

                  {totals?.lastViewedAt && (
                    <p className="border-b border-border px-5 py-3 text-xs text-muted-foreground">
                      {t("resources.engagement.lastViewed", {
                        date: formatDate(totals.lastViewedAt, locale),
                      })}
                    </p>
                  )}

                  {students.length === 0 ? (
                    <p className="p-5 text-sm text-muted-foreground">
                      {t("resources.engagement.noStudents")}
                    </p>
                  ) : (
                    <>
                      {/* Not opened first: this is the actionable half. */}
                      {notOpened.length > 0 && (
                        <Group
                          title={t("resources.engagement.notOpened", { count: notOpened.length })}
                          tone="muted"
                        >
                          {notOpened.map((s) => (
                            <Row
                              key={s.studentId}
                              name={s.studentName}
                              icon={UserX}
                              tone="muted"
                              detail={t("resources.engagement.never")}
                            />
                          ))}
                        </Group>
                      )}
                      {opened.length > 0 && (
                        <Group
                          title={t("resources.engagement.opened", { count: opened.length })}
                          tone="success"
                        >
                          {opened.map((s) => (
                            <Row
                              key={s.studentId}
                              name={s.studentName}
                              icon={UserCheck}
                              tone="success"
                              detail={
                                s.lastViewedAt ? formatDate(s.lastViewedAt, locale) : undefined
                              }
                            />
                          ))}
                        </Group>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Figure({ icon: Icon, value, label }: { icon: typeof Eye; value: number; label: string }) {
  return (
    <div className="min-w-0">
      <dd className="flex items-center gap-1.5 text-lg font-semibold tabular-nums">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        {value}
      </dd>
      <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
    </div>
  );
}

function Group({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "muted" | "success";
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3
        className={cn(
          "sticky top-0 z-10 bg-card px-5 py-2 text-[11px] font-semibold uppercase tracking-wide",
          tone === "success" ? "text-success" : "text-muted-foreground",
        )}
      >
        {title}
      </h3>
      <ul className="divide-y divide-border">{children}</ul>
    </section>
  );
}

function Row({
  name,
  icon: Icon,
  tone,
  detail,
}: {
  name: string | null;
  icon: typeof Eye;
  tone: "muted" | "success";
  detail?: string | undefined;
}) {
  const { t } = useI18n();
  return (
    <li className="flex items-center gap-2.5 px-5 py-2.5">
      <Icon
        className={cn(
          "size-4 shrink-0",
          tone === "success" ? "text-success" : "text-muted-foreground/60",
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-sm">
        {name ?? t("resources.engagement.unknownStudent")}
      </span>
      {detail && (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{detail}</span>
      )}
    </li>
  );
}
