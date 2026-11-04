-- Run as owner after migration 0006, in the coordinated activation transaction.
-- The API never becomes a member of this role and cannot SET ROLE to it.
CREATE ROLE nina_channel_processor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA nina_channels,nina_clinic,nina_auth TO nina_channel_processor;
GRANT CREATE ON SCHEMA nina_channels TO nina_channel_processor;
GRANT SELECT ON nina_channels.processor_scope,nina_channels.zernio_inbox,
 nina_channels.peer_links,nina_channels.conversation_links,nina_channels.message_links,
 nina_channels.delivery_receipts,nina_channels.media_files,nina_channels.message_files,nina_channels.processing_log TO nina_channel_processor;
GRANT INSERT ON nina_channels.peer_links,nina_channels.conversation_links,nina_channels.message_links,
 nina_channels.delivery_receipts,nina_channels.media_files,nina_channels.message_files,nina_channels.processing_log TO nina_channel_processor;
GRANT UPDATE(sent_at,delivered_at,read_at,failed_at,failure_code) ON nina_channels.delivery_receipts TO nina_channel_processor;
GRANT UPDATE(status,attempts,available_at,lease_token,lease_until,processed_at,last_error_code) ON nina_channels.zernio_inbox TO nina_channel_processor;
GRANT SELECT(id,disabled_at) ON nina_auth.users TO nina_channel_processor;
GRANT SELECT(user_id,role) ON nina_auth.user_roles TO nina_channel_processor;
GRANT SELECT ON nina_clinic.contacts,nina_clinic.conversations,nina_clinic.messages TO nina_channel_processor;
GRANT INSERT(phone_number,whatsapp_id,name,call_name,first_contact_date,last_activity,user_id) ON nina_clinic.contacts TO nina_channel_processor;
GRANT UPDATE(phone_number,whatsapp_id,name,call_name,last_activity) ON nina_clinic.contacts TO nina_channel_processor;
GRANT INSERT(contact_id,status,is_active,ai_paused,ai_paused_reason,zernio_conversation_id,started_at,last_message_at,user_id) ON nina_clinic.conversations TO nina_channel_processor;
GRANT UPDATE(last_message_at,zernio_conversation_id,updated_at) ON nina_clinic.conversations TO nina_channel_processor;
GRANT INSERT(conversation_id,whatsapp_message_id,type,from_type,content,status,sent_at,metadata) ON nina_clinic.messages TO nina_channel_processor;
GRANT UPDATE(media_url,media_type,delivered_at,read_at,status) ON nina_clinic.messages TO nina_channel_processor;
GRANT EXECUTE ON FUNCTION nina_clinic.can_write(boolean),nina_clinic.bump_revision() TO nina_channel_processor;

CREATE POLICY processor_queue_read ON nina_channels.zernio_inbox FOR SELECT TO nina_channel_processor USING(true);
CREATE POLICY processor_queue_update ON nina_channels.zernio_inbox FOR UPDATE TO nina_channel_processor USING(true) WITH CHECK(true);
CREATE POLICY processor_media_read ON nina_channels.media_files FOR SELECT TO nina_channel_processor USING(true);
CREATE POLICY processor_media_insert ON nina_channels.media_files FOR INSERT TO nina_channel_processor WITH CHECK(true);
CREATE POLICY processor_media_link_read ON nina_channels.message_files FOR SELECT TO nina_channel_processor USING(true);
CREATE POLICY processor_media_link_insert ON nina_channels.message_files FOR INSERT TO nina_channel_processor WITH CHECK(true);
CREATE POLICY processor_contact_read ON nina_clinic.contacts FOR SELECT TO nina_channel_processor USING(true);
CREATE POLICY processor_contact_insert ON nina_clinic.contacts FOR INSERT TO nina_channel_processor WITH CHECK(true);
CREATE POLICY processor_contact_update ON nina_clinic.contacts FOR UPDATE TO nina_channel_processor USING(true) WITH CHECK(true);
CREATE POLICY processor_conversation_read ON nina_clinic.conversations FOR SELECT TO nina_channel_processor USING(true);
CREATE POLICY processor_conversation_insert ON nina_clinic.conversations FOR INSERT TO nina_channel_processor WITH CHECK(true);
CREATE POLICY processor_conversation_update ON nina_clinic.conversations FOR UPDATE TO nina_channel_processor USING(true) WITH CHECK(true);
CREATE POLICY processor_message_read ON nina_clinic.messages FOR SELECT TO nina_channel_processor USING(true);
CREATE POLICY processor_message_insert ON nina_clinic.messages FOR INSERT TO nina_channel_processor WITH CHECK(true);
CREATE POLICY processor_message_update ON nina_clinic.messages FOR UPDATE TO nina_channel_processor USING(true) WITH CHECK(true);

ALTER FUNCTION nina_channels.runtime_status(text,text) OWNER TO nina_channel_processor;
ALTER FUNCTION nina_channels.claim_job(text,text,uuid) OWNER TO nina_channel_processor;
ALTER FUNCTION nina_channels.heartbeat_job(uuid,uuid) OWNER TO nina_channel_processor;
ALTER FUNCTION nina_channels.fail_job(uuid,uuid,text,boolean) OWNER TO nina_channel_processor;
ALTER FUNCTION nina_channels.apply_job(uuid,uuid,jsonb) OWNER TO nina_channel_processor;
REVOKE CREATE ON SCHEMA nina_channels FROM nina_channel_processor;
GRANT EXECUTE ON FUNCTION nina_channels.runtime_status(text,text),nina_channels.claim_job(text,text,uuid),
 nina_channels.heartbeat_job(uuid,uuid),nina_channels.fail_job(uuid,uuid,text,boolean),
 nina_channels.apply_job(uuid,uuid,jsonb) TO nina_app;

-- Metadata-only read grants; raw bodies and private provider identities stay inaccessible.
GRANT SELECT(status) ON nina_channels.zernio_inbox TO nina_app;
GRANT SELECT(id,byte_count,sha256,mime,display_name,created_at) ON nina_channels.media_files TO nina_app;
GRANT SELECT(message_id,position,file_id,type,original_type,is_sticker,voice) ON nina_channels.message_files TO nina_app;
