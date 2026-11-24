-- Chat da equipe: posição de leitura por pessoa, contagem de não lidas e
-- histórico imediato das respostas. Aditiva: as funções da 0009 continuam.
CREATE TABLE nina_channels.inbox_reads (
  user_id uuid NOT NULL REFERENCES nina_auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES nina_clinic.conversations(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, conversation_id)
);
REVOKE ALL ON nina_channels.inbox_reads FROM PUBLIC;

-- Arrival order (created_at), not the provider clock, decides what was seen.
-- Any reply from the clinic clears the counter for the whole team; opening a
-- conversation clears it only for that person. Older than 7 days never counts.
CREATE FUNCTION nina_channels.inbox_unread(p_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
  SELECT count(*)::integer FROM (
    SELECT 1 FROM nina_clinic.messages m
    WHERE m.conversation_id=p_id AND m.from_type='user' AND m.sent_at>now()-interval '7 days'
      AND m.created_at>coalesce((SELECT o.created_at FROM nina_clinic.messages o
        WHERE o.conversation_id=p_id AND o.from_type<>'user' ORDER BY o.sent_at DESC,o.id DESC LIMIT 1),'-infinity'::timestamptz)
      AND m.created_at>coalesce((SELECT r.read_at FROM nina_channels.inbox_reads r WHERE r.conversation_id=p_id
        AND r.user_id=nullif(current_setting('nina.user_id',true),'')::uuid),'-infinity'::timestamptz)
    LIMIT 100) unseen;
$$;

CREATE FUNCTION nina_channels.staff_chat_list(p_account text,p_profile text,p_filter text,p_query text,p_offset integer)
RETURNS TABLE(id uuid, contact_id uuid, name text, assigned_to_me boolean, assignee text, last_message_at timestamptz,
  preview text, message_type text, last_direction text, last_status text, unread integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT recent.id,recent.contact_id,recent.name,recent.assigned_to_me,recent.assignee,recent.last_message_at,
    left(m.content,160),m.type::text,CASE WHEN m.from_type='user' THEN 'in' WHEN m.from_type IS NOT NULL THEN 'out' END,
    m.status::text,nina_channels.inbox_unread(recent.id)
  FROM (
    SELECT c.id,c.contact_id,coalesce(nullif(t.name,''),nullif(t.call_name,''),t.phone_number,'Contato do WhatsApp') AS name,
      c.assigned_user_id IS NOT DISTINCT FROM nullif(current_setting('nina.user_id',true),'')::uuid AS assigned_to_me,
      CASE WHEN c.assigned_user_id IS NOT NULL THEN coalesce(nullif(u.full_name,''),'Equipe') END AS assignee,
      c.last_message_at
    FROM nina_clinic.conversations c JOIN nina_clinic.contacts t ON t.id=c.contact_id
    LEFT JOIN nina_auth.users u ON u.id=c.assigned_user_id
    WHERE nina_clinic.can_write(false) AND c.is_active AND c.archived_at IS NULL
      AND nina_channels.inbox_route(p_account,p_profile,c.id) IS NOT NULL
      AND (p_filter='all' OR (p_filter='mine' AND c.assigned_user_id=nullif(current_setting('nina.user_id',true),'')::uuid)
        OR (p_filter='unassigned' AND c.assigned_user_id IS NULL)
        OR (p_filter='unread' AND c.last_message_at>now()-interval '7 days'
          AND (c.assigned_user_id IS NULL OR c.assigned_user_id=nullif(current_setting('nina.user_id',true),'')::uuid)
          AND nina_channels.inbox_unread(c.id)>0))
      AND (p_query='' OR strpos(lower(coalesce(t.name,'')||' '||coalesce(t.call_name,'')),lower(p_query))>0
        OR (regexp_replace(p_query,'[^0-9]','','g')<>'' AND p_query ~ '^[+0-9(). -]+$'
          AND strpos(regexp_replace(coalesce(t.phone_number,''),'[^0-9]','','g'),regexp_replace(p_query,'[^0-9]','','g'))>0))
    ORDER BY c.last_message_at DESC,c.id DESC LIMIT 31 OFFSET greatest(0,least(p_offset,100000))
  ) recent
  LEFT JOIN LATERAL (SELECT x.content,x.type,x.from_type,x.status FROM nina_clinic.messages x WHERE x.conversation_id=recent.id
    ORDER BY x.sent_at DESC,x.id DESC LIMIT 1) m ON true
  ORDER BY recent.last_message_at DESC,recent.id DESC;
$$;

CREATE FUNCTION nina_channels.staff_chat_unread(p_account text,p_profile text) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT count(*)::integer FROM nina_clinic.conversations c
  WHERE nina_clinic.can_write(false) AND c.is_active AND c.archived_at IS NULL AND c.last_message_at>now()-interval '7 days'
    AND (c.assigned_user_id IS NULL OR c.assigned_user_id=nullif(current_setting('nina.user_id',true),'')::uuid)
    AND nina_channels.inbox_route(p_account,p_profile,c.id) IS NOT NULL AND nina_channels.inbox_unread(c.id)>0;
$$;

CREATE FUNCTION nina_channels.staff_chat_thread(p_account text,p_profile text,p_id uuid,p_before_at timestamptz,p_before_id uuid,p_media boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT jsonb_build_object('id',c.id,'contact_id',c.contact_id,'phone',t.phone_number,
    'name',coalesce(nullif(t.name,''),nullif(t.call_name,''),t.phone_number,'Contato do WhatsApp'),
    'assigned_to_me',c.assigned_user_id IS NOT DISTINCT FROM nullif(current_setting('nina.user_id',true),'')::uuid,
    'assignee',CASE WHEN c.assigned_user_id IS NOT NULL THEN coalesce(nullif(u.full_name,''),'Equipe') END,
    'blocked',t.is_blocked IS DISTINCT FROM false,'reply_until',nina_channels.inbox_window(p_account,c.id),
    'messages',coalesce((SELECT jsonb_agg(to_jsonb(rows) ORDER BY rows.sent_at DESC,rows.id DESC) FROM (
      SELECT m.id,m.conversation_id,m.type,m.content,m.status,m.sent_at,m.created_at,r.operation_id,
        CASE WHEN r.operation_id IS NOT NULL THEN coalesce(nullif(a.full_name,''),'Equipe') END AS author,
        CASE WHEN m.from_type<>'user' AND r.operation_id IS NOT NULL THEN 'human' ELSE m.from_type::text END AS from_type,
        CASE WHEN p_media THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'position',mf.position,'type',mf.type,
          'is_sticker',mf.is_sticker,'voice',mf.voice,'mime',f.mime,'bytes',f.byte_count,'filename',f.display_name) ORDER BY mf.position)
          FROM nina_channels.message_files mf JOIN nina_channels.media_files f ON f.id=mf.file_id
          WHERE mf.message_id=m.id AND f.account_id=p_account),'[]'::jsonb) ELSE '[]'::jsonb END AS attachments
      FROM nina_clinic.messages m
      LEFT JOIN LATERAL (SELECT x.operation_id,x.actor_id FROM nina_channels.inbox_replies x WHERE m.from_type<>'user'
        AND x.account_id=p_account AND x.conversation_id=c.id AND x.provider_message_id=m.whatsapp_message_id LIMIT 1) r ON true
      LEFT JOIN nina_auth.users a ON a.id=r.actor_id
      WHERE m.conversation_id=c.id AND (p_before_at IS NULL OR (m.sent_at,m.id)<(p_before_at,p_before_id))
      ORDER BY m.sent_at DESC,m.id DESC LIMIT 41
    ) rows),'[]'::jsonb))
  FROM nina_clinic.conversations c JOIN nina_clinic.contacts t ON t.id=c.contact_id
  LEFT JOIN nina_auth.users u ON u.id=c.assigned_user_id
  WHERE c.id=p_id AND c.is_active AND c.archived_at IS NULL AND nina_clinic.can_write(false)
    AND nina_channels.inbox_route(p_account,p_profile,c.id) IS NOT NULL;
