ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS archived_by uuid;

CREATE INDEX IF NOT EXISTS idx_conversations_archived_at ON public.conversations (archived_at);

CREATE OR REPLACE FUNCTION public.unarchive_conversation_on_lead_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.from_type = 'user' THEN
    UPDATE public.conversations
    SET archived_at = NULL,
        archived_by = NULL,
        status = 'nina',
        ai_paused = false,
        ai_paused_at = NULL,
        ai_paused_reason = NULL,
        ai_paused_by = NULL
    WHERE id = NEW.conversation_id
      AND archived_at IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER unarchive_conversation_on_message
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.unarchive_conversation_on_lead_message();