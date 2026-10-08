import { getNinaAutomationBlockReason } from "../_shared/nina-automation.ts";
import { authorizeAutomationRequest } from "../_shared/automation-auth.ts";
// Runs scheduled (delayed) automations whose scheduled_for has elapsed.
// Companion to automation-runner: when a rule has delay_minutes > 0, the runner
// inserts a row into automation_scheduled instead of executing the action; this
// function picks those up, validates the precondition still holds (optional),
// and runs the same action handlers.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function getByPath(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  return path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
    .reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

function normalizePhone(raw: any): string | null {
  if (raw == null) return null;
  const d = String(raw).replace(/\D+/g, '');
  return d.length >= 8 ? d : null;
}

function canonicalPhone(digits: string): string {
  const d = digits.replace(/^0+/, '');
  if (d.startsWith('55') && d.length >= 12) return d;
  return '55' + d;
}

function phoneVariants(phone: string): string[] {
  const canonical = canonicalPhone(phone);
  const withoutCC = canonical.startsWith('55') ? canonical.slice(2) : canonical;
  return [...new Set([phone, canonical, withoutCC])];
}

function renderTemplate(tpl: string, payload: any): string {
  if (!tpl) return '';
  return String(tpl).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, p) => {
    const v = getByPath(payload, String(p).trim());
    return v == null ? '' : String(v);
  });
}

async function contactIdsByPhone(supabase: any, phone: string): Promise<string[]> {
  const variants = phoneVariants(phone);
  const orParts = variants.flatMap(v => [`phone_number.eq.${v}`, `whatsapp_id.eq.${v}`]);
  const { data } = await supabase.from('contacts').select('id').or(orParts.join(','));
  return (data || []).map((r: any) => r.id).filter(Boolean);
}

async function findOrCreateContact(supabase: any, phone: string, payload: any) {
  const email = getByPath(payload, 'contact.email') || getByPath(payload, 'billing.email') || getByPath(payload, 'email');
  if (email && typeof email === 'string' && email.includes('@')) {
    const { data } = await supabase.from('contacts').select('id, name').eq('email', email).maybeSingle();
    if (data) return data;
  }
  const matchingIds = await contactIdsByPhone(supabase, phone);
  if (matchingIds.length >= 1) {
    const { data: convContact } = await supabase
      .from('conversations').select('contact_id').in('contact_id', matchingIds)
      .eq('is_active', true).order('created_at', { ascending: true }).limit(1).maybeSingle();
    const preferredId = convContact?.contact_id ?? matchingIds[0];
    const { data } = await supabase.from('contacts').select('id, name').eq('id', preferredId).maybeSingle();
    if (data) return data;
  }
  const canonical = canonicalPhone(phone);
  const name = [getByPath(payload, 'billing.first_name'), getByPath(payload, 'billing.last_name')]
    .filter(Boolean).join(' ').trim() || getByPath(payload, 'contact.name') || getByPath(payload, 'first_name') || null;
  const { data: created, error } = await supabase
    .from('contacts').insert({ phone_number: canonical, name, whatsapp_id: canonical })
    .select('id, name').single();
  if (error) throw new Error(`contact insert: ${error.message}`);
  return created;
}

async function findOrCreateConversation(supabase: any, contactId: string, phone?: string) {
  const ids = new Set<string>([contactId]);
  if (phone) (await contactIdsByPhone(supabase, phone)).forEach(id => ids.add(id));
  const { data: existing } = await supabase
    .from('conversations').select('id').in('contact_id', [...ids])
    .eq('is_active', true).order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (existing) return existing;
  const { data: created, error } = await supabase.from('conversations')
    .insert({ contact_id: contactId, status: 'nina', is_active: true })
    .select('id').single();
  if (error) {
    if ((error as any).code === '23505') {
      const { data: e2 } = await supabase.from('conversations').select('id')
        .in('contact_id', [...ids]).eq('is_active', true).maybeSingle();
      if (e2) return e2;
    }
    throw new Error(`conversation insert: ${error.message}`);
  }
  return created;
}

async function isInCooldown(supabase: any, phone: string, ruleId: string, hours: number): Promise<boolean> {
  if (!hours || hours <= 0) return false;
  // Check cooldown for all phone variants so format mismatches don't bypass the guard
  for (const v of phoneVariants(phone)) {
    const { data } = await supabase
      .from('contact_cooldowns').select('last_sent_at')
      .eq('contact_phone', v).eq('rule_id', ruleId).maybeSingle();
    if (data?.last_sent_at) {
      const elapsed = (Date.now() - new Date(data.last_sent_at).getTime()) / (1000 * 60 * 60);
      if (elapsed < hours) return true;
    }
  }
  return false;
}

