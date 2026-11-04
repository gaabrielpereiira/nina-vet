-- Passive mirroring only. No AI, sends, handover or changes to clinical notes.
ALTER TYPE nina_clinic.message_from ADD VALUE 'external';
ALTER TABLE nina_clinic.contacts ALTER COLUMN phone_number DROP NOT NULL;
CREATE INDEX contacts_whatsapp_identity_idx ON nina_clinic.contacts(whatsapp_id) WHERE whatsapp_id IS NOT NULL;
CREATE INDEX contacts_phone_digits_idx ON nina_clinic.contacts((regexp_replace(phone_number,'[^0-9]','','g'))) WHERE phone_number IS NOT NULL;
CREATE INDEX conversations_provider_identity_idx ON nina_clinic.conversations(zernio_conversation_id) WHERE zernio_conversation_id IS NOT NULL;
CREATE INDEX messages_provider_identity_idx ON nina_clinic.messages(whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL;

ALTER TABLE nina_channels.zernio_inbox DROP CONSTRAINT zernio_inbox_status_check;
ALTER TABLE nina_channels.zernio_inbox ADD CONSTRAINT zernio_inbox_status_check
 CHECK(status IN ('pending','processing','processed','needs_review'));
ALTER TABLE nina_channels.zernio_inbox
 ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 ADD COLUMN available_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN lease_token uuid,
 ADD COLUMN lease_until timestamptz,
 ADD COLUMN processed_at timestamptz,
 ADD COLUMN last_error_code text CHECK(last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{1,60}$'),
 ADD CONSTRAINT zernio_lease_state CHECK
 ((status='processing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR
  (status<>'processing' AND lease_token IS NULL AND lease_until IS NULL));
CREATE INDEX zernio_work_queue_idx ON nina_channels.zernio_inbox(account_id,available_at,received_at)
 WHERE status IN ('pending','processing');

CREATE TABLE nina_channels.processor_scope(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 account_id text NOT NULL UNIQUE CHECK(account_id ~ '^[a-f0-9]{24}$'),
 profile_id text NOT NULL CHECK(profile_id ~ '^[a-f0-9]{24}$')
);
CREATE TABLE nina_channels.peer_links(
 account_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('bsuid','platform','phone')),
 external_id text NOT NULL CHECK(length(external_id) BETWEEN 1 AND 256),
 contact_id uuid NOT NULL REFERENCES nina_clinic.contacts(id),
 PRIMARY KEY(account_id,kind,external_id)
);
CREATE INDEX peer_links_contact_idx ON nina_channels.peer_links(contact_id);
CREATE TABLE nina_channels.conversation_links(
 account_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('internal','platform')),
 external_id text NOT NULL CHECK(length(external_id) BETWEEN 1 AND 512),
 conversation_id uuid NOT NULL REFERENCES nina_clinic.conversations(id),
 PRIMARY KEY(account_id,kind,external_id)
);
CREATE INDEX conversation_links_native_idx ON nina_channels.conversation_links(conversation_id);
CREATE TABLE nina_channels.message_links(
 account_id text NOT NULL,
 external_id text NOT NULL CHECK(length(external_id) BETWEEN 1 AND 512),
 message_id uuid NOT NULL REFERENCES nina_clinic.messages(id),
 PRIMARY KEY(account_id,external_id)
);
CREATE INDEX message_links_native_idx ON nina_channels.message_links(message_id);
CREATE TABLE nina_channels.delivery_receipts(
 account_id text NOT NULL,
 external_id text NOT NULL CHECK(length(external_id) BETWEEN 1 AND 512),
 sent_at timestamptz,
 delivered_at timestamptz,
 read_at timestamptz,
 failed_at timestamptz,
 failure_code text CHECK(failure_code IS NULL OR failure_code ~ '^[A-Za-z0-9_-]{1,60}$'),
 PRIMARY KEY(account_id,external_id)
);
CREATE TABLE nina_channels.media_files(
 id uuid PRIMARY KEY,
 account_id text NOT NULL CHECK(account_id ~ '^[a-f0-9]{24}$'),
 byte_count bigint NOT NULL CHECK(byte_count BETWEEN 1 AND 134217728),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 mime text NOT NULL CHECK(length(mime)<150 AND mime ~ '^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$'),
 display_name text CHECK(length(display_name)<=240),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE nina_channels.message_files(
 message_id uuid NOT NULL REFERENCES nina_clinic.messages(id),
 position integer NOT NULL CHECK(position BETWEEN 0 AND 9),
 file_id uuid NOT NULL REFERENCES nina_channels.media_files(id),
 type text NOT NULL CHECK(type IN ('audio','image','video','document')),
 original_type text NOT NULL CHECK(length(original_type) BETWEEN 1 AND 50),
 is_sticker boolean NOT NULL DEFAULT false,
 voice boolean NOT NULL DEFAULT false,
 PRIMARY KEY(message_id,position)
);
CREATE INDEX message_files_file_idx ON nina_channels.message_files(file_id);
CREATE TABLE nina_channels.processing_log(
 job_id uuid PRIMARY KEY REFERENCES nina_channels.zernio_inbox(id),
 outcome text NOT NULL CHECK(outcome IN ('message','duplicate','status')),
 message_id uuid REFERENCES nina_clinic.messages(id),
 completed_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ALL TABLES IN SCHEMA nina_channels FROM PUBLIC;

ALTER TABLE nina_channels.media_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_media_read ON nina_channels.media_files FOR SELECT USING(
 EXISTS(SELECT 1 FROM nina_auth.users u JOIN nina_auth.user_roles r ON r.user_id=u.id
 WHERE u.id=nullif(current_setting('nina.user_id',true),'')::uuid
 AND u.disabled_at IS NULL AND r.role IN ('admin','user'))
);
ALTER TABLE nina_channels.message_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_media_read ON nina_channels.message_files FOR SELECT USING(
 EXISTS(SELECT 1 FROM nina_auth.users u JOIN nina_auth.user_roles r ON r.user_id=u.id
 WHERE u.id=nullif(current_setting('nina.user_id',true),'')::uuid
 AND u.disabled_at IS NULL AND r.role IN ('admin','user'))
);

-- Activity-only writes must not invalidate an editor's optimistic revision.
-- Actual contact identity/name/notes edits still increment the revision.
CREATE OR REPLACE FUNCTION nina_clinic.bump_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='contacts' THEN
  IF (to_jsonb(NEW)-ARRAY['revision','updated_at','last_activity','whatsapp_id']) IS NOT DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['revision','updated_at','last_activity','whatsapp_id']) THEN
   NEW.revision:=OLD.revision; NEW.updated_at:=OLD.updated_at; RETURN NEW;
  END IF;
 END IF;
 NEW.revision:=OLD.revision+1; NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;

-- Functions are initially inaccessible. The coordinated role script changes
-- ownership to a dedicated NOLOGIN role before granting EXECUTE to nina_app.
CREATE FUNCTION nina_channels.runtime_status(p_account text,p_profile text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM nina_channels.processor_scope WHERE account_id=p_account AND profile_id=p_profile) THEN
  RETURN jsonb_build_object('scope_matches',false);
 END IF;
 RETURN (SELECT jsonb_build_object('scope_matches',true,
  'pending',count(*) FILTER(WHERE status='pending'),
  'processing',count(*) FILTER(WHERE status='processing'),
  'needs_review',count(*) FILTER(WHERE status='needs_review'),
  'processed',count(*) FILTER(WHERE status='processed'),
  'last_processed_at',max(processed_at))
 FROM nina_channels.zernio_inbox WHERE account_id=p_account);
END $$;

CREATE FUNCTION nina_channels.claim_job(p_account text,p_profile text,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE job nina_channels.zernio_inbox%ROWTYPE;
BEGIN
 IF p_lease IS NULL OR NOT EXISTS(SELECT 1 FROM nina_channels.processor_scope
  WHERE account_id=p_account AND profile_id=p_profile) THEN RAISE EXCEPTION 'CHANNEL_SCOPE_NOT_CONFIGURED'; END IF;
 UPDATE nina_channels.zernio_inbox SET status='needs_review',lease_token=NULL,lease_until=NULL,last_error_code='CHANNEL_RETRY_EXHAUSTED'
 WHERE account_id=p_account AND status='processing' AND lease_until<=clock_timestamp() AND attempts>=5;
 SELECT * INTO job FROM nina_channels.zernio_inbox
 WHERE account_id=p_account AND attempts<5 AND
  ((status='pending' AND available_at<=clock_timestamp()) OR (status='processing' AND lease_until<=clock_timestamp()))
 ORDER BY available_at,received_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE nina_channels.zernio_inbox SET status='processing',attempts=attempts+1,
  lease_token=p_lease,lease_until=clock_timestamp()+interval '120 seconds'
 WHERE id=job.id;
 RETURN jsonb_build_object('id',job.id,'account_id',job.account_id,'event_id',job.event_id,
  'event_type',job.event_type,'payload_sha256',job.payload_sha256,'payload_encrypted',job.payload_encrypted,'attempts',job.attempts+1);
END $$;

CREATE FUNCTION nina_channels.heartbeat_job(p_id uuid,p_lease uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 UPDATE nina_channels.zernio_inbox SET lease_until=clock_timestamp()+interval '120 seconds'
 WHERE id=p_id AND lease_token=p_lease AND status='processing' AND lease_until>clock_timestamp()
 AND account_id IN(SELECT account_id FROM nina_channels.processor_scope);
 RETURN FOUND;
END $$;

CREATE FUNCTION nina_channels.fail_job(p_id uuid,p_lease uuid,p_code text,p_retry boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_code IS NULL OR p_code !~ '^[A-Z0-9_]{1,60}$' THEN p_code:='CHANNEL_PROCESSING_FAILED'; END IF;
 UPDATE nina_channels.zernio_inbox SET
  status=CASE WHEN p_retry AND attempts<5 THEN 'pending' ELSE 'needs_review' END,
  available_at=clock_timestamp()+least(300,power(3,greatest(0,attempts-1))*5)*interval '1 second',
  last_error_code=p_code,lease_token=NULL,lease_until=NULL
 WHERE id=p_id AND lease_token=p_lease AND status='processing' AND lease_until>clock_timestamp()
 AND account_id IN(SELECT account_id FROM nina_channels.processor_scope);
 RETURN FOUND;
END $$;

CREATE FUNCTION nina_channels.apply_job(p_id uuid,p_lease uuid,p_plan jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
 job nina_channels.zernio_inbox%ROWTYPE; contact nina_clinic.contacts%ROWTYPE;
 convo nina_clinic.conversations%ROWTYPE; msg nina_clinic.messages%ROWTYPE;
 receipts nina_channels.delivery_receipts%ROWTYPE;
 peers jsonb; item jsonb; candidates uuid[]; conv_candidates uuid[];
 native_message uuid; duplicate boolean:=false; plan_kind text; number text; display text;
 at_time timestamptz; provider_id text; internal_convo text; platform_convo text;
 file_row nina_channels.media_files%ROWTYPE; position_no integer; prior_file uuid;
BEGIN
 SELECT * INTO job FROM nina_channels.zernio_inbox
 WHERE id=p_id AND lease_token=p_lease AND status='processing' AND lease_until>clock_timestamp()
 AND account_id IN(SELECT account_id FROM nina_channels.processor_scope) FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','lease_lost'); END IF;
 IF jsonb_typeof(p_plan) IS DISTINCT FROM 'object' OR
  (p_plan->>'event_id') IS DISTINCT FROM job.event_id::text OR
  (p_plan->>'event_type') IS DISTINCT FROM job.event_type OR
  (p_plan->>'account_id') IS DISTINCT FROM job.account_id OR
  length(coalesce(p_plan->>'provider_message_id','')) NOT BETWEEN 1 AND 512 THEN
  RAISE EXCEPTION 'CHANNEL_PLAN_MISMATCH';
 END IF;
 plan_kind:=p_plan->>'kind';provider_id:=p_plan->>'provider_message_id';
 PERFORM pg_advisory_xact_lock(hashtextextended('nina-channel:'||job.account_id,0));
 IF plan_kind='status' AND job.event_type IN('message.delivered','message.read','message.failed') THEN
  at_time:=(p_plan->>'status_at')::timestamptz;
  IF at_time IS NULL OR (p_plan->>'status') IS DISTINCT FROM substr(job.event_type,9) THEN RAISE EXCEPTION 'CHANNEL_PLAN_MISMATCH'; END IF;
  INSERT INTO nina_channels.delivery_receipts(account_id,external_id,delivered_at,read_at,failed_at,failure_code)
  VALUES(job.account_id,provider_id,
   CASE WHEN job.event_type='message.delivered' THEN at_time END,
   CASE WHEN job.event_type='message.read' THEN at_time END,
   CASE WHEN job.event_type='message.failed' THEN at_time END,p_plan->>'failure_code')
  ON CONFLICT(account_id,external_id) DO UPDATE SET
   delivered_at=greatest(nina_channels.delivery_receipts.delivered_at,EXCLUDED.delivered_at),
   read_at=greatest(nina_channels.delivery_receipts.read_at,EXCLUDED.read_at),
   failed_at=greatest(nina_channels.delivery_receipts.failed_at,EXCLUDED.failed_at),
   failure_code=coalesce(EXCLUDED.failure_code,nina_channels.delivery_receipts.failure_code);
  SELECT message_id INTO native_message FROM nina_channels.message_links
   WHERE account_id=job.account_id AND external_id=provider_id;
  IF native_message IS NULL THEN
   SELECT array_agg(id) INTO candidates FROM nina_clinic.messages WHERE whatsapp_message_id=provider_id;
   IF coalesce(array_length(candidates,1),0)=1 THEN
    native_message:=candidates[1];
    INSERT INTO nina_channels.message_links VALUES(job.account_id,provider_id,native_message) ON CONFLICT DO NOTHING;
   END IF;
  END IF;
 ELSIF plan_kind='message' AND job.event_type IN('message.received','message.sent') THEN
  IF (p_plan->>'direction') IS DISTINCT FROM (CASE WHEN job.event_type='message.received' THEN 'incoming' ELSE 'outgoing' END)
   OR (p_plan->>'from_type') IS NULL OR (p_plan->>'from_type') NOT IN('user','human','external')
   OR (job.event_type='message.received' AND p_plan->>'from_type'<>'user')
   OR (job.event_type='message.sent' AND p_plan->>'from_type'='user')
   OR length(coalesce(p_plan->>'text',''))>32768 OR jsonb_typeof(p_plan->'files') IS DISTINCT FROM 'array'
   OR jsonb_array_length(p_plan->'files')>10 THEN RAISE EXCEPTION 'CHANNEL_PLAN_MISMATCH'; END IF;
  at_time:=(p_plan->>'sent_at')::timestamptz;internal_convo:=p_plan->>'provider_conversation_id';platform_convo:=p_plan->>'platform_conversation_id';
  IF at_time IS NULL OR length(coalesce(internal_convo,'')) NOT BETWEEN 1 AND 512 THEN RAISE EXCEPTION 'CHANNEL_PLAN_MISMATCH'; END IF;
  peers:=p_plan->'peer';number:=peers->>'phone';display:=peers->>'name';
  IF number IS NOT NULL AND number !~ '^[1-9][0-9]{9,14}$' THEN RAISE EXCEPTION 'CHANNEL_PLAN_MISMATCH'; END IF;
  IF display IS NOT NULL AND length(display)>240 THEN RAISE EXCEPTION 'CHANNEL_PLAN_MISMATCH'; END IF;
  IF peers IS NOT NULL AND peers<>'null'::jsonb AND
   (jsonb_typeof(peers->'keys') IS DISTINCT FROM 'array' OR jsonb_array_length(peers->'keys') NOT BETWEEN 1 AND 3) THEN
   RAISE EXCEPTION 'CHANNEL_PLAN_MISMATCH';
  END IF;
  SELECT array_agg(DISTINCT c_id) INTO candidates FROM(
   SELECT l.contact_id AS c_id FROM nina_channels.peer_links l
    JOIN jsonb_array_elements(coalesce(peers->'keys','[]'::jsonb)) k
     ON l.kind=k->>'kind' AND l.external_id=k->>'value' WHERE l.account_id=job.account_id
   UNION SELECT c.id FROM nina_clinic.contacts c WHERE
    (number IS NOT NULL AND regexp_replace(c.phone_number,'[^0-9]','','g')=number)
    OR c.whatsapp_id IN(SELECT k->>'value' FROM jsonb_array_elements(coalesce(peers->'keys','[]'::jsonb)) k WHERE k->>'kind'='platform')
   UNION SELECT c.contact_id FROM nina_clinic.conversations c WHERE c.id IN(
    SELECT l.conversation_id FROM nina_channels.conversation_links l WHERE l.account_id=job.account_id
     AND ((l.kind='internal' AND l.external_id=internal_convo) OR (l.kind='platform' AND l.external_id=platform_convo)))
   UNION SELECT c.contact_id FROM nina_clinic.conversations c WHERE c.zernio_conversation_id IN(internal_convo,platform_convo)
   UNION SELECT c.contact_id FROM nina_clinic.messages m JOIN nina_clinic.conversations c ON c.id=m.conversation_id
    WHERE m.whatsapp_message_id=provider_id
  ) all_candidates;
  IF coalesce(array_length(candidates,1),0)>1 THEN RAISE EXCEPTION 'CHANNEL_AMBIGUOUS_CONTACT'; END IF;
  IF coalesce(array_length(candidates,1),0)=0 THEN
   IF peers IS NULL OR peers='null'::jsonb THEN RAISE EXCEPTION 'CHANNEL_MISSING_PEER'; END IF;
   INSERT INTO nina_clinic.contacts(phone_number,whatsapp_id,name,call_name,first_contact_date,last_activity,user_id)
   VALUES(number,(SELECT k->>'value' FROM jsonb_array_elements(peers->'keys') k WHERE k->>'kind'='platform' LIMIT 1),
    display,split_part(display,' ',1),at_time,at_time,NULL) RETURNING * INTO contact;
  ELSE
   SELECT * INTO contact FROM nina_clinic.contacts WHERE id=candidates[1] FOR UPDATE;
   IF number IS NOT NULL AND contact.phone_number IS NOT NULL AND
    regexp_replace(contact.phone_number,'[^0-9]','','g')<>number THEN RAISE EXCEPTION 'CHANNEL_IDENTITY_CONFLICT'; END IF;
   UPDATE nina_clinic.contacts SET last_activity=greatest(last_activity,at_time),
    phone_number=coalesce(phone_number,number),name=coalesce(name,display),
    call_name=CASE WHEN name IS NULL THEN coalesce(call_name,split_part(display,' ',1)) ELSE call_name END,
    whatsapp_id=coalesce(whatsapp_id,(SELECT k->>'value' FROM jsonb_array_elements(coalesce(peers->'keys','[]'::jsonb)) k WHERE k->>'kind'='platform' LIMIT 1))
    WHERE id=contact.id RETURNING * INTO contact;
  END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(coalesce(peers->'keys','[]'::jsonb)) LOOP
   IF (item->>'kind') NOT IN('bsuid','platform','phone') OR length(coalesce(item->>'value','')) NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'CHANNEL_PLAN_MISMATCH'; END IF;
   INSERT INTO nina_channels.peer_links VALUES(job.account_id,item->>'kind',item->>'value',contact.id) ON CONFLICT DO NOTHING;
   IF EXISTS(SELECT 1 FROM nina_channels.peer_links WHERE account_id=job.account_id AND kind=item->>'kind' AND external_id=item->>'value' AND contact_id<>contact.id) THEN RAISE EXCEPTION 'CHANNEL_IDENTITY_CONFLICT'; END IF;
  END LOOP;
  SELECT message_id INTO native_message FROM nina_channels.message_links WHERE account_id=job.account_id AND external_id=provider_id;
  IF native_message IS NULL THEN
   SELECT m.id INTO native_message FROM nina_clinic.messages m JOIN nina_clinic.conversations c ON c.id=m.conversation_id
    WHERE m.whatsapp_message_id=provider_id AND c.contact_id=contact.id ORDER BY m.created_at,m.id LIMIT 1;
  END IF;
  IF native_message IS NOT NULL THEN
   SELECT m.* INTO msg FROM nina_clinic.messages m JOIN nina_clinic.conversations c ON c.id=m.conversation_id
    WHERE m.id=native_message AND c.contact_id=contact.id;
   IF NOT FOUND THEN RAISE EXCEPTION 'CHANNEL_IDENTITY_CONFLICT'; END IF;
  END IF;
  SELECT array_agg(DISTINCT c_id) INTO conv_candidates FROM(
   SELECT conversation_id AS c_id FROM nina_channels.conversation_links
    WHERE account_id=job.account_id AND ((kind='internal' AND external_id=internal_convo) OR (kind='platform' AND external_id=platform_convo))
   UNION SELECT msg.conversation_id WHERE native_message IS NOT NULL
  ) known_conversations;
  IF coalesce(array_length(conv_candidates,1),0)>1 THEN RAISE EXCEPTION 'CHANNEL_AMBIGUOUS_CONVERSATION'; END IF;
  IF coalesce(array_length(conv_candidates,1),0)=1 THEN
   SELECT * INTO convo FROM nina_clinic.conversations WHERE id=conv_candidates[1] FOR UPDATE;
  ELSE
   SELECT array_agg(id) INTO conv_candidates FROM nina_clinic.conversations
    WHERE contact_id=contact.id AND zernio_conversation_id IN(internal_convo,platform_convo);
   IF coalesce(array_length(conv_candidates,1),0)>1 THEN RAISE EXCEPTION 'CHANNEL_AMBIGUOUS_CONVERSATION'; END IF;
   IF coalesce(array_length(conv_candidates,1),0)=1 THEN
    SELECT * INTO convo FROM nina_clinic.conversations WHERE id=conv_candidates[1] FOR UPDATE;
   ELSE
    SELECT array_agg(id) INTO conv_candidates FROM nina_clinic.conversations WHERE contact_id=contact.id AND is_active;
    IF coalesce(array_length(conv_candidates,1),0)>1 THEN RAISE EXCEPTION 'CHANNEL_AMBIGUOUS_CONVERSATION'; END IF;
    IF coalesce(array_length(conv_candidates,1),0)=1 THEN
     SELECT * INTO convo FROM nina_clinic.conversations WHERE id=conv_candidates[1] FOR UPDATE;
    ELSE
     INSERT INTO nina_clinic.conversations(contact_id,status,is_active,ai_paused,ai_paused_reason,
       zernio_conversation_id,started_at,last_message_at,user_id)
     VALUES(contact.id,'human',true,true,'Atendimento pela equipe',internal_convo,at_time,at_time,NULL) RETURNING * INTO convo;
    END IF;
   END IF;
  END IF;
  IF convo.contact_id<>contact.id THEN RAISE EXCEPTION 'CHANNEL_IDENTITY_CONFLICT'; END IF;
  INSERT INTO nina_channels.conversation_links VALUES(job.account_id,'internal',internal_convo,convo.id) ON CONFLICT DO NOTHING;
  IF platform_convo IS NOT NULL THEN INSERT INTO nina_channels.conversation_links VALUES(job.account_id,'platform',platform_convo,convo.id) ON CONFLICT DO NOTHING; END IF;
  IF native_message IS NULL THEN
   INSERT INTO nina_clinic.messages(conversation_id,whatsapp_message_id,type,from_type,content,status,sent_at,metadata)
   VALUES(convo.id,provider_id,coalesce(p_plan->'files'->0->>'type','text')::nina_clinic.message_type,
    (p_plan->>'from_type')::nina_clinic.message_from,p_plan->>'text','sent',at_time,
    jsonb_build_object('source','zernio','sent_via',p_plan->'sent_via','standby',p_plan->'standby')) RETURNING * INTO msg;
   native_message:=msg.id;
  ELSE
   duplicate:=true;
   SELECT m.* INTO msg FROM nina_clinic.messages m JOIN nina_clinic.conversations c ON c.id=m.conversation_id
    WHERE m.id=native_message AND c.contact_id=contact.id;
   IF NOT FOUND THEN RAISE EXCEPTION 'CHANNEL_IDENTITY_CONFLICT'; END IF;
  END IF;
  INSERT INTO nina_channels.message_links VALUES(job.account_id,provider_id,native_message) ON CONFLICT DO NOTHING;
  FOR item IN SELECT * FROM jsonb_array_elements(p_plan->'files') LOOP
   position_no:=(item->>'index')::integer;
   IF position_no IS NULL OR position_no NOT BETWEEN 0 AND 9 THEN RAISE EXCEPTION 'CHANNEL_PLAN_MISMATCH'; END IF;
   INSERT INTO nina_channels.media_files(id,account_id,byte_count,sha256,mime,display_name)
    VALUES((item->>'id')::uuid,job.account_id,(item->>'bytes')::bigint,item->>'sha256',item->>'mime',item->>'filename') ON CONFLICT DO NOTHING;
   SELECT * INTO file_row FROM nina_channels.media_files WHERE id=(item->>'id')::uuid;
   IF file_row.account_id<>job.account_id OR file_row.byte_count<>(item->>'bytes')::bigint OR file_row.sha256 IS DISTINCT FROM item->>'sha256' OR file_row.mime IS DISTINCT FROM item->>'mime' THEN RAISE EXCEPTION 'CHANNEL_MEDIA_CONFLICT'; END IF;
   SELECT file_id INTO prior_file FROM nina_channels.message_files WHERE message_id=native_message AND position=position_no;
   IF prior_file IS NOT NULL AND prior_file<>file_row.id THEN RAISE EXCEPTION 'CHANNEL_MEDIA_CONFLICT'; END IF;
   INSERT INTO nina_channels.message_files VALUES(native_message,position_no,file_row.id,item->>'type',item->>'original_type',
    coalesce((item->>'is_sticker')::boolean,false),coalesce((item->>'voice')::boolean,false)) ON CONFLICT DO NOTHING;
   IF position_no=0 THEN UPDATE nina_clinic.messages SET media_url='/v1/files/'||file_row.id,media_type=file_row.mime WHERE id=native_message; END IF;
  END LOOP;
  UPDATE nina_clinic.conversations SET last_message_at=greatest(last_message_at,at_time),
   zernio_conversation_id=coalesce(zernio_conversation_id,internal_convo),updated_at=clock_timestamp() WHERE id=convo.id;
  IF job.event_type='message.sent' THEN
   INSERT INTO nina_channels.delivery_receipts(account_id,external_id,sent_at) VALUES(job.account_id,provider_id,at_time)
    ON CONFLICT(account_id,external_id) DO UPDATE SET sent_at=greatest(nina_channels.delivery_receipts.sent_at,EXCLUDED.sent_at);
  END IF;
 ELSE RAISE EXCEPTION 'CHANNEL_PLAN_MISMATCH';
 END IF;
 IF native_message IS NOT NULL THEN
  SELECT * INTO receipts FROM nina_channels.delivery_receipts WHERE account_id=job.account_id AND external_id=provider_id;
  IF FOUND THEN
   UPDATE nina_clinic.messages SET
    delivered_at=greatest(delivered_at,receipts.delivered_at),
    read_at=greatest(read_at,receipts.read_at),
    status=CASE WHEN read_at IS NOT NULL OR receipts.read_at IS NOT NULL THEN 'read'::nina_clinic.message_status
     WHEN delivered_at IS NOT NULL OR receipts.delivered_at IS NOT NULL THEN 'delivered'::nina_clinic.message_status
     WHEN receipts.failed_at IS NOT NULL AND receipts.failed_at>=coalesce(receipts.sent_at,'-infinity'::timestamptz) THEN 'failed'::nina_clinic.message_status
     ELSE status END
   WHERE id=native_message AND from_type<>'user';
  END IF;
 END IF;
 UPDATE nina_channels.zernio_inbox SET status='processed',processed_at=clock_timestamp(),lease_token=NULL,lease_until=NULL,last_error_code=NULL WHERE id=job.id;
 INSERT INTO nina_channels.processing_log(job_id,outcome,message_id)
 VALUES(job.id,CASE WHEN plan_kind='status' THEN 'status' WHEN duplicate THEN 'duplicate' ELSE 'message' END,native_message);
 RETURN jsonb_build_object('status','processed','message_id',native_message,'duplicate',duplicate);
END $$;

REVOKE ALL ON FUNCTION nina_channels.runtime_status(text,text),
 nina_channels.claim_job(text,text,uuid),nina_channels.heartbeat_job(uuid,uuid),
 nina_channels.fail_job(uuid,uuid,text,boolean),nina_channels.apply_job(uuid,uuid,jsonb) FROM PUBLIC;
