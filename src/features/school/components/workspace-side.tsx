import { Link } from "@tanstack/react-router";
import {
  Bell,
  BookOpenCheck,
  CalendarCheck2,
  CalendarX2,
  CircleDollarSign,
  MessagesSquare,
  NotebookPen,
  ClipboardCheck,
  FolderOpen,
  GraduationCap,
  PieChart,
  Users,
  UserPlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate } from "@/lib/format";
import type { NotificationKind, NotificationRow } from "@/features/school/types";

interface QuickAction {
  to: string;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  /** Surfaced as a count, e.g. registers still to complete. */
  badge?: number;
  /** Deep-link params, so a badged action arrives already filtered. */
  search?: Record<string, boolean | string> | undefined;
}

/**
 * A launchpad for the four things a teacher opens repeatedly.
 *
 * Cards rather than buttons: each carries a line of copy saying what it is for,
 * which turns a row of similar-looking controls into a set of distinguishable
 * destinations. Driven by a registry, so a future action plugs in with one entry
 * and inherits the spacing, hover and badge behaviour automatically.
 */
export function QuickActions({ pendingCount }: { pendingCount: number }) {
  const { t } = useI18n();

  const actions: QuickAction[] = [
    {
      to: "/dashboard/attendance",
      labelKey: "teacher.markAttendance",
      descriptionKey: "teacher.action.attendanceDesc",
      icon: ClipboardCheck,
      // The badge counts outstanding registers, so when there are any the link
      // should arrive already filtered to them rather than to the whole week.
      ...(pendingCount > 0 ? { badge: pendingCount, search: { toMark: true } } : {}),
    },
    {
      to: "/dashboard/my-groups",
      labelKey: "menu.myGroups",
      descriptionKey: "teacher.action.groupsDesc",
      icon: GraduationCap,
    },
    {
      to: "/dashboard/my-students",
      labelKey: "menu.myStudents",
      descriptionKey: "teacher.action.studentsDesc",
      icon: Users,
    },
    {
      to: "/dashboard/attendance-report",
      labelKey: "menu.attendanceReport",
      descriptionKey: "teacher.action.reportDesc",
      icon: PieChart,
    },
  ];

  return (
    <SectionCard variant="quiet" title={t("teacher.quickActionsTitle")}>
      {/* The first action is performed many times a day, so it keeps a solid
          icon and its description. The rest collapse to one line each -- four
          identical tiles was repetition, not a launchpad. */}
      <ul className="-mx-1.5">
        {actions.map((a, i) => (
          <li key={a.to}>
            <Link
              to={a.to}
              {...(a.search ? { search: a.search } : {})}
              className={`focus-ring surface-action group flex items-center gap-3 px-1.5 ${
                i === 0 ? "py-2.5" : "py-2"
              }`}
            >
              <span
                className={`grid shrink-0 place-items-center rounded-lg transition-colors ${
                  i === 0
                    ? "size-9 bg-primary text-primary-foreground"
                    : "size-8 bg-muted text-muted-foreground group-hover:text-foreground"
                }`}
              >
                <a.icon className={i === 0 ? "size-4.5" : "size-4"} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={i === 0 ? "truncate text-sm font-semibold" : "truncate text-sm"}>
                    {t(a.labelKey)}
                  </span>
                  {a.badge !== undefined && (
                    <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-accent-foreground">
                      {a.badge}
                    </span>
                  )}
                </span>
                {i === 0 && (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {t(a.descriptionKey)}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/** Each kind gets its own icon so a glance distinguishes categories. */
const NOTIFICATION_ICON: Record<NotificationKind, LucideIcon> = {
  registration_approved: BookOpenCheck,
  registration_rejected: BookOpenCheck,
  attendance_marked: CalendarCheck2,
  teacher_assigned: GraduationCap,
  group_updated: Users,
  announcement: Bell,
  resource_published: FolderOpen,
  chapter_published: FolderOpen,
  application_received: UserPlus,
  message_received: MessagesSquare,
  payment_reminder: CircleDollarSign,
  absence_alert: CalendarX2,
  lesson_log_reminder: NotebookPen,
};

/** "2 h", "3 d" -- relative time reads faster than a date in a feed. */
function relativeTime(
  iso: string,
  now: Date,
  t: (k: string, v?: Record<string, string>) => string,
) {
  const mins = Math.round((now.getTime() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return t("teacher.justNow");
  if (mins < 60) return t("teacher.minutesAgoShort", { count: String(mins) });
  const h = Math.floor(mins / 60);
  if (h < 24) return t("teacher.hoursAgoShort", { count: String(h) });
  return t("teacher.daysAgoShort", { count: String(Math.floor(h / 24)) });
}

/**
 * Notifications as cards, grouped Unread / Today / Earlier.
 *
 * A flat list forces the reader to scan for what changed; three tiers put what
 * still needs attention on top and let the rest recede. Unread rows carry a
 * marker and a tinted edge; read rows are quiet. Text renders from `kind` +
 * `params`, never stored prose, so a row reads correctly in any locale.
 */
export function NotificationsPanel({
  notifications,
  onMarkRead,
  now = new Date(),
}: {
  notifications: NotificationRow[];
  onMarkRead: (id: string) => void;
  now?: Date;
}) {
  const { t, locale } = useI18n();

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const unread = notifications.filter((n) => !n.readAt);
  const read = notifications.filter((n) => n.readAt);
  const tiers = [
    { key: "unread", items: unread },
    { key: "today", items: read.filter((n) => new Date(n.createdAt) >= startOfToday) },
    { key: "earlier", items: read.filter((n) => new Date(n.createdAt) < startOfToday).slice(0, 5) },
  ].filter((g) => g.items.length > 0);

  return (
    <SectionCard
      variant="quiet"
      title={t("teacher.notificationsTitle")}
      actions={
        unread.length > 0 ? (
          <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-semibold tabular-nums text-primary-foreground">
            {unread.length}
          </span>
        ) : undefined
      }
    >
      {tiers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <span className="grid size-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
            <Bell className="size-5" aria-hidden />
          </span>
          <p className="text-sm font-medium">{t("teacher.notificationsEmptyTitle")}</p>
          <p className="max-w-[24ch] text-xs text-muted-foreground">
            {t("teacher.notificationsEmptyBody")}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {tiers.map((tier) => (
            <section key={tier.key}>
              <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t(`teacher.notifications.${tier.key}`)}
                <span className="h-px flex-1 bg-border" aria-hidden />
              </h3>
              <ul className="space-y-1.5">
                {tier.items.map((n) => {
                  const Icon = NOTIFICATION_ICON[n.kind] ?? Bell;
                  const isUnread = !n.readAt;
                  return (
                    // Activity-feed row: no card, no border. Unread is carried
                    // by a 2px start marker and full-contrast text; read rows
                    // drop to muted and lose the marker.
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => isUnread && onMarkRead(n.id)}
                        disabled={!isUnread}
                        aria-label={isUnread ? t("teacher.markNotificationRead") : undefined}
                        className={`focus-ring surface-action flex w-full items-start gap-2.5 py-2 pe-1.5 text-start disabled:cursor-default ${
                          isUnread ? "ps-2 border-s-2 border-primary" : "ps-2.5"
                        }`}
                      >
                        <Icon
                          className={`mt-0.5 size-3.5 shrink-0 ${
                            isUnread ? "text-primary" : "text-muted-foreground/70"
                          }`}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block text-[13px] leading-snug ${
                              isUnread ? "font-medium text-foreground" : "text-muted-foreground"
                            }`}
                          >
                            {t(`notification.${n.kind}`, n.params)}
                          </span>
                          <time
                            dateTime={n.createdAt}
                            title={formatDate(n.createdAt, locale)}
                            className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground/70"
                          >
                            {relativeTime(n.createdAt, now, t)}
                          </time>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
