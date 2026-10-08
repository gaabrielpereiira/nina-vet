CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL, title text NOT NULL, body text,
  conversation_id uuid, contact_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications (is_read);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_template_id text, name text NOT NULL,
  category text NOT NULL DEFAULT 'MARKETING',
  language text NOT NULL DEFAULT 'pt_BR',
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  samples jsonb, status text NOT NULL DEFAULT 'draft',
  quality_rating text, rejected_reason text, user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_templates_name_language_unique UNIQUE (name, language)
);
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS update_whatsapp_templates_updated_at ON public.whatsapp_templates;
CREATE TRIGGER update_whatsapp_templates_updated_at BEFORE UPDATE ON public.whatsapp_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.nina_settings ADD COLUMN IF NOT EXISTS wc_webhook_secret text;

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'woocommerce',
  received_at timestamptz NOT NULL DEFAULT now(),
  processed boolean NOT NULL DEFAULT false,
  error text,
  retry_count integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz, last_error_at timestamptz,
  external_id text, event_signature text,
  dry_run boolean NOT NULL DEFAULT false,
  processing_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_topic ON public.webhook_events(topic);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON public.webhook_events(processed);
CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON public.webhook_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_retry ON public.webhook_events (next_retry_at) WHERE processed = false AND next_retry_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_dedup_idx ON public.webhook_events (source, topic, external_id, event_signature) WHERE external_id IS NOT NULL AND event_signature IS NOT NULL;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, trigger_topic text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{"conditions":[],"logic":"AND"}'::jsonb,
  action_type text NOT NULL,
  action_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  cooldown_hours integer NOT NULL DEFAULT 0,
  delay_minutes integer NOT NULL DEFAULT 0,
  cancel_if_changed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automation_rules_topic_active ON public.automation_rules(trigger_topic, active);
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_automation_rules_updated_at ON public.automation_rules;
CREATE TRIGGER trg_automation_rules_updated_at BEFORE UPDATE ON public.automation_rules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.automation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.webhook_events(id) ON DELETE SET NULL,
  status text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  executed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automation_logs_rule ON public.automation_logs(rule_id, executed_at DESC);
ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.contact_cooldowns (
  contact_phone text NOT NULL,
  rule_id uuid NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_phone, rule_id)
);
ALTER TABLE public.contact_cooldowns ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  woo_order_id bigint NOT NULL UNIQUE,
  contact_id uuid, status text, total numeric(12,2), currency text,
  customer_id bigint, customer_email text, customer_phone text, customer_name text,
  payment_method text, payment_method_title text,
  is_first_order boolean DEFAULT false,
  line_items jsonb DEFAULT '[]'::jsonb, billing jsonb DEFAULT '{}'::jsonb, raw_payload jsonb DEFAULT '{}'::jsonb,
  order_created_at timestamptz, last_processed_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_contact_id ON public.orders(contact_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON public.orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_order_created_at ON public.orders(order_created_at DESC);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS update_orders_updated_at ON public.orders;
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.automation_executions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_id uuid NOT NULL, external_id text NOT NULL, target_signature text NOT NULL,
  event_id uuid, executed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, external_id, target_signature)
);
ALTER TABLE public.automation_executions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.automation_scheduled (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.webhook_events(id) ON DELETE SET NULL,
  external_id text, target_signature text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status_at_schedule text, scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending', cancel_reason text, executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.automation_scheduled ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_automation_scheduled_pending ON public.automation_scheduled (status, scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_automation_scheduled_rule ON public.automation_scheduled (rule_id, status);
DROP TRIGGER IF EXISTS update_automation_scheduled_updated_at ON public.automation_scheduled;
CREATE TRIGGER update_automation_scheduled_updated_at BEFORE UPDATE ON public.automation_scheduled
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE(is_read) ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
CREATE POLICY "Team reads notifications" ON public.notifications FOR SELECT TO authenticated USING (true);
CREATE POLICY "Team marks notifications read" ON public.notifications FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

REVOKE ALL ON public.whatsapp_templates FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_templates TO authenticated;
GRANT ALL ON public.whatsapp_templates TO service_role;
CREATE POLICY "Team reads whatsapp_templates" ON public.whatsapp_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins configure whatsapp_templates" ON public.whatsapp_templates FOR ALL TO authenticated
USING (public.has_role((select auth.uid()), 'admin')) WITH CHECK (public.has_role((select auth.uid()), 'admin'));

REVOKE ALL ON public.automation_rules FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_rules TO authenticated;
GRANT ALL ON public.automation_rules TO service_role;
CREATE POLICY "Team reads automation_rules" ON public.automation_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins configure automation_rules" ON public.automation_rules FOR ALL TO authenticated
USING (public.has_role((select auth.uid()), 'admin')) WITH CHECK (public.has_role((select auth.uid()), 'admin'));

REVOKE ALL ON public.automation_logs FROM anon, authenticated;
GRANT SELECT ON public.automation_logs TO authenticated;
GRANT ALL ON public.automation_logs TO service_role;
CREATE POLICY "Team reads automation_logs" ON public.automation_logs FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.webhook_events FROM anon, authenticated;
GRANT SELECT ON public.webhook_events TO authenticated;
GRANT ALL ON public.webhook_events TO service_role;
CREATE POLICY "Team reads webhook_events" ON public.webhook_events FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.contact_cooldowns FROM anon, authenticated;
GRANT SELECT ON public.contact_cooldowns TO authenticated;
GRANT ALL ON public.contact_cooldowns TO service_role;
CREATE POLICY "Team reads contact_cooldowns" ON public.contact_cooldowns FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.automation_executions FROM anon, authenticated;
GRANT SELECT ON public.automation_executions TO authenticated;
GRANT ALL ON public.automation_executions TO service_role;
CREATE POLICY "Team reads automation_executions" ON public.automation_executions FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.automation_scheduled FROM anon, authenticated;
GRANT SELECT ON public.automation_scheduled TO authenticated;
GRANT ALL ON public.automation_scheduled TO service_role;
CREATE POLICY "Team reads automation_scheduled" ON public.automation_scheduled FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.orders FROM anon, authenticated;
GRANT SELECT ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
CREATE POLICY "Team reads orders" ON public.orders FOR SELECT TO authenticated USING (true);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notifications','automation_logs','automation_scheduled','whatsapp_templates','webhook_events','automation_rules'] LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;

CREATE SCHEMA IF NOT EXISTS automation_private;
REVOKE ALL ON SCHEMA automation_private FROM PUBLIC;
CREATE OR REPLACE FUNCTION automation_private.capture_deal_won()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  stage_title text; old_stage_title text;
  contact_row public.contacts%ROWTYPE;
  last_order public.orders%ROWTYPE;
BEGIN
  SELECT title INTO stage_title FROM public.pipeline_stages WHERE id = NEW.stage_id;
  IF TG_OP = 'UPDATE' THEN
    SELECT title INTO old_stage_title FROM public.pipeline_stages WHERE id = OLD.stage_id;
    IF lower(coalesce(old_stage_title, '')) = 'ganho' OR OLD.won_at IS NOT NULL THEN RETURN NEW; END IF;
  END IF;
  IF lower(coalesce(stage_title, '')) <> 'ganho' AND NEW.won_at IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO contact_row FROM public.contacts WHERE id = NEW.contact_id;
  SELECT * INTO last_order FROM public.orders WHERE contact_id = NEW.contact_id ORDER BY order_created_at DESC NULLS LAST LIMIT 1;
  INSERT INTO public.webhook_events(topic, source, external_id, event_signature, payload)
  VALUES ('pipeline.deal.won', 'pipeline', NEW.id::text, gen_random_uuid()::text,
    jsonb_build_object(
      'deal', jsonb_build_object('id', NEW.id, 'title', NEW.title, 'company', NEW.company, 'value', NEW.value),
      'contact', jsonb_build_object('id', contact_row.id, 'name', contact_row.name, 'phone', contact_row.phone_number, 'email', contact_row.email),
      'order', jsonb_build_object('number', last_order.woo_order_id, 'total', last_order.total, 'status', last_order.status)
    ));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION automation_private.capture_deal_won() FROM PUBLIC;
DROP TRIGGER IF EXISTS capture_automation_deal_won ON public.deals;
CREATE TRIGGER capture_automation_deal_won AFTER INSERT OR UPDATE OF stage_id, won_at ON public.deals
FOR EACH ROW EXECUTE FUNCTION automation_private.capture_deal_won();

CREATE OR REPLACE FUNCTION public.cleanup_webhook_data()
RETURNS TABLE(events_deleted bigint, logs_deleted bigint)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_events bigint; v_logs bigint;
BEGIN
  WITH d AS (DELETE FROM public.automation_logs WHERE executed_at < now() - interval '30 days' RETURNING 1) SELECT count(*) INTO v_logs FROM d;
  WITH d AS (DELETE FROM public.webhook_events WHERE processed AND received_at < now() - interval '90 days' RETURNING 1) SELECT count(*) INTO v_events FROM d;
  RETURN QUERY SELECT v_events, v_logs;
END $$;
REVOKE ALL ON FUNCTION public.cleanup_webhook_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_webhook_data() TO service_role;