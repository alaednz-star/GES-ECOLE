-- ==================================================================
-- Communication (ADR-009): SharePoint-style news, conversations, the e-mail / SMS outbox,
-- reminders.
--
-- Every table has RLS; clients never write conversations, messages, recipients, the outbox or
-- the reminder log directly -- SECURITY DEFINER functions do, after checking the caller.
-- News drafts are written through RLS (author or admin).
--
-- ROLLBACK
--   SELECT cron.unschedule('gestion-ecole-reminders') -- only if pg_cron scheduled it
--   DROP TABLE public.reminder_log, public.reminder_rules, public.outbound_messages,
--     public.message_campaigns, public.news_recipients, public.news_posts, public.messages,
--     public.conversation_participants, public.conversations;
--   DROP FUNCTION the functions created below; DROP INDEX public.notifications_message_unread;
--   DELETE FROM storage.objects WHERE bucket_id = 'news'; DELETE FROM storage.buckets WHERE id = 'news';
-- ==================================================================

-- ------------------------------------------------------------------ shared helpers

-- The account's main role, for display (admin > teacher > student).
CREATE OR REPLACE FUNCTION private.primary_role(p_user uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT role::text FROM public.user_roles WHERE user_id = p_user
   ORDER BY CASE role::text WHEN 'admin' THEN 1 WHEN 'teacher' THEN 2 ELSE 3 END
   LIMIT 1;
$$;

-- Validates an audience; raises 23514 with a readable sentence.
CREATE OR REPLACE FUNCTION private.check_audience(p_type text, p_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_type NOT IN ('everyone', 'students', 'teachers', 'staff', 'group', 'program', 'level') THEN
    RAISE EXCEPTION 'Unknown audience.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_type IN ('group', 'program', 'level') AND p_id IS NULL THEN
    RAISE EXCEPTION 'Choose the group, formation or level of the audience.' USING ERRCODE = 'check_violation';
  END IF;
  IF (p_type = 'group' AND NOT EXISTS (SELECT 1 FROM public.groups WHERE id = p_id))
     OR (p_type = 'program' AND NOT EXISTS (SELECT 1 FROM public.programs WHERE id = p_id))
     OR (p_type = 'level' AND NOT EXISTS (SELECT 1 FROM public.levels WHERE id = p_id)) THEN
    RAISE EXCEPTION 'This audience no longer exists.' USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.audience_label(p_type text, p_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE p_type
    WHEN 'group'   THEN (SELECT name FROM public.groups WHERE id = p_id)
    WHEN 'program' THEN (SELECT name FROM public.programs WHERE id = p_id)
    WHEN 'level'   THEN (SELECT name FROM public.levels WHERE id = p_id)
  END;
$$;

-- The accounts an audience designates, now. Approved enrollments only.
CREATE OR REPLACE FUNCTION private.audience_members(p_type text, p_id uuid)
RETURNS TABLE (user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT u FROM (
    SELECT ur.user_id AS u FROM public.user_roles ur WHERE p_type = 'everyone'
    UNION ALL SELECT ur.user_id FROM public.user_roles ur WHERE p_type = 'students' AND ur.role = 'student'
    UNION ALL SELECT ur.user_id FROM public.user_roles ur WHERE p_type = 'teachers' AND ur.role = 'teacher'
    UNION ALL SELECT ur.user_id FROM public.user_roles ur WHERE p_type = 'staff' AND ur.role IN ('admin', 'teacher')
    UNION ALL SELECT r.student_id FROM public.registrations r
               WHERE p_type = 'group' AND r.group_id = p_id AND r.status = 'approved'
    UNION ALL SELECT g.teacher_id FROM public.groups g WHERE p_type = 'group' AND g.id = p_id
    UNION ALL SELECT r.student_id FROM public.registrations r JOIN public.groups g ON g.id = r.group_id
               WHERE p_type = 'program' AND g.program_id = p_id AND r.status = 'approved'
    UNION ALL SELECT g.teacher_id FROM public.groups g WHERE p_type = 'program' AND g.program_id = p_id
    UNION ALL SELECT r.student_id FROM public.registrations r JOIN public.groups g ON g.id = r.group_id
               WHERE p_type = 'level' AND g.level_id = p_id AND r.status = 'approved'
  ) s WHERE u IS NOT NULL;
$$;

-- Who may write to whom (ADR-009 §2).
CREATE OR REPLACE FUNCTION private.can_message(p_sender uuid, p_recipient uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p_sender IS NOT NULL AND p_recipient IS NOT NULL AND p_sender <> p_recipient
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_recipient)
     AND (
          EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_sender AND role = 'admin')
       OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_recipient AND role = 'admin')
       OR EXISTS (SELECT 1 FROM public.groups g
                    JOIN public.registrations r ON r.group_id = g.id AND r.status = 'approved'
                   WHERE (g.teacher_id = p_sender AND r.student_id = p_recipient)
                      OR (g.teacher_id = p_recipient AND r.student_id = p_sender))
     );
$$;

REVOKE ALL ON FUNCTION private.primary_role(uuid), private.check_audience(text, uuid),
  private.audience_label(text, uuid), private.audience_members(text, uuid),
  private.can_message(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.primary_role(uuid), private.can_message(uuid, uuid) TO authenticated;

-- ==================================================================
-- 1. Messagerie
-- ==================================================================
CREATE TABLE IF NOT EXISTS public.conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject         text CHECK (subject IS NULL OR length(btrim(subject)) BETWEEN 1 AND 120),
  created_by      uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.conversation_participants (
  conversation_id uuid NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  last_read_at    timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conversation_participants_user_idx ON public.conversation_participants (user_id);
CREATE TABLE IF NOT EXISTS public.messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  sender_id       uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  body            text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON public.messages (conversation_id, created_at);

COMMENT ON TABLE public.conversations IS
  'Messagerie (ADR-009): participants read; administrators can read every conversation '
  '(safeguarding). Written only through start_conversation / send_message.';

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "conversations read" ON public.conversations;
CREATE POLICY "conversations read" ON public.conversations FOR SELECT TO authenticated
  USING (private.is_admin() OR EXISTS (SELECT 1 FROM public.conversation_participants p
                                        WHERE p.conversation_id = id AND p.user_id = auth.uid()));
DROP POLICY IF EXISTS "participants read" ON public.conversation_participants;
CREATE POLICY "participants read" ON public.conversation_participants FOR SELECT TO authenticated
  USING (private.is_admin() OR user_id = auth.uid());
DROP POLICY IF EXISTS "messages read" ON public.messages;
CREATE POLICY "messages read" ON public.messages FOR SELECT TO authenticated
  USING (private.is_admin() OR EXISTS (SELECT 1 FROM public.conversation_participants p
                                        WHERE p.conversation_id = messages.conversation_id AND p.user_id = auth.uid()));
REVOKE ALL ON public.conversations, public.conversation_participants, public.messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conversations, public.conversation_participants, public.messages TO authenticated;

-- One unread "new message" notice per conversation and recipient, refreshed by later messages.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_message_unread
  ON public.notifications (user_id, (params ->> 'conversationId'))
  WHERE kind = 'message_received' AND read_at IS NULL;

CREATE OR REPLACE FUNCTION public.on_message_inserted()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  UPDATE public.conversation_participants SET last_read_at = NEW.created_at
   WHERE conversation_id = NEW.conversation_id AND user_id = NEW.sender_id;
  INSERT INTO public.notifications (user_id, kind, params)
  SELECT cp.user_id, 'message_received',
         jsonb_build_object('conversationId', NEW.conversation_id::text,
                            'sender', coalesce((SELECT full_name FROM public.profiles WHERE id = NEW.sender_id), ''),
                            'preview', left(regexp_replace(NEW.body, '\s+', ' ', 'g'), 80))
    FROM public.conversation_participants cp
   WHERE cp.conversation_id = NEW.conversation_id AND cp.user_id IS DISTINCT FROM NEW.sender_id
  ON CONFLICT (user_id, (params ->> 'conversationId')) WHERE kind = 'message_received' AND read_at IS NULL
  DO UPDATE SET params = EXCLUDED.params, created_at = now(), deliver_at = now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.on_message_inserted() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS t_messages_after_insert ON public.messages;
CREATE TRIGGER t_messages_after_insert AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.on_message_inserted();

-- The people the caller may write to, with the reason (a group's name, or the role).
CREATE OR REPLACE FUNCTION public.messaging_contacts()
RETURNS TABLE (user_id uuid, full_name text, avatar_url text, role text, context text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id, p.full_name, p.avatar_url, private.primary_role(p.id),
         (SELECT string_agg(DISTINCT g.name, ', ')
            FROM public.groups g JOIN public.registrations r ON r.group_id = g.id AND r.status = 'approved'
           WHERE (g.teacher_id = auth.uid() AND r.student_id = p.id)
              OR (g.teacher_id = p.id AND r.student_id = auth.uid()))
    FROM public.profiles p
   WHERE auth.uid() IS NOT NULL AND private.can_message(auth.uid(), p.id)
   ORDER BY p.full_name
   LIMIT 3000;
$$;

CREATE OR REPLACE FUNCTION public.start_conversation(p_recipients uuid[], p_subject text, p_body text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _me      uuid := auth.uid();
  _rcpt    uuid[];
  _r       uuid;
  _subject text := nullif(btrim(coalesce(p_subject, '')), '');
  _conv    uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501'; END IF;
  IF p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Write a message (4000 characters at most).' USING ERRCODE = 'check_violation';
  END IF;
  IF _subject IS NOT NULL AND length(_subject) > 120 THEN
    RAISE EXCEPTION 'The subject is limited to 120 characters.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT array_agg(DISTINCT x) INTO _rcpt FROM unnest(coalesce(p_recipients, '{}')) x WHERE x IS DISTINCT FROM _me;
  IF coalesce(cardinality(_rcpt), 0) = 0 THEN
    RAISE EXCEPTION 'Choose at least one recipient.' USING ERRCODE = 'check_violation';
  END IF;
  IF cardinality(_rcpt) > 50 THEN
    RAISE EXCEPTION 'At most 50 recipients; use a news post for a wider audience.' USING ERRCODE = 'check_violation';
  END IF;
  FOREACH _r IN ARRAY _rcpt LOOP
    IF NOT private.can_message(_me, _r) THEN
      RAISE EXCEPTION 'You cannot write to one of these people.' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- A one-to-one message without a subject continues the existing conversation.
  IF cardinality(_rcpt) = 1 AND _subject IS NULL THEN
    SELECT c.id INTO _conv FROM public.conversations c
     WHERE c.subject IS NULL
       AND EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = c.id AND user_id = _me)
       AND EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = c.id AND user_id = _rcpt[1])
       AND (SELECT count(*) FROM public.conversation_participants WHERE conversation_id = c.id) = 2
     ORDER BY c.last_message_at DESC LIMIT 1;
  END IF;

  IF _conv IS NULL THEN
    INSERT INTO public.conversations (subject, created_by) VALUES (_subject, _me) RETURNING id INTO _conv;
    INSERT INTO public.conversation_participants (conversation_id, user_id)
    SELECT _conv, u FROM unnest(array_append(_rcpt, _me)) u;
  END IF;
  INSERT INTO public.messages (conversation_id, sender_id, body) VALUES (_conv, _me, btrim(p_body));
  RETURN _conv;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_message(p_conversation uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.conversation_participants
                  WHERE conversation_id = p_conversation AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'You are not part of this conversation.' USING ERRCODE = '42501';
  END IF;
  IF p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Write a message (4000 characters at most).' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.messages (conversation_id, sender_id, body)
  VALUES (p_conversation, auth.uid(), btrim(p_body)) RETURNING id INTO _id;
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.conversation_participants SET last_read_at = now()
   WHERE conversation_id = p_conversation AND user_id = auth.uid();
  UPDATE public.notifications SET read_at = now()
   WHERE user_id = auth.uid() AND kind = 'message_received' AND read_at IS NULL
     AND params ->> 'conversationId' = p_conversation::text;
END;
$$;

-- The caller's conversations (administrators: every conversation when p_all).
CREATE OR REPLACE FUNCTION public.my_conversations(p_all boolean DEFAULT false)
RETURNS TABLE (id uuid, subject text, created_at timestamptz, last_message_at timestamptz,
               last_body text, last_sender_id uuid, last_sender_name text, unread integer,
               participants jsonb, is_participant boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.id, c.subject, c.created_at, c.last_message_at, lm.body, lm.sender_id, lp.full_name,
         CASE WHEN me.user_id IS NULL THEN 0 ELSE
           (SELECT count(*) FROM public.messages m
             WHERE m.conversation_id = c.id AND m.sender_id IS DISTINCT FROM auth.uid()
               AND m.created_at > coalesce(me.last_read_at, '-infinity'::timestamptz))::int END,
         (SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'avatar', p.avatar_url,
                                              'role', private.primary_role(p.id)) ORDER BY p.full_name)
            FROM public.conversation_participants cp JOIN public.profiles p ON p.id = cp.user_id
           WHERE cp.conversation_id = c.id),
         me.user_id IS NOT NULL
    FROM public.conversations c
    LEFT JOIN public.conversation_participants me ON me.conversation_id = c.id AND me.user_id = auth.uid()
    LEFT JOIN LATERAL (SELECT m.body, m.sender_id FROM public.messages m
                        WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) lm ON true
    LEFT JOIN public.profiles lp ON lp.id = lm.sender_id
   WHERE auth.uid() IS NOT NULL AND (me.user_id IS NOT NULL OR (p_all AND private.is_admin()))
   ORDER BY c.last_message_at DESC
   LIMIT 300;
$$;

CREATE OR REPLACE FUNCTION public.conversation_messages(p_conversation uuid)
RETURNS TABLE (id uuid, sender_id uuid, sender_name text, sender_avatar text, body text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (private.is_admin() OR EXISTS (SELECT 1 FROM public.conversation_participants
                                          WHERE conversation_id = p_conversation AND user_id = auth.uid())) THEN
    RAISE EXCEPTION 'You are not part of this conversation.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT m.id, m.sender_id, p.full_name, p.avatar_url, m.body, m.created_at
      FROM public.messages m LEFT JOIN public.profiles p ON p.id = m.sender_id
     WHERE m.conversation_id = p_conversation
     ORDER BY m.created_at
     LIMIT 1000;
END;
$$;

-- ==================================================================
-- 2. Actualités (SharePoint-style news)
-- ==================================================================
CREATE TABLE IF NOT EXISTS public.news_posts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  summary        text CHECK (summary IS NULL OR length(summary) <= 300),
  body           text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 20000),
  category       text NOT NULL DEFAULT 'general'
                 CHECK (category IN ('general', 'academic', 'event', 'admin', 'urgent')),
  cover_path     text CHECK (cover_path IS NULL OR cover_path LIKE 'posts/%'),
  audience_type  text NOT NULL DEFAULT 'everyone'
                 CHECK (audience_type IN ('everyone', 'students', 'teachers', 'staff', 'group', 'program', 'level')),
  audience_id    uuid,
  audience_label text,
  pinned         boolean NOT NULL DEFAULT false,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  publish_at     timestamptz,
  published_at   timestamptz,
  created_by     uuid DEFAULT auth.uid() REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT news_posts_audience_id CHECK ((audience_type IN ('group', 'program', 'level')) = (audience_id IS NOT NULL)),
  CONSTRAINT news_posts_published CHECK (status = 'draft' OR (publish_at IS NOT NULL AND published_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS news_posts_feed_idx ON public.news_posts (status, publish_at DESC);
CREATE TABLE IF NOT EXISTS public.news_recipients (
  post_id  uuid NOT NULL REFERENCES public.news_posts (id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  read_at  timestamptz,
  liked_at timestamptz,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS news_recipients_user_idx ON public.news_recipients (user_id);
COMMENT ON TABLE public.news_posts IS
  'Actualités (ADR-009): drafts written by their author (administrators: any audience; teachers: '
  'their groups) through RLS; published by publish_news, which fans out news_recipients.';

-- Status and dates change only through publish_news; the audience is fixed once published.
CREATE OR REPLACE FUNCTION public.guard_news_post()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF coalesce(current_setting('app.news_publishing', true), '') <> 'on' THEN
    IF TG_OP = 'INSERT' AND (NEW.status <> 'draft' OR NEW.publish_at IS NOT NULL OR NEW.published_at IS NOT NULL) THEN
      RAISE EXCEPTION 'A post starts as a draft; publish it to send it.' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.status IS DISTINCT FROM OLD.status
        OR NEW.publish_at IS DISTINCT FROM OLD.publish_at OR NEW.published_at IS DISTINCT FROM OLD.published_at) THEN
      RAISE EXCEPTION 'Publish a post with its publish action.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'published'
     AND (NEW.audience_type IS DISTINCT FROM OLD.audience_type OR NEW.audience_id IS DISTINCT FROM OLD.audience_id) THEN
    RAISE EXCEPTION 'The audience of a published post cannot change.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'A post keeps its author.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_news_post() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS t_news_posts_guard ON public.news_posts;
CREATE TRIGGER t_news_posts_guard BEFORE INSERT OR UPDATE ON public.news_posts
  FOR EACH ROW EXECUTE FUNCTION public.guard_news_post();
DROP TRIGGER IF EXISTS t_news_posts_updated ON public.news_posts;
CREATE TRIGGER t_news_posts_updated BEFORE UPDATE ON public.news_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The two policies below refer to each other's table; these helpers read past RLS so the
-- policies do not recurse.
CREATE OR REPLACE FUNCTION private.is_news_recipient(p_post uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.news_recipients WHERE post_id = p_post AND user_id = auth.uid());
$$;
CREATE OR REPLACE FUNCTION private.is_news_author(p_post uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.news_posts WHERE id = p_post AND created_by = auth.uid());
$$;
REVOKE ALL ON FUNCTION private.is_news_recipient(uuid), private.is_news_author(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_news_recipient(uuid), private.is_news_author(uuid) TO authenticated;

ALTER TABLE public.news_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "news read" ON public.news_posts;
CREATE POLICY "news read" ON public.news_posts FOR SELECT TO authenticated
  USING (private.is_admin() OR created_by = auth.uid()
         OR (status = 'published' AND publish_at <= now() AND private.is_news_recipient(id)));
DROP POLICY IF EXISTS "news write draft" ON public.news_posts;
CREATE POLICY "news write draft" ON public.news_posts FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid()
              AND (private.is_admin()
                   OR (audience_type = 'group' AND can_manage_group(audience_id) AND NOT pinned)));
DROP POLICY IF EXISTS "news edit" ON public.news_posts;
CREATE POLICY "news edit" ON public.news_posts FOR UPDATE TO authenticated
  USING (private.is_admin() OR created_by = auth.uid())
  WITH CHECK (private.is_admin()
              OR (created_by = auth.uid() AND audience_type = 'group' AND can_manage_group(audience_id) AND NOT pinned));
DROP POLICY IF EXISTS "news recipients read" ON public.news_recipients;
CREATE POLICY "news recipients read" ON public.news_recipients FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.is_admin() OR private.is_news_author(post_id));
REVOKE ALL ON public.news_posts, public.news_recipients FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.news_posts TO authenticated;
GRANT SELECT ON public.news_recipients TO authenticated;

CREATE OR REPLACE FUNCTION public.publish_news(p_post uuid, p_publish_at timestamptz DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _p     public.news_posts;
  _at    timestamptz := coalesce(p_publish_at, now());
  _n     integer;
BEGIN
  SELECT * INTO _p FROM public.news_posts WHERE id = p_post FOR UPDATE;
  IF NOT FOUND OR NOT (private.is_admin() OR _p.created_by = auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  IF _p.status <> 'draft' THEN
    RAISE EXCEPTION 'This post is already published.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT private.is_admin() AND NOT (_p.audience_type = 'group' AND can_manage_group(_p.audience_id)) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  IF _at > now() + interval '1 year' THEN
    RAISE EXCEPTION 'Schedule within the next year.' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM private.check_audience(_p.audience_type, _p.audience_id);

  INSERT INTO public.news_recipients (post_id, user_id)
  SELECT p_post, m.user_id FROM private.audience_members(_p.audience_type, _p.audience_id) m
   WHERE m.user_id IS DISTINCT FROM _p.created_by
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n = 0 THEN
    RAISE EXCEPTION 'This audience has no member yet.' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('app.news_publishing', 'on', true);
  UPDATE public.news_posts
     SET status = 'published', publish_at = _at, published_at = now(),
         audience_label = private.audience_label(audience_type, audience_id)
   WHERE id = p_post;
  PERFORM set_config('app.news_publishing', 'off', true);

  INSERT INTO public.notifications (user_id, kind, params, deliver_at)
  SELECT r.user_id, 'announcement', jsonb_build_object('message', _p.title, 'postId', p_post::text), _at
    FROM public.news_recipients r WHERE r.post_id = p_post;
  RETURN _n;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_news(p_post uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _p public.news_posts;
BEGIN
  SELECT * INTO _p FROM public.news_posts WHERE id = p_post;
  IF NOT FOUND OR NOT (private.is_admin() OR _p.created_by = auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.notifications WHERE kind = 'announcement' AND params ->> 'postId' = p_post::text;
  DELETE FROM public.news_posts WHERE id = p_post;
  RETURN _p.cover_path;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_news_read(p_post uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.news_recipients SET read_at = coalesce(read_at, now())
   WHERE post_id = p_post AND user_id = auth.uid()
     AND EXISTS (SELECT 1 FROM public.news_posts p WHERE p.id = p_post AND p.status = 'published' AND p.publish_at <= now());
  UPDATE public.notifications SET read_at = now()
   WHERE user_id = auth.uid() AND kind = 'announcement' AND read_at IS NULL AND params ->> 'postId' = p_post::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.toggle_news_like(p_post uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _liked boolean;
BEGIN
  UPDATE public.news_recipients
     SET liked_at = CASE WHEN liked_at IS NULL THEN now() END, read_at = coalesce(read_at, now())
   WHERE post_id = p_post AND user_id = auth.uid()
     AND EXISTS (SELECT 1 FROM public.news_posts p WHERE p.id = p_post AND p.status = 'published' AND p.publish_at <= now())
  RETURNING liked_at IS NOT NULL INTO _liked;
  IF _liked IS NULL THEN
    RAISE EXCEPTION 'Only the readers of a post can like it.' USING ERRCODE = '42501';
  END IF;
  RETURN _liked;
END;
$$;

-- What the caller may read (or wrote), with likes, the caller's own read/like and -- for the
-- author and administrators -- views out of recipients. p_post: one post, with its body.
CREATE OR REPLACE FUNCTION public.news_feed(p_post uuid DEFAULT NULL)
RETURNS TABLE (id uuid, title text, summary text, body text, category text, cover_path text,
               audience_type text, audience_id uuid, audience_label text, pinned boolean, status text,
               publish_at timestamptz, published_at timestamptz, created_by uuid, author_name text,
               author_avatar text, created_at timestamptz, updated_at timestamptz, likes integer,
               my_read boolean, my_liked boolean, views integer, recipients integer, can_edit boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH me AS (SELECT auth.uid() AS uid, private.is_admin() AS admin)
  SELECT n.id, n.title, n.summary, CASE WHEN p_post IS NOT NULL THEN n.body END, n.category, n.cover_path,
         n.audience_type, n.audience_id, n.audience_label, n.pinned, n.status, n.publish_at, n.published_at,
         n.created_by, a.full_name, a.avatar_url, n.created_at, n.updated_at,
         (SELECT count(*) FROM public.news_recipients r WHERE r.post_id = n.id AND r.liked_at IS NOT NULL)::int,
         mine.read_at IS NOT NULL, mine.liked_at IS NOT NULL,
         CASE WHEN me.admin OR n.created_by = me.uid THEN
           (SELECT count(*) FROM public.news_recipients r WHERE r.post_id = n.id AND r.read_at IS NOT NULL)::int END,
         CASE WHEN me.admin OR n.created_by = me.uid THEN
           (SELECT count(*) FROM public.news_recipients r WHERE r.post_id = n.id)::int END,
         me.admin OR n.created_by = me.uid
    FROM public.news_posts n
    CROSS JOIN me
    LEFT JOIN public.profiles a ON a.id = n.created_by
    LEFT JOIN public.news_recipients mine ON mine.post_id = n.id AND mine.user_id = me.uid
   WHERE me.uid IS NOT NULL
     AND (p_post IS NULL OR n.id = p_post)
     AND (me.admin OR n.created_by = me.uid
          OR (n.status = 'published' AND n.publish_at <= now() AND mine.user_id IS NOT NULL))
   ORDER BY (n.status = 'draft') DESC, n.pinned DESC, coalesce(n.publish_at, n.created_at) DESC
   LIMIT 300;
$$;

-- Cover images: public read, staff write inside posts/.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('news', 'news', true, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
DROP POLICY IF EXISTS "news covers read" ON storage.objects;
CREATE POLICY "news covers read" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'news');
DROP POLICY IF EXISTS "news covers insert" ON storage.objects;
CREATE POLICY "news covers insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'news' AND private.is_staff() AND split_part(name, '/', 1) = 'posts');
DROP POLICY IF EXISTS "news covers delete" ON storage.objects;
CREATE POLICY "news covers delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'news' AND private.is_staff() AND split_part(name, '/', 1) = 'posts');

-- ==================================================================
-- 3. E-mail & SMS outbox
-- ==================================================================
CREATE TABLE IF NOT EXISTS public.message_campaigns (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel        text NOT NULL CHECK (channel IN ('email', 'sms')),
  audience_type  text NOT NULL,
  audience_id    uuid,
  audience_label text,
  target         text NOT NULL DEFAULT 'self' CHECK (target IN ('self', 'guardian')),
  subject        text CHECK (subject IS NULL OR length(subject) <= 160),
  body           text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  queued         integer NOT NULL DEFAULT 0,
  skipped        integer NOT NULL DEFAULT 0,
  created_by     uuid DEFAULT auth.uid() REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.outbound_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    uuid REFERENCES public.message_campaigns (id) ON DELETE CASCADE,
  source         text NOT NULL DEFAULT 'campaign' CHECK (source IN ('campaign', 'reminder')),
  channel        text NOT NULL CHECK (channel IN ('email', 'sms')),
  recipient_id   uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  recipient_name text,
  address        text NOT NULL CHECK (length(btrim(address)) BETWEEN 3 AND 200),
  subject        text,
  body           text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  status_at      timestamptz,
  status_by      uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  error          text CHECK (error IS NULL OR length(error) <= 300),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbound_messages_status_idx ON public.outbound_messages (status, created_at DESC);
COMMENT ON TABLE public.outbound_messages IS
  'E-mail / SMS outbox (ADR-009): one row per recipient, address snapshot. No provider is '
  'connected: rows stay pending until an administrator marks them, or a future worker sends them.';

ALTER TABLE public.message_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbound_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "campaigns admin read" ON public.message_campaigns;
CREATE POLICY "campaigns admin read" ON public.message_campaigns FOR SELECT TO authenticated USING (private.is_admin());
DROP POLICY IF EXISTS "outbox admin read" ON public.outbound_messages;
CREATE POLICY "outbox admin read" ON public.outbound_messages FOR SELECT TO authenticated USING (private.is_admin());
REVOKE ALL ON public.message_campaigns, public.outbound_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.message_campaigns, public.outbound_messages TO authenticated;

-- One recipient's address on a channel, or NULL.
CREATE OR REPLACE FUNCTION private.contact_address(p_user uuid, p_channel text, p_target text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_channel = 'email' THEN
      (SELECT nullif(btrim(email), '') FROM public.profiles
        WHERE id = p_user AND email LIKE '%_@_%' AND email NOT ILIKE '%@no-login.madrasti.local')
    WHEN p_channel = 'sms' AND p_target = 'guardian' THEN
      (SELECT nullif(btrim(guardian_phone), '') FROM public.students WHERE id = p_user)
    WHEN p_channel = 'sms' THEN
      (SELECT nullif(btrim(phone), '') FROM public.profiles WHERE id = p_user)
  END;
$$;
REVOKE ALL ON FUNCTION private.contact_address(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.preview_campaign(p_channel text, p_audience_type text, p_audience_id uuid, p_target text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _total int; _reach int;
BEGIN
  IF NOT private.is_admin() THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  PERFORM private.check_audience(p_audience_type, p_audience_id);
  SELECT count(*), count(private.contact_address(m.user_id, p_channel, p_target))
    INTO _total, _reach
    FROM private.audience_members(p_audience_type, p_audience_id) m;
  RETURN jsonb_build_object('recipients', _total, 'reachable', _reach);
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_campaign(p_channel text, p_audience_type text, p_audience_id uuid,
                                                 p_target text, p_subject text, p_body text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _id uuid; _queued int; _total int;
BEGIN
  IF NOT private.is_admin() THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  IF p_channel NOT IN ('email', 'sms') OR p_target NOT IN ('self', 'guardian') THEN
    RAISE EXCEPTION 'Unknown channel or target.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_channel = 'email' AND (p_subject IS NULL OR length(btrim(p_subject)) NOT BETWEEN 1 AND 160) THEN
    RAISE EXCEPTION 'An e-mail needs a subject (160 characters at most).' USING ERRCODE = 'check_violation';
  END IF;
  IF p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND (CASE WHEN p_channel = 'sms' THEN 640 ELSE 2000 END) THEN
    RAISE EXCEPTION 'Write the message (SMS: 640 characters, e-mail: 2000 at most).' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM private.check_audience(p_audience_type, p_audience_id);

  INSERT INTO public.message_campaigns (channel, audience_type, audience_id, audience_label, target, subject, body)
  VALUES (p_channel, p_audience_type, p_audience_id, private.audience_label(p_audience_type, p_audience_id),
          p_target, CASE WHEN p_channel = 'email' THEN btrim(p_subject) END, btrim(p_body))
  RETURNING id INTO _id;

  SELECT count(*) INTO _total FROM private.audience_members(p_audience_type, p_audience_id);
  INSERT INTO public.outbound_messages (campaign_id, channel, recipient_id, recipient_name, address, subject, body)
  SELECT _id, p_channel, m.user_id, p.full_name, a.addr,
         CASE WHEN p_channel = 'email' THEN btrim(p_subject) END,
         replace(btrim(p_body), '{name}', coalesce(p.full_name, ''))
    FROM private.audience_members(p_audience_type, p_audience_id) m
    JOIN public.profiles p ON p.id = m.user_id
    CROSS JOIN LATERAL (SELECT private.contact_address(m.user_id, p_channel, p_target) AS addr) a
   WHERE a.addr IS NOT NULL;
  GET DIAGNOSTICS _queued = ROW_COUNT;
  UPDATE public.message_campaigns SET queued = _queued, skipped = _total - _queued WHERE id = _id;
  RETURN jsonb_build_object('campaignId', _id, 'queued', _queued, 'skipped', _total - _queued);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_outbound_status(p_ids uuid[], p_status text, p_error text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _n int;
BEGIN
  IF NOT private.is_admin() THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('sent', 'failed', 'cancelled', 'pending') THEN
    RAISE EXCEPTION 'Unknown status.' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.outbound_messages
     SET status = p_status, status_at = now(), status_by = auth.uid(),
         error = CASE WHEN p_status = 'failed' THEN left(nullif(btrim(coalesce(p_error, '')), ''), 300) END
   WHERE id = ANY (p_ids);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

-- ==================================================================
-- 4. Rappels & alertes
-- ==================================================================
CREATE TABLE IF NOT EXISTS public.reminder_rules (
  kind        text PRIMARY KEY CHECK (kind IN ('payment_overdue', 'payment_due_soon', 'absences', 'lesson_log_missing')),
  enabled     boolean NOT NULL DEFAULT false,
  threshold   integer NOT NULL,
  channels    text[] NOT NULL DEFAULT '{in_app}',
  last_run_at timestamptz,
  updated_by  uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reminder_rules_channels CHECK (cardinality(channels) >= 1 AND channels <@ ARRAY['in_app', 'email', 'sms']),
  CONSTRAINT reminder_rules_threshold CHECK (
       (kind = 'payment_overdue'    AND threshold BETWEEN 0 AND 60)
    OR (kind = 'payment_due_soon'   AND threshold BETWEEN 1 AND 30)
    OR (kind = 'absences'           AND threshold BETWEEN 1 AND 20)
    OR (kind = 'lesson_log_missing' AND threshold BETWEEN 1 AND 14))
);
INSERT INTO public.reminder_rules (kind, threshold) VALUES
  ('payment_overdue', 3), ('payment_due_soon', 3), ('absences', 3), ('lesson_log_missing', 2)
ON CONFLICT (kind) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.reminder_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL,
  user_id     uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  subject_key text NOT NULL,
  channels    text[] NOT NULL,
  params      jsonb NOT NULL DEFAULT '{}',
  sent_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reminder_log_once UNIQUE (kind, user_id, subject_key)
);
CREATE INDEX IF NOT EXISTS reminder_log_sent_idx ON public.reminder_log (sent_at DESC);

CREATE OR REPLACE FUNCTION public.stamp_reminder_rule()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at := now(); NEW.updated_by := auth.uid(); RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.stamp_reminder_rule() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS t_reminder_rules_stamp ON public.reminder_rules;
CREATE TRIGGER t_reminder_rules_stamp BEFORE UPDATE OF enabled, threshold, channels ON public.reminder_rules
  FOR EACH ROW EXECUTE FUNCTION public.stamp_reminder_rule();

ALTER TABLE public.reminder_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reminder rules admin" ON public.reminder_rules;
CREATE POLICY "reminder rules admin" ON public.reminder_rules FOR SELECT TO authenticated USING (private.is_admin());
DROP POLICY IF EXISTS "reminder rules admin update" ON public.reminder_rules;
CREATE POLICY "reminder rules admin update" ON public.reminder_rules FOR UPDATE TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());
DROP POLICY IF EXISTS "reminder log admin" ON public.reminder_log;
CREATE POLICY "reminder log admin" ON public.reminder_log FOR SELECT TO authenticated USING (private.is_admin());
REVOKE ALL ON public.reminder_rules, public.reminder_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reminder_rules, public.reminder_log TO authenticated;
GRANT UPDATE (enabled, threshold, channels) ON public.reminder_rules TO authenticated;

-- Who each enabled rule designates now (ADR-009 §4). Payments follow the app's rule: payments and
-- active discounts cover installments oldest due date first.
CREATE OR REPLACE FUNCTION private.reminder_candidates()
RETURNS TABLE (kind text, user_id uuid, subject_key text, params jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH rules AS (SELECT * FROM public.reminder_rules WHERE enabled),
  regs AS (
    SELECT r.id, r.student_id, r.group_id, g.name AS group_name,
           coalesce((SELECT sum(p.amount_dzd) FROM public.payments p WHERE p.registration_id = r.id), 0)
         + coalesce((SELECT sum(d.amount_dzd) FROM public.charge_discounts d JOIN public.charges c ON c.id = d.charge_id
                      WHERE c.registration_id = r.id AND c.status = 'active' AND d.status = 'active'), 0) AS covered
      FROM public.registrations r JOIN public.groups g ON g.id = r.group_id
     WHERE r.status = 'approved'
  ),
  inst AS (
    SELECT rg.id AS reg, rg.student_id, rg.group_name, rg.covered, i.id AS inst_id, i.due_on, i.amount_dzd,
           sum(i.amount_dzd) OVER (PARTITION BY rg.id ORDER BY i.due_on, c.id, i.position) AS cum
      FROM regs rg
      JOIN public.charges c ON c.registration_id = rg.id AND c.status = 'active'
      JOIN public.charge_installments i ON i.charge_id = c.id
  )
  -- Overdue after the grace days.
  SELECT 'payment_overdue', o.student_id, o.reg::text || ':' || o.last_due::text,
         jsonb_build_object('amount', (o.due_sum - o.covered)::text, 'date', o.last_due::text, 'group', o.group_name)
    FROM (SELECT inst.reg, inst.student_id, inst.group_name, inst.covered,
                 sum(inst.amount_dzd) AS due_sum, max(inst.due_on) AS last_due
            FROM inst, rules
           WHERE rules.kind = 'payment_overdue' AND inst.due_on < current_date - rules.threshold
           GROUP BY inst.reg, inst.student_id, inst.group_name, inst.covered) o
   WHERE o.due_sum - o.covered > 0
  UNION ALL
  -- An installment due within the next days and not covered yet.
  SELECT 'payment_due_soon', inst.student_id, inst.inst_id::text,
         jsonb_build_object('amount', least(inst.amount_dzd, inst.cum - inst.covered)::text,
                            'date', inst.due_on::text, 'group', inst.group_name)
    FROM inst, rules
   WHERE rules.kind = 'payment_due_soon'
     AND inst.due_on BETWEEN current_date AND current_date + rules.threshold
     AND inst.cum - inst.covered > 0
  UNION ALL
  -- Absences in the last 30 days, in one group.
  SELECT 'absences', rg.student_id, rg.id::text || ':' || to_char(current_date, 'IYYY-IW'),
         jsonb_build_object('count', a.n::text, 'group', rg.group_name)
    FROM regs rg, rules,
         LATERAL (SELECT count(*) AS n FROM public.attendance at
                   WHERE at.group_id = rg.group_id AND at.student_id = rg.student_id
                     AND at.status = 'absent' AND at.session_date >= current_date - 30) a
   WHERE rules.kind = 'absences' AND a.n >= rules.threshold
  UNION ALL
  -- Sessions held in the last 14 days without a lesson-log entry, per teacher.
  SELECT 'lesson_log_missing', t.teacher_id, t.teacher_id::text || ':' || to_char(current_date, 'IYYY-IW'),
         jsonb_build_object('count', t.n::text, 'groups', t.groups)
    FROM (SELECT g.teacher_id, count(*) AS n, string_agg(DISTINCT g.name, ', ') AS groups
            FROM public.groups g
            CROSS JOIN LATERAL generate_series(current_date - 13, current_date, interval '1 day') d(day)
           WHERE g.status = 'active' AND g.teacher_id IS NOT NULL
             AND d.day::date >= g.start_date AND (g.end_date IS NULL OR d.day::date <= g.end_date)
             AND EXISTS (SELECT 1 FROM public.group_schedules s
                          WHERE s.group_id = g.id AND s.weekday = extract(dow FROM d.day)::int)
             AND NOT EXISTS (SELECT 1 FROM public.lesson_entries le
                              WHERE le.group_id = g.id AND le.session_date = d.day::date)
           GROUP BY g.teacher_id) t, rules
   WHERE rules.kind = 'lesson_log_missing' AND t.n >= rules.threshold;
$$;
REVOKE ALL ON FUNCTION private.reminder_candidates() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.preview_reminders()
RETURNS TABLE (kind text, user_id uuid, full_name text, subject_key text, params jsonb, already_sent boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT private.is_admin() THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT c.kind, c.user_id, p.full_name, c.subject_key, c.params,
           EXISTS (SELECT 1 FROM public.reminder_log l
                    WHERE l.kind = c.kind AND l.user_id = c.user_id AND l.subject_key = c.subject_key)
      FROM private.reminder_candidates() c LEFT JOIN public.profiles p ON p.id = c.user_id
     ORDER BY c.kind, p.full_name
     LIMIT 2000;
END;
$$;

-- The e-mail / SMS wording of a reminder (French, like the documents).
CREATE OR REPLACE FUNCTION private.reminder_text(p_kind text, p_params jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_kind
    WHEN 'payment_overdue' THEN format('Rappel : un montant de %s DA reste à régler pour %s (échéance du %s).',
                                       p_params ->> 'amount', p_params ->> 'group', p_params ->> 'date')
    WHEN 'payment_due_soon' THEN format('Rappel : %s DA sont à régler pour %s avant le %s.',
                                        p_params ->> 'amount', p_params ->> 'group', p_params ->> 'date')
    WHEN 'absences' THEN format('Information : %s absences en 30 jours dans le groupe %s.',
                                p_params ->> 'count', p_params ->> 'group')
    ELSE format('Rappel : %s séances sans cahier de textes (%s).', p_params ->> 'count', p_params ->> 'groups')
  END;
$$;

-- Sends what preview_reminders lists and was not sent yet. Administrators, or the database's own
-- scheduled job (no signed-in user).
CREATE OR REPLACE FUNCTION public.run_reminders()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _c      record;
  _rule   public.reminder_rules;
  _counts jsonb := '{}'::jsonb;
  _addr   text;
  _target text;
BEGIN
  IF NOT (private.is_admin() OR (auth.uid() IS NULL AND session_user IN ('postgres', 'supabase_admin'))) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  FOR _c IN SELECT * FROM private.reminder_candidates() LOOP
    SELECT * INTO _rule FROM public.reminder_rules WHERE kind = _c.kind;
    INSERT INTO public.reminder_log (kind, user_id, subject_key, channels, params)
    VALUES (_c.kind, _c.user_id, _c.subject_key, _rule.channels, _c.params)
    ON CONFLICT ON CONSTRAINT reminder_log_once DO NOTHING;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF 'in_app' = ANY (_rule.channels) THEN
      INSERT INTO public.notifications (user_id, kind, params)
      VALUES (_c.user_id,
              (CASE _c.kind WHEN 'absences' THEN 'absence_alert'
                            WHEN 'lesson_log_missing' THEN 'lesson_log_reminder'
                            ELSE 'payment_reminder' END)::public.notification_kind,
              _c.params);
    END IF;
    FOREACH _target IN ARRAY ARRAY['email', 'sms'] LOOP
      IF _target = ANY (_rule.channels) THEN
        -- Students' SMS go to the guardian's phone when there is one.
        _addr := CASE WHEN _target = 'sms'
                      THEN coalesce(private.contact_address(_c.user_id, 'sms', 'guardian'),
                                    private.contact_address(_c.user_id, 'sms', 'self'))
                      ELSE private.contact_address(_c.user_id, 'email', 'self') END;
        IF _addr IS NOT NULL THEN
          INSERT INTO public.outbound_messages (source, channel, recipient_id, recipient_name, address, subject, body)
          SELECT 'reminder', _target, _c.user_id, p.full_name, _addr,
                 CASE WHEN _target = 'email' THEN 'Rappel' END, private.reminder_text(_c.kind, _c.params)
            FROM public.profiles p WHERE p.id = _c.user_id;
        END IF;
      END IF;
    END LOOP;
    _counts := jsonb_set(_counts, ARRAY[_c.kind], to_jsonb(coalesce((_counts ->> _c.kind)::int, 0) + 1));
  END LOOP;
  UPDATE public.reminder_rules SET last_run_at = now() WHERE enabled;
  RETURN _counts;
END;
$$;

-- Daily run at 07:00 UTC, only where pg_cron is installed (enabling it is a deployment step).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    EXECUTE $q$SELECT cron.schedule('gestion-ecole-reminders', '0 7 * * *', 'SELECT public.run_reminders()')$q$;
  END IF;
END $$;

-- ------------------------------------------------------------------ grants on functions
REVOKE ALL ON FUNCTION
  public.messaging_contacts(), public.start_conversation(uuid[], text, text), public.send_message(uuid, text),
  public.mark_conversation_read(uuid), public.my_conversations(boolean), public.conversation_messages(uuid),
  public.publish_news(uuid, timestamptz), public.delete_news(uuid), public.mark_news_read(uuid),
  public.toggle_news_like(uuid), public.news_feed(uuid),
  public.preview_campaign(text, text, uuid, text), public.queue_campaign(text, text, uuid, text, text, text),
  public.set_outbound_status(uuid[], text, text), public.preview_reminders(), public.run_reminders()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.messaging_contacts(), public.start_conversation(uuid[], text, text), public.send_message(uuid, text),
  public.mark_conversation_read(uuid), public.my_conversations(boolean), public.conversation_messages(uuid),
  public.publish_news(uuid, timestamptz), public.delete_news(uuid), public.mark_news_read(uuid),
  public.toggle_news_like(uuid), public.news_feed(uuid),
  public.preview_campaign(text, text, uuid, text), public.queue_campaign(text, text, uuid, text, text, text),
  public.set_outbound_status(uuid[], text, text), public.preview_reminders(), public.run_reminders()
  TO authenticated;

-- ------------------------------------------------------------------ post-conditions
DO $$
DECLARE
  _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['conversations', 'conversation_participants', 'messages', 'news_posts', 'news_recipients',
                             'message_campaigns', 'outbound_messages', 'reminder_rules', 'reminder_log'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || _t)::regclass) THEN
      RAISE EXCEPTION 'SECURITY: RLS is not enabled on %', _t;
    END IF;
    IF has_table_privilege('anon', 'public.' || _t, 'SELECT') THEN
      RAISE EXCEPTION 'SECURITY: anon can read %', _t;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.messages', 'INSERT')
     OR has_table_privilege('authenticated', 'public.outbound_messages', 'INSERT') THEN
    RAISE EXCEPTION 'SECURITY: clients can write messages or the outbox directly';
  END IF;
  RAISE NOTICE 'Communication installed.';
END $$;
