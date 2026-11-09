-- Apply only when enabling team ownership and replies for the existing staff roles.
GRANT UPDATE (assigned_user_id,status,ai_paused,ai_paused_at,ai_paused_by,ai_paused_reason)
  ON nina_clinic.conversations TO nina_channel_processor;
GRANT INSERT (operation_id,account_id,conversation_id,actor_id,fingerprint), UPDATE (status,provider_message_id)
  ON nina_channels.inbox_replies TO nina_channel_processor;
GRANT EXECUTE ON FUNCTION nina_channels.staff_inbox_assign(text,text,uuid,boolean),
  nina_channels.staff_inbox_reserve(text,text,uuid,uuid,text),nina_channels.staff_inbox_finish(text,uuid,uuid,text,text) TO nina_app;
