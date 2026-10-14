/**
 * Communication models (ADR-009): news layout and text, audiences, conversations, SMS length,
 * campaign validation, delivery links, CSV, reminder thresholds.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedAudiences,
  audienceError,
  campaignErrors,
  conversationMatches,
  conversationTitle,
  deliveryLink,
  excerpt,
  groupMessages,
  isScheduled,
  newsErrors,
  newsLayout,
  outboxCsv,
  paragraphs,
  smsSegments,
  thresholdError,
  totalUnread,
  whatsappLink,
} from "./comm-model.ts";
import type { ChatMessage, ConversationSummary, NewsPost } from "./types.ts";

const post = (id: string, over: Partial<NewsPost> = {}): NewsPost => ({
  id,
  title: id,
  summary: null,
  body: null,
  category: "general",
  coverPath: null,
  audienceType: "everyone",
  audienceId: null,
  audienceLabel: null,
  pinned: false,
  status: "published",
  publishAt: "2026-10-10T08:00:00Z",
  publishedAt: "2026-10-10T08:00:00Z",
  createdBy: "a",
  authorName: "A",
  authorAvatar: null,
  createdAt: "2026-10-10T08:00:00Z",
  updatedAt: "2026-10-10T08:00:00Z",
  likes: 0,
  myRead: false,
  myLiked: false,
  views: null,
  recipients: null,
  canEdit: false,
  ...over,
});

test("the news layout puts the newest pinned post in the hero, three beside it, the rest below", () => {
  const posts = [
    post("p1", { publishAt: "2026-10-01T00:00:00Z" }),
    post("p2", { publishAt: "2026-10-02T00:00:00Z", pinned: true }),
    post("p3", { publishAt: "2026-10-03T00:00:00Z" }),
    post("p4", { publishAt: "2026-10-04T00:00:00Z" }),
    post("p5", { publishAt: "2026-10-05T00:00:00Z" }),
    post("d", { status: "draft", publishAt: null }),
  ];
  const l = newsLayout(posts);
  assert.equal(l.hero?.id, "p2");
  assert.deepEqual(
    l.side.map((p) => p.id),
    ["p5", "p4", "p3"],
  );
  assert.deepEqual(
    l.rest.map((p) => p.id),
    ["p1"],
  );
});

test("without a pinned post the newest is the hero; an empty feed has none", () => {
  const l = newsLayout([
    post("old", { publishAt: "2026-01-01T00:00:00Z" }),
    post("new", { publishAt: "2026-02-01T00:00:00Z" }),
  ]);
  assert.equal(l.hero?.id, "new");
  assert.deepEqual(newsLayout([]), { hero: null, side: [], rest: [] });
});

test("a post published in the future is scheduled", () => {
  assert.equal(
    isScheduled(post("x", { publishAt: "2026-12-01T00:00:00Z" }), "2026-10-14T00:00:00Z"),
    true,
  );
  assert.equal(isScheduled(post("x"), "2026-10-14T00:00:00Z"), false);
  assert.equal(
    isScheduled(post("x", { status: "draft", publishAt: null }), "2026-10-14T00:00:00Z"),
    false,
  );
});

test("a body splits into paragraphs on blank lines, and an excerpt cuts on a word", () => {
  assert.deepEqual(paragraphs("Un.\nSuite.\n\n  Deux.\r\n\r\nTrois. "), [
    "Un.\nSuite.",
    "Deux.",
    "Trois.",
  ]);
  assert.deepEqual(paragraphs(null), []);
  assert.equal(excerpt({ summary: "Court.", body: "Long" }), "Court.");
  assert.equal(
    excerpt({ summary: null, body: "Premier paragraphe.\n\nSecond." }),
    "Premier paragraphe.",
  );
  const long = excerpt({ summary: null, body: "mot ".repeat(80) }, 40);
  assert.ok(long.endsWith("…") && long.length <= 41, long);
});

test("a news draft needs a title, a body and a complete audience", () => {
  const ok = {
    title: "Titre",
    summary: "",
    body: "Texte",
    audience: { type: "everyone" as const, id: null },
  };
  assert.deepEqual(newsErrors(ok), {});
  assert.equal(newsErrors({ ...ok, title: " " }).title, "news.error.title");
  assert.equal(newsErrors({ ...ok, body: "" }).body, "news.error.body");
  assert.equal(newsErrors({ ...ok, summary: "x".repeat(301) }).summary, "news.error.summary");
  assert.equal(
    newsErrors({ ...ok, audience: { type: "group", id: null } }).audience,
    "comm.error.audienceTarget",
  );
});

test("a teacher addresses only their groups; an administrator every audience", () => {
  assert.deepEqual(allowedAudiences(false), ["group"]);
  assert.equal(allowedAudiences(true).length, 7);
  assert.equal(audienceError({ type: "level", id: "l1" }), null);
  assert.equal(audienceError({ type: "students", id: null }), null);
});

const conv = (over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: "c",
  subject: null,
  createdAt: "2026-10-01T00:00:00Z",
  lastMessageAt: "2026-10-01T00:00:00Z",
  lastBody: "Bonjour",
  lastSenderId: "me",
  lastSenderName: "Moi",
  unread: 2,
  participants: [
    { id: "me", name: "Moi", avatar: null, role: "teacher" },
    { id: "s1", name: "Amina", avatar: null, role: "student" },
    { id: "s2", name: "Bilal", avatar: null, role: "student" },
  ],
  isParticipant: true,
  ...over,
});

test("a conversation without a subject is named after the other people", () => {
  assert.equal(conversationTitle(conv(), "me"), "Amina, Bilal");
  assert.equal(conversationTitle(conv({ subject: "Sortie" }), "me"), "Sortie");
  assert.equal(conversationMatches(conv(), "me", "bil"), true);
  assert.equal(conversationMatches(conv(), "me", "bonj"), true);
  assert.equal(conversationMatches(conv(), "me", "zzz"), false);
  assert.equal(totalUnread([conv(), conv({ unread: 5, isParticipant: false })]), 2);
});

test("messages group by day, and consecutive messages of one sender form a run", () => {
  const m = (id: string, sender: string, at: string): ChatMessage => ({
    id,
    senderId: sender,
    senderName: sender,
    senderAvatar: null,
    body: id,
    createdAt: at,
  });
  const days = groupMessages(
    [
      m("1", "a", "2026-10-13T10:00:00Z"),
      m("2", "a", "2026-10-13T10:02:00Z"),
      m("3", "b", "2026-10-13T10:03:00Z"),
      m("4", "b", "2026-10-13T10:20:00Z"),
      m("5", "b", "2026-10-14T09:00:00Z"),
    ],
    (iso) => iso.slice(0, 10),
  );
  assert.deepEqual(
    days.map((d) => d.day),
    ["2026-10-13", "2026-10-14"],
  );
  assert.deepEqual(
    days[0]?.messages.map((x) => x.firstOfRun),
    [true, false, true, true],
  );
  assert.equal(days[1]?.messages[0]?.firstOfRun, true);
});

test("SMS length: 160 characters in plain Latin, 70 when the text needs Unicode", () => {
  assert.deepEqual(smsSegments(""), { segments: 0, perSegment: 160, unicode: false });
  assert.deepEqual(smsSegments("Bonjour, cours annulé demain."), {
    segments: 1,
    perSegment: 160,
    unicode: false,
  });
  assert.equal(smsSegments("a".repeat(161)).segments, 2);
  assert.deepEqual(smsSegments("مرحبا"), { segments: 1, perSegment: 70, unicode: true });
  assert.equal(smsSegments("م".repeat(71)).segments, 2);
});

test("a campaign: an e-mail needs a subject; an SMS is limited to 640 characters", () => {
  const ok = {
    channel: "email" as const,
    audience: { type: "students" as const, id: null },
    subject: "Info",
    body: "Bonjour",
  };
  assert.deepEqual(campaignErrors(ok), {});
  assert.equal(campaignErrors({ ...ok, subject: "" }).subject, "outbox.error.subject");
  assert.equal(
    campaignErrors({ ...ok, channel: "sms", subject: "", body: "x".repeat(641) }).body,
    "outbox.error.smsBody",
  );
  assert.deepEqual(campaignErrors({ ...ok, channel: "sms", subject: "" }), {});
});

test("delivery links open the message in the person's own tools", () => {
  assert.equal(
    deliveryLink({
      channel: "email",
      address: "a@b.dz",
      subject: "Réunion",
      body: "Bonjour à tous",
    }),
    "mailto:a%40b.dz?subject=R%C3%A9union&body=Bonjour%20%C3%A0%20tous",
  );
  assert.equal(
    deliveryLink({ channel: "sms", address: "0550 12 34 56", subject: null, body: "Salut" }),
    "sms:0550123456?body=Salut",
  );
  assert.equal(whatsappLink("0550 12 34 56", "Salut"), "https://wa.me/213550123456?text=Salut");
  assert.equal(whatsappLink("+213550123456", "x"), "https://wa.me/213550123456?text=x");
});

test("the outbox CSV opens in Excel: BOM, semicolons, quotes doubled", () => {
  const csv = outboxCsv([
    {
      recipientName: 'Amina "A"',
      address: "a@b.dz",
      subject: null,
      body: "x;y",
      status: "pending",
    },
  ]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"Amina ""A""";"a@b.dz";"";"x;y";"pending"'));
});

test("reminder thresholds stay in their range", () => {
  assert.equal(thresholdError("payment_overdue", 0), null);
  assert.equal(thresholdError("payment_due_soon", 0), "reminders.error.threshold");
  assert.equal(thresholdError("absences", 21), "reminders.error.threshold");
  assert.equal(thresholdError("lesson_log_missing", 2.5), "reminders.error.threshold");
});
