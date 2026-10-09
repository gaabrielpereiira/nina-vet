CREATE OR REPLACE FUNCTION public.get_nina_automation()
RETURNS TABLE(id uuid, is_active boolean, auto_response_enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.is_active, s.auto_response_enabled FROM public.nina_settings s
  WHERE EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid())
  ORDER BY s.created_at, s.id LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION public.set_nina_automation(p_enabled boolean)
RETURNS TABLE(id uuid, is_active boolean, auto_response_enabled boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  SELECT s.id INTO v_id FROM public.nina_settings s ORDER BY s.created_at, s.id LIMIT 1;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Configure a Nina antes de alterar o atendimento.'; END IF;
  UPDATE public.nina_settings SET is_active = p_enabled, auto_response_enabled = p_enabled WHERE nina_settings.id = v_id;
  RETURN QUERY SELECT s.id, s.is_active, s.auto_response_enabled FROM public.nina_settings s WHERE s.id = v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.get_nina_automation() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.set_nina_automation(boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_nina_automation() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_nina_automation(boolean) TO authenticated;