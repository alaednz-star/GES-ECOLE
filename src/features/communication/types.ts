/**
 * Communication (ADR-009): the shapes the pages work with, mapped from the database by
 * `queries.ts`.
 */

export const NEWS_CATEGORIES = ["general", "academic", "event", "admin", "urgent"] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

export const AUDIENCE_TYPES = [
  "everyone",
  "students",
  "teachers",
  "staff",
  "group",
  "program",
  "level",
] as const;
export type AudienceType = (typeof AUDIENCE_TYPES)[number];

export interface Audience {
  type: AudienceType;
  /** The group, formation or level, for those audiences; null otherwise. */
  id: string | null;
}

export interface NewsPost {
  id: string;
  title: string;
  summary: string | null;
  /** Only loaded for a single post. */
  body: string | null;
  category: NewsCategory;
  coverPath: string | null;
  audienceType: AudienceType;
  audienceId: string | null;
  audienceLabel: string | null;
  pinned: boolean;
  status: "draft" | "published";
  publishAt: string | null;
  publishedAt: string | null;
  createdBy: string | null;
  authorName: string | null;
  authorAvatar: string | null;
  createdAt: string;
  updatedAt: string;
  likes: number;
  myRead: boolean;
  myLiked: boolean;
  /** Author and administrators only. */
  views: number | null;
  recipients: number | null;
  canEdit: boolean;
}

export interface Participant {
  id: string;
  name: string | null;
  avatar: string | null;
  role: string | null;
}

export interface ConversationSummary {
  id: string;
  subject: string | null;
  createdAt: string;
  lastMessageAt: string;
  lastBody: string | null;
  lastSenderId: string | null;
  lastSenderName: string | null;
  unread: number;
  participants: Participant[];
  isParticipant: boolean;
}

export interface ChatMessage {
  id: string;
  senderId: string | null;
  senderName: string | null;
  senderAvatar: string | null;
  body: string;
  createdAt: string;
}

export interface Contact {
  userId: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: string | null;
  context: string | null;
}

export type Channel = "email" | "sms";
export type OutboundStatus = "pending" | "sent" | "failed" | "cancelled";

export interface Campaign {
  id: string;
  channel: Channel;
  audienceType: AudienceType;
  audienceLabel: string | null;
  target: "self" | "guardian";
  subject: string | null;
  body: string;
  queued: number;
  skipped: number;
  createdAt: string;
}

export interface OutboundMessage {
  id: string;
  campaignId: string | null;
  source: "campaign" | "reminder";
  channel: Channel;
  recipientName: string | null;
  address: string;
  subject: string | null;
  body: string;
  status: OutboundStatus;
  statusAt: string | null;
  error: string | null;
  createdAt: string;
}

export const REMINDER_KINDS = [
  "payment_overdue",
  "payment_due_soon",
  "absences",
  "lesson_log_missing",
] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];
export type ReminderChannel = "in_app" | "email" | "sms";

export interface ReminderRule {
  kind: ReminderKind;
  enabled: boolean;
  threshold: number;
  channels: ReminderChannel[];
  lastRunAt: string | null;
}

export interface ReminderCandidate {
  kind: ReminderKind;
  userId: string;
  fullName: string | null;
  subjectKey: string;
  params: Record<string, string>;
  alreadySent: boolean;
}

export interface ReminderLogEntry {
  id: string;
  kind: ReminderKind;
  userId: string;
  channels: ReminderChannel[];
  params: Record<string, string>;
  sentAt: string;
}
