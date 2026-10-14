-- 1. Sign-up always creates a student; roles are granted by admins only
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name',''), NEW.email, NEW.raw_user_meta_data->>'phone');

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'student');
  INSERT INTO public.students (id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $function$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Admins manage roles
DROP POLICY IF EXISTS "roles admin write" ON public.user_roles;
CREATE POLICY "roles admin write" ON public.user_roles
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
GRANT INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;

-- 3. Profiles: self + admin + teachers limited to their own students
DROP POLICY IF EXISTS "profiles readable by authenticated" ON public.profiles;
CREATE POLICY "profiles read scoped" ON public.profiles
FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.registrations r
    JOIN public.groups g ON g.id = r.group_id
    WHERE r.student_id = profiles.id
      AND r.status = 'approved'
      AND g.teacher_id = auth.uid()
  )
);

-- 4. Students: self + admin + teachers limited to their own groups
DROP POLICY IF EXISTS "students read" ON public.students;
CREATE POLICY "students read" ON public.students
FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.registrations r
    JOIN public.groups g ON g.id = r.group_id
    WHERE r.student_id = students.id
      AND r.status = 'approved'
      AND g.teacher_id = auth.uid()
  )
);