// ─── Action handlers ──────────────────────────────────────────────────

async function actionWhatsapp(supabase: any, rule: any, payload: any) {
  const globalBlock = await getNinaAutomationBlockReason(supabase);
  if (globalBlock) return { status: 'skipped', result: { reason: 'nina_globally_paused', detail: globalBlock } };
  const cfg = rule.action_config || {};
  const phoneField = rule.trigger_topic?.startsWith('pipeline.') ? 'contact.phone' : (cfg.phone_field || 'billing.phone');
  const phone = normalizePhone(getByPath(payload, phoneField));
  if (!phone) return { status: 'failed', result: { reason: 'no_phone' } };
  if (await isInCooldown(supabase, phone, rule.id, rule.cooldown_hours || 0)) return { status: 'skipped', result: { reason: 'cooldown', phone } };

  const { data: tpl } = await supabase.from('whatsapp_templates')
    .select('id, name, language, components, status').eq('id', cfg.template_id).maybeSingle();
  if (!tpl) return { status: 'failed', result: { reason: 'template_not_found' } };
  if (tpl.status !== 'APPROVED') return { status: 'failed', result: { reason: 'template_not_approved' } };

  const variablePaths: string[] = Array.isArray(cfg.variables) ? cfg.variables : [];
  const vars: Record<string, string> = {};
  variablePaths.forEach((p, i) => { const v = getByPath(payload, p); vars[String(i + 1)] = v == null ? '' : String(v); });

  const contact = await findOrCreateContact(supabase, phone, payload);
  const conversation = await findOrCreateConversation(supabase, contact.id, phone);
  const { data: conversationState, error: conversationError } = await supabase.from('conversations')
    .select('status, ai_paused, archived_at').eq('id', conversation.id).single();
  if (conversationError) throw conversationError;
  if (!conversationState || conversationState.status !== 'nina' || conversationState.ai_paused || conversationState.archived_at) {
    return { status: 'skipped', result: { reason: 'conversation_paused', conversation_id: conversation.id } };
  }


  const body = (tpl.components || []).find((c: any) => (c.type || '').toUpperCase() === 'BODY')?.text || tpl.name;
  const previewText = String(body).replace(/\{\{(\d+)\}\}/g, (_m, n) => vars[String(n)] ?? '');

  const { error: queueErr } = await supabase.from('send_queue').insert({
    conversation_id: conversation.id, contact_id: contact.id,
    from_type: 'nina', message_type: 'text', content: previewText, priority: 5,
    metadata: {
      source: 'automation_scheduled', rule_id: rule.id,
      template: { name: tpl.name, language: tpl.language || 'pt_BR', components: tpl.components, variables: vars },
    },
  });
  if (queueErr) return { status: 'failed', result: { reason: 'send_queue_insert_failed', error: queueErr.message } };
  const { error: cooldownError } = await supabase.from('contact_cooldowns').upsert(
    { contact_phone: canonicalPhone(phone), rule_id: rule.id, last_sent_at: new Date().toISOString() },
    { onConflict: 'contact_phone,rule_id' });
  if (cooldownError) console.warn('[scheduler] cooldown update failed:', cooldownError.message);
  return { status: 'success', result: { phone: canonicalPhone(phone), template: tpl.name, conversation_id: conversation.id } };
}

