-- ==================================================================
-- Communication (ADR-009): the notification kinds of messages and reminders.
--
-- Own migration: a value added to an enum cannot be used in the transaction that adds it (55P04).
--
-- ROLLBACK: enum values cannot be dropped; unused values are harmless.
-- ==================================================================

ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'message_received';
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'payment_reminder';
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'absence_alert';
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'lesson_log_reminder';
