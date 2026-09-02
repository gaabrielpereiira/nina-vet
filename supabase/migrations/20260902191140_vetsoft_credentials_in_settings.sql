-- Credenciais de login do VetSoft direto no nina_settings, no mesmo padrão já usado
-- pra elevenlabs_api_key/openai_api_key/calcom_api_key (Pattern A: texto simples,
-- editável na UI de Configurações, visível a qualquer usuário autenticado via a
-- policy "Authenticated can read nina_settings" já existente).
--
-- Substitui os secrets VETSOFT_TENANT/VETSOFT_EMAIL/VETSOFT_PASSWORD do Supabase —
-- _shared/vetsoft.ts passa a ler daqui em vez de Deno.env.

ALTER TABLE public.nina_settings
  ADD COLUMN IF NOT EXISTS vetsoft_login_tenant TEXT,
  ADD COLUMN IF NOT EXISTS vetsoft_login_email TEXT,
  ADD COLUMN IF NOT EXISTS vetsoft_login_password TEXT;
