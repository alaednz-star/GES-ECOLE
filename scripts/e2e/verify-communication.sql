-- ==================================================================
-- Communication (ADR-009): messaging, news, the e-mail / SMS outbox and reminders, against the
-- LOCAL database, inside ONE transaction that is always ROLLED BACK.
--
--   docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q \
--     < scripts/e2e/verify-communication.sql
-- ==================================================================

\set QUIET on
BEGIN;

CREATE TEMP TABLE results (n serial, name text, ok boolean, detail text);
GRANT ALL ON results TO PUBLIC;
GRANT ALL ON SEQUENCE results_n_seq TO PUBLIC;
CREATE TEMP TABLE ids (name text PRIMARY KEY, id uuid);
GRANT ALL ON ids TO PUBLIC;

CREATE FUNCTION pg_temp.expect(p_name text, p_sql text, p_code text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
    INSERT INTO results (name, ok, detail) VALUES (p_name, false, 'accepted');
  EXCEPTION WHEN others THEN
    INSERT INTO results (name, ok, detail) VALUES (p_name, SQLSTATE = p_code, SQLSTATE || ' ' || SQLERRM);
  END;
END $$;
CREATE FUNCTION pg_temp.touched(p_sql text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE _n integer;
BEGIN
  EXECUTE p_sql; GET DIAGNOSTICS _n = ROW_COUNT; RETURN _n;
END $$;
CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE TEMP TABLE ctx AS
  SELECT (SELECT user_id FROM public.user_roles WHERE role = 'admin' LIMIT 1) AS admin_id,
         (SELECT user_id FROM public.user_roles WHERE role = 'teacher' ORDER BY user_id LIMIT 1) AS teacher_id,
         (SELECT user_id FROM public.user_roles WHERE role = 'teacher' ORDER BY user_id OFFSET 1 LIMIT 1) AS other_teacher,
         gen_random_uuid() AS s_a, gen_random_uuid() AS s_b, gen_random_uuid() AS s_out,
         gen_random_uuid() AS g1, gen_random_uuid() AS g_empty;
GRANT SELECT ON ctx TO PUBLIC;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT u, 'e2e-fixture-com-' || u || '@example.test', json_build_object('full_name', 'e2e-fixture COM ' || n)::jsonb
  FROM ctx, LATERAL (VALUES (s_a, 'A'), (s_b, 'B'), (s_out, 'OUT')) v(u, n);
UPDATE public.profiles SET email = 'student-b@no-login.madrasti.local' WHERE id = (SELECT s_b FROM ctx);
UPDATE public.students SET guardian_phone = '0550000001' WHERE id = (SELECT s_a FROM ctx);
-- G1: the teacher's group, meeting every day, from 30 days ago.
INSERT INTO public.groups (id, name, max_students, teacher_id, status, start_date)
SELECT g1, 'e2e-fixture COM G1', 10, teacher_id, 'active'::public.entity_status, current_date - 30 FROM ctx
UNION ALL SELECT g_empty, 'e2e-fixture COM empty', 10, NULL, 'active', current_date FROM ctx;
INSERT INTO public.group_schedules (group_id, weekday, start_time, end_time)
SELECT g1, d, TIME '08:00', TIME '09:00' FROM ctx, generate_series(0, 6) d;
INSERT INTO public.registrations (student_id, group_id, status, decided_at)
SELECT s_a, g1, 'approved'::public.registration_status, now() FROM ctx
UNION ALL SELECT s_b, g1, 'approved', now() FROM ctx;

/* ------------------------------------------------------------------ messaging */
DO $$
DECLARE
  c ctx;
  _conv uuid;
  _again uuid;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.as_user(c.s_a);
  INSERT INTO results (name, ok, detail) SELECT 'a student''s contacts are their teacher and the administrators, not other students',
    bool_or(user_id = c.teacher_id) AND bool_or(user_id = c.admin_id) AND NOT bool_or(user_id IN (c.s_b, c.other_teacher, c.s_out)),
    count(*)::text FROM public.messaging_contacts();
  _conv := public.start_conversation(ARRAY[c.teacher_id], NULL, 'Bonjour, une question sur le devoir.');
  INSERT INTO ids VALUES ('conv', _conv);
  INSERT INTO results (name, ok, detail) SELECT 'a student writes to their group''s teacher', count(*) = 1, count(*)::text
    FROM public.conversation_messages(_conv);
  PERFORM pg_temp.expect('a student cannot write to another student',
    format($q$SELECT public.start_conversation(ARRAY[%L]::uuid[], NULL, 'salut')$q$, c.s_b), '42501');
  PERFORM pg_temp.expect('a student cannot write to another teacher',
    format($q$SELECT public.start_conversation(ARRAY[%L]::uuid[], NULL, 'salut')$q$, c.other_teacher), '42501');
  PERFORM pg_temp.expect('an empty message is refused',
    format($q$SELECT public.start_conversation(ARRAY[%L]::uuid[], NULL, '   ')$q$, c.teacher_id), '23514');
  PERFORM pg_temp.expect('a message needs a recipient', $q$SELECT public.start_conversation(ARRAY[]::uuid[], NULL, 'x')$q$, '23514');
  PERFORM pg_temp.expect('a client cannot insert a message directly',
    format($q$INSERT INTO public.messages (conversation_id, sender_id, body) VALUES (%L, %L, 'x')$q$, _conv, c.s_a), '42501');

  PERFORM pg_temp.as_user(c.teacher_id);
  INSERT INTO results (name, ok, detail) SELECT 'the teacher sees one unread message and one notice',
    (SELECT unread FROM public.my_conversations() WHERE id = _conv) = 1
    AND (SELECT count(*) FROM public.notifications WHERE user_id = c.teacher_id AND kind = 'message_received'
          AND params ->> 'conversationId' = _conv::text AND read_at IS NULL) = 1, '';
  PERFORM pg_temp.as_user(c.s_a);
  PERFORM public.send_message(_conv, 'Et pour l''exercice 3 ?');
  PERFORM pg_temp.as_user(c.teacher_id);
  INSERT INTO results (name, ok, detail) SELECT 'a second message refreshes the notice instead of adding one',
    (SELECT unread FROM public.my_conversations() WHERE id = _conv) = 2
    AND (SELECT count(*) FROM public.notifications WHERE user_id = c.teacher_id AND kind = 'message_received'
          AND params ->> 'conversationId' = _conv::text AND read_at IS NULL) = 1, '';
  PERFORM public.mark_conversation_read(_conv);
  INSERT INTO results (name, ok, detail) SELECT 'reading the conversation clears the unread count and the notice',
    (SELECT unread FROM public.my_conversations() WHERE id = _conv) = 0
    AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = c.teacher_id AND kind = 'message_received'
                     AND params ->> 'conversationId' = _conv::text AND read_at IS NULL), '';
  _again := public.start_conversation(ARRAY[c.s_a], NULL, 'Voir page 12.');
  INSERT INTO results (name, ok, detail) SELECT 'a one-to-one reply continues the same conversation', _again = _conv, _again::text;
  PERFORM pg_temp.as_user(c.s_a);
  INSERT INTO results (name, ok, detail) SELECT 'the student is notified of the reply', count(*) = 1, count(*)::text
    FROM public.notifications WHERE user_id = c.s_a AND kind = 'message_received' AND read_at IS NULL;

  PERFORM pg_temp.as_user(c.s_b);
  INSERT INTO results (name, ok, detail) SELECT 'another student does not see the conversation',
    (SELECT count(*) FROM public.my_conversations()) = 0 AND (SELECT count(*) FROM public.messages WHERE conversation_id = _conv) = 0, '';
  PERFORM pg_temp.expect('another student cannot read its messages', format($q$SELECT * FROM public.conversation_messages(%L)$q$, _conv), '42501');
  PERFORM pg_temp.expect('another student cannot post in it', format($q$SELECT public.send_message(%L, 'x')$q$, _conv), '42501');
  PERFORM pg_temp.as_user(c.s_out);
  PERFORM public.start_conversation(ARRAY[c.admin_id], 'Inscription', 'Bonjour, comment s''inscrire ?');
  INSERT INTO results (name, ok, detail) SELECT 'anyone can write to the administration', count(*) = 1, count(*)::text FROM public.my_conversations();

  PERFORM pg_temp.as_user(c.admin_id);
  INSERT INTO results (name, ok, detail) SELECT 'an administrator supervises every conversation on demand',
    (SELECT count(*) FROM public.my_conversations(true) WHERE id = _conv) = 1
    AND (SELECT count(*) FROM public.my_conversations(false) WHERE id = _conv) = 0
    AND (SELECT count(*) FROM public.conversation_messages(_conv)) = 3, '';
  PERFORM pg_temp.expect('supervision does not let an administrator post in someone else''s conversation',
    format($q$SELECT public.send_message(%L, 'x')$q$, _conv), '42501');
  RESET role;
END $$;

/* ------------------------------------------------------------------ news */
DO $$
DECLARE
  c ctx;
  _post uuid;
  _sched uuid;
  _n int;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.as_user(c.teacher_id);
  INSERT INTO public.news_posts (title, summary, body, category, audience_type, audience_id)
  VALUES ('e2e-fixture Sortie au musée', 'Samedi matin', 'Rendez-vous à 9 h devant l''établissement.', 'event', 'group', c.g1)
  RETURNING id INTO _post;
  INSERT INTO ids VALUES ('post', _post);
  INSERT INTO results (name, ok, detail) SELECT 'a teacher writes a draft for their group', status = 'draft', status
    FROM public.news_posts WHERE id = _post;
  PERFORM pg_temp.expect('a teacher cannot address everyone',
    $q$INSERT INTO public.news_posts (title, body, audience_type) VALUES ('x', 'y', 'everyone')$q$, '42501');
  PERFORM pg_temp.expect('a teacher cannot pin a post',
    format($q$INSERT INTO public.news_posts (title, body, audience_type, audience_id, pinned) VALUES ('x', 'y', 'group', %L, true)$q$, c.g1), '42501');
  PERFORM pg_temp.expect('a post cannot be inserted as published',
    format($q$INSERT INTO public.news_posts (title, body, audience_type, audience_id, status, publish_at, published_at) VALUES ('x', 'y', 'group', %L, 'published', now(), now())$q$, c.g1), '23514');
  _n := public.publish_news(_post);
  INSERT INTO results (name, ok, detail) SELECT 'publishing reaches the group''s students, not the author', _n = 2, _n::text;
  RESET role;
  INSERT INTO results (name, ok, detail) SELECT 'each reader gets a notice', count(*) = 2, count(*)::text
    FROM public.notifications WHERE kind = 'announcement' AND params ->> 'postId' = _post::text;
  PERFORM pg_temp.as_user(c.teacher_id);
  INSERT INTO results (name, ok, detail) SELECT 'the author sees views out of recipients',
    recipients = 2 AND views = 0 AND can_edit, coalesce(recipients::text, 'null') FROM public.news_feed(_post);
  PERFORM pg_temp.expect('a published post cannot be republished', format($q$SELECT public.publish_news(%L)$q$, _post), '23514');
  PERFORM pg_temp.expect('the audience of a published post cannot change',
    format($q$UPDATE public.news_posts SET audience_type = 'students', audience_id = NULL WHERE id = %L$q$, _post), '23514');
  PERFORM pg_temp.expect('status changes only through publishing',
    format($q$UPDATE public.news_posts SET status = 'draft' WHERE id = %L$q$, _post), '23514');
  UPDATE public.news_posts SET body = 'Rendez-vous à 9 h 30 devant l''établissement.' WHERE id = _post;
  INSERT INTO results (name, ok, detail) SELECT 'the author corrects the published text', body LIKE '%9 h 30%', ''
    FROM public.news_posts WHERE id = _post;

  PERFORM pg_temp.as_user(c.other_teacher);
  PERFORM pg_temp.expect('another teacher cannot post to the group',
    format($q$INSERT INTO public.news_posts (title, body, audience_type, audience_id) VALUES ('x', 'y', 'group', %L)$q$, c.g1), '42501');
  INSERT INTO results (name, ok, detail) SELECT 'another teacher does not see the post', count(*) = 0, count(*)::text FROM public.news_feed();
  INSERT INTO results (name, ok, detail) SELECT 'another teacher cannot edit it',
    pg_temp.touched(format($q$UPDATE public.news_posts SET title = 'x' WHERE id = %L$q$, _post)) = 0, '';

  PERFORM pg_temp.as_user(c.s_a);
  INSERT INTO results (name, ok, detail) SELECT 'a reader sees the post, without the view statistics',
    count(*) = 1 AND bool_and(views IS NULL AND recipients IS NULL AND NOT can_edit), count(*)::text FROM public.news_feed();
  PERFORM public.mark_news_read(_post);
  INSERT INTO results (name, ok, detail) SELECT 'reading it records a view and reads the notice',
    (SELECT read_at IS NOT NULL FROM public.news_recipients WHERE post_id = _post AND user_id = c.s_a)
    AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = c.s_a AND kind = 'announcement'
                     AND params ->> 'postId' = _post::text AND read_at IS NULL), '';
  INSERT INTO results (name, ok, detail) SELECT 'a reader likes, then unlikes',
    public.toggle_news_like(_post) = true AND public.toggle_news_like(_post) = false, '';
  PERFORM public.toggle_news_like(_post);
  PERFORM pg_temp.expect('a student cannot write a post',
    format($q$INSERT INTO public.news_posts (title, body, audience_type, audience_id) VALUES ('x', 'y', 'group', %L)$q$, c.g1), '42501');
  PERFORM pg_temp.expect('a reader cannot delete the post', format($q$SELECT public.delete_news(%L)$q$, _post), '42501');

  PERFORM pg_temp.as_user(c.s_out);
  INSERT INTO results (name, ok, detail) SELECT 'a student outside the audience does not see it', count(*) = 0, count(*)::text FROM public.news_feed();
  PERFORM pg_temp.expect('nor like it', format($q$SELECT public.toggle_news_like(%L)$q$, _post), '42501');

  PERFORM pg_temp.as_user(c.teacher_id);
  INSERT INTO results (name, ok, detail) SELECT 'the author sees one view and one like',
    views = 1 AND likes = 1, views::text || '/' || likes::text FROM public.news_feed(_post);

  PERFORM pg_temp.as_user(c.admin_id);
  INSERT INTO public.news_posts (title, body, audience_type, pinned)
  VALUES ('e2e-fixture Rentrée', 'La rentrée aura lieu lundi.', 'everyone', true) RETURNING id INTO _sched;
  PERFORM public.publish_news(_sched, now() + interval '1 day');
  INSERT INTO results (name, ok, detail) SELECT 'a scheduled post notifies at its publication time',
    bool_and(deliver_at > now()), count(*)::text
    FROM public.notifications WHERE kind = 'announcement' AND params ->> 'postId' = _sched::text;
  INSERT INTO results (name, ok, detail) SELECT 'the administrator sees the scheduled post', count(*) = 1, count(*)::text
    FROM public.news_feed(_sched);
  RESET role;
