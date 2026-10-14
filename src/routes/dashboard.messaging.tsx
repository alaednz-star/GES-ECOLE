/**
 * Messagerie (ADR-009): conversations, Teams-style -- the list on the start side, the thread on
 * the other. Students write to the administration and their teachers; teachers to the
 * administration and their students; administrators to anyone, and can supervise every
 * conversation (safeguarding; the screen says so).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Loader2,
  MessageSquarePlus,
  MessagesSquare,
  Search,
  Send,
  ShieldAlert,
} from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RequireAuth } from "@/features/auth/require-auth";
import { PersonAvatar } from "@/features/profile/person-avatar";
import {
  conversationMatches,
  conversationTitle,
  groupMessages,
} from "@/features/communication/comm-model";
import {
  useContacts,
  useConversationMessages,
  useConversations,
  useMarkConversationRead,
  useSendMessage,
  useStartConversation,
} from "@/features/communication/queries";
import type { ConversationSummary } from "@/features/communication/types";
import { isQueuedOffline } from "@/features/desktop/queue";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/messaging")({
  validateSearch: (raw: Record<string, unknown>): { c?: string } =>
    typeof raw["c"] === "string" && /^[0-9a-f-]{36}$/i.test(raw["c"]) ? { c: raw["c"] } : {},
  head: () => ({
    meta: [{ title: "Messagerie — Gestion École" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <RequireAuth roles={["admin", "teacher", "student"]}>
      <MessagingPage />
    </RequireAuth>
  ),
});

function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function useTimeLabel() {
  const { locale } = useI18n();
  const tag = locale === "ar" ? "ar-DZ-u-nu-latn" : locale === "en" ? "en-GB" : "fr-FR";
  return (iso: string) => {
    const d = new Date(iso);
    return localDay(iso) === localDay(new Date().toISOString())
      ? new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit" }).format(d)
      : formatDate(iso, locale);
  };
}

function MessagingPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/dashboard/messaging" });
  const isAdmin = user?.role === "admin";
  const [supervise, setSupervise] = useState(false);
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const list = useConversations(isAdmin && supervise);
  const timeLabel = useTimeLabel();

  const selectedId = search.c ?? null;
  const select = (id: string | null) =>
    void navigate({ search: id ? { c: id } : {}, replace: true });
  const conversations = useMemo(
    () => (list.data ?? []).filter((c) => conversationMatches(c, user?.id, query)),
    [list.data, query, user?.id],
  );
  const selected = (list.data ?? []).find((c) => c.id === selectedId) ?? null;

  if (list.error) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("chat.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("chat.subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={supervise}
                onCheckedChange={setSupervise}
                data-testid="chat-supervise"
              />
              {t("chat.supervise")}
            </label>
          )}
          <Button className="rounded-xl" onClick={() => setComposing(true)} data-testid="chat-new">
            <MessageSquarePlus className="size-4" aria-hidden /> {t("chat.new")}
          </Button>
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldAlert className="size-3.5" aria-hidden /> {t("chat.safeguarding")}
      </p>

      <div className="surface-card grid h-[calc(100dvh-15rem)] min-h-[28rem] overflow-hidden p-0 md:grid-cols-[20rem_1fr]">
        {/* List */}
        <aside
          className={cn(
            "flex min-h-0 flex-col border-border md:border-e",
            selected && "hidden md:flex",
          )}
        >
          <div className="relative border-b border-border p-2">
            <Search
              className="pointer-events-none absolute start-5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="h-9 rounded-lg ps-9"
              placeholder={t("chat.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="chat-search"
            />
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="chat-list">
            {list.isLoading ? (
              [0, 1, 2, 3].map((i) => (
                <li key={i} className="p-3">
                  <Skeleton className="h-12 rounded-xl" />
                </li>
              ))
            ) : conversations.length === 0 ? (
              <li className="p-6 text-center text-sm text-muted-foreground">
                {t(query ? "chat.noMatch" : "chat.emptyList")}
              </li>
            ) : (
              conversations.map((c) => (
                <ConversationRow
                  key={c.id}
                  c={c}
                  me={user?.id}
                  active={c.id === selectedId}
                  time={timeLabel(c.lastMessageAt)}
                  onClick={() => select(c.id)}
                />
              ))
            )}
          </ul>
        </aside>

        {/* Thread */}
        <section className={cn("min-h-0 flex-col", selected ? "flex" : "hidden md:flex")}>
          {selected ? (
            <Thread key={selected.id} conversation={selected} onBack={() => select(null)} />
          ) : (
            <div className="grid flex-1 place-items-center p-6">
              <EmptyState
                icon={MessagesSquare}
                title={t("chat.pickTitle")}
                description={t("chat.pickBody")}
                className="border-0 shadow-none"
              />
            </div>
          )}
        </section>
      </div>

      {composing && (
        <NewConversationDialog
          onClose={(id) => {
            setComposing(false);
            if (id) select(id);
          }}
        />
      )}
    </div>
  );
}

