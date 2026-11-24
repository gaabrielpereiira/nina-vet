-- Chat read surface and each person's own read position. Run after staff-inbox-role.sql.
-- Sending stays a separate grant (chat-write-role.sql).
GRANT CREATE ON SCHEMA nina_channels TO nina_channel_processor;
GRANT SELECT, INSERT, UPDATE (read_at) ON nina_channels.inbox_reads TO nina_channel_processor;
ALTER FUNCTION nina_channels.inbox_unread(uuid) OWNER TO nina_channel_processor;
ALTER FUNCTION nina_channels.staff_chat_list(text,text,text,text,integer) OWNER TO nina_channel_processor;
ALTER FUNCTION nina_channels.staff_chat_unread(text,text) OWNER TO nina_channel_processor;
ALTER FUNCTION nina_channels.staff_chat_thread(text,text,uuid,timestamptz,uuid,boolean) OWNER TO nina_channel_processor;
ALTER FUNCTION nina_channels.staff_chat_read(text,text,uuid,uuid) OWNER TO nina_channel_processor;
ALTER FUNCTION nina_channels.staff_chat_finish(text,text,uuid,uuid,text,text,text) OWNER TO nina_channel_processor;
REVOKE CREATE ON SCHEMA nina_channels FROM nina_channel_processor;
GRANT EXECUTE ON FUNCTION nina_channels.staff_chat_list(text,text,text,text,integer),nina_channels.staff_chat_unread(text,text),
  nina_channels.staff_chat_thread(text,text,uuid,timestamptz,uuid,boolean),nina_channels.staff_chat_read(text,text,uuid,uuid) TO nina_app;