END $$;

-- Scheduled visibility, empty audience and deletion.
DO $$
DECLARE
  c ctx;
  _empty uuid;
  _post uuid := (SELECT id FROM ids WHERE name = 'post');
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.as_user(c.s_a);
  INSERT INTO results (name, ok, detail) SELECT 'a reader does not see a post scheduled for tomorrow', count(*) = 0, count(*)::text
    FROM public.news_feed() WHERE title = 'e2e-fixture Rentrée';
  PERFORM pg_temp.as_user(c.admin_id);
  INSERT INTO public.news_posts (title, body, audience_type, audience_id)
  VALUES ('e2e-fixture vide', 'personne', 'group', c.g_empty) RETURNING id INTO _empty;
  PERFORM pg_temp.expect('publishing to an audience without members is refused', format($q$SELECT public.publish_news(%L)$q$, _empty), '23514');

  PERFORM pg_temp.as_user(c.teacher_id);
  PERFORM public.delete_news(_post);
  RESET role;
  INSERT INTO results (name, ok, detail) SELECT 'the author deletes the post with its notices',
    NOT EXISTS (SELECT 1 FROM public.news_posts WHERE id = _post)
    AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE kind = 'announcement' AND params ->> 'postId' = _post::text), '';
  RESET role;
END $$;

