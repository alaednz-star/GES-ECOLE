import {
  Bell,
  CalendarCheck,
  CalendarX2,
  CircleDollarSign,
  MessagesSquare,
  NotebookPen,
  CheckCheck,
  CheckCircle2,
  FolderOpen,
  GraduationCap,
  Megaphone,
  UserPlus,
  UserSquare2,
  XCircle,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/common/empty-state";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/features/school/notifications";
import { cn } from "@/lib/utils";
import type { NotificationKind } from "@/features/school/types";

/**
 * Icon and destination per notification kind.
 *
 * Clicking a notification should land on the page it is about, so the student
 * never has to hunt for what changed.
 */
const NOTIFICATION_META: Record<NotificationKind, { icon: typeof Bell; to: string; tone: string }> =
  {
    registration_approved: {
      icon: CheckCircle2,
      to: "/dashboard/my-registrations",
      tone: "text-success",
    },
    registration_rejected: {
      icon: XCircle,
      to: "/dashboard/my-registrations",
      tone: "text-destructive",
    },
    attendance_marked: {
      icon: CalendarCheck,
      to: "/dashboard/my-attendance",
      tone: "text-primary",
    },
    teacher_assigned: { icon: UserSquare2, to: "/dashboard", tone: "text-primary" },
    application_received: { icon: UserPlus, to: "/dashboard/admissions", tone: "text-accent" },
    group_updated: { icon: GraduationCap, to: "/dashboard/my-registrations", tone: "text-accent" },
    announcement: { icon: Megaphone, to: "/dashboard/news", tone: "text-primary" },
    // Communication (ADR-009). A message or a post opens itself (see the click handler).
    message_received: { icon: MessagesSquare, to: "/dashboard/messaging", tone: "text-primary" },
    payment_reminder: {
      icon: CircleDollarSign,
      to: "/dashboard/my-registrations",
      tone: "text-accent",
    },
    absence_alert: { icon: CalendarX2, to: "/dashboard/my-attendance", tone: "text-destructive" },
    lesson_log_reminder: { icon: NotebookPen, to: "/dashboard/lesson-log", tone: "text-accent" },
    // Both land on the student's own library: the notice exists to shorten the
    // distance between "something arrived" and reading it.
    resource_published: {
      icon: FolderOpen,
      to: "/dashboard/my-resources",
      tone: "text-primary",
    },
    chapter_published: {
      icon: FolderOpen,
      to: "/dashboard/my-resources",
      tone: "text-primary",
    },
  };

/** Relative time without pulling in a date library. */
function useRelativeTime() {
  const { t } = useI18n();
  return (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return t("time.justNow");
    if (mins < 60) return t("time.minutesAgo", { count: String(mins) });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("time.hoursAgo", { count: String(hours) });
    const days = Math.floor(hours / 24);
    return t("time.daysAgo", { count: String(days) });
  };
}

export function NotificationBell() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { notifyError } = useActionFeedback();
  const relative = useRelativeTime();
  const navigate = useNavigate();

  const { data: items = [] } = useNotifications(user?.id);
  const markRead = useMarkNotificationRead(user?.id);
  const markAll = useMarkAllNotificationsRead(user?.id);

  const unread = items.filter((n) => !n.readAt).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-9 rounded-lg"
          aria-label={
            unread > 0
              ? t("notification.ariaWithCount", { count: String(unread) })
              : t("notification.aria")
          }
        >
          <Bell className="size-4" aria-hidden />
          {unread > 0 && (
            <span
              className="absolute top-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[0.625rem] font-semibold leading-4 text-destructive-foreground ltr:right-1 rtl:left-1"
              aria-hidden
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 rounded-2xl p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">{t("notification.title")}</p>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 rounded-lg text-xs"
              disabled={markAll.isPending}
              onClick={() => markAll.mutate(undefined, { onError: (e) => notifyError(e) })}
            >
              <CheckCheck className="size-3.5" aria-hidden />
              {t("notification.markAllRead")}
            </Button>
          )}
        </div>

        {items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={t("notification.emptyTitle")}
            description={t("notification.emptyBody")}
            className="border-none px-4 py-10 shadow-none"
          />
        ) : (
          <ScrollArea className="max-h-96">
            <ul className="divide-y divide-border">
              {items.map((n) => {
                const meta = NOTIFICATION_META[n.kind];
                const Icon = meta.icon;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!n.readAt) {
                          markRead.mutate(n.id, { onError: (e) => notifyError(e) });
                        }
                        // Land on the page the notification is about: the conversation or the
                        // post itself when the notice names one.
                        if (n.kind === "message_received" && n.params["conversationId"]) {
                          void navigate({
                            to: "/dashboard/messaging",
                            search: { c: n.params["conversationId"] },
                          });
                        } else if (n.kind === "announcement" && n.params["postId"]) {
                          void navigate({
                            to: "/dashboard/news/$postId",
                            params: { postId: n.params["postId"] },
                          });
                        } else {
                          void navigate({ to: meta.to });
                        }
                      }}
                      className={cn(
                        "focus-ring flex w-full gap-3 px-4 py-3 text-start transition-colors hover:bg-muted/50",
                        !n.readAt && "bg-primary-soft/40",
                      )}
                    >
                      <span className={cn("mt-0.5 shrink-0", meta.tone)} aria-hidden>
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm">
                          {t(`notification.${n.kind}`, n.params)}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {relative(n.createdAt)}
                        </span>
                      </span>
                      {!n.readAt && (
                        <span
                          className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                          aria-label={t("notification.unreadAria")}
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
