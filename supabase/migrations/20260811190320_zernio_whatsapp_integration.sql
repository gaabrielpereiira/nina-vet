-- Migração para integração WhatsApp via Zernio (substitui o fluxo direto com a Meta).
-- Mantém as colunas whatsapp_access_token / whatsapp_phone_number_id / whatsapp_business_account_id
-- antigas (não usadas mais pelo código) para não perder histórico/config já salva.

ALTER TABLE public.nina_settings
  ADD COLUMN IF NOT EXISTS zernio_profile_id TEXT,
  ADD COLUMN IF NOT EXISTS zernio_account_id TEXT,
  ADD COLUMN IF NOT EXISTS zernio_display_phone_number TEXT,
  ADD COLUMN IF NOT EXISTS zernio_display_name TEXT,
  ADD COLUMN IF NOT EXISTS zernio_connected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS zernio_disconnected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS zernio_disconnect_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_nina_settings_zernio_account_id ON public.nina_settings(zernio_account_id);

-- A conversa precisa guardar o conversationId interno da Zernio para permitir
-- responder na mesma thread (POST /v1/inbox/conversations/{conversationId}/messages).
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS zernio_conversation_id TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_zernio_conversation_id ON public.conversations(zernio_conversation_id);