/* ------------------------------------------------------------------ outbox */
DO $$
DECLARE
  c ctx;
  _r jsonb;
  _ids uuid[];
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.as_user(c.teacher_id);
  PERFORM pg_temp.expect('a teacher cannot queue a campaign',
    format($q$SELECT public.queue_campaign('email', 'group', %L, 'self', 'Info', 'Bonjour')$q$, c.g1), '42501');
  INSERT INTO results (name, ok, detail) SELECT 'a teacher does not read the outbox', count(*) = 0, count(*)::text FROM public.outbound_messages;

  PERFORM pg_temp.as_user(c.admin_id);
  _r := public.preview_campaign('email', 'group', c.g1, 'self');
  INSERT INTO results (name, ok, detail) SELECT 'the preview counts recipients and reachable addresses',
    (_r ->> 'recipients')::int = 3 AND (_r ->> 'reachable')::int = 2, _r::text;
  _r := public.queue_campaign('email', 'group', c.g1, 'self', 'Réunion des parents', 'Bonjour {name}, réunion vendredi.');
  INSERT INTO results (name, ok, detail) SELECT 'an e-mail campaign queues reachable recipients and skips internal addresses',
    (_r ->> 'queued')::int = 2 AND (_r ->> 'skipped')::int = 1, _r::text;
  INSERT INTO results (name, ok, detail) SELECT 'each message carries the recipient''s name, pending',
    bool_and(status = 'pending' AND body LIKE 'Bonjour e2e-fixture COM A,%' OR recipient_id <> c.s_a), count(*)::text
    FROM public.outbound_messages WHERE campaign_id = (_r ->> 'campaignId')::uuid;
  _r := public.queue_campaign('sms', 'group', c.g1, 'guardian', NULL, 'Absence de {name} aujourd''hui.');
  INSERT INTO results (name, ok, detail) SELECT 'an SMS to guardians goes to the guardians'' phones only',
    (_r ->> 'queued')::int = 1 AND (SELECT address FROM public.outbound_messages WHERE campaign_id = (_r ->> 'campaignId')::uuid) = '0550000001', _r::text;
  PERFORM pg_temp.expect('an e-mail needs a subject',
    format($q$SELECT public.queue_campaign('email', 'group', %L, 'self', '', 'Bonjour')$q$, c.g1), '23514');
  PERFORM pg_temp.expect('a client cannot write the outbox directly',
    $q$INSERT INTO public.outbound_messages (channel, address, body) VALUES ('sms', '0550', 'x')$q$, '42501');
  SELECT array_agg(id) INTO _ids FROM public.outbound_messages WHERE channel = 'email' AND campaign_id IS NOT NULL;
  INSERT INTO results (name, ok, detail) SELECT 'an administrator marks messages sent', public.set_outbound_status(_ids, 'sent') = 2, '';
  INSERT INTO results (name, ok, detail) SELECT 'with who and when', bool_and(status_by = c.admin_id AND status_at IS NOT NULL), ''
    FROM public.outbound_messages WHERE id = ANY (_ids);
  RESET role;
