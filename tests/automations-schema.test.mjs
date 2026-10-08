import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

// Real PostgreSQL (WASM), isolated from the live clinic. Bootstrap only the
// existing Nina tables/auth primitives referenced by the new migration.
const bootstrap = `
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TABLE public.user_roles(user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(u uuid, r public.app_role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = u AND role = r)
$$;
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN NEW.updated_at = now(); RETURN NEW; END
$$;
CREATE TABLE public.nina_settings(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, phone_number text, email text);
CREATE TABLE public.pipeline_stages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text);
CREATE TABLE public.deals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, company text, value numeric,
 contact_id uuid, stage_id uuid, won_at timestamptz);
CREATE PUBLICATION supabase_realtime;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
GRANT SELECT, INSERT, UPDATE ON public.deals, public.contacts, public.pipeline_stages TO authenticated;
`;

async function migrated() {
  const db = new PGlite();
  await db.exec(bootstrap);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261008160347_import_automations_module.sql', import.meta.url), 'utf8'));
  return db;
}

test('migration creates all automation dependencies and a working win trigger', async () => {
  const db = await migrated();
  try {
    const tables = (await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'`)).rows.map(r => r.tablename);
    for (const table of ['automation_rules','automation_logs','automation_executions','automation_scheduled','webhook_events','contact_cooldowns','orders','notifications','whatsapp_templates'])
      assert.ok(tables.includes(table), table);
    const { rows: [contact] } = await db.query(`INSERT INTO contacts(name, phone_number, email) VALUES ('Tutor', '5511999999999', 'tutor@example.com') RETURNING id`);
    const { rows: [stage] } = await db.query(`INSERT INTO pipeline_stages(title) VALUES ('Ganho') RETURNING id`);
    const { rows: [deal] } = await db.query(`INSERT INTO deals(title, contact_id) VALUES ('Consulta', $1) RETURNING id`, [contact.id]);
    await db.query(`UPDATE deals SET stage_id=$1 WHERE id=$2`, [stage.id, deal.id]);
    let events = (await db.query(`SELECT topic, payload FROM webhook_events`)).rows;
    assert.equal(events.length, 1);
    assert.equal(events[0].topic, 'pipeline.deal.won');
    assert.equal(events[0].payload.contact.phone, '5511999999999');
    assert.equal(events[0].payload.deal.title, 'Consulta');
    await db.query(`UPDATE deals SET won_at=now() WHERE id=$1`, [deal.id]);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM webhook_events`)).rows[0].n, 1, 'same win must not emit twice');
  } finally { await db.close(); }
});

test('RLS permits team reads, restricts rule writes to admins and blocks anonymous access', async () => {
  const db = await migrated();
  try {
    await db.exec(`INSERT INTO user_roles VALUES ('00000000-0000-0000-0000-000000000001', 'admin');
      INSERT INTO automation_rules(name, trigger_topic, action_type) VALUES ('Teste', 'order.created', 'crm_update');`);
    await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';`);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM automation_rules`)).rows[0].n, 1);
    await assert.rejects(db.query(`INSERT INTO automation_rules(name, trigger_topic, action_type) VALUES ('Não autorizado','order.created','crm_update')`), /row-level security/);
    await assert.rejects(db.query(`INSERT INTO webhook_events(topic) VALUES ('order.created')`), /permission denied/);
    await db.exec(`SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';`);
    await db.query(`INSERT INTO automation_rules(name, trigger_topic, action_type) VALUES ('Admin','order.created','crm_update')`);
    await db.exec(`RESET ROLE; SET ROLE anon;`);
    await assert.rejects(db.query(`SELECT * FROM automation_rules`), /permission denied/);
    await assert.rejects(db.query(`SELECT * FROM cleanup_webhook_data()`), /permission denied/);
  } finally { await db.close(); }
});

test('database constraints prevent duplicate deliveries and duplicate rule executions', async () => {
  const db = await migrated();
  try {
    await db.exec(`INSERT INTO webhook_events(topic, source, external_id, event_signature) VALUES ('order.created','woocommerce','123','sha');`);
    await assert.rejects(db.exec(`INSERT INTO webhook_events(topic, source, external_id, event_signature) VALUES ('order.created','woocommerce','123','sha');`), /duplicate key/);
    await db.exec(`INSERT INTO automation_executions(rule_id, external_id, target_signature) VALUES ('00000000-0000-0000-0000-000000000001','123','status=processing');`);
    await assert.rejects(db.exec(`INSERT INTO automation_executions(rule_id, external_id, target_signature) VALUES ('00000000-0000-0000-0000-000000000001','123','status=processing');`), /duplicate key/);
  } finally { await db.close(); }
});
