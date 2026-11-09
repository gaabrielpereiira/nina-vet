-- Run as the database owner after migration 0008, with the pilot still disabled.
GRANT CREATE ON SCHEMA nina_channels TO nina_channel_processor;
ALTER FUNCTION nina_channels.pilot_reply_target(text,text,uuid,uuid) OWNER TO nina_channel_processor;
REVOKE CREATE ON SCHEMA nina_channels FROM nina_channel_processor;
GRANT EXECUTE ON FUNCTION nina_channels.pilot_reply_target(text,text,uuid,uuid) TO nina_app;
GRANT SELECT (conversation_id,inbound_message_id,status),
 INSERT (conversation_id,inbound_message_id,actor_id), UPDATE (status)
 ON nina_channels.pilot_replies TO nina_app;
