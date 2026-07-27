-- Remover campos legados que não são mais utilizados no sistema
-- Cal.com: agendamento é nativo via Nina, não usa Cal.com
-- OpenAI: sistema usa Lovable AI Gateway, não precisa de API key própria

ALTER TABLE public.nina_settings DROP COLUMN IF EXISTS calcom_api_key;
ALTER TABLE public.nina_settings DROP COLUMN IF EXISTS openai_api_key;
ALTER TABLE public.nina_settings DROP COLUMN IF EXISTS openai_model;
ALTER TABLE public.nina_settings DROP COLUMN IF EXISTS openai_assistant_id;