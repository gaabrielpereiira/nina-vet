-- Integração VetSoft: agendamento direto na agenda real da clínica + sincronização
-- de clientes e animais. Ver plano em conversa (integração VetSoft) para contexto completo.

-- 1) nina_settings: cache de token (login simples email/senha/tenant, sem OAuth) +
--    config fixa da clínica exigida pela API (tipo de atendimento e usuário responsável).
ALTER TABLE public.nina_settings
  ADD COLUMN IF NOT EXISTS vetsoft_connected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vetsoft_access_token TEXT,
  ADD COLUMN IF NOT EXISTS vetsoft_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS vetsoft_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vetsoft_default_service_type_id INTEGER,
  ADD COLUMN IF NOT EXISTS vetsoft_default_service_type_name TEXT,
  ADD COLUMN IF NOT EXISTS vetsoft_default_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS vetsoft_default_user_name TEXT,
  ADD COLUMN IF NOT EXISTS vetsoft_last_error TEXT;

-- 2) animals: não existia nenhum conceito de "pet" no schema. Guarda os dados capturados
--    pela Nina na conversa; a sincronização com o VetSoft é best-effort (cod_raca é
--    obrigatório lá, então nem todo animal necessariamente sincroniza).
CREATE TABLE public.animals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  species TEXT,
  breed TEXT,
  sex TEXT,
  birth_date DATE,
  notes TEXT,
  vetsoft_animal_id INTEGER,
  vetsoft_synced_at TIMESTAMPTZ,
  vetsoft_sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_animals_contact_id ON public.animals(contact_id);
CREATE INDEX idx_animals_vetsoft_animal_id ON public.animals(vetsoft_animal_id);

ALTER TABLE public.animals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can access all animals"
  ON public.animals
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- 3) contacts: mapeamento pro cliente correspondente no VetSoft.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS vetsoft_client_id INTEGER,
  ADD COLUMN IF NOT EXISTS vetsoft_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vetsoft_sync_error TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_vetsoft_client_id ON public.contacts(vetsoft_client_id);

-- 4) appointments: qual animal é a consulta (novo) + mapeamento pro evento no VetSoft.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS animal_id UUID REFERENCES public.animals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vetsoft_event_id INTEGER,
  ADD COLUMN IF NOT EXISTS vetsoft_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vetsoft_sync_error TEXT;

CREATE INDEX IF NOT EXISTS idx_appointments_animal_id ON public.appointments(animal_id);
CREATE INDEX IF NOT EXISTS idx_appointments_vetsoft_event_id ON public.appointments(vetsoft_event_id);
