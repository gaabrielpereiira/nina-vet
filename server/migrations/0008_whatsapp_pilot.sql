-- One manually approved text reply per verified inbound message in the pilot.
CREATE TABLE nina_channels.pilot_replies (
  conversation_id uuid NOT NULL REFERENCES nina_clinic.conversations(id),
  inbound_message_id uuid NOT NULL REFERENCES nina_clinic.messages(id),
  actor_id uuid NOT NULL REFERENCES nina_auth.users(id),
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending','accepted','rejected','uncertain')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, inbound_message_id)
);
REVOKE ALL ON nina_channels.pilot_replies FROM PUBLIC;
ALTER TABLE nina_channels.pilot_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY pilot_replies_admin ON nina_channels.pilot_replies FOR SELECT
  USING (nina_clinic.can_write(true));
CREATE POLICY pilot_replies_insert ON nina_channels.pilot_replies FOR INSERT
  WITH CHECK (nina_clinic.can_write(true) AND actor_id = nullif(current_setting('nina.user_id', true), '')::uuid
    AND status = 'sending');
CREATE POLICY pilot_replies_update ON nina_channels.pilot_replies FOR UPDATE
  USING (nina_clinic.can_write(true) AND actor_id = nullif(current_setting('nina.user_id', true), '')::uuid
    AND status = 'sending')
  WITH CHECK (nina_clinic.can_write(true) AND actor_id = nullif(current_setting('nina.user_id', true), '')::uuid
    AND status IN ('accepted','rejected','uncertain'));

CREATE FUNCTION nina_channels.pilot_reply_target(p_account text, p_profile text, p_conversation uuid, p_contact uuid)
RETURNS TABLE(provider_conversation_id text, inbound_message_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT route.external_id, incoming.id
  FROM nina_channels.processor_scope scope
  JOIN nina_clinic.conversations c ON c.id = p_conversation AND c.contact_id = p_contact
  JOIN nina_clinic.contacts t ON t.id = c.contact_id
  JOIN LATERAL (
    SELECT min(link.external_id) AS external_id
    FROM nina_channels.conversation_links link
    WHERE link.account_id = scope.account_id AND link.kind = 'internal' AND link.conversation_id = c.id
    HAVING count(*) = 1
  ) route ON route.external_id ~ '^[a-f0-9]{24}$'
  JOIN LATERAL (
    SELECT m.id, m.sent_at, m.metadata
    FROM nina_clinic.messages m
    JOIN nina_channels.message_links link ON link.message_id = m.id AND link.account_id = scope.account_id
    WHERE m.conversation_id = c.id AND m.from_type = 'user' AND EXISTS (
      SELECT 1 FROM nina_channels.processing_log processed
      JOIN nina_channels.zernio_inbox inbox ON inbox.id = processed.job_id
      WHERE processed.message_id = m.id AND inbox.account_id = scope.account_id
        AND inbox.event_type = 'message.received' AND inbox.status = 'processed'
    )
    ORDER BY m.sent_at DESC, m.id DESC LIMIT 1
  ) incoming ON incoming.sent_at > now() - interval '23 hours 55 minutes'
    AND incoming.sent_at <= now() AND incoming.metadata->>'standby' = 'false'
  WHERE scope.account_id = p_account AND scope.profile_id = p_profile
    AND nina_clinic.can_write(true) AND t.is_blocked IS FALSE
    AND c.status = 'human' AND c.ai_paused AND c.is_active AND c.archived_at IS NULL;
$$;
REVOKE ALL ON FUNCTION nina_channels.pilot_reply_target(text,text,uuid,uuid) FROM PUBLIC;
