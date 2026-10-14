/**
 * E-mail & SMS (ADR-009): compose a message for an audience, queue one personalised copy per
 * reachable recipient in the outbox, and send them. No provider is connected yet, so the page
 * says so and offers the honest path: per-row links that open the administrator's own mail, SMS or
 * WhatsApp, a CSV export, then marking the rows sent / failed / cancelled.
 */

import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Check,
  Download,
  Info,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquareText,
  Send,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RequireAuth } from "@/features/auth/require-auth";
import {
  AudiencePicker,
  useAudienceText,
} from "@/features/communication/components/audience-picker";
import {
  campaignErrors,
  deliveryLink,
  outboxCsv,
  smsSegments,
  whatsappLink,
} from "@/features/communication/comm-model";
import {
  previewCampaign,
  useCampaigns,
  useOutbox,
  useQueueCampaign,
  useSetOutboundStatus,
} from "@/features/communication/queries";
import type {
  Audience,
  Channel,
  OutboundMessage,
  OutboundStatus,
} from "@/features/communication/types";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useI18n } from "@/hooks/use-i18n";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/email-sms")({
  head: () => ({
    meta: [{ title: "E-mail & SMS — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin"]}>
      <EmailSmsPage />
    </RequireAuth>
  ),
});

const STATUS_TONE: Record<OutboundStatus, string> = {
  pending: "bg-accent-soft text-accent",
  sent: "bg-success-soft text-success",
  failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

function EmailSmsPage() {
  const { t, locale } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const outbox = useOutbox();
  const campaigns = useCampaigns();
  const setStatus = useSetOutboundStatus();
  const audienceText = useAudienceText();
  const [statusFilter, setStatusFilter] = useState<OutboundStatus | "all">("pending");
  const [channelFilter, setChannelFilter] = useState<Channel | "all">("all");

  const rows = useMemo(
    () =>
      (outbox.data ?? []).filter(
        (m) =>
          (statusFilter === "all" || m.status === statusFilter) &&
          (channelFilter === "all" || m.channel === channelFilter),
      ),
    [outbox.data, statusFilter, channelFilter],
  );
  const pendingCount = (outbox.data ?? []).filter((m) => m.status === "pending").length;

  const mark = (ids: string[], status: OutboundStatus, clear?: () => void) =>
    setStatus.mutate(
      { ids, status },
      {
        onSuccess: (n) => {
          notifySuccess("outbox.marked", { count: n });
          clear?.();
        },
        onError: notifyError,
      },
    );

  const download = (list: OutboundMessage[]) => {
    const blob = new Blob([outboxCsv(list)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `outbox-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: Column<OutboundMessage>[] = [
    {
      key: "recipient",
      header: t("outbox.col.recipient"),
      sortValue: (m) => m.recipientName ?? "",
      cell: (m) => (
        <div className="min-w-0" data-testid="outbox-row" data-status={m.status}>
          <p className="truncate font-medium">{m.recipientName ?? "—"}</p>
          <p className="truncate text-xs text-muted-foreground" dir="ltr">
            {m.address}
          </p>
        </div>
      ),
    },
    {
      key: "message",
      header: t("outbox.col.message"),
      className: "hidden md:table-cell",
      cell: (m) => (
        <div className="max-w-md">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {m.channel === "email" ? (
              <Mail className="size-3" aria-hidden />
            ) : (
              <MessageSquareText className="size-3" aria-hidden />
            )}
            {t(`outbox.source.${m.source}`)} · {formatDateTime(m.createdAt, locale)}
          </p>
          {m.subject && <p className="truncate text-sm font-medium">{m.subject}</p>}
          <p className="line-clamp-2 text-sm text-muted-foreground" dir="auto">
            {m.body}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: t("outbox.col.status"),
      sortValue: (m) => m.status,
      cell: (m) => (
        <span
          className={cn("rounded-full px-2.5 py-1 text-xs font-medium", STATUS_TONE[m.status])}
          title={m.error ?? undefined}
        >
          {t(`outbox.status.${m.status}`)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-end",
      cell: (m) => (
        <div className="flex justify-end gap-1">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-8 rounded-lg"
            aria-label={t(m.channel === "email" ? "outbox.openMail" : "outbox.openSms")}
          >
            <a href={deliveryLink(m)} target="_blank" rel="noreferrer" data-testid="outbox-open">
              {m.channel === "email" ? (
                <Mail className="size-4" aria-hidden />
              ) : (
                <MessageSquareText className="size-4" aria-hidden />
              )}
            </a>
          </Button>
          {m.channel === "sms" && (
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg"
              aria-label={t("outbox.openWhatsapp")}
            >
              <a href={whatsappLink(m.address, m.body)} target="_blank" rel="noreferrer">
                <MessageCircle className="size-4" aria-hidden />
              </a>
            </Button>
          )}
          {m.status !== "sent" && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg text-success"
              aria-label={t("outbox.markSent")}
              onClick={() => mark([m.id], "sent")}
              data-testid="outbox-mark-sent"
            >
              <Check className="size-4" aria-hidden />
            </Button>
          )}
          {m.status === "pending" && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg text-muted-foreground"
              aria-label={t("outbox.markCancelled")}
              onClick={() => mark([m.id], "cancelled")}
            >
              <X className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("outbox.title")} description={t("outbox.subtitle")} />

      <div
        className="flex items-start gap-3 rounded-2xl border border-accent/30 bg-accent-soft/50 px-4 py-3 text-sm"
        data-testid="outbox-provider-note"
      >
        <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <p>{t("outbox.noProvider")}</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,26rem)_1fr]">
        <Composer />
        <section className="surface-card min-w-0 space-y-3 p-4">
          <h2 className="font-semibold">{t("outbox.campaigns")}</h2>
          {(campaigns.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("outbox.noCampaigns")}</p>
          ) : (
            <ul className="divide-y divide-border" data-testid="outbox-campaigns">
              {(campaigns.data ?? []).slice(0, 8).map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {c.channel === "email" ? (
                        <Mail className="size-3.5" aria-hidden />
                      ) : (
                        <MessageSquareText className="size-3.5" aria-hidden />
                      )}
                      {c.subject ?? c.body.slice(0, 60)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {audienceText(c.audienceType, c.audienceLabel)}
                      {c.target === "guardian" ? ` · ${t("outbox.target.guardian")}` : ""} ·{" "}
                      {formatDateTime(c.createdAt, locale)}
                    </p>
                  </div>
                  <p className="shrink-0 text-end text-xs tabular-nums">
                    <span className="font-semibold">{c.queued}</span> {t("outbox.queuedShort")}
                    {c.skipped > 0 && (
                      <span className="block text-muted-foreground">
                        {t("outbox.skippedShort", { count: c.skipped })}
                      </span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">
            {t("outbox.outbox")}{" "}
            {pendingCount > 0 && (
              <span className="text-sm font-normal text-accent">
                ({t("outbox.pendingCount", { count: pendingCount })})
              </span>
            )}
          </h2>
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={() => download(rows)}
            disabled={rows.length === 0}
            data-testid="outbox-csv"
          >
            <Download className="size-4" aria-hidden /> {t("outbox.csv")}
          </Button>
        </div>
        <DataTable
          rows={rows}
          columns={columns}
          isLoading={outbox.isLoading}
          error={outbox.error}
          onRetry={() => void outbox.refetch()}
          rowKey={(m) => m.id}
          pageSize={50}
          searchable={(m) => `${m.recipientName ?? ""} ${m.address} ${m.subject ?? ""} ${m.body}`}
          filters={
            <div className="flex flex-wrap gap-2">
              <Select
                value={statusFilter}
                onValueChange={(v) =>
                  v && v !== statusFilter && setStatusFilter(v as OutboundStatus | "all")
                }
              >
                <SelectTrigger
                  className="h-10 w-full rounded-xl sm:w-44"
                  data-testid="outbox-status-filter"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("outbox.status.all")}</SelectItem>
                  {(["pending", "sent", "failed", "cancelled"] as const).map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`outbox.status.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={channelFilter}
                onValueChange={(v) =>
                  v && v !== channelFilter && setChannelFilter(v as Channel | "all")
                }
              >
                <SelectTrigger className="h-10 w-full rounded-xl sm:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("outbox.channel.all")}</SelectItem>
                  <SelectItem value="email">{t("outbox.channel.email")}</SelectItem>
                  <SelectItem value="sms">{t("outbox.channel.sms")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          }
          bulkActions={(selected, clear) => (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                className="rounded-lg"
                onClick={() =>
                  mark(
                    selected.map((m) => m.id),
                    "sent",
                    clear,
                  )
                }
                data-testid="outbox-bulk-sent"
              >
                <Check className="size-4" aria-hidden /> {t("outbox.markSent")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-lg"
                onClick={() =>
                  mark(
                    selected.map((m) => m.id),
                    "failed",
                    clear,
                  )
                }
              >
                {t("outbox.markFailed")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-lg"
                onClick={() =>
                  mark(
                    selected.map((m) => m.id),
                    "cancelled",
                    clear,
                  )
                }
              >
                {t("outbox.markCancelled")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-lg"
                onClick={() => download(selected)}
              >
                <Download className="size-4" aria-hidden /> {t("outbox.csv")}
              </Button>
            </div>
          )}
          emptyState={
            <EmptyState
              icon={Send}
              title={t("outbox.emptyTitle")}
              description={t("outbox.emptyBody")}
            />
          }
        />
      </section>
    </div>
  );
}

function Composer() {
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useActionFeedback();
  const queue = useQueueCampaign();
  const [form, setForm] = useState({
    channel: "sms" as Channel,
    target: "guardian" as "self" | "guardian",
    audience: { type: "students", id: null } as Audience,
    subject: "",
    body: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [preview, setPreview] = useState<{ recipients: number; reachable: number } | null>(null);
  const errors = campaignErrors(form);
  const seg = smsSegments(form.body);

  // Live count of who would receive it.
  useEffect(() => {
    let live = true;
    setPreview(null);
    if (errors.audience) return;
    const target = form.channel === "sms" ? form.target : "self";
    previewCampaign(form.channel, form.audience, target)
      .then((p) => live && setPreview(p))
      .catch(() => live && setPreview(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute on audience / channel / target
  }, [form.channel, form.target, form.audience.type, form.audience.id]);

  return (
    <section className="surface-card min-w-0 space-y-4 p-4" data-testid="outbox-composer">
      <h2 className="font-semibold">{t("outbox.compose")}</h2>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("outbox.channel")}>
        {(["sms", "email"] as const).map((ch) => (
          <button
            key={ch}
            type="button"
            role="radio"
            aria-checked={form.channel === ch}
            onClick={() => setForm({ ...form, channel: ch })}
            className={cn(
              "flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium",
              form.channel === ch
                ? "border-primary bg-primary-soft text-primary"
                : "border-border hover:bg-muted",
            )}
            data-testid={`outbox-channel-${ch}`}
          >
            {ch === "email" ? (
              <Mail className="size-4" aria-hidden />
            ) : (
              <MessageSquareText className="size-4" aria-hidden />
            )}
            {t(`outbox.channel.${ch}`)}
          </button>
        ))}
      </div>
      <AudiencePicker
        value={form.audience}
        onChange={(a) => setForm({ ...form, audience: a })}
        error={submitted ? errors.audience : undefined}
        idPrefix="outbox-audience"
      />
      {form.channel === "sms" && (
        <div className="space-y-1.5">
          <Label>{t("outbox.target")}</Label>
          <Select
            value={form.target}
            onValueChange={(v) =>
              v && v !== form.target && setForm({ ...form, target: v as "self" | "guardian" })
            }
          >
            <SelectTrigger className="h-11 rounded-xl" data-testid="outbox-target">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="guardian">{t("outbox.target.guardian")}</SelectItem>
              <SelectItem value="self">{t("outbox.target.self")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {form.channel === "email" && (
        <div className="space-y-1.5">
          <Label htmlFor="outbox-subject">{t("outbox.subject")}</Label>
          <Input
            id="outbox-subject"
            className="h-11 rounded-xl"
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            data-testid="outbox-subject"
          />
          {submitted && errors.subject && (
            <p className="text-xs text-destructive">{t(errors.subject)}</p>
          )}
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="outbox-body">{t("outbox.body")}</Label>
        <Textarea
          id="outbox-body"
          rows={5}
          dir="auto"
          className="rounded-xl"
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          data-testid="outbox-body"
        />
        <p className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <span>{t("outbox.nameHint")}</span>
          {form.channel === "sms" && (
            <span className="tabular-nums" data-testid="outbox-sms-count">
              {t("outbox.smsCount", { chars: form.body.length, segments: seg.segments })}
            </span>
          )}
        </p>
        {submitted && errors.body && <p className="text-xs text-destructive">{t(errors.body)}</p>}
      </div>
      <p className="rounded-xl bg-muted/60 px-3 py-2 text-xs" data-testid="outbox-preview">
        {preview
          ? t("outbox.preview", { reachable: preview.reachable, recipients: preview.recipients })
          : t("outbox.previewNone")}
      </p>
      <Button
        className="w-full rounded-xl"
        disabled={queue.isPending}
        data-testid="outbox-queue"
        onClick={() => {
          setSubmitted(true);
          if (Object.keys(errors).length) return;
          queue.mutate(
            {
              channel: form.channel,
              audience: form.audience,
              target: form.channel === "sms" ? form.target : "self",
              subject: form.channel === "email" ? form.subject.trim() : null,
              body: form.body.trim(),
            },
            {
              onSuccess: (r) => {
                notifySuccess("outbox.queued", { queued: r.queued, skipped: r.skipped });
                setForm({ ...form, subject: "", body: "" });
                setSubmitted(false);
              },
              onError: notifyError,
            },
          );
        }}
      >
        {queue.isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Send className="size-4" aria-hidden />
        )}
        {t("outbox.queue")}
      </Button>
    </section>
  );
}
