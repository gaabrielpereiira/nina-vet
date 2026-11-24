-- Apply together with staff-inbox-write-role.sql, only when the team may reply.
GRANT EXECUTE ON FUNCTION nina_channels.staff_chat_finish(text,text,uuid,uuid,text,text,text) TO nina_app;
