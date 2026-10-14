/**
 * Communication data (ADR-009): news, conversations, the e-mail / SMS outbox, reminders.
 * Fetches and writes only. SECURITY is the database's: RLS on every table, and the writes that
 * matter (messages, publishing, the outbox, reminders) go through checked SECURITY DEFINER
 * functions.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { OFFLINE_MUTATIONS } from "@/features/desktop/offline-model";
import type {
  Audience,
  AudienceType,
  Campaign,
  Channel,
  ChatMessage,
  Contact,
  ConversationSummary,
  NewsCategory,
  NewsPost,
  OutboundMessage,
  OutboundStatus,
  Participant,
  ReminderCandidate,
  ReminderChannel,
  ReminderKind,
  ReminderLogEntry,
  ReminderRule,
} from "./types";

export const commKeys = {
  news: () => ["comm", "news"] as const,
  post: (id: string) => ["comm", "news", id] as const,
  conversations: (all: boolean) => ["comm", "conversations", all] as const,
  messages: (id: string) => ["comm", "messages", id] as const,
  contacts: () => ["comm", "contacts"] as const,
  campaigns: () => ["comm", "campaigns"] as const,
  outbox: () => ["comm", "outbox"] as const,
  rules: () => ["comm", "reminder-rules"] as const,
  preview: () => ["comm", "reminder-preview"] as const,
  log: () => ["comm", "reminder-log"] as const,
};

const NOT_ALLOWED = { code: "42501", message: "Not allowed" };

/* ------------------------------------------------------------------ news */

export const NEWS_BUCKET = "news";

export function coverUrl(path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from(NEWS_BUCKET).getPublicUrl(path).data.publicUrl;
}

interface RawPost {
  id: string;
  title: string;
  summary: string | null;
  body: string | null;
  category: string;
  cover_path: string | null;
  audience_type: string;
  audience_id: string | null;
  audience_label: string | null;
  pinned: boolean;
  status: string;
  publish_at: string | null;
  published_at: string | null;
  created_by: string | null;
  author_name: string | null;
  author_avatar: string | null;
  created_at: string;
  updated_at: string;
  likes: number;
  my_read: boolean;
  my_liked: boolean;
  views: number | null;
  recipients: number | null;
  can_edit: boolean;
}

const toPost = (r: RawPost): NewsPost => ({
  id: r.id,
  title: r.title,
  summary: r.summary,
  body: r.body,
  category: r.category as NewsCategory,
  coverPath: r.cover_path,
  audienceType: r.audience_type as AudienceType,
  audienceId: r.audience_id,
  audienceLabel: r.audience_label,
  pinned: r.pinned,
  status: r.status as NewsPost["status"],
  publishAt: r.publish_at,
  publishedAt: r.published_at,
  createdBy: r.created_by,
  authorName: r.author_name,
  authorAvatar: r.author_avatar,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  likes: Number(r.likes ?? 0),
  myRead: r.my_read,
  myLiked: r.my_liked,
  views: r.views === null ? null : Number(r.views),
  recipients: r.recipients === null ? null : Number(r.recipients),
  canEdit: r.can_edit,
});

export function useNewsFeed() {
  return useQuery({
    queryKey: commKeys.news(),
    queryFn: async (): Promise<NewsPost[]> => {
      const { data, error } = await supabase.rpc("news_feed", {});
      if (error) throw error;
      return ((data ?? []) as RawPost[]).map(toPost);
    },
  });
}

export function useNewsPost(id: string) {
  return useQuery({
    queryKey: commKeys.post(id),
    queryFn: async (): Promise<NewsPost | null> => {
      const { data, error } = await supabase.rpc("news_feed", { p_post: id });
      if (error) throw error;
      const row = ((data ?? []) as RawPost[])[0];
      return row ? toPost(row) : null;
    },
  });
}

export interface NewsInput {
  id?: string;
  title: string;
  summary: string | null;
  body: string;
  category: NewsCategory;
  coverPath: string | null;
  audience: Audience;
  pinned: boolean;
}

