CREATE TABLE nina_channels.inbox_replies (
  operation_id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES nina_channels.processor_scope(account_id),
  conversation_id uuid NOT NULL REFERENCES nina_clinic.conversations(id),
  actor_id uuid NOT NULL REFERENCES nina_auth.users(id),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending','accepted','rejected','uncertain')),
  provider_message_id text CHECK (provider_message_id IS NULL OR (length(provider_message_id) BETWEEN 7 AND 506 AND provider_message_id ~ '^wamid\.[A-Za-z0-9_+/=-]+$')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'accepted') = (provider_message_id IS NOT NULL))
);
CREATE INDEX inbox_replies_echo_idx ON nina_channels.inbox_replies(account_id, conversation_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX inbox_replies_recent_idx ON nina_channels.inbox_replies(conversation_id, created_at DESC);
CREATE INDEX messages_inbox_order_idx ON nina_clinic.messages(conversation_id, sent_at DESC, id DESC);
CREATE INDEX conversations_inbox_order_idx ON nina_clinic.conversations(last_message_at DESC,id DESC)
  WHERE is_active AND archived_at IS NULL;
REVOKE ALL ON nina_channels.inbox_replies FROM PUBLIC;

-- Resolve only an unambiguous internal route of the configured account. This
-- helper is private to the function owner and never serializes provider IDs.
CREATE FUNCTION nina_channels.inbox_route(p_account text, p_profile text, p_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
  SELECT min(l.external_id)
  FROM nina_channels.processor_scope s JOIN nina_channels.conversation_links l ON l.account_id=s.account_id
  WHERE s.account_id=p_account AND s.profile_id=p_profile AND l.kind='internal' AND l.conversation_id=p_id
  HAVING count(*)=1 AND min(l.external_id) ~ '^[a-f0-9]{24}$';
$$;

CREATE FUNCTION nina_channels.inbox_window(p_account text, p_id uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
  SELECT CASE WHEN m.metadata->>'standby'='false' AND m.sent_at<=now()
    THEN m.sent_at+interval '23 hours 55 minutes' END
  FROM nina_clinic.messages m
  WHERE m.conversation_id=p_id AND m.from_type='user' AND m.metadata->>'source'='zernio'
    AND EXISTS (SELECT 1 FROM nina_channels.message_links l WHERE l.account_id=p_account AND l.message_id=m.id)
  ORDER BY m.sent_at DESC,m.id DESC LIMIT 1;
$$;

CREATE FUNCTION nina_channels.staff_inbox_list(p_account text,p_profile text,p_filter text,p_query text,p_offset integer)
RETURNS TABLE(id uuid, contact_id uuid, name text, assigned_to_me boolean, assignee text,
  last_message_at timestamptz, preview text, message_type text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT recent.id,recent.contact_id,recent.name,recent.assigned_to_me,recent.assignee,
    recent.last_message_at,left(m.content,160),m.type::text
  FROM (
    SELECT c.id,c.contact_id,coalesce(nullif(t.call_name,''),nullif(t.name,''),t.phone_number,'Contato do WhatsApp') AS name,
      c.assigned_user_id IS NOT DISTINCT FROM nullif(current_setting('nina.user_id',true),'')::uuid AS assigned_to_me,
      CASE WHEN c.assigned_user_id IS NOT NULL THEN coalesce(nullif(u.full_name,''),'Equipe') END AS assignee,
      c.last_message_at
    FROM nina_clinic.conversations c JOIN nina_clinic.contacts t ON t.id=c.contact_id
    LEFT JOIN nina_auth.users u ON u.id=c.assigned_user_id
    WHERE nina_clinic.can_write(false) AND c.is_active AND c.archived_at IS NULL
      AND nina_channels.inbox_route(p_account,p_profile,c.id) IS NOT NULL
      AND (p_filter='all' OR (p_filter='mine' AND c.assigned_user_id=nullif(current_setting('nina.user_id',true),'')::uuid)
        OR (p_filter='unassigned' AND c.assigned_user_id IS NULL))
      AND (p_query='' OR strpos(lower(coalesce(t.name,'')||' '||coalesce(t.call_name,'')),lower(p_query))>0
        OR (regexp_replace(p_query,'[^0-9]','','g')<>'' AND p_query ~ '^[+0-9(). -]+$'
          AND strpos(coalesce(t.phone_number,''),regexp_replace(p_query,'[^0-9]','','g'))>0))
    ORDER BY c.last_message_at DESC,c.id DESC LIMIT 31 OFFSET greatest(0,least(p_offset,100000))
  ) recent
  LEFT JOIN LATERAL (SELECT x.content,x.type FROM nina_clinic.messages x WHERE x.conversation_id=recent.id
    ORDER BY x.sent_at DESC,x.id DESC LIMIT 1) m ON true
  ORDER BY recent.last_message_at DESC,recent.id DESC;
$$;

CREATE FUNCTION nina_channels.staff_inbox_thread(p_account text,p_profile text,p_id uuid,p_before_at timestamptz,p_before_id uuid,p_media boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT jsonb_build_object('id',c.id,'contact_id',c.contact_id,
    'name',coalesce(nullif(t.call_name,''),nullif(t.name,''),t.phone_number,'Contato do WhatsApp'),
    'assigned_to_me',c.assigned_user_id IS NOT DISTINCT FROM nullif(current_setting('nina.user_id',true),'')::uuid,
    'assignee',CASE WHEN c.assigned_user_id IS NOT NULL THEN coalesce(nullif(u.full_name,''),'Equipe') END,
    'blocked',t.is_blocked IS DISTINCT FROM false,'reply_until',nina_channels.inbox_window(p_account,c.id),
    'messages',coalesce((SELECT jsonb_agg(to_jsonb(rows) ORDER BY rows.sent_at DESC,rows.id DESC) FROM (
      SELECT m.id,m.conversation_id,m.type,m.content,m.status,m.sent_at,m.created_at,
        CASE WHEN m.from_type<>'user' AND EXISTS(SELECT 1 FROM nina_channels.inbox_replies r WHERE r.account_id=p_account AND r.conversation_id=c.id
          AND r.provider_message_id=m.whatsapp_message_id) THEN 'human' ELSE m.from_type::text END AS from_type,
        CASE WHEN p_media THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'position',mf.position,'type',mf.type,
          'is_sticker',mf.is_sticker,'voice',mf.voice,'mime',f.mime,'bytes',f.byte_count,'filename',f.display_name) ORDER BY mf.position)
          FROM nina_channels.message_files mf JOIN nina_channels.media_files f ON f.id=mf.file_id
          WHERE mf.message_id=m.id AND f.account_id=p_account),'[]'::jsonb) ELSE '[]'::jsonb END AS attachments
      FROM nina_clinic.messages m WHERE m.conversation_id=c.id
        AND (p_before_at IS NULL OR (m.sent_at,m.id)<(p_before_at,p_before_id))
      ORDER BY m.sent_at DESC,m.id DESC LIMIT 41
    ) rows),'[]'::jsonb))
  FROM nina_clinic.conversations c JOIN nina_clinic.contacts t ON t.id=c.contact_id
  LEFT JOIN nina_auth.users u ON u.id=c.assigned_user_id
  WHERE c.id=p_id AND c.is_active AND c.archived_at IS NULL AND nina_clinic.can_write(false)
    AND nina_channels.inbox_route(p_account,p_profile,c.id) IS NOT NULL;
$$;

CREATE FUNCTION nina_channels.staff_inbox_assign(p_account text,p_profile text,p_id uuid,p_assume boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=nullif(current_setting('nina.user_id',true),'')::uuid;
        previous uuid; blocked boolean;
BEGIN
  IF NOT nina_clinic.can_write(false) THEN RETURN 'denied'; END IF;
  SELECT c.assigned_user_id,t.is_blocked IS DISTINCT FROM false INTO previous,blocked
  FROM nina_clinic.conversations c JOIN nina_clinic.contacts t ON t.id=c.contact_id
  WHERE c.id=p_id AND c.is_active AND c.archived_at IS NULL AND nina_channels.inbox_route(p_account,p_profile,c.id) IS NOT NULL
  FOR UPDATE OF c;
  IF NOT FOUND THEN RETURN 'missing'; END IF;
  IF p_assume AND blocked THEN RETURN 'blocked'; END IF;
  IF (p_assume AND previous IS NOT NULL AND previous<>actor) OR (NOT p_assume AND previous IS DISTINCT FROM actor)
    THEN RETURN 'conflict'; END IF;
  UPDATE nina_clinic.conversations SET assigned_user_id=CASE WHEN p_assume THEN actor END,
    status='human',ai_paused=true,ai_paused_at=clock_timestamp(),ai_paused_by=actor,
    ai_paused_reason='Atendimento pela equipe',updated_at=clock_timestamp() WHERE id=p_id;
  RETURN 'ok';
END;
$$;

CREATE FUNCTION nina_channels.staff_inbox_reserve(p_account text,p_profile text,p_id uuid,p_operation uuid,p_fingerprint text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=nullif(current_setting('nina.user_id',true),'')::uuid;
        owner_id uuid; blocked boolean; route text; previous nina_channels.inbox_replies%ROWTYPE;
BEGIN
  IF NOT nina_clinic.can_write(false) THEN RETURN jsonb_build_object('status','denied'); END IF;
  SELECT c.assigned_user_id,t.is_blocked IS DISTINCT FROM false,nina_channels.inbox_route(p_account,p_profile,c.id)
    INTO owner_id,blocked,route
  FROM nina_clinic.conversations c JOIN nina_clinic.contacts t ON t.id=c.contact_id
  WHERE c.id=p_id AND c.is_active AND c.archived_at IS NULL AND c.status='human' AND c.ai_paused FOR UPDATE OF c;
  IF NOT FOUND OR route IS NULL THEN RETURN jsonb_build_object('status','missing'); END IF;
  SELECT * INTO previous FROM nina_channels.inbox_replies WHERE operation_id=p_operation;
  IF FOUND THEN
    IF previous.actor_id<>actor OR previous.conversation_id<>p_id OR previous.account_id<>p_account OR previous.fingerprint<>p_fingerprint
      THEN RETURN jsonb_build_object('status','conflict'); END IF;
    RETURN jsonb_build_object('status',previous.status);
  END IF;
  IF owner_id IS DISTINCT FROM actor THEN RETURN jsonb_build_object('status','conflict'); END IF;
  IF blocked THEN RETURN jsonb_build_object('status','blocked'); END IF;
  IF coalesce(nina_channels.inbox_window(p_account,p_id)<=now(),true) THEN RETURN jsonb_build_object('status','window'); END IF;
  IF EXISTS (SELECT 1 FROM nina_channels.inbox_replies r WHERE r.conversation_id=p_id
    AND (r.created_at>now()-interval '3 seconds' OR (r.status='sending' AND r.created_at>now()-interval '20 seconds'))) THEN RETURN jsonb_build_object('status','busy'); END IF;
  INSERT INTO nina_channels.inbox_replies(operation_id,account_id,conversation_id,actor_id,fingerprint)
    VALUES(p_operation,p_account,p_id,actor,p_fingerprint) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','conflict'); END IF;
  RETURN jsonb_build_object('status','reserved','target',route);
END;
$$;

CREATE FUNCTION nina_channels.staff_inbox_finish(p_account text,p_id uuid,p_operation uuid,p_status text,p_provider_id text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NOT nina_clinic.can_write(false) OR p_status NOT IN ('accepted','rejected','uncertain') THEN RETURN false; END IF;
  UPDATE nina_channels.inbox_replies SET status=p_status,provider_message_id=p_provider_id
  WHERE operation_id=p_operation AND conversation_id=p_id AND account_id=p_account AND status='sending'
    AND actor_id=nullif(current_setting('nina.user_id',true),'')::uuid;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION nina_channels.inbox_route(text,text,uuid),nina_channels.inbox_window(text,uuid),
  nina_channels.staff_inbox_list(text,text,text,text,integer),nina_channels.staff_inbox_thread(text,text,uuid,timestamptz,uuid,boolean),
  nina_channels.staff_inbox_assign(text,text,uuid,boolean),nina_channels.staff_inbox_reserve(text,text,uuid,uuid,text),
  nina_channels.staff_inbox_finish(text,uuid,uuid,text,text) FROM PUBLIC;
