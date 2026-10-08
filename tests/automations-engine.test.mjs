import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEdge, postgrest } from './support/edge-harness.mjs';

const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const bootstrap = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE TYPE app_role AS ENUM ('admin','user');
CREATE FUNCTION has_role(uuid, app_role) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
CREATE TABLE nina_settings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_active boolean DEFAULT true, auto_response_enabled boolean DEFAULT true, created_at timestamptz DEFAULT now(), user_id uuid);
CREATE TABLE contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, phone_number text, whatsapp_id text, email text, tags jsonb DEFAULT '[]');
CREATE TABLE conversations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid, status text DEFAULT 'nina', is_active boolean DEFAULT true, ai_paused boolean DEFAULT false, archived_at timestamptz, created_at timestamptz DEFAULT now(), last_message_at timestamptz DEFAULT now());
CREATE TABLE pipeline_stages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text);
CREATE TABLE deals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text,company text,value numeric,contact_id uuid,stage_id uuid,won_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE send_queue(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid, contact_id uuid, from_type text, message_type text, content text, priority int, metadata jsonb);
CREATE PUBLICATION supabase_realtime;
INSERT INTO nina_settings DEFAULT VALUES;
`;

async function fixture() {
  const db = new PGlite();
  await db.exec(bootstrap);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261008160347_import_automations_module.sql', import.meta.url), 'utf8'));
  const client = postgrest(db);
  const { context: { getNinaAutomationBlockReason } } = loadEdge('_shared/nina-automation.ts');
  const runner = loadEdge('automation-runner/index.ts', { getNinaAutomationBlockReason }).context;
  const scheduler = loadEdge('automation-scheduler/index.ts', { getNinaAutomationBlockReason }).context;
  const rule = { id: uid(1), name: 'Confirmação', trigger_topic: 'order.updated', action_type: 'internal_notification', action_config: { title: 'Pedido {{id}} confirmado', body: 'Olá {{billing.first_name}}' }, filters: { conditions: [{ field: 'status', operator: 'changed_to', value: 'processing' }], logic: 'AND' }, active: true, cooldown_hours: 0, delay_minutes: 0, cancel_if_changed: true };
  await client.from('automation_rules').insert(rule);
  async function event(overrides = {}) {
    const ev = { topic: 'order.created', payload: { id: 123, status: 'processing', billing: { phone: '11999999999', first_name: 'Tutor', email: 'tutor@example.com' } }, source: 'woocommerce', ...overrides };
    const { data, error } = await client.from('webhook_events').insert(ev).select('*').single();
    if (error) throw new Error(error.message);
    return data;
  }
  return { db, client, runner, scheduler, rule, event };
}

async function withFixture(fn) { const f = await fixture(); try { await fn(f); } finally { await f.db.close(); } }

test('incoming paid order matches an updated-status rule, creates a notification and deduplicates the next delivery', () => withFixture(async f => {
  await f.runner.processEvent(f.client, await f.event());
  assert.equal((await f.db.query('SELECT title FROM notifications')).rows[0].title, 'Pedido 123 confirmado');
  await f.runner.processEvent(f.client, await f.event({ topic: 'order.updated' }));
  assert.equal((await f.db.query('SELECT count(*)::int n FROM notifications')).rows[0].n, 1);
}));

test('dry-run logs matching rules without orders, notifications, claims or sends', () => withFixture(async f => {
  await f.runner.processEvent(f.client, await f.event({ dry_run: true }));
  const { rows } = await f.db.query('SELECT result FROM automation_logs');
  assert.equal(rows[0].result.reason, 'dry_run');
  for (const table of ['orders','notifications','automation_executions','send_queue'])
    assert.equal((await f.db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n, 0, table);
}));

test('delay schedules an action and cancels it when the order status changes', () => withFixture(async f => {
  await f.db.exec('UPDATE automation_rules SET delay_minutes=60');
  await f.runner.processEvent(f.client, await f.event());
  const sch = (await f.db.query('SELECT * FROM automation_scheduled')).rows[0];
  assert.equal(sch.status, 'pending');
  assert.equal((await f.db.query('SELECT count(*)::int n FROM notifications')).rows[0].n, 0);
  await f.db.exec("UPDATE orders SET status='cancelled'");
  await f.scheduler.processScheduled(f.client, sch);
  assert.equal((await f.db.query('SELECT status, cancel_reason FROM automation_scheduled')).rows[0].status, 'cancelled');
  assert.equal((await f.db.query('SELECT cancel_reason FROM automation_scheduled')).rows[0].cancel_reason, 'status_changed');
}));

test('delayed action executes once when the precondition still holds', () => withFixture(async f => {
  await f.db.exec('UPDATE automation_rules SET delay_minutes=1');
  await f.runner.processEvent(f.client, await f.event());
  const sch = (await f.db.query('SELECT * FROM automation_scheduled')).rows[0];
  await f.scheduler.processScheduled(f.client, sch);
  await f.scheduler.processScheduled(f.client, sch);
  assert.equal((await f.db.query('SELECT count(*)::int n FROM notifications')).rows[0].n, 1);
  assert.equal((await f.db.query('SELECT status FROM automation_scheduled')).rows[0].status, 'executed');
}));

test('WhatsApp automation queues an approved template with resolved variables and observes cooldown', () => withFixture(async f => {
  const tpl = (await f.client.from('whatsapp_templates').insert({ name: 'consulta', language: 'pt_BR', status: 'APPROVED', components: [{ type: 'BODY', text: 'Olá {{1}}' }] }).select('*').single()).data;
  const rule = { ...f.rule, action_type: 'whatsapp_message', cooldown_hours: 24, action_config: { template_id: tpl.id, variables: ['billing.first_name'] } };
  const ev = await f.event();
  const result = await f.runner.actionWhatsapp(f.client, rule, ev);
  assert.equal(result.status, 'success', JSON.stringify(result));
  const row = (await f.db.query('SELECT * FROM send_queue')).rows[0];
  assert.equal(row.content, 'Olá Tutor');
  assert.equal(row.metadata.template.variables['1'], 'Tutor');
  assert.equal((await f.runner.actionWhatsapp(f.client, rule, ev)).result.reason, 'cooldown');
}));

test('global human mode skips immediate and delayed WhatsApp actions', () => withFixture(async f => {
  await f.db.exec('UPDATE nina_settings SET auto_response_enabled=false');
  const rule = { ...f.rule, action_type: 'whatsapp_message' };
  const ev = await f.event();
  assert.equal((await f.runner.actionWhatsapp(f.client, rule, ev)).result.reason, 'nina_globally_paused');
  assert.equal((await f.scheduler.actionWhatsapp(f.client, rule, ev.payload)).result.reason, 'nina_globally_paused');
  assert.equal((await f.db.query('SELECT count(*)::int n FROM send_queue')).rows[0].n, 0);
}));

test('pipeline event resolves contact.phone and variables instead of billing.phone', () => withFixture(async f => {
  const tpl = (await f.client.from('whatsapp_templates').insert({ name: 'ganho', status: 'APPROVED', components: [{ type: 'BODY', text: 'Olá {{1}}, {{2}}' }] }).select('*').single()).data;
  const rule = { ...f.rule, trigger_topic: 'pipeline.deal.won', action_type: 'whatsapp_message', action_config: { template_id: tpl.id, variables: ['contact.name','deal.title'] } };
  const ev = await f.event({ topic: rule.trigger_topic, payload: { contact: { name: 'Tutor', phone: '11999999999' }, deal: { title: 'Consulta' } } });
  const result = await f.runner.actionWhatsapp(f.client, rule, ev);
  assert.equal(result.status, 'success', JSON.stringify(result));
  assert.equal((await f.db.query('SELECT content FROM send_queue')).rows[0].content, 'Olá Tutor, Consulta');
}));


test('CRM action updates tags and moves the contact deal', () => withFixture(async f => {
  const contact = (await f.client.from('contacts').insert({ name: 'Tutor', phone_number: '5511999999999', tags: ['tutor'] }).select('*').single()).data;
  const stage = (await f.client.from('pipeline_stages').insert({ title: 'Em atendimento' }).select('*').single()).data;
  await f.client.from('deals').insert({ contact_id: contact.id, title: 'Consulta' });
  const result = await f.runner.actionCrmUpdate(f.client, { ...f.rule, action_config: { add_tags: ['retorno'], move_deal_stage_id: stage.id } }, { payload: { billing: { phone: '5511999999999' } } });
  assert.equal(result.status, 'success');
  assert.deepEqual((await f.db.query('SELECT tags FROM contacts')).rows[0].tags, ['tutor','retorno']);
  assert.equal((await f.db.query('SELECT stage_id FROM deals')).rows[0].stage_id, stage.id);
}));

test('delayed pipeline action is cancelled if the deal leaves the won stage', () => withFixture(async f => {
  const stage = (await f.client.from('pipeline_stages').insert({ title: 'Em atendimento' }).select('*').single()).data;
  const deal = (await f.client.from('deals').insert({ title: 'Consulta', stage_id: stage.id }).select('*').single()).data;
  const result = await f.scheduler.preconditionStillValid(f.client, { ...f.rule, trigger_topic: 'pipeline.deal.won' }, { payload: { deal: { id: deal.id } } });
  assert.equal(result.reason, 'deal_no_longer_won');
}));

test('a failed rule releases its execution claim so the retry can actually execute it', () => withFixture(async f => {
  await f.db.exec("UPDATE automation_rules SET action_type='whatsapp_message', action_config='{}'");
  const ev = await f.event();
  await assert.rejects(f.runner.processEvent(f.client, ev), /automation actions failed/);
  assert.equal((await f.db.query('SELECT count(*)::int n FROM automation_executions')).rows[0].n, 0);
  await f.runner.scheduleRetry(f.client, ev, 'temporary failure');
  const state = (await f.db.query('SELECT processed, retry_count, next_retry_at, processing_at FROM webhook_events')).rows[0];
  assert.equal(state.processed, false);
  assert.equal(state.retry_count, 1);
  assert.ok(state.next_retry_at);
  assert.equal(state.processing_at, null);
  await f.db.exec("UPDATE automation_rules SET action_type='internal_notification', action_config='{\"title\":\"Retry worked\"}'");
  await f.runner.processEvent(f.client, ev);
  assert.equal((await f.db.query('SELECT title FROM notifications')).rows[0].title, 'Retry worked');
}));

for (const [token, user, admin, expected] of [[null,null,false,401],['bad',null,false,401],['member',{id:uid(99)},false,403],['admin',{id:uid(99)},true,null],['service-key',null,false,null]]) {
  test(`worker authorization: ${token ?? 'anonymous'} → ${expected ?? 'allowed'}`, async () => {
    const { context: { authorizeAutomationRequest } } = loadEdge('_shared/automation-auth.ts');
    const supabase = { auth: { getUser: async () => ({ data: { user }, error: user ? null : new Error('invalid') }) }, from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: admin ? { role: 'admin' } : null, error: null }) }; return q; } };
    const response = await authorizeAutomationRequest(new Request('https://test.example', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} }), supabase);
    assert.equal(response?.status ?? null, expected);
  });
}

test('WooCommerce receiver rejects unsigned requests, verifies HMAC and deduplicates valid redelivery', () => withFixture(async f => {
  await f.db.exec("UPDATE nina_settings SET wc_webhook_secret='test-hmac-secret'");
  await f.db.exec("INSERT INTO nina_settings(created_at, wc_webhook_secret) VALUES (now() + interval '1 day', 'other-secret')");
  const requests = [];
  const receiver = loadEdge('wc-receiver/index.ts', { createClient: () => f.client, fetch: async (...args) => { requests.push(args); return new Response('{}'); } });
  const body = JSON.stringify({ id: 123, status: 'processing' });
  const unsigned = await receiver.handler(new Request('https://test.example', { method: 'POST', body }));
  assert.equal(unsigned.status, 401);
  const signature = await receiver.context.hmacBase64('test-hmac-secret', body);
  const request = () => new Request('https://test.example', { method: 'POST', body, headers: { 'x-wc-webhook-signature': signature, 'x-wc-webhook-topic': 'order.created' } });
  assert.equal((await receiver.handler(request())).status, 200);
  const second = await receiver.handler(request());
  assert.equal((await second.json()).duplicate, true);
  assert.equal((await f.db.query('SELECT count(*)::int n FROM webhook_events')).rows[0].n, 1);
  assert.equal(requests.length, 2, 'pending duplicate retriggers the worker');
}));