$$;

-- The newest message on the person's screen moves only that person's position.
CREATE FUNCTION nina_channels.staff_chat_read(p_account text,p_profile text,p_id uuid,p_message uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=nullif(current_setting('nina.user_id',true),'')::uuid; seen timestamptz;
BEGIN
  IF NOT nina_clinic.can_write(false) THEN RETURN 'denied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM nina_clinic.conversations c WHERE c.id=p_id AND c.is_active AND c.archived_at IS NULL
    AND nina_channels.inbox_route(p_account,p_profile,c.id) IS NOT NULL) THEN RETURN 'missing'; END IF;
  SELECT max(page.created_at) INTO seen FROM (
    SELECT m.created_at FROM nina_clinic.messages m
    JOIN nina_clinic.messages edge ON edge.id=p_message AND edge.conversation_id=p_id
    WHERE m.conversation_id=p_id AND (m.sent_at,m.id)<=(edge.sent_at,edge.id)
    ORDER BY m.sent_at DESC,m.id DESC LIMIT 100) page;
  IF seen IS NULL THEN RETURN 'missing'; END IF;
  INSERT INTO nina_channels.inbox_reads AS r(user_id,conversation_id,read_at) VALUES(actor,p_id,seen)
    ON CONFLICT (user_id,conversation_id) DO UPDATE SET read_at=greatest(r.read_at,EXCLUDED.read_at);
  RETURN 'ok';
