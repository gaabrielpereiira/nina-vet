CREATE OR REPLACE FUNCTION public.auto_create_deal_on_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE first_stage_id uuid;
BEGIN
  SELECT id INTO first_stage_id
  FROM public.pipeline_stages
  WHERE is_active = true
    AND (user_id = NEW.user_id OR user_id IS NULL)
  ORDER BY position ASC
  LIMIT 1;

  IF first_stage_id IS NOT NULL THEN
    INSERT INTO public.deals (contact_id, stage_id, title, value, stage, priority, user_id)
    VALUES (NEW.id, first_stage_id, COALESCE(NEW.name, NEW.call_name, 'Novo Lead'), 0, 'new', 'medium', NEW.user_id);
  END IF;

  RETURN NEW;
END;
$function$;