/**
 * Communication (ADR-009): pure rules shared by the pages -- the news layout, audiences,
 * conversation display, campaign validation, SMS length, reminder thresholds. PURE.
 */

import type {
  Audience,
  AudienceType,
  ChatMessage,
  ConversationSummary,
  NewsCategory,
  NewsPost,
  ReminderKind,
} from "./types";

/* ------------------------------------------------------------------ news */

export interface NewsLayout {
  /** The newest pinned post, else the newest post. */
  hero: NewsPost | null;
  /** The next three, beside the hero. */
  side: NewsPost[];
  /** Everything else, newest first. */
  rest: NewsPost[];
}

/** SharePoint's news web part: one large story, three beside it, the rest in a grid. */
export function newsLayout(posts: NewsPost[]): NewsLayout {
  const published = posts
    .filter((p) => p.status === "published")
    .sort((a, b) => (b.publishAt ?? "").localeCompare(a.publishAt ?? ""));
  const hero = published.find((p) => p.pinned) ?? published[0] ?? null;
  const others = published.filter((p) => p !== hero);
  return { hero, side: others.slice(0, 3), rest: others.slice(3) };
}

export function isScheduled(post: NewsPost, now: string): boolean {
  return post.status === "published" && !!post.publishAt && post.publishAt > now;
}