END $$;

/* ------------------------------------------------------------------ reminders */
DO $$
DECLARE
  c ctx;
  _r jsonb;
  _reg uuid;
BEGIN
  SELECT * INTO c FROM ctx;
  SELECT id INTO _reg FROM public.registrations WHERE student_id = c.s_a AND group_id = c.g1;
  PERFORM pg_temp.as_user(c.teacher_id);
  INSERT INTO results (name, ok, detail) SELECT 'a teacher does not see the reminder rules', count(*) = 0, count(*)::text FROM public.reminder_rules;
  INSERT INTO results (name, ok, detail) SELECT 'nor change them',
    pg_temp.touched($q$UPDATE public.reminder_rules SET enabled = true$q$) = 0, '';
  PERFORM pg_temp.expect('nor run them', $q$SELECT public.run_reminders()$q$, '42501');

  PERFORM pg_temp.as_user(c.admin_id);
  -- Fees: 4000 due ten days ago, 5000 due in two days, 2000 paid.
  PERFORM public.save_charge(NULL, _reg, 'tuition', NULL, 9000, NULL,
    json_build_array(json_build_object('due_on', current_date - 10, 'amount_dzd', 4000),
                     json_build_object('due_on', current_date + 2, 'amount_dzd', 5000))::jsonb);
  INSERT INTO public.payments (registration_id, amount_dzd, paid_on, method, recorded_by)
  VALUES (_reg, 2000, current_date, 'cash', c.admin_id);
  -- Two absences this month.
  INSERT INTO public.attendance (group_id, student_id, session_date, status, marked_by)
  VALUES (c.g1, c.s_a, current_date - 2, 'absent', c.admin_id), (c.g1, c.s_a, current_date - 1, 'absent', c.admin_id);

  UPDATE public.reminder_rules SET enabled = true, threshold = 3, channels = '{in_app}' WHERE kind IN ('payment_overdue', 'payment_due_soon');
  UPDATE public.reminder_rules SET enabled = true, threshold = 2, channels = '{in_app,sms}' WHERE kind = 'absences';
  UPDATE public.reminder_rules SET enabled = true, threshold = 2, channels = '{in_app}' WHERE kind = 'lesson_log_missing';
  PERFORM pg_temp.expect('a threshold outside its range is refused',
    $q$UPDATE public.reminder_rules SET threshold = 99 WHERE kind = 'absences'$q$, '23514');
  PERFORM pg_temp.expect('an unknown channel is refused',
    $q$UPDATE public.reminder_rules SET channels = '{fax}' WHERE kind = 'absences'$q$, '23514');

  INSERT INTO results (name, ok, detail) SELECT 'overdue: 4000 due, 2000 paid, 2000 overdue', count(*) = 1 AND bool_and(params ->> 'amount' = '2000'), count(*)::text
    FROM public.preview_reminders() WHERE kind = 'payment_overdue' AND user_id = c.s_a;
  INSERT INTO results (name, ok, detail) SELECT 'due soon: the next installment, uncovered', count(*) = 1 AND bool_and(params ->> 'amount' = '5000'), count(*)::text
    FROM public.preview_reminders() WHERE kind = 'payment_due_soon' AND user_id = c.s_a;
  INSERT INTO results (name, ok, detail) SELECT 'absences: two in the month', count(*) = 1 AND bool_and(params ->> 'count' = '2'), count(*)::text
    FROM public.preview_reminders() WHERE kind = 'absences' AND user_id = c.s_a;
  INSERT INTO results (name, ok, detail) SELECT 'lesson log: the teacher with sessions not logged', count(*) = 1 AND bool_and((params ->> 'count')::int >= 2), count(*)::text
    FROM public.preview_reminders() WHERE kind = 'lesson_log_missing' AND user_id = c.teacher_id;

  _r := public.run_reminders();
  INSERT INTO results (name, ok, detail) SELECT 'running sends each reminder', (_r ->> 'absences')::int >= 1 AND (_r ->> 'payment_overdue')::int >= 1, _r::text;
  INSERT INTO results (name, ok, detail) SELECT 'in-app notices of the right kinds',
    EXISTS (SELECT 1 FROM public.notifications WHERE user_id = c.s_a AND kind = 'absence_alert')
    AND EXISTS (SELECT 1 FROM public.notifications WHERE user_id = c.s_a AND kind = 'payment_reminder')
    AND EXISTS (SELECT 1 FROM public.notifications WHERE user_id = c.teacher_id AND kind = 'lesson_log_reminder'), '';
  INSERT INTO results (name, ok, detail) SELECT 'the SMS channel queues the absence for the guardian''s phone',
    count(*) = 1, count(*)::text FROM public.outbound_messages WHERE source = 'reminder' AND recipient_id = c.s_a AND address = '0550000001';
  _r := public.run_reminders();
  INSERT INTO results (name, ok, detail) SELECT 'running again reminds no one twice',
    coalesce((_r ->> 'absences')::int, 0) = 0 AND coalesce((_r ->> 'payment_overdue')::int, 0) = 0, _r::text;
  INSERT INTO results (name, ok, detail) SELECT 'the preview shows them as already sent',
    bool_and(already_sent), count(*)::text FROM public.preview_reminders() WHERE user_id = c.s_a;
  RESET role;
END $$;

/* ------------------------------------------------------------------ anonymous */
DO $$
DECLARE
  _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['conversations', 'conversation_participants', 'messages', 'news_posts', 'news_recipients',
                             'message_campaigns', 'outbound_messages', 'reminder_rules', 'reminder_log'] LOOP
    INSERT INTO results (name, ok, detail) SELECT 'anon has no privilege on ' || _t,
      NOT has_table_privilege('anon', 'public.' || _t, 'SELECT') AND NOT has_table_privilege('anon', 'public.' || _t, 'INSERT'), '';
  END LOOP;
  INSERT INTO results (name, ok, detail) SELECT 'anon cannot call the messaging or news functions',
    NOT has_function_privilege('anon', 'public.start_conversation(uuid[], text, text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.news_feed(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.run_reminders()', 'EXECUTE'), '';
END $$;

\set QUIET off
SELECT n, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS r, name, detail FROM results ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) FILTER (WHERE NOT ok) AS failed FROM results;
ROLLBACK;