/** Saves a draft (or the content of a published post). Returns the post id. */
export function useSaveNews() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewsInput): Promise<string> => {
      const row = {
        title: input.title,
        summary: input.summary,
        body: input.body,
        category: input.category,
        cover_path: input.coverPath,
        pinned: input.pinned,
      };
      const { data, error } = input.id
        ? await supabase.from("news_posts").update(row).eq("id", input.id).select("id")
        : await supabase
            .from("news_posts")
            .insert({ ...row, audience_type: input.audience.type, audience_id: input.audience.id })
            .select("id");
      if (error) throw error;
      const id = data?.[0]?.id;
      if (!id) throw NOT_ALLOWED;
      return id;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["comm", "news"] }),
  });
}

/** Changes the audience of a draft (published posts keep theirs). */
export function useSetDraftAudience() {
  return useMutation({
    mutationFn: async ({ id, audience }: { id: string; audience: Audience }) => {
      const { data, error } = await supabase
        .from("news_posts")
        .update({ audience_type: audience.type, audience_id: audience.id })
        .eq("id", id)
        .eq("status", "draft")
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw NOT_ALLOWED;
    },
  });
}

export function usePublishNews() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      publishAt,
    }: {
      id: string;
      publishAt: string | null;
    }): Promise<number> => {
      const { data, error } = await supabase.rpc("publish_news", {
        p_post: id,
        ...(publishAt ? { p_publish_at: publishAt } : {}),
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["comm", "news"] }),
  });
}

export function useDeleteNews() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("delete_news", { p_post: id });
      if (error) throw error;
      // The cover goes with the post. Best effort: an orphan file is harmless.
      if (data) await supabase.storage.from(NEWS_BUCKET).remove([data as string]);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["comm", "news"] }),
  });
}

export function useMarkNewsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("mark_news_read", { p_post: id });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["comm", "news"] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useToggleNewsLike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<boolean> => {
      const { data, error } = await supabase.rpc("toggle_news_like", { p_post: id });
      if (error) throw error;
      return Boolean(data);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["comm", "news"] }),
  });
}

const COVER_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const COVER_MAX_BYTES = 2 * 1024 * 1024;

