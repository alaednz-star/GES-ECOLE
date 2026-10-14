# ADR-009 — Communication: News, Messaging, E-mail & SMS, Reminders

**Status:** Accepted — implementation 2026-10-14 (local first; production only after its own
migration push).
**Date:** 2026-10-14
**Builds on:**
- the in-app notifications (`notifications`, the bell: a kind plus params, rendered in the
  reader's language);
- fees and installments (ADR-005, ADR-006);
- attendance;
- the lesson log (ADR-008).

## Context

The « Communication » section had three roadmap entries: Messagerie, E-mail & SMS, and Rappels &
alertes. The product owner asked for it to work « like Microsoft SharePoint », meaning an
institutional communication site:
- a news home with a featured story and cards;
- articles with a cover, a category and an audience;
- pinned items;
- views and likes;
- conversations next to it (the Teams half of that pairing).

No e-mail or SMS provider is configured. Choosing one is a product decision outside this code,
and nothing here may pretend to send what it cannot.

## Decisions

### 1. Actualités — SharePoint-style news (`/dashboard/news`, every role)

**Tables:**
- `news_posts`, with these fields:
  - title, summary, body (paragraphs);
  - category: `general`, `academic`, `event`, `admin` or `urgent`;
  - an optional cover image (bucket `news`, public read);
  - audience, pinned, status (`draft` or `published`) and `publish_at` (scheduling);
  - author and timestamps.
- `news_recipients(post, user, read_at, liked_at)`, one row per reader, created when the post is
  published.

**Audiences:**

| Audience | Who receives the post |
|---|---|
| everyone | every account with a role |
| students | every student |
| teachers | every teacher |
| staff | every administrator and teacher |
| a group | its students (approved enrollments) and its teacher |
| a formation | the students and teachers of its groups |
| a level | the students of groups at that level |

The audience is resolved once, at publication, and frozen with the post (`audience_label` keeps its
name).

**Authors:**
- administrators publish to any audience and can pin a post;
- a teacher publishes only to one of their groups.

**Writing and publishing:**
- Drafts are written through RLS: the author, or administrators.
- `publish_news` resolves the audience, creates the recipients and leaves one `announcement` notice
  per reader. The notice is delivered at `publish_at`, so a scheduled post notifies on time.
- After publication the content stays editable, but the audience is fixed (trigger).
- `delete_news` also removes the post's notices.

**Reading:**
- Readers see a published post once `publish_at` has passed; the author and administrators see
  every post.
- `mark_news_read` and `toggle_news_like` record views and likes.
- `news_feed()` returns what the caller may read, with the like count, the caller's own read and
  like, and views out of recipients (shown to the author and administrators only).

**Layout:** the page has a hero (the newest pinned post), three side cards, then a grid filtered by
category. An article page shows the cover banner, the body, likes and views.

### 2. Messagerie — conversations (`/dashboard/messaging`, every role)

**Tables:** `conversations(subject, created_by, last_message_at)`,
`conversation_participants(conversation, user, last_read_at)` and
`messages(conversation, sender, body ≤ 4000)`.

**Who may write to whom** (`private.can_message(sender, recipient)`):
- an administrator, to and from anyone;
- a teacher, to administrators and to the students of their groups;
- a student, to administrators and to the teachers of their groups.

**Writes:**
- Only through SECURITY DEFINER functions: `start_conversation`, `send_message` (participants
  only) and `mark_conversation_read`.
- Clients have no write privilege on these tables.
- A one-to-one message without a subject reuses the existing conversation between the same two
  people.

**Reads** go through `messaging_contacts()`, `my_conversations()` and
`conversation_messages(conversation)`.

**Administrator access:** administrators can read every conversation (a supervision switch). This
is a safeguarding choice: teachers write to minors. The screen tells every user so.

**Notification:** a new message leaves ONE unread `message_received` notice per conversation and
recipient. It is refreshed by later messages, not duplicated.

### 3. E-mail & SMS — an outbox, honest about delivery (`/dashboard/email-sms`, administrators)

**Tables:**
- `message_campaigns`: channel, audience, target (the person, or the student's guardian for SMS),
  subject, body, counts;
- `outbound_messages`: one row per recipient, with the address snapshot, the body with `{name}`
  filled in, and a status.

**Statuses:** `pending`, then `sent`, `failed` or `cancelled`.

**Addresses:**
- E-mail: the profile e-mail. Internal `@no-login.madrasti.local` identities are skipped.
- SMS: the profile phone, or `students.guardian_phone`.
- Recipients without an address are counted, never queued.

**No provider is connected**, so messages stay `pending`. The administrator can:
- send them from their own tools, using per-row `mailto:`, `sms:` and WhatsApp links, or a CSV
  export;
- then mark them sent, failed or cancelled (`set_outbound_status`).

A future server worker with a provider key only has to read `pending` rows.

### 4. Rappels & alertes — rules, preview, run, log (`/dashboard/reminders`, administrators)

**Rules:** `reminder_rules`, with one row per kind, each enabled or not, a threshold and channels
(`in_app`, `email`, `sms`):

| Kind | Who is reminded | Threshold | Sent once per |
|---|---|---|---|
| `payment_overdue` | the student | days of grace after the due date | newest overdue due date |
| `payment_due_soon` | the student | days before the due date | installment |
| `absences` | the student | absences in the last 30 days, in one group | enrollment and week |
| `lesson_log_missing` | the teacher | sessions without an entry in the last 14 days | teacher and week |

**Running:**
- `preview_reminders()` lists who would be reminded now.
- `run_reminders()` sends in-app notices and queues e-mail and SMS in the outbox (§3).
- `reminder_log` (unique key) makes a run idempotent.

**Scheduling:** the migration schedules a daily run only if `pg_cron` is installed. Enabling it is a
deployment step.

## Security

- RLS is on every new table, and `anon` has no privilege on any of them. The `news` bucket is
  public read; writes are limited to staff, inside the `posts/` folder.
- Every function pins `search_path` and checks its caller.
- Tests: `verify-communication.sql` covers administrators, the group's teacher, another teacher,
  an enrolled student, another student and anonymous visitors.

## Not built

Real e-mail or SMS delivery (needs a provider and its secret); comments under news; attachments
in messages; message editing and deletion (messages are a record); parent accounts.