END;
$$;

-- An accepted reply enters the history at once. The signed echo later finds the
-- same provider ID and is treated as a duplicate; the lock is the processor's.
CREATE FUNCTION nina_channels.staff_chat_finish(p_account text,p_profile text,p_id uuid,p_operation uuid,p_status text,p_provider_id text,p_message text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE reply nina_channels.inbox_replies%ROWTYPE; receipt nina_channels.delivery_receipts%ROWTYPE; native uuid;
BEGIN
  IF NOT nina_clinic.can_write(false) OR p_status NOT IN ('accepted','rejected','uncertain')
    OR NOT EXISTS (SELECT 1 FROM nina_channels.processor_scope s WHERE s.account_id=p_account AND s.profile_id=p_profile) THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('nina-channel:'||p_account,0));
  UPDATE nina_channels.inbox_replies SET status=p_status,provider_message_id=p_provider_id
  WHERE operation_id=p_operation AND conversation_id=p_id AND account_id=p_account AND status='sending'
    AND actor_id=nullif(current_setting('nina.user_id',true),'')::uuid RETURNING * INTO reply;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_status<>'accepted' OR encode(sha256(convert_to(p_message,'UTF8')),'hex')<>reply.fingerprint THEN RETURN true; END IF;
  SELECT l.message_id INTO native FROM nina_channels.message_links l WHERE l.account_id=p_account AND l.external_id=p_provider_id;
  IF native IS NULL THEN
    SELECT m.id INTO native FROM nina_clinic.messages m WHERE m.conversation_id=p_id AND m.whatsapp_message_id=p_provider_id
      ORDER BY m.created_at,m.id LIMIT 1;
    IF native IS NULL THEN
      INSERT INTO nina_clinic.messages(conversation_id,whatsapp_message_id,type,from_type,content,status,sent_at,metadata)
      VALUES(p_id,p_provider_id,'text','human',p_message,'sent',clock_timestamp(),
        jsonb_build_object('source','nina_inbox','sent_via','api','standby',false)) RETURNING id INTO native;
    END IF;
    INSERT INTO nina_channels.message_links VALUES(p_account,p_provider_id,native) ON CONFLICT DO NOTHING;
    SELECT * INTO receipt FROM nina_channels.delivery_receipts d WHERE d.account_id=p_account AND d.external_id=p_provider_id;
    IF FOUND THEN
      UPDATE nina_clinic.messages SET delivered_at=receipt.delivered_at,read_at=receipt.read_at,
        status=CASE WHEN receipt.read_at IS NOT NULL THEN 'read' WHEN receipt.delivered_at IS NOT NULL THEN 'delivered'
          WHEN receipt.failed_at IS NOT NULL THEN 'failed' ELSE 'sent' END::nina_clinic.message_status WHERE id=native;
    END IF;
    UPDATE nina_clinic.conversations SET last_message_at=greatest(last_message_at,clock_timestamp()),updated_at=clock_timestamp() WHERE id=p_id;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION nina_channels.inbox_unread(uuid),nina_channels.staff_chat_list(text,text,text,text,integer),
  nina_channels.staff_chat_unread(text,text),nina_channels.staff_chat_thread(text,text,uuid,timestamptz,uuid,boolean),
  nina_channels.staff_chat_read(text,text,uuid,uuid),nina_channels.staff_chat_finish(text,text,uuid,uuid,text,text,text) FROM PUBLIC;