/** Paragraphs of a post body: blank lines separate them; single newlines stay inside. */
export function paragraphs(body: string | null): string[] {
  return (body ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** A summary for cards when the author wrote none: the first paragraph, cut on a word. */
export function excerpt(post: Pick<NewsPost, "summary" | "body">, max = 160): string {
  const text = (post.summary ?? paragraphs(post.body)[0] ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The colour pair of a category (cover fallback and chip). Tailwind classes. */
export const CATEGORY_TONE: Record<NewsCategory, { cover: string; chip: string }> = {
  general: { cover: "from-primary/80 to-primary", chip: "bg-primary-soft text-primary" },
  academic: { cover: "from-sky-500 to-indigo-600", chip: "bg-sky-100 text-sky-800" },
  event: { cover: "from-amber-400 to-orange-600", chip: "bg-amber-100 text-amber-800" },
  admin: { cover: "from-slate-500 to-slate-700", chip: "bg-slate-100 text-slate-700" },
  urgent: { cover: "from-rose-500 to-red-700", chip: "bg-destructive/10 text-destructive" },
};

export interface NewsDraft {
  title: string;
  summary: string;
  body: string;
  audience: Audience;
}

/** i18n keys by field; empty when valid. */
export function newsErrors(
  d: NewsDraft,
): Partial<Record<"title" | "summary" | "body" | "audience", string>> {
  const out: Partial<Record<"title" | "summary" | "body" | "audience", string>> = {};
  const title = d.title.trim();
  if (title.length < 1 || title.length > 160) out.title = "news.error.title";
  if (d.summary.trim().length > 300) out.summary = "news.error.summary";
  const body = d.body.trim();
  if (body.length < 1 || body.length > 20000) out.body = "news.error.body";
  const err = audienceError(d.audience);
  if (err) out.audience = err;
  return out;
}

/* ------------------------------------------------------------------ audiences */

export const AUDIENCES_WITH_ID: readonly AudienceType[] = ["group", "program", "level"];

export function audienceError(a: Audience): string | null {
  if (AUDIENCES_WITH_ID.includes(a.type) && !a.id) return "comm.error.audienceTarget";
  return null;
}

/** Audiences a role may address: a teacher writes to their groups only (database enforced). */
export function allowedAudiences(isAdmin: boolean): AudienceType[] {
  return isAdmin
    ? ["everyone", "students", "teachers", "staff", "group", "program", "level"]
    : ["group"];
}

/* ------------------------------------------------------------------ conversations */

/** The other people of a conversation, for its title, when it has no subject. */
export function conversationTitle(c: ConversationSummary, me: string | undefined): string {
  if (c.subject) return c.subject;
  const others = c.participants.filter((p) => p.id !== me).map((p) => p.name ?? "—");
  return others.length ? others.join(", ") : "—";
}

export function conversationMatches(c: ConversationSummary, me: string | undefined, query: string) {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  return [conversationTitle(c, me), c.lastBody ?? "", ...c.participants.map((p) => p.name ?? "")]
    .join(" ")
    .toLocaleLowerCase()
    .includes(q);
}

export interface MessageDay {
  /** Local date, YYYY-MM-DD. */
  day: string;
  messages: (ChatMessage & { firstOfRun: boolean })[];
}

/**
 * Messages grouped by local day. Within a day, consecutive messages of the same sender within
 * five minutes form a run: only the first shows the name and avatar (Teams-style).
 */
export function groupMessages(
  messages: ChatMessage[],
  dayOf: (iso: string) => string,
): MessageDay[] {
  const out: MessageDay[] = [];
  let prev: ChatMessage | null = null;
  for (const m of [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const day = dayOf(m.createdAt);
    let bucket = out[out.length - 1];
    if (!bucket || bucket.day !== day) {
      bucket = { day, messages: [] };
      out.push(bucket);
      prev = null;
    }
    const firstOfRun =
      !prev ||
      prev.senderId !== m.senderId ||
      new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60_000;
    bucket.messages.push({ ...m, firstOfRun });
    prev = m;
  }
  return out;
}

export function totalUnread(list: ConversationSummary[]): number {
  return list.reduce((s, c) => s + (c.isParticipant ? c.unread : 0), 0);
}

/* ------------------------------------------------------------------ e-mail & SMS */

/** SMS segments: 160 characters in GSM-7, 70 when the text needs Unicode (Arabic, accents beyond GSM). */
export function smsSegments(text: string): {
  segments: number;
  perSegment: number;
  unicode: boolean;
} {
  // GSM-7 basic set, approximately: Latin letters, digits, common punctuation, a few accents.
  const gsm =
    /^[\n\r A-Za-z0-9@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;
  const unicode = !gsm.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const n = text.length;
  if (n === 0) return { segments: 0, perSegment: single, unicode };
  if (n <= single) return { segments: 1, perSegment: single, unicode };
  return { segments: Math.ceil(n / multi), perSegment: multi, unicode };
}

export interface CampaignDraft {
  channel: "email" | "sms";
  audience: Audience;
  subject: string;
  body: string;
}

export function campaignErrors(
  d: CampaignDraft,
): Partial<Record<"subject" | "body" | "audience", string>> {
  const out: Partial<Record<"subject" | "body" | "audience", string>> = {};
  if (d.channel === "email") {
    const s = d.subject.trim();
    if (s.length < 1 || s.length > 160) out.subject = "outbox.error.subject";
  }
  const max = d.channel === "sms" ? 640 : 2000;
  const b = d.body.trim();
  if (b.length < 1 || b.length > max)
    out.body = d.channel === "sms" ? "outbox.error.smsBody" : "outbox.error.emailBody";
  const err = audienceError(d.audience);
  if (err) out.audience = err;
  return out;
}

/** A link that opens the message in the person's own tools (no provider is connected). */
export function deliveryLink(m: {
  channel: "email" | "sms";
  address: string;
  subject: string | null;
  body: string;
}): string {
  if (m.channel === "email") {
    const q = new URLSearchParams();
    if (m.subject) q.set("subject", m.subject);
    q.set("body", m.body);
    return `mailto:${encodeURIComponent(m.address)}?${q.toString().replace(/\+/g, "%20")}`;
  }
  return `sms:${m.address.replace(/[^\d+]/g, "")}?body=${encodeURIComponent(m.body)}`;
}

/** WhatsApp link with an Algerian number normalised to the international form. */
export function whatsappLink(phone: string, body: string): string {
  let digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = `213${digits.slice(1)}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(body)}`;
}

/** CSV of outbox rows (Excel-friendly: BOM, semicolons, quotes doubled). */
export function outboxCsv(
  rows: {
    recipientName: string | null;
    address: string;
    subject: string | null;
    body: string;
    status: string;
  }[],
): string {
  const cell = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Nom", "Adresse", "Objet", "Message", "État"].map(cell).join(";")];
  for (const r of rows)
    lines.push([r.recipientName, r.address, r.subject, r.body, r.status].map(cell).join(";"));
  return `\uFEFF${lines.join("\r\n")}`;
}

/* ------------------------------------------------------------------ reminders */

export const THRESHOLD_RANGE: Record<ReminderKind, { min: number; max: number }> = {
  payment_overdue: { min: 0, max: 60 },
  payment_due_soon: { min: 1, max: 30 },
  absences: { min: 1, max: 20 },
  lesson_log_missing: { min: 1, max: 14 },
};

export function thresholdError(kind: ReminderKind, value: number): string | null {
  const r = THRESHOLD_RANGE[kind];
  return Number.isInteger(value) && value >= r.min && value <= r.max
    ? null
    : "reminders.error.threshold";
}
