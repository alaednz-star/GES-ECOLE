
-- ============ ROLES ============
CREATE TYPE public.app_role AS ENUM ('admin','teacher','student');
CREATE TYPE public.entity_status AS ENUM ('active','inactive');
CREATE TYPE public.registration_status AS ENUM ('pending','approved','rejected');
CREATE TYPE public.attendance_status AS ENUM ('present','absent','late','excused');
CREATE TYPE public.level_stage AS ENUM ('primary','middle','high');

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

-- profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  email text,
  phone text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'admin');
$$;

CREATE POLICY "profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid() OR public.is_admin()) WITH CHECK (id = auth.uid() OR public.is_admin());
CREATE POLICY "profiles admin insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid() OR public.is_admin());
CREATE POLICY "profiles admin delete" ON public.profiles FOR DELETE TO authenticated USING (public.is_admin());

CREATE POLICY "roles readable" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());

-- signup trigger
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE requested text; final_role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name',''), NEW.email, NEW.raw_user_meta_data->>'phone');

  requested := COALESCE(NEW.raw_user_meta_data->>'role','student');
  IF requested = 'admin' AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    final_role := 'admin';
  ELSIF requested = 'teacher' THEN final_role := 'teacher';
  ELSIF requested = 'admin' THEN final_role := 'student';
  ELSE final_role := 'student';
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, final_role);

  IF final_role = 'teacher' THEN
    INSERT INTO public.teachers (id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  ELSIF final_role = 'student' THEN
    INSERT INTO public.students (id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

-- ============ DOMAIN ============
CREATE TABLE public.levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  stage public.level_stage NOT NULL,
  position int NOT NULL DEFAULT 0,
  status public.entity_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.levels TO authenticated;
GRANT ALL ON public.levels TO service_role;
ALTER TABLE public.levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "levels read" ON public.levels FOR SELECT TO authenticated USING (true);
CREATE POLICY "levels admin write" ON public.levels FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE public.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#0F766E',
  description text,
  status public.entity_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subjects TO authenticated;
GRANT ALL ON public.subjects TO service_role;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subjects read" ON public.subjects FOR SELECT TO authenticated USING (true);
CREATE POLICY "subjects admin write" ON public.subjects FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE public.teachers (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  experience_years int NOT NULL DEFAULT 0,
  bio text,
  status public.entity_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teachers TO authenticated;
GRANT ALL ON public.teachers TO service_role;
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "teachers read" ON public.teachers FOR SELECT TO authenticated USING (true);
CREATE POLICY "teachers self update" ON public.teachers FOR UPDATE TO authenticated USING (id = auth.uid() OR public.is_admin()) WITH CHECK (id = auth.uid() OR public.is_admin());
CREATE POLICY "teachers admin insert" ON public.teachers FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR id = auth.uid());
CREATE POLICY "teachers admin delete" ON public.teachers FOR DELETE TO authenticated USING (public.is_admin());

CREATE TABLE public.teacher_subjects (
  teacher_id uuid NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (teacher_id, subject_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teacher_subjects TO authenticated;
GRANT ALL ON public.teacher_subjects TO service_role;
ALTER TABLE public.teacher_subjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "teacher_subjects read" ON public.teacher_subjects FOR SELECT TO authenticated USING (true);
CREATE POLICY "teacher_subjects admin write" ON public.teacher_subjects FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE public.students (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  level_id uuid REFERENCES public.levels(id) ON DELETE SET NULL,
  guardian_phone text,
  status public.entity_status NOT NULL DEFAULT 'active',
  registered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.students TO authenticated;
GRANT ALL ON public.students TO service_role;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
CREATE POLICY "students read" ON public.students FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin() OR public.has_role(auth.uid(),'teacher'));
CREATE POLICY "students self update" ON public.students FOR UPDATE TO authenticated USING (id = auth.uid() OR public.is_admin()) WITH CHECK (id = auth.uid() OR public.is_admin());
CREATE POLICY "students insert" ON public.students FOR INSERT TO authenticated WITH CHECK (id = auth.uid() OR public.is_admin());
CREATE POLICY "students admin delete" ON public.students FOR DELETE TO authenticated USING (public.is_admin());

CREATE TABLE public.groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  teacher_id uuid REFERENCES public.teachers(id) ON DELETE SET NULL,
  level_id uuid REFERENCES public.levels(id) ON DELETE SET NULL,
  max_students int NOT NULL DEFAULT 20,
  price_dzd int NOT NULL DEFAULT 0,
  status public.entity_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.groups TO authenticated;
GRANT ALL ON public.groups TO service_role;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "groups read" ON public.groups FOR SELECT TO authenticated USING (true);
CREATE POLICY "groups admin write" ON public.groups FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE public.group_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  weekday int NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  room text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_schedules TO authenticated;
GRANT ALL ON public.group_schedules TO service_role;
ALTER TABLE public.group_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "schedules read" ON public.group_schedules FOR SELECT TO authenticated USING (true);
CREATE POLICY "schedules admin write" ON public.group_schedules FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE public.registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  status public.registration_status NOT NULL DEFAULT 'pending',
  note text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, group_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.registrations TO authenticated;
GRANT ALL ON public.registrations TO service_role;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "registrations read" ON public.registrations FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR public.is_admin()
    OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = group_id AND g.teacher_id = auth.uid()));
CREATE POLICY "registrations student insert" ON public.registrations FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid() OR public.is_admin());
CREATE POLICY "registrations admin update" ON public.registrations FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "registrations delete" ON public.registrations FOR DELETE TO authenticated USING (public.is_admin() OR student_id = auth.uid());

CREATE TABLE public.attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  session_date date NOT NULL DEFAULT CURRENT_DATE,
  status public.attendance_status NOT NULL DEFAULT 'present',
  marked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, student_id, session_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance TO authenticated;
GRANT ALL ON public.attendance TO service_role;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance read" ON public.attendance FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR public.is_admin()
    OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = group_id AND g.teacher_id = auth.uid()));