/** Uploads a cover image; returns its storage path. */
export async function uploadCover(file: File): Promise<string> {
  if (!COVER_TYPES.includes(file.type)) throw new Error("news.error.coverType");
  if (file.size > COVER_MAX_BYTES) throw new Error("news.error.coverSize");
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `posts/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(NEWS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

/* ------------------------------------------------------------------ conversations */

interface RawConversation {
  id: string;
  subject: string | null;
  created_at: string;
  last_message_at: string;
  last_body: string | null;
  last_sender_id: string | null;
  last_sender_name: string | null;
  unread: number;
  participants: Participant[] | null;
  is_participant: boolean;
}

export function useConversations(all: boolean) {
  return useQuery({
    queryKey: commKeys.conversations(all),
    refetchInterval: 15_000,
    queryFn: async (): Promise<ConversationSummary[]> => {
      const { data, error } = await supabase.rpc("my_conversations", { p_all: all });
      if (error) throw error;
      return ((data ?? []) as RawConversation[]).map((c) => ({
        id: c.id,
        subject: c.subject,
        createdAt: c.created_at,
        lastMessageAt: c.last_message_at,
        lastBody: c.last_body,
        lastSenderId: c.last_sender_id,
        lastSenderName: c.last_sender_name,
        unread: Number(c.unread ?? 0),
        participants: c.participants ?? [],
        isParticipant: c.is_participant,
      }));
    },
  });
}

export function useConversationMessages(id: string | null) {
  return useQuery({
    queryKey: commKeys.messages(id ?? "none"),
    enabled: !!id,
    refetchInterval: 8_000,
    queryFn: async (): Promise<ChatMessage[]> => {
      const { data, error } = await supabase.rpc("conversation_messages", {
        p_conversation: id as string,
      });
      if (error) throw error;
      return (data ?? []).map((m) => ({
        id: m.id,
        senderId: m.sender_id,
        senderName: m.sender_name,
        senderAvatar: m.sender_avatar,
        body: m.body,
        createdAt: m.created_at,
      }));
    },
  });
}

export function useContacts(enabled: boolean) {
  return useQuery({
    queryKey: commKeys.contacts(),
    enabled,
    queryFn: async (): Promise<Contact[]> => {
      const { data, error } = await supabase.rpc("messaging_contacts");
      if (error) throw error;
      return (data ?? []).map((c) => ({
        userId: c.user_id,
        fullName: c.full_name,
        avatarUrl: c.avatar_url,
        role: c.role,
        context: c.context,
      }));
    },
  });
}

export function useStartConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      recipients: string[];
      subject: string | null;
      body: string;
    }): Promise<string> => {
      const { data, error } = await supabase.rpc("start_conversation", {
        p_recipients: input.recipients,
        p_subject: input.subject ?? "",
        p_body: input.body,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["comm", "conversations"] }),
  });
}

export interface SendMessageInput {
  conversationId: string;
  body: string;
  /** For the immediate on-screen copy; the server stamps the real sender. */
  senderId: string | null;
  senderName: string | null;
}

/** The message write. Standalone so the desktop app can replay it after a restart. */
export async function sendMessageRequest(input: SendMessageInput): Promise<void> {
  const { error } = await supabase.rpc("send_message", {
    p_conversation: input.conversationId,
    p_body: input.body,
  });
  if (error) throw error;
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: OFFLINE_MUTATIONS.message,
    mutationFn: sendMessageRequest,
    // The message shows in the thread at once (offline included), marked as waiting by its id.
    onMutate: (input) => {
      qc.setQueryData<ChatMessage[]>(commKeys.messages(input.conversationId), (old) => [
        ...(old ?? []),
        {
          id: `pending-${Date.now()}`,
          senderId: input.senderId,
          senderName: input.senderName,
          senderAvatar: null,
          body: input.body,
          createdAt: new Date().toISOString(),
        },
      ]);
    },
    onSettled: (_data, _error, input) => {
      void qc.invalidateQueries({ queryKey: commKeys.messages(input.conversationId) });
      void qc.invalidateQueries({ queryKey: ["comm", "conversations"] });
    },
  });
}

export function useMarkConversationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("mark_conversation_read", { p_conversation: id });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["comm", "conversations"] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

/* ------------------------------------------------------------------ outbox */

export function useCampaigns() {
  return useQuery({
    queryKey: commKeys.campaigns(),
    queryFn: async (): Promise<Campaign[]> => {
      const { data, error } = await supabase
        .from("message_campaigns")
        .select(
          "id, channel, audience_type, audience_label, target, subject, body, queued, skipped, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((c) => ({
        id: c.id,
        channel: c.channel as Channel,
        audienceType: c.audience_type as AudienceType,
        audienceLabel: c.audience_label,
        target: c.target as Campaign["target"],
        subject: c.subject,
        body: c.body,
        queued: c.queued,
        skipped: c.skipped,
        createdAt: c.created_at,
      }));
    },
  });
}

export function useOutbox() {
  return useQuery({
    queryKey: commKeys.outbox(),
    queryFn: async (): Promise<OutboundMessage[]> => {
      const { data, error } = await supabase
        .from("outbound_messages")
        .select(
          "id, campaign_id, source, channel, recipient_name, address, subject, body, status, status_at, error, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []).map((m) => ({
        id: m.id,
        campaignId: m.campaign_id,
        source: m.source as OutboundMessage["source"],
        channel: m.channel as Channel,
        recipientName: m.recipient_name,
        address: m.address,
        subject: m.subject,
        body: m.body,
        status: m.status as OutboundStatus,
        statusAt: m.status_at,
        error: m.error,
        createdAt: m.created_at,
      }));
    },
  });
}

export async function previewCampaign(
  channel: Channel,
  audience: Audience,
  target: "self" | "guardian",
) {
  const { data, error } = await supabase.rpc("preview_campaign", {
    p_channel: channel,
    p_audience_type: audience.type,
    p_audience_id: audience.id as string,
    p_target: target,
  });
  if (error) throw error;
  return data as { recipients: number; reachable: number };
}

export function useQueueCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      channel: Channel;
      audience: Audience;
      target: "self" | "guardian";
      subject: string | null;
      body: string;
    }) => {
      const { data, error } = await supabase.rpc("queue_campaign", {
        p_channel: input.channel,
        p_audience_type: input.audience.type,
        p_audience_id: input.audience.id as string,
        p_target: input.target,
        p_subject: input.subject ?? "",
        p_body: input.body,
      });
      if (error) throw error;
      return data as { campaignId: string; queued: number; skipped: number };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: commKeys.campaigns() });
      void qc.invalidateQueries({ queryKey: commKeys.outbox() });
    },
  });
}

export function useSetOutboundStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ids: string[]; status: OutboundStatus; error?: string | null }) => {
      const { data, error } = await supabase.rpc("set_outbound_status", {
        p_ids: input.ids,
        p_status: input.status,
        p_error: input.error ?? "",
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: commKeys.outbox() }),
  });
}

/* ------------------------------------------------------------------ reminders */

export function useReminderRules() {
  return useQuery({
    queryKey: commKeys.rules(),
    queryFn: async (): Promise<ReminderRule[]> => {
      const { data, error } = await supabase
        .from("reminder_rules")
        .select("kind, enabled, threshold, channels, last_run_at");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        kind: r.kind as ReminderKind,
        enabled: r.enabled,
        threshold: r.threshold,
        channels: (r.channels ?? []) as ReminderChannel[],
        lastRunAt: r.last_run_at,
      }));
    },
  });
}

export function useSaveReminderRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: Pick<ReminderRule, "kind" | "enabled" | "threshold" | "channels">) => {
      const { data, error } = await supabase
        .from("reminder_rules")
        .update({ enabled: r.enabled, threshold: r.threshold, channels: r.channels })
        .eq("kind", r.kind)
        .select("kind");
      if (error) throw error;
      if (!data || data.length === 0) throw NOT_ALLOWED;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: commKeys.rules() });
      void qc.invalidateQueries({ queryKey: commKeys.preview() });
    },
  });
}

export function useReminderPreview() {
  return useQuery({
    queryKey: commKeys.preview(),
    queryFn: async (): Promise<ReminderCandidate[]> => {
      const { data, error } = await supabase.rpc("preview_reminders");
      if (error) throw error;
      return (data ?? []).map((c) => ({
        kind: c.kind as ReminderKind,
        userId: c.user_id,
        fullName: c.full_name,
        subjectKey: c.subject_key,
        params: (c.params ?? {}) as Record<string, string>,
        alreadySent: c.already_sent,
      }));
    },
  });
}

export function useReminderLog() {
  return useQuery({
    queryKey: commKeys.log(),
    queryFn: async (): Promise<(ReminderLogEntry & { fullName: string | null })[]> => {
      const { data, error } = await supabase
        .from("reminder_log")
        .select("id, kind, user_id, channels, params, sent_at, profiles(full_name)")
        .order("sent_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []).map((l) => ({
        id: l.id,
        kind: l.kind as ReminderKind,
        userId: l.user_id,
        channels: (l.channels ?? []) as ReminderChannel[],
        params: (l.params ?? {}) as Record<string, string>,
        sentAt: l.sent_at,
        fullName: (l.profiles as { full_name: string | null } | null)?.full_name ?? null,
      }));
    },
  });
}

export function useRunReminders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase.rpc("run_reminders");
      if (error) throw error;
      return (data ?? {}) as Record<string, number>;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: commKeys.preview() });
      void qc.invalidateQueries({ queryKey: commKeys.log() });
      void qc.invalidateQueries({ queryKey: commKeys.rules() });
      void qc.invalidateQueries({ queryKey: commKeys.outbox() });
    },
  });
}