async function actionCrmUpdate(supabase: any, rule: any, payload: any) {
  const cfg = rule.action_config || {};
  const phone = normalizePhone(getByPath(payload, rule.trigger_topic?.startsWith('pipeline.') ? 'contact.phone' : (cfg.phone_field || 'billing.phone')));
  if (!phone) return { status: 'failed', result: { reason: 'no_phone' } };
  const { data: contact } = await supabase.from('contacts').select('id, tags').eq('phone_number', phone).maybeSingle();
  if (!contact) return { status: 'skipped', result: { reason: 'contact_not_found' } };
  const result: any = { phone, contact_id: contact.id };
  if (Array.isArray(cfg.add_tags) && cfg.add_tags.length > 0) {
    const merged = Array.from(new Set([...(contact.tags || []), ...cfg.add_tags]));
    await supabase.from('contacts').update({ tags: merged }).eq('id', contact.id);
    result.tags_added = cfg.add_tags;
  }
  if (cfg.move_deal_stage_id) {
    const { data: deal } = await supabase.from('deals').select('id').eq('contact_id', contact.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (deal) {
      await supabase.from('deals').update({ stage_id: cfg.move_deal_stage_id, updated_at: new Date().toISOString() }).eq('id', deal.id);
      result.deal_id = deal.id;
    }
  }
  return { status: 'success', result };
}

async function actionInternalNotification(supabase: any, rule: any, payload: any) {
  const cfg = rule.action_config || {};
  const title = renderTemplate(cfg.title || `Automação: ${rule.name}`, payload).slice(0, 200);
  const body = renderTemplate(cfg.body || '', payload).slice(0, 1000);
  let contactId: string | null = null;
  if (cfg.phone_field) {
    const phone = normalizePhone(getByPath(payload, cfg.phone_field));
    if (phone) {
      const { data } = await supabase.from('contacts').select('id').eq('phone_number', phone).maybeSingle();
      contactId = data?.id ?? null;
    }
  }
  const { error } = await supabase.from('notifications').insert({
    type: cfg.type || 'automation', title, body: body || null, contact_id: contactId,
    metadata: { rule_id: rule.id, scheduled: true },
  });
  if (error) return { status: 'failed', result: { reason: 'notification_insert_failed', error: error.message } };
  return { status: 'success', result: { title, contact_id: contactId } };
}

async function actionOutboundWebhook(rule: any, payload: any) {
  const cfg = rule.action_config || {};
  const url = cfg.url;
  if (!url) return { status: 'failed', result: { reason: 'no_url' } };
  const method = (cfg.method || 'POST').toUpperCase();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(cfg.headers || {}) };
  const bodyTpl = cfg.body_template;
  const body = (typeof bodyTpl === 'string' && bodyTpl.trim())
    ? renderTemplate(bodyTpl, payload)
    : JSON.stringify({ rule: rule.name, payload });
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    clearTimeout(timer);
    const text = await res.text().catch(() => '');
    if (!res.ok) return { status: 'failed', result: { reason: 'http_error', status: res.status, body: text.slice(0, 500) } };
    return { status: 'success', result: { url, http_status: res.status } };
  } catch (e) {
    return { status: 'failed', result: { reason: 'fetch_error', error: e instanceof Error ? e.message : 'unknown' } };
  }
}

// ─── Precondition check ───────────────────────────────────────────────

async function preconditionStillValid(supabase: any, rule: any, sch: any): Promise<{ ok: boolean; reason?: string; details?: any }> {
  if (!rule.cancel_if_changed) return { ok: true };
  if (rule.trigger_topic === 'pipeline.deal.won') {
    const dealId = sch.payload?.deal?.id;
    if (!dealId) return { ok: false, reason: 'deal_not_found' };
    const { data: deal, error } = await supabase.from('deals').select('stage_id, won_at').eq('id', dealId).maybeSingle();
    if (error) throw error;
    if (!deal) return { ok: false, reason: 'deal_not_found' };
    const { data: stage, error: stageError } = await supabase.from('pipeline_stages').select('title').eq('id', deal.stage_id).maybeSingle();
    if (stageError) throw stageError;
    if (stage?.title?.toLowerCase() !== 'ganho' && !deal.won_at) return { ok: false, reason: 'deal_no_longer_won' };
    return { ok: true };
  }
  // Only check for order.* triggers — they have a tracked status in `orders`.
  const wooId = Number(sch.payload?.id);
  if (!rule.trigger_topic?.startsWith('order.') || !Number.isFinite(wooId)) return { ok: true };

  const { data: order } = await supabase
    .from('orders').select('status, last_processed_status')
    .eq('woo_order_id', wooId).maybeSingle();

  if (!order) return { ok: false, reason: 'order_not_found', details: { woo_order_id: wooId } };

  const current = String(order.status ?? '');
  const atSchedule = String(sch.status_at_schedule ?? '');

  // If a changed_to/eq condition exists on `status`, ensure current status still matches the target.
  const conditions: any[] = rule.filters?.conditions || [];
  const statusTarget = conditions.find((c: any) =>
    c.field === 'status' && (c.operator === 'changed_to' || c.operator === 'eq')
  )?.value;

  if (statusTarget && current !== String(statusTarget)) {
    return { ok: false, reason: 'status_changed', details: { from: atSchedule, to: current, expected: statusTarget } };
  }
  // No explicit status target — fall back to "status must not have changed since scheduling".
  if (!statusTarget && atSchedule && current !== atSchedule) {
    return { ok: false, reason: 'status_changed', details: { from: atSchedule, to: current } };
  }
  return { ok: true };
}

// ─── Main loop ────────────────────────────────────────────────────────

