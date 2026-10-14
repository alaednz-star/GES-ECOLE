import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Bell, CheckCircle2, Clock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import type { SessionOccurrence } from "@/features/school/schedule";
import { sessionKey } from "@/features/school/session/session-key";

type Urgency = "alert" | "soon" | "info";

interface Priority {
  id: string;
  icon: LucideIcon;
  urgency: Urgency;
  title: string;
  detail: string;
  to: string;
  cta: string;
  /**
   * Deep-link search params, so a call to action that names a specific session
   * lands ON that session instead of on the current week. See
   * `AttendanceSearch` in the attendance route.
   */
  search?: Record<string, string> | undefined;
}

/**
 * The teacher's daily checklist.
 *
 * Adds no data: it re-reads what the workspace already computed and ranks it by
 * what actually blocks the day -- registers owed first, then the class about to
 * start, then anything unread. The rest of the page answers "what is there?";
 * this answers "what should I do first?", which is a different question and the
 * reason the section exists.
 */
export function TodayPriorities({
  pendingAttendance,
  nextClass,
  unreadCount,
  now = new Date(),
}: {
  pendingAttendance: SessionOccurrence[];
  nextClass: SessionOccurrence | null;
  unreadCount: number;
  now?: Date;
}) {
  const { t } = useI18n();
  const items: Priority[] = [];

  if (pendingAttendance.length > 0) {
    const oldest = pendingAttendance[pendingAttendance.length - 1];
    items.push({
      id: "attendance",
      icon: AlertTriangle,
      urgency: "alert",
      title: t("teacher.priority.attendanceTitle", { count: String(pendingAttendance.length) }),
      detail: oldest ? t("teacher.priority.attendanceDetail", { group: oldest.group.name }) : "",
      to: "/dashboard/attendance",
      cta: t("teacher.completeNow"),
      // This card names the oldest unmarked register, so send the teacher
      // straight to it with the drawer open -- the copy is specific and the
      // destination should match.
      ...(oldest
        ? { search: { date: oldest.date, session: sessionKey(oldest.group.id, oldest.date) } }
        : {}),
    });
  }

  if (nextClass) {
    const mins = Math.round((nextClass.startsAt.getTime() - now.getTime()) / 60000);
    // "Soon" only inside the hour: an amber cue at 09:00 for a 16:00 class
    // would train the teacher to ignore the colour.
    items.push({
      id: "next",
      icon: Clock,
      urgency: mins > 0 && mins <= 60 ? "soon" : "info",
      title: t("teacher.priority.nextTitle", { group: nextClass.group.name }),
      detail: `${nextClass.slot.startTime.slice(0, 5)} · ${
        nextClass.slot.room ?? t("dash.section.noRoom")
      }`,
      to: "/dashboard/groups/$groupId",
      cta: t("teacher.viewGroup"),
    });
  }

  if (unreadCount > 0) {
    items.push({
      id: "notifications",
      icon: Bell,
      urgency: "info",
      title: t("teacher.priority.unreadTitle", { count: String(unreadCount) }),
      detail: t("teacher.priority.unreadDetail"),
      to: "/dashboard",
      cta: t("teacher.priority.review"),
    });
  }

  // An empty checklist is a result worth stating, not a blank space.
  if (items.length === 0) {
    return (
      <section aria-labelledby="priorities-heading" className="surface-done px-5 py-4">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
          <div className="min-w-0">
            <h2 id="priorities-heading" className="text-sm font-semibold">
              {t("teacher.priority.clearTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("teacher.priority.clearBody")}</p>
          </div>
        </div>
      </section>
    );
  }

  const tone: Record<Urgency, string> = {
    alert: "surface-alert",
    soon: "surface-panel",
    info: "surface-panel",
  };
  const iconTone: Record<Urgency, string> = {
    alert: "bg-accent/15 text-accent",
    soon: "bg-accent-soft text-accent",
    info: "bg-primary-soft text-primary",
  };

  return (
    <section aria-labelledby="priorities-heading" className="space-y-3">
      <h2
        id="priorities-heading"
        className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {t("teacher.priority.heading")}
      </h2>

      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((p) => (
          <li key={p.id}>
            <Link
              to={p.to}
              {...(p.id === "next" && nextClass ? { params: { groupId: nextClass.group.id } } : {})}
              {...(p.search ? { search: p.search } : {})}
              className={`focus-ring group flex h-full items-center gap-3 px-3.5 py-3 transition-transform hover:-translate-y-0.5 motion-reduce:transform-none ${tone[p.urgency]}`}
            >
              <span
                className={`grid size-9 shrink-0 place-items-center rounded-xl ${iconTone[p.urgency]}`}
              >
                <p.icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{p.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {p.detail}
                </span>
                <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary">
                  {p.cta}
                  <ArrowRight
                    className="size-3 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none rtl:rotate-180"
                    aria-hidden
                  />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
