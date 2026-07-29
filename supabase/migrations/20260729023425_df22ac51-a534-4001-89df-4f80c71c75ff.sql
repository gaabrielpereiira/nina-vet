
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_paused_reason text,
  ADD COLUMN IF NOT EXISTS ai_paused_by uuid;

-- message_from enum currently: user, nina, human. 'human' já cobre operador humano.
-- Nada a alterar no enum.