function ConversationRow({
  c,
  me,
  active,
  time,
  onClick,
}: {
  c: ConversationSummary;
  me: string | undefined;
  active: boolean;
  time: string;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const others = c.participants.filter((p) => p.id !== me);
  const first = others[0];
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-start gap-3 border-b border-border/60 px-3 py-3 text-start transition-colors hover:bg-muted/60",
          active && "bg-primary-soft hover:bg-primary-soft",
        )}
        data-testid="chat-row"
        data-conversation={c.id}
        data-unread={c.unread}
      >
        <PersonAvatar name={first?.name} url={first?.avatar} className="size-10 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span
              className={cn("truncate text-sm", c.unread > 0 ? "font-semibold" : "font-medium")}
            >
              {conversationTitle(c, me)}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{time}</span>
          </span>
          <span className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "truncate text-xs",
                c.unread > 0 ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {c.lastSenderId === me ? `${t("chat.you")} : ` : ""}
              {c.lastBody ?? ""}
            </span>
            {c.unread > 0 && (
              <span className="grid min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                {c.unread}
              </span>
            )}
          </span>
          {!c.isParticipant && (
            <span className="text-[11px] text-accent">{t("chat.supervised")}</span>
          )}
        </span>
      </button>
    </li>
  );
}

function Thread({
  conversation,
  onBack,
}: {
  conversation: ConversationSummary;
  onBack: () => void;
}) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { notifyError } = useActionFeedback();
  const messages = useConversationMessages(conversation.id);
  const send = useSendMessage();
  const markRead = useMarkConversationRead();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const tag = locale === "ar" ? "ar-DZ-u-nu-latn" : locale === "en" ? "en-GB" : "fr-FR";
  const hour = (iso: string) =>
    new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const days = useMemo(() => groupMessages(messages.data ?? [], localDay), [messages.data]);
  const today = localDay(new Date().toISOString());

  // Reading the thread clears its unread count and notice.
  useEffect(() => {
    if (conversation.isParticipant && conversation.unread > 0) markRead.mutate(conversation.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when new messages arrive
  }, [conversation.id, conversation.unread, messages.data?.length]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.data?.length]);

  const submit = () => {
    const body = text.trim();
    if (!body || (send.isPending && !isQueuedOffline())) return;
    send.mutate(
      {
        conversationId: conversation.id,
        body,
        senderId: user?.id ?? null,
        senderName: user?.fullName ?? null,
      },
      { onSuccess: () => setText(""), onError: notifyError },
    );
    // Desktop offline: the message waits for the connection (it is already in the thread).
    if (isQueuedOffline()) setText("");
  };

  return (
    <>
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-lg md:hidden"
          onClick={onBack}
          aria-label={t("chat.back")}
        >
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        </Button>
        <div className="min-w-0">
          <p className="truncate font-semibold" data-testid="chat-thread-title">
            {conversationTitle(conversation, user?.id)}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {conversation.participants.map((p) => p.name ?? "—").join(", ")}
          </p>
        </div>
      </header>

      <div
        className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-muted/20 px-4 py-4"
        data-testid="chat-thread"
      >
        {messages.isLoading ? (
          <Skeleton className="h-24 rounded-xl" />
        ) : (
          days.map((d) => (
            <div key={d.day} className="space-y-1.5">
              <p className="py-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {d.day === today ? t("chat.today") : formatDate(d.day, locale)}
              </p>
              {d.messages.map((m) => {
                const mine = m.senderId === user?.id;
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex gap-2",
                      mine ? "flex-row-reverse" : "flex-row",
                      !m.firstOfRun && (mine ? "pe-0" : "ps-10"),
                    )}
                    data-testid="chat-message"
                    data-mine={mine ? "true" : "false"}
                  >
                    {!mine && m.firstOfRun && (
                      <PersonAvatar
                        name={m.senderName}
                        url={m.senderAvatar}
                        className="mt-5 size-8 shrink-0"
                      />
                    )}
                    <div className={cn("max-w-[75%] space-y-0.5", mine && "items-end text-end")}>
                      {m.firstOfRun && (
                        <p className="px-1 text-[11px] text-muted-foreground">
                          {mine ? t("chat.you") : (m.senderName ?? "—")} · {hour(m.createdAt)}
                        </p>
                      )}
                      <p
                        dir="auto"
                        className={cn(
                          "inline-block whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-start text-sm",
                          mine
                            ? "bg-primary text-primary-foreground"
                            : "border border-border bg-background",
                        )}
                      >
                        {m.body}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {conversation.isParticipant ? (
        <form
          className="flex items-end gap-2 border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Textarea
            rows={1}
            dir="auto"
            className="max-h-40 min-h-10 flex-1 resize-none rounded-xl"
            placeholder={t("chat.placeholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            data-testid="chat-input"
          />
          <Button
            type="submit"
            size="icon"
            className="size-10 shrink-0 rounded-xl"
            disabled={!text.trim() || (send.isPending && !isQueuedOffline())}
            aria-label={t("chat.send")}
            data-testid="chat-send"
          >
            {send.isPending && !isQueuedOffline() ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Send className="size-4 rtl:-scale-x-100" aria-hidden />
            )}
          </Button>
        </form>
      ) : (
        <p className="border-t border-border p-3 text-center text-xs text-muted-foreground">
          {t("chat.readOnly")}
        </p>
      )}
    </>
  );
}

function NewConversationDialog({ onClose }: { onClose: (id?: string) => void }) {
  const { t } = useI18n();
  const { notifyError } = useActionFeedback();
  const contacts = useContacts(true);
  const start = useStartConversation();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return (contacts.data ?? []).filter(
      (c) => !q || `${c.fullName ?? ""} ${c.context ?? ""}`.toLocaleLowerCase().includes(q),
    );
  }, [contacts.data, query]);
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const errors = {
    recipients:
      picked.length === 0
        ? "chat.error.recipients"
        : picked.length > 50
          ? "chat.error.tooMany"
          : null,
    body: body.trim().length < 1 || body.trim().length > 4000 ? "chat.error.body" : null,
    subject: subject.trim().length > 120 ? "chat.error.subject" : null,
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !start.isPending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-start">{t("chat.newTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
            if (errors.recipients || errors.body || errors.subject) return;
            start.mutate(
              { recipients: picked, subject: subject.trim() || null, body: body.trim() },
              { onSuccess: (id) => onClose(id), onError: notifyError },
            );
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="chat-to">{t("chat.to")}</Label>
            <Input
              id="chat-to"
              className="h-10 rounded-xl"
              placeholder={t("chat.searchPeople")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="chat-to-search"
            />
            <ul
              className="max-h-48 overflow-y-auto rounded-xl border border-border"
              data-testid="chat-contacts"
            >
              {contacts.isLoading ? (
                <li className="p-3">
                  <Skeleton className="h-8 rounded-lg" />
                </li>
              ) : shown.length === 0 ? (
                <li className="p-3 text-center text-xs text-muted-foreground">
                  {t("chat.noContacts")}
                </li>
              ) : (
                shown.map((c) => (
                  <li key={c.userId}>
                    <label
                      className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/60"
                      data-testid="chat-contact"
                      data-user={c.userId}
                    >
                      <Checkbox
                        checked={picked.includes(c.userId)}
                        onCheckedChange={() => toggle(c.userId)}
                      />
                      <PersonAvatar name={c.fullName} url={c.avatarUrl} className="size-7" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {c.fullName ?? "—"}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {t(`chat.role.${c.role ?? "student"}`)}
                          {c.context ? ` · ${c.context}` : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                ))
              )}
            </ul>
            {submitted && errors.recipients && (
              <p className="text-xs text-destructive">{t(errors.recipients)}</p>
            )}
          </div>
          {picked.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="chat-subject">{t("chat.subject")}</Label>
              <Input
                id="chat-subject"
                className="h-10 rounded-xl"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                data-testid="chat-subject"
              />
              {submitted && errors.subject && (
                <p className="text-xs text-destructive">{t(errors.subject)}</p>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="chat-body">{t("chat.message")}</Label>
            <Textarea
              id="chat-body"
              rows={4}
              dir="auto"
              className="rounded-xl"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              data-testid="chat-body"
            />
            {submitted && errors.body && (
              <p className="text-xs text-destructive">{t(errors.body)}</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => onClose()}
            >
              {t("comm.cancel")}
            </Button>
            <Button
              type="submit"
              className="rounded-xl"
              disabled={start.isPending}
              data-testid="chat-start"
            >
              {start.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("chat.send")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
