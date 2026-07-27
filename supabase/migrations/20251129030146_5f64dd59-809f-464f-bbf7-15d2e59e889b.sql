-- Add 'pro3' option to ai_model_mode constraint
ALTER TABLE public.nina_settings 
DROP CONSTRAINT IF EXISTS nina_settings_ai_model_mode_check;

ALTER TABLE public.nina_settings 
ADD CONSTRAINT nina_settings_ai_model_mode_check 
CHECK (ai_model_mode IN ('flash', 'pro', 'pro3', 'adaptive'));