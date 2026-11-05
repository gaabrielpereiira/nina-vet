-- Business configuration only. Never store provider credentials or enable replies here.
SET LOCAL lock_timeout='5s';
CREATE SCHEMA nina_agent;
REVOKE ALL ON SCHEMA nina_agent FROM PUBLIC;
CREATE TABLE nina_agent.settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=131072
   AND payload - ARRAY['company_name','assistant_name','system_prompt','timezone','business_hours_start',
     'business_hours_end','business_days','scheduling_policy','response_delay_min','response_delay_max',
     'message_breaking_enabled','audio_response_requested','source_scheduling_flag','source_automation_active',
     'source_auto_response_enabled','source_model_mode','source_business_hours_end','review_notes']::text[]='{}'::jsonb),
 source_snapshot_sha256 text NOT NULL CHECK(source_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
 source_payload_sha256 text NOT NULL CHECK(source_payload_sha256 ~ '^[a-f0-9]{64}$'),
 payload_sha256 text NOT NULL CHECK(payload_sha256=encode(sha256(convert_to(payload::text,'UTF8')),'hex')),
 imported_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE nina_agent.settings FROM PUBLIC;
ALTER TABLE nina_agent.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_read ON nina_agent.settings FOR SELECT USING (
 EXISTS(SELECT 1 FROM nina_auth.users u JOIN nina_auth.user_roles r ON r.user_id=u.id
   WHERE u.id=nullif(current_setting('nina.user_id',true),'')::uuid AND u.disabled_at IS NULL AND r.role='admin')
);
