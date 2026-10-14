/**
 * Rappels & alertes (ADR-009): four rules (overdue payments, payments due soon, absences, lesson
 * log not filled), each with a threshold and channels; a preview of who would be reminded now; a
 * run that sends in-app notices and queues e-mail / SMS in the outbox; the history. A run never
 * reminds anyone twice for the same thing.
 */

import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BellRing,
  CalendarX2,
  CircleDollarSign,
  Loader2,
  NotebookPen,
  Play,
  TimerReset,
  UserX,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { RequireAuth } from "@/features/auth/require-auth";
import { THRESHOLD_RANGE, thresholdError } from "@/features/communication/comm-model";
import {
  useReminderLog,
  useReminderPreview,
  useReminderRules,
  useRunReminders,
  useSaveReminderRule,
} from "@/features/communication/queries";
import {
  REMINDER_KINDS,
  type ReminderChannel,
  type ReminderKind,
  type ReminderRule,
} from "@/features/communication/types";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useI18n } from "@/hooks/use-i18n";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/reminders")({
  head: () => ({
    meta: [{ title: "Rappels & alertes — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <RemindersPage />
    </RequireAuth>
  ),
});

const ICON: Record<ReminderKind, typeof BellRing> = {
  payment_overdue: CircleDollarSign,
  payment_due_soon: TimerReset,
  absences: UserX,
  lesson_log_missing: NotebookPen,
};

function RemindersPage() {
  const { t, locale } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const rules = useReminderRules();
  const preview = useReminderPreview();
  const log = useReminderLog();
  const run = useRunReminders();

  if (rules.error) return <ErrorState error={rules.error} onRetry={() => void rules.refetch()} />;
  const due = (preview.data ?? []).filter((c) => !c.alreadySent);
  const byKind = (k: ReminderKind) => (rules.data ?? []).find((r) => r.kind === k);
  const lastRun =
    (rules.data ?? [])
      .map((r) => r.lastRunAt)
      .filter(Boolean)
      .sort()
      .pop() ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("reminders.title")}
        description={t("reminders.subtitle")}
        actions={
          <Button
            className="rounded-xl"
            disabled={run.isPending || due.length === 0}
            onClick={() =>
              run.mutate(undefined, {
                onSuccess: (counts) =>
                  notifySuccess("reminders.ran", {
                    count: Object.values(counts).reduce((s, n) => s + Number(n), 0),
                  }),
                onError: notifyError,
              })
            }
            data-testid="reminders-run"
          >
            {run.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}
            {t("reminders.run", { count: due.length })}
          </Button>
        }
      />
      <p className="-mt-3 text-xs text-muted-foreground">
        {lastRun
          ? t("reminders.lastRun", { date: formatDateTime(lastRun, locale) })
          : t("reminders.neverRun")}{" "}
        · {t("reminders.schedulingNote")}
      </p>

      <section className="grid gap-4 md:grid-cols-2" data-testid="reminder-rules">
        {rules.isLoading
          ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-44 rounded-2xl" />)
          : REMINDER_KINDS.map((k) => {
              const r = byKind(k);
              return r ? (
                <RuleCard
                  key={k}
                  rule={r}
                  pending={
                    (preview.data ?? []).filter((c) => c.kind === k && !c.alreadySent).length
                  }
                />
              ) : null;
            })}
      </section>

      <section className="surface-card space-y-3 p-4">
        <h2 className="font-semibold">{t("reminders.previewTitle")}</h2>
        {preview.isLoading ? (
          <Skeleton className="h-20 rounded-xl" />
        ) : (preview.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="reminders-preview-empty">
            {t("reminders.previewEmpty")}
          </p>
        ) : (
          <ul className="divide-y divide-border" data-testid="reminders-preview">
            {(preview.data ?? []).map((c) => (
              <li
                key={`${c.kind}-${c.userId}-${c.subjectKey}`}
                className="flex items-center justify-between gap-3 py-2"
                data-testid="reminder-candidate"
                data-kind={c.kind}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.fullName ?? "—"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t(`notification.${noticeKind(c.kind)}`, c.params)}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-xs",
                    c.alreadySent ? "bg-muted text-muted-foreground" : "bg-accent-soft text-accent",
                  )}
                >
                  {t(c.alreadySent ? "reminders.sent" : "reminders.toSend")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="surface-card space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t("reminders.history")}</h2>
          <Button asChild variant="link" size="sm">
            <Link to="/dashboard/email-sms">{t("reminders.openOutbox")}</Link>
          </Button>
        </div>
        {(log.data ?? []).length === 0 ? (
          <EmptyState
            icon={CalendarX2}
            title={t("reminders.historyEmpty")}
            className="border-0 py-6 shadow-none"
          />
        ) : (
          <ul className="divide-y divide-border" data-testid="reminders-history">
            {(log.data ?? []).slice(0, 50).map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{l.fullName ?? "—"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t(`notification.${noticeKind(l.kind)}`, l.params)}
                  </p>
                </div>
                <p className="shrink-0 text-end text-xs text-muted-foreground">
                  {formatDateTime(l.sentAt, locale)}
                  <span className="block">
                    {l.channels.map((c) => t(`reminders.channel.${c}`)).join(", ")}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function noticeKind(k: ReminderKind): string {
  return k === "absences"
    ? "absence_alert"
    : k === "lesson_log_missing"
      ? "lesson_log_reminder"
      : "payment_reminder";
}

function RuleCard({ rule, pending }: { rule: ReminderRule; pending: number }) {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const save = useSaveReminderRule();
  const [threshold, setThreshold] = useState(String(rule.threshold));
  const Icon = ICON[rule.kind];
  const range = THRESHOLD_RANGE[rule.kind];

  const persist = (patch: Partial<Pick<ReminderRule, "enabled" | "threshold" | "channels">>) => {
    const next = {
      kind: rule.kind,
      enabled: rule.enabled,
      threshold: rule.threshold,
      channels: rule.channels,
      ...patch,
    };
    if (next.channels.length === 0) return;
    save.mutate(next, { onSuccess: () => notifySuccess("reminders.saved"), onError: notifyError });
  };
  const toggleChannel = (c: ReminderChannel) =>
    persist({
      channels: rule.channels.includes(c)
        ? rule.channels.filter((x) => x !== c)
        : [...rule.channels, c],
    });
  const thresholdValue = Number(threshold);
  const err = thresholdError(rule.kind, thresholdValue);

  return (
    <article
      className={cn("surface-card space-y-3 p-4", !rule.enabled && "opacity-80")}
      data-testid="reminder-rule"
      data-kind={rule.kind}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-xl",
              rule.enabled ? "bg-primary-soft text-primary" : "bg-muted text-muted-foreground",
            )}
          >
            <Icon className="size-5" aria-hidden />
          </span>
          <div>
            <h3 className="font-semibold">{t(`reminders.kind.${rule.kind}`)}</h3>
            <p className="text-xs text-muted-foreground">{t(`reminders.kindHint.${rule.kind}`)}</p>
          </div>
        </div>
        <Switch
          checked={rule.enabled}
          disabled={save.isPending}
          onCheckedChange={(v) => persist({ enabled: v })}
          aria-label={t("reminders.enable")}
          data-testid="reminder-enabled"
        />
      </header>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{t(`reminders.thresholdLabel.${rule.kind}`)}</span>
        <Input
          type="number"
          inputMode="numeric"
          min={range.min}
          max={range.max}
          dir="ltr"
          className="h-9 w-20 rounded-lg"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          onBlur={() => {
            if (!err && thresholdValue !== rule.threshold) persist({ threshold: thresholdValue });
          }}
          data-testid="reminder-threshold"
        />
        <span className="text-muted-foreground">{t(`reminders.thresholdUnit.${rule.kind}`)}</span>
      </div>
      {err && (
        <p className="text-xs text-destructive">{t(err, { min: range.min, max: range.max })}</p>
      )}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {(["in_app", "email", "sms"] as const).map((c) => (
          <label key={c} className="flex items-center gap-1.5">
            <Checkbox
              checked={rule.channels.includes(c)}
              disabled={save.isPending || (rule.channels.length === 1 && rule.channels.includes(c))}
              onCheckedChange={() => toggleChannel(c)}
              data-testid={`reminder-channel-${c}`}
            />
            {t(`reminders.channel.${c}`)}
          </label>
        ))}
      </div>
      {rule.enabled && (
        <p className="text-xs text-muted-foreground" data-testid="reminder-pending">
          {t("reminders.pending", { count: pending })}
        </p>
      )}
    </article>
  );
}