CREATE POLICY "attendance write" ON public.attendance FOR ALL TO authenticated
  USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = group_id AND g.teacher_id = auth.uid()))
  WITH CHECK (public.is_admin() OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = group_id AND g.teacher_id = auth.uid()));

CREATE TABLE public.center_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  school_name text NOT NULL DEFAULT 'Madrasti',
  logo_url text,
  default_language text NOT NULL DEFAULT 'fr',
  academic_year text NOT NULL DEFAULT '2025/2026',
  phone text,
  address text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.center_settings TO authenticated;
GRANT ALL ON public.center_settings TO service_role;
ALTER TABLE public.center_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings read" ON public.center_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings admin write" ON public.center_settings FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

INSERT INTO public.center_settings (id) VALUES (true);

-- triggers
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
CREATE TRIGGER t_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t_levels_updated BEFORE UPDATE ON public.levels FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t_subjects_updated BEFORE UPDATE ON public.subjects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t_teachers_updated BEFORE UPDATE ON public.teachers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t_students_updated BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t_groups_updated BEFORE UPDATE ON public.groups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t_registrations_updated BEFORE UPDATE ON public.registrations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t_attendance_updated BEFORE UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- seed levels
INSERT INTO public.levels (name, stage, position) VALUES
 ('1ère année primaire','primary',1),('2ème année primaire','primary',2),('3ème année primaire','primary',3),
 ('4ème année primaire','primary',4),('5ème année primaire','primary',5),
 ('1ère année moyenne','middle',6),('2ème année moyenne','middle',7),('3ème année moyenne','middle',8),('4ème année moyenne','middle',9),
 ('1ère année secondaire','high',10),('2ème année secondaire','high',11),('3ème année secondaire','high',12);

INSERT INTO public.subjects (name, color, description) VALUES
 ('Mathématiques','#0F766E','Algèbre, analyse et géométrie'),
 ('Physique','#14B8A6','Mécanique, électricité et chimie'),
 ('Français','#F59E0B','Grammaire, expression et littérature'),
 ('Anglais','#6366F1','Compréhension et expression orale'),
 ('Arabe','#10B981','Langue et littérature arabe');
