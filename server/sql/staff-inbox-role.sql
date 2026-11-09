-- Install the read surface. Assignment and send permissions are a separate grant.
GRANT CREATE ON SCHEMA nina_channels TO nina_channel_processor;
GRANT SELECT (full_name) ON nina_auth.users TO nina_channel_processor;
GRANT SELECT ON nina_channels.inbox_replies TO nina_channel_processor;
ALTER FUNCTION nina_channels.inbox_route(text,text,uuid) OWNER TO nina_channel_processor;
ALTER FUNCTION nina_channels.inbox_window(text,uuid) OWNER TO nina_channel_processor;
ALTER FUNCTION nina_channels.staff_inbox_list(text,text,text,text,integer) OWNER TO nina_channel_processor;
ALTER FUNCTION nina_channels.staff_inbox_thread(text,text,uuid,timestamptz,uuid,boolean) OWNER TO nina_channel_processor;
ALTER FUNCTION nina_channels.staff_inbox_assign(text,text,uuid,boolean) OWNER TO nina_channel_processor;
ALTER FUNCTION nina_channels.staff_inbox_reserve(text,text,uuid,uuid,text) OWNER TO nina_channel_processor;
ALTER FUNCTION nina_channels.staff_inbox_finish(text,uuid,uuid,text,text) OWNER TO nina_channel_processor;
REVOKE CREATE ON SCHEMA nina_channels FROM nina_channel_processor;
GRANT EXECUTE ON FUNCTION nina_channels.staff_inbox_list(text,text,text,text,integer),
  nina_channels.staff_inbox_thread(text,text,uuid,timestamptz,uuid,boolean) TO nina_app;
