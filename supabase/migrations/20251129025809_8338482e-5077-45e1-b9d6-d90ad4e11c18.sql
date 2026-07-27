-- Adiciona coluna ai_model_mode à tabela nina_settings
ALTER TABLE public.nina_settings 
ADD COLUMN ai_model_mode TEXT DEFAULT 'flash' 
CHECK (ai_model_mode IN ('flash', 'pro', 'adaptive'));