async function processScheduled(supabase: any, sch: any) {
  // Atomically claim the row.
  const { data: claimed, error: claimErr } = await supabase
    .from('automation_scheduled')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', sch.id).eq('status', 'pending')
    .select('*').maybeSingle();
  if (claimErr || !claimed) return { skipped: true };

  const { data: rule } = await supabase.from('automation_rules').select('*').eq('id', sch.rule_id).maybeSingle();
  if (!rule || !rule.active) {
    await supabase.from('automation_scheduled').update({
      status: 'cancelled', cancel_reason: rule ? 'rule_inactive' : 'rule_deleted', executed_at: new Date().toISOString(),
    }).eq('id', sch.id);
    await supabase.from('automation_logs').insert({
      rule_id: sch.rule_id, event_id: sch.event_id, status: 'cancelled',
      result: { reason: rule ? 'rule_inactive' : 'rule_deleted', scheduled_id: sch.id },
    });
    return { cancelled: true };
  }

  const pre = await preconditionStillValid(supabase, rule, sch);
  if (!pre.ok) {
    await supabase.from('automation_scheduled').update({
      status: 'cancelled', cancel_reason: pre.reason, executed_at: new Date().toISOString(),
    }).eq('id', sch.id);
    await supabase.from('automation_logs').insert({
      rule_id: rule.id, event_id: sch.event_id, status: 'cancelled',
      result: { reason: pre.reason, ...pre.details, scheduled_id: sch.id },
    });
    console.log(`[scheduler] rule=${rule.id} cancelled (${pre.reason})`);
    return { cancelled: true };
  }

  let outcome: { status: string; result: any };
  let queuedWhatsapp = false;
  try {
    switch (rule.action_type) {
      case 'whatsapp_message':
        outcome = await actionWhatsapp(supabase, rule, sch.payload);
        if (outcome.status === 'success') queuedWhatsapp = true;
        break;
      case 'crm_update': outcome = await actionCrmUpdate(supabase, rule, sch.payload); break;
      case 'internal_notification': outcome = await actionInternalNotification(supabase, rule, sch.payload); break;
      case 'outbound_webhook': outcome = await actionOutboundWebhook(rule, sch.payload); break;
      default: outcome = { status: 'skipped', result: { reason: 'unknown_action_type' } };
    }
  } catch (e) {
    outcome = { status: 'failed', result: { reason: 'exception', error: e instanceof Error ? e.message : 'unknown' } };
  }

  await supabase.from('automation_scheduled').update({
    status: outcome.status === 'success' ? 'executed' : outcome.status === 'skipped' ? 'cancelled' : 'failed',
    cancel_reason: outcome.status === 'skipped' ? outcome.result?.reason : null,
    executed_at: new Date().toISOString(),
  }).eq('id', sch.id);

  await supabase.from('automation_logs').insert({
    rule_id: rule.id, event_id: sch.event_id, status: outcome.status,
    result: { ...outcome.result, scheduled_id: sch.id, delayed: true },
  });
  console.log(`[scheduler] rule=${rule.id} → ${outcome.status}`);
  return { queuedWhatsapp };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const denied = await authorizeAutomationRequest(req, supabase);
    if (denied) {
      const headers = new Headers(denied.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));
      headers.set('Content-Type', 'application/json');
      return new Response(denied.body, { status: denied.status, headers });
    }


    const { error: recoveryError } = await supabase.from('automation_scheduled')
      .update({ status: 'pending' }).eq('status', 'processing')
      .lt('updated_at', new Date(Date.now() - 5 * 60_000).toISOString());
    if (recoveryError) throw recoveryError;

    const nowIso = new Date().toISOString();
    const { data: due, error } = await supabase
      .from('automation_scheduled').select('*')
      .eq('status', 'pending').lte('scheduled_for', nowIso)
      .order('scheduled_for', { ascending: true }).limit(50);
    if (error) throw error;

    console.log(`[scheduler] ${due?.length || 0} due item(s)`);

    let triggerSender = false;
    for (const sch of due || []) {
      const r = await processScheduled(supabase, sch);
      if (r?.queuedWhatsapp) triggerSender = true;
    }

    if (triggerSender) {
      const senderCall = fetch(`${supabaseUrl}/functions/v1/whatsapp-sender`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).catch((e) => console.warn('[scheduler] sender trigger failed:', e));
      // @ts-ignore
      try { EdgeRuntime.waitUntil(senderCall); } catch (_) {}
    }

    return new Response(JSON.stringify({ success: true, processed: due?.length || 0 }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[scheduler] fatal:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'unknown' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
