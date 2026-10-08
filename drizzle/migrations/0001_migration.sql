-- Shared access for all logged-in staff on operational data
CREATE POLICY "Staff access contacts" ON public.contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff access conversations" ON public.conversations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff access messages" ON public.messages FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff read pipeline_stages" ON public.pipeline_stages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff read tag_definitions" ON public.tag_definitions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff read teams" ON public.teams FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff read team_functions" ON public.team_functions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff read team_members" ON public.team_members FOR SELECT TO authenticated USING (true);

-- Missing roles for invited users
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'user'::app_role FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id);

-- Self-activation of team membership on login
CREATE OR REPLACE FUNCTION public.activate_my_team_membership()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  UPDATE public.team_members
  SET user_id = auth.uid(), status = 'active', last_active = now()
  WHERE (user_id = auth.uid() OR lower(email) = lower(v_email)) AND status <> 'disabled';
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(), 'user');
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.activate_my_team_membership() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.activate_my_team_membership() TO authenticated;

-- Mark those who already logged in as active
UPDATE public.team_members tm SET status = 'active', user_id = u.id, last_active = u.last_sign_in_at
FROM auth.users u WHERE lower(u.email) = lower(tm.email) AND u.last_sign_in_at IS NOT NULL AND tm.status = 'invited';