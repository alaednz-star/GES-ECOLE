-- ==================================================================
-- `notification_kind` gains the two resource values
--
-- TWO STATEMENTS, ITS OWN MIGRATION, for the reason `20260811095000` documents at
-- length: Postgres refuses to let a new enum value be USED in the transaction that
-- added it, and `supabase db push` runs each migration file in one transaction.
--
-- This is not a precaution copied from that migration -- it is load-bearing here, and
-- verified. The next file creates two PARTIAL unique indexes whose predicates read
-- `kind = 'resource_published'`, and an index predicate is evaluated when the index is
-- built. Combining the two files on a clone rewound to pre-Phase-4 shape fails with:
--
--   ERROR:  unsafe use of new value "resource_published" of enum type notification_kind
--
-- (The trigger bodies would have survived a merge, since a function body is only
-- parsed at call time. The indexes are what make the split necessary.)
--
-- Only two, and only these two. A student is told when material becomes available to
-- them; there is no `resource_scheduled` value because a student has no use for
-- "this will appear on Monday", and the scheduling itself is expressed by
-- `notifications.deliver_at` rather than by a kind.
-- ==================================================================

alter type public.notification_kind add value if not exists 'resource_published';
alter type public.notification_kind add value if not exists 'chapter_published';
