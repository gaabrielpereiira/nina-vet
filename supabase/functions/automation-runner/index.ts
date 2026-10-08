import { getNinaAutomationBlockReason } from "../_shared/nina-automation.ts";
import { authorizeAutomationRequest } from "../_shared/automation-auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Exponential backoff in minutes per attempt
const RETRY_BACKOFF_MIN = [1, 5, 30, 120, 720];
const MAX_RETRIES = RETRY_BACKOFF_MIN.length;

function getByPath(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function normalizePhone(raw: any): string | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D+/g, '');
  return digits.length >= 8 ? digits : null;
}

/**
 * Converts digits-only phone to Brazilian canonical form (with country code 55).
 * e.g. "11957065883" → "5511957065883"
 *      "5511957065883" → "5511957065883" (unchanged)
 */
function canonicalPhone(digits: string): string {
  const d = digits.replace(/^0+/, ''); // strip leading zeros (e.g. 0055...)
  if (d.startsWith('55') && d.length >= 12) return d;
  return '55' + d;
}

/**
 * Returns all phone variants to check when looking up a contact.
 * Covers mismatches between WooCommerce (local format) and WhatsApp (international format).
 * e.g. "11957065883" → ["11957065883", "5511957065883"]
 *      "5511957065883" → ["5511957065883", "11957065883"]
 */
function phoneVariants(phone: string): string[] {
  const canonical = canonicalPhone(phone);
  const withoutCC = canonical.startsWith('55') ? canonical.slice(2) : canonical;
  return [...new Set([phone, canonical, withoutCC])];
}

function compareValues(a: any, op: string, b: string): boolean {
  if (op === 'eq') return String(a ?? '') === b;
  if (op === 'neq') return String(a ?? '') !== b;
  if (op === 'contains') return String(a ?? '').toLowerCase().includes(b.toLowerCase());
  if (op === 'gte') return Number(a) >= Number(b);
  if (op === 'lte') return Number(a) <= Number(b);
  // changed_to is handled separately in matchesFilters because it needs prev state
  return false;
}

function matchesFilters(payload: any, filters: any, prevState: Record<string, any> = {}): boolean {
  const conditions = filters?.conditions || [];
  if (conditions.length === 0) return true;
  const logic = (filters?.logic || 'AND').toUpperCase();
  const results = conditions.map((c: any) => {
    const val = getByPath(payload, c.field);
    if (c.operator === 'is_first_order') return Boolean(payload?._is_first_order ?? false);
    if (c.operator === 'changed_to') {
      // only true when current value equals target AND previous value differs
      const prev = prevState[c.field];
      return String(val ?? '') === c.value && String(prev ?? '') !== c.value;
    }
    return compareValues(val, c.operator, c.value);
  });
  return logic === 'OR' ? results.some(Boolean) : results.every(Boolean);
}

// Build a stable signature describing the transition this rule guards against.
// Used together with rule_id+external_id to deduplicate executions.
function buildTargetSignature(filters: any, eventId: string): string {
  const conditions: any[] = filters?.conditions || [];
  const transitionParts = conditions
    .filter((c) => c.operator === 'changed_to' || c.operator === 'eq')
    .map((c) => `${c.field}=${c.value}`)
    .sort();
  if (transitionParts.length > 0) return transitionParts.join('&');
  // No transition condition → fall back to per-event idempotency
  return `event:${eventId}`;
}


function renderTemplate(tpl: string, payload: any): string {
  if (!tpl) return '';
  return String(tpl).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, path) => {
    const v = getByPath(payload, String(path).trim());
    return v == null ? '' : String(v);
  });
}

/**
 * Returns all contact IDs that match any variant of the given phone number.
 * Uses a single OR query across phone_number and whatsapp_id for all variants.
 * This handles duplicates created before the normalisation fix was deployed.
 */
async function contactIdsByPhone(supabase: any, phone: string): Promise<string[]> {
  const variants = phoneVariants(phone);
  const orParts = variants.flatMap(v => [
    `phone_number.eq.${v}`,
    `whatsapp_id.eq.${v}`,
  ]);
  const { data } = await supabase
    .from('contacts')
    .select('id')
    .or(orParts.join(','));
  return (data || []).map((r: any) => r.id).filter(Boolean);
}

async function findOrCreateContact(supabase: any, phone: string, payload: any) {
  // 1. Try by email first — most reliable, unaffected by phone format variations.
  const email =
    getByPath(payload, 'contact.email') || getByPath(payload, 'billing.email') ||
    getByPath(payload, 'email') ||
    null;
  if (email && typeof email === 'string' && email.includes('@')) {
    const { data: byEmail } = await supabase
      .from('contacts').select('id, name').eq('email', email).maybeSingle();
    if (byEmail) {
      console.log(`[runner] findOrCreateContact: matched by email=${email} id=${byEmail.id}`);
      return byEmail;
    }
  }

  // 2. Find ALL contacts that have any variant of this phone number in a single query.
  //    When duplicates exist (e.g. 11999614268 vs 5511999614268), we prefer the contact
  //    that already has an active conversation — that is the one with the real chat history.
  const matchingIds = await contactIdsByPhone(supabase, phone);
  if (matchingIds.length === 1) {
    const { data: c } = await supabase.from('contacts').select('id, name').eq('id', matchingIds[0]).maybeSingle();
    if (c) {
      console.log(`[runner] findOrCreateContact: single match id=${c.id}`);
      return c;
    }
  }
  if (matchingIds.length > 1) {
    // Multiple duplicate contacts — pick the one with the OLDEST active conversation.
    // The original contact (real history) always has the oldest conversation.
    // Duplicates created by automation bugs are always newer.
    const { data: convContact } = await supabase
      .from('conversations')
      .select('contact_id')
      .in('contact_id', matchingIds)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    const preferredId = convContact?.contact_id ?? matchingIds[0];
    const { data: c } = await supabase.from('contacts').select('id, name').eq('id', preferredId).maybeSingle();
    if (c) {
      console.log(`[runner] findOrCreateContact: preferred among ${matchingIds.length} duplicates id=${c.id}`);
      return c;
    }
  }

  // 3. Not found — create with canonical phone (includes country code for WhatsApp delivery).
  const canonical = canonicalPhone(phone);
  const name =
    [getByPath(payload, 'billing.first_name'), getByPath(payload, 'billing.last_name')]
      .filter(Boolean).join(' ').trim() ||
    getByPath(payload, 'contact.name') || getByPath(payload, 'first_name') || null;
  const { data: created, error } = await supabase
    .from('contacts').insert({ phone_number: canonical, name, whatsapp_id: canonical })
    .select('id, name').single();
  if (error) throw new Error(`contact insert: ${error.message}`);
  console.log(`[runner] findOrCreateContact: created new contact id=${created.id} phone=${canonical}`);
  return created;
}

/**
 * Find or create an active conversation for a contact.
 *
 * The `phone` parameter expands the search to ALL contacts that share any
 * variant of the same number. This handles legacy duplicate contact records:
 * instead of creating a new conversation, we reuse the most-recent active
 * conversation found across ALL contacts that map to the same phone.
 */
async function findOrCreateConversation(supabase: any, contactId: string, phone?: string) {
  // Collect all contact IDs for this phone number (any format).
  const contactIds = new Set<string>([contactId]);
  if (phone) {
    const extras = await contactIdsByPhone(supabase, phone);
    extras.forEach(id => contactIds.add(id));
  }

  const ids = [...contactIds];

  // Find the OLDEST active conversation among all matching contacts.
  // The original conversation (real chat history) is always the oldest.
  // Duplicate conversations created by the automation bug are always newer,
  // so ascending order by created_at consistently picks the correct one.
  const { data: existing } = await supabase
    .from('conversations').select('id')
    .in('contact_id', ids)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing) {
    console.log(`[runner] findOrCreateConversation: reusing conv=${existing.id} (${ids.length} contact(s) searched)`);
    return existing;
  }

  // No active conversation — create one under the canonical contact.
  const { data: created, error } = await supabase
    .from('conversations')
    .insert({ contact_id: contactId, status: 'nina', is_active: true })
    .select('id').single();

  if (error) {
    if ((error as any).code === '23505') {
      // Race condition: another insert just won — fetch the winner.
      const { data: existing2 } = await supabase
        .from('conversations').select('id')
        .in('contact_id', ids).eq('is_active', true).maybeSingle();
      if (existing2) return existing2;
    }
    throw new Error(`conversation insert: ${error.message}`);
  }
  console.log(`[runner] findOrCreateConversation: created new conv=${created.id}`);
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

async function actionWhatsapp(supabase: any, rule: any, event: any) {
  const globalBlock = await getNinaAutomationBlockReason(supabase);
  if (globalBlock) return { status: 'skipped', result: { reason: 'nina_globally_paused', detail: globalBlock } };
  const cfg = rule.action_config || {};
  const phoneField = rule.trigger_topic?.startsWith('pipeline.') ? 'contact.phone' : (cfg.phone_field || 'billing.phone');
  const phone = normalizePhone(getByPath(event.payload, phoneField));
  if (!phone) return { status: 'failed', result: { reason: 'no_phone', phone_field: phoneField } };

  if (await isInCooldown(supabase, phone, rule.id, rule.cooldown_hours || 0)) {
    return { status: 'skipped', result: { reason: 'cooldown', phone } };
  }

  const { data: tpl } = await supabase
    .from('whatsapp_templates').select('id, name, language, components, status')
    .eq('id', cfg.template_id).maybeSingle();
  if (!tpl) return { status: 'failed', result: { reason: 'template_not_found', template_id: cfg.template_id } };
  if (tpl.status !== 'APPROVED') return { status: 'failed', result: { reason: 'template_not_approved', status: tpl.status } };

  const variablePaths: string[] = Array.isArray(cfg.variables) ? cfg.variables : [];
  const vars: Record<string, string> = {};
  variablePaths.forEach((p, i) => { const v = getByPath(event.payload, p); vars[String(i + 1)] = v == null ? '' : String(v); });

  const contact = await findOrCreateContact(supabase, phone, event.payload);
  const conversation = await findOrCreateConversation(supabase, contact.id, phone);
  const { data: conversationState, error: conversationError } = await supabase.from('conversations')
    .select('status, ai_paused, archived_at').eq('id', conversation.id).single();
  if (conversationError) throw conversationError;
  if (!conversationState || conversationState.status !== 'nina' || conversationState.ai_paused || conversationState.archived_at) {
    return { status: 'skipped', result: { reason: 'conversation_paused', conversation_id: conversation.id } };
  }


  const previewBody = (tpl.components || []).find((c: any) => (c.type || '').toUpperCase() === 'BODY')?.text || tpl.name;
  const previewText = String(previewBody).replace(/\{\{(\d+)\}\}/g, (_m, n) => vars[String(n)] ?? '');

  const { error: queueErr } = await supabase.from('send_queue').insert({
    conversation_id: conversation.id, contact_id: contact.id,
    from_type: 'nina', message_type: 'text', content: previewText, priority: 5,
    metadata: {
      source: 'automation', rule_id: rule.id, event_id: event.id,
      template: { name: tpl.name, language: tpl.language || 'pt_BR', components: tpl.components, variables: vars },
    },
  });
  if (queueErr) return { status: 'failed', result: { reason: 'send_queue_insert_failed', error: queueErr.message } };

  // Store cooldown with canonical phone so isInCooldown always finds it regardless of format
  const canonicalForCooldown = canonicalPhone(phone);
  await supabase.from('contact_cooldowns').upsert(
    { contact_phone: canonicalForCooldown, rule_id: rule.id, last_sent_at: new Date().toISOString() },
    { onConflict: 'contact_phone,rule_id' }
  );

  return { status: 'success', result: { phone: canonicalForCooldown, template: tpl.name, conversation_id: conversation.id } };
}

async function actionCrmUpdate(supabase: any, rule: any, event: any) {
  const cfg = rule.action_config || {};
  const phoneField = rule.trigger_topic?.startsWith('pipeline.') ? 'contact.phone' : (cfg.phone_field || 'billing.phone');
  const phone = normalizePhone(getByPath(event.payload, phoneField));
  if (!phone) return { status: 'failed', result: { reason: 'no_phone' } };

  const { data: contact } = await supabase
    .from('contacts').select('id, tags').eq('phone_number', phone).maybeSingle();
  if (!contact) return { status: 'skipped', result: { reason: 'contact_not_found', phone } };

  const result: any = { phone, contact_id: contact.id };

  if (Array.isArray(cfg.add_tags) && cfg.add_tags.length > 0) {
    const merged = Array.from(new Set([...(contact.tags || []), ...cfg.add_tags]));
    const { error } = await supabase.from('contacts').update({ tags: merged }).eq('id', contact.id);
    if (error) return { status: 'failed', result: { reason: 'tag_update_failed', error: error.message } };
    result.tags_added = cfg.add_tags;
  }

  if (cfg.move_deal_stage_id) {
    const { data: deal } = await supabase
      .from('deals').select('id').eq('contact_id', contact.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!deal) {
      result.deal_move = 'skipped_no_deal';
    } else {
      const { error } = await supabase.from('deals')
        .update({ stage_id: cfg.move_deal_stage_id, updated_at: new Date().toISOString() })
        .eq('id', deal.id);
      if (error) return { status: 'failed', result: { reason: 'deal_update_failed', error: error.message } };
      result.deal_id = deal.id;
      result.moved_to_stage = cfg.move_deal_stage_id;
    }
  }

  return { status: 'success', result };
}

async function actionInternalNotification(supabase: any, rule: any, event: any) {
  const cfg = rule.action_config || {};
  const title = renderTemplate(cfg.title || `Automação: ${rule.name}`, event.payload).slice(0, 200);
  const body = renderTemplate(cfg.body || '', event.payload).slice(0, 1000);

  let contactId: string | null = null;
  if (cfg.phone_field) {
    const phone = normalizePhone(getByPath(event.payload, cfg.phone_field));
    if (phone) {
      const { data } = await supabase.from('contacts').select('id').eq('phone_number', phone).maybeSingle();
      contactId = data?.id ?? null;
    }
  }

  const { error } = await supabase.from('notifications').insert({
    type: cfg.type || 'automation',
    title, body: body || null,
    contact_id: contactId,
    metadata: { rule_id: rule.id, event_id: event.id, topic: event.topic },
  });
  if (error) return { status: 'failed', result: { reason: 'notification_insert_failed', error: error.message } };
  return { status: 'success', result: { title, contact_id: contactId } };
}

async function actionOutboundWebhook(rule: any, event: any) {
  const cfg = rule.action_config || {};
  const url = cfg.url;
  if (!url) return { status: 'failed', result: { reason: 'no_url' } };

  const method = (cfg.method || 'POST').toUpperCase();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(cfg.headers || {}) };
  const bodyTpl = cfg.body_template;
  let body: string;
  if (typeof bodyTpl === 'string' && bodyTpl.trim()) {
    body = renderTemplate(bodyTpl, event.payload);
  } else {
    body = JSON.stringify({ rule: rule.name, topic: event.topic, event_id: event.id, payload: event.payload });
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    clearTimeout(timer);
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      return { status: 'failed', result: { reason: 'http_error', status: res.status, body: text.slice(0, 500) } };
    }
    return { status: 'success', result: { url, http_status: res.status, response_preview: text.slice(0, 200) } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return { status: 'failed', result: { reason: 'fetch_error', error: msg } };
  }
}

// ─── Order persistence ────────────────────────────────────────────────

async function upsertOrderFromEvent(supabase: any, event: any) {
  if (!event?.topic?.startsWith('order.')) return;
  const p = event.payload || {};
  const wooId = Number(p.id);
  if (!wooId || Number.isNaN(wooId)) {
    console.warn(`[runner] order event ${event.id} missing payload.id, skipping orders upsert`);
    return;
  }
  try {
    const phone = normalizePhone(getByPath(p, 'billing.phone'));
    let contactId: string | null = null;
    if (phone) {
      const { data: contact } = await supabase
        .from('contacts').select('id').eq('phone_number', phone).maybeSingle();
      contactId = contact?.id ?? null;
    }
    const fullName = [getByPath(p, 'billing.first_name'), getByPath(p, 'billing.last_name')]
      .filter(Boolean).join(' ').trim() || null;
    const totalNum = p.total != null ? Number(p.total) : null;

    const row = {
      woo_order_id: wooId,
      contact_id: contactId,
      status: p.status ?? null,
      total: Number.isFinite(totalNum) ? totalNum : null,
      currency: p.currency ?? null,
      customer_id: p.customer_id != null ? Number(p.customer_id) : null,
      customer_email: getByPath(p, 'billing.email') ?? null,
      customer_phone: phone,
      customer_name: fullName,
      payment_method: p.payment_method ?? null,
      payment_method_title: p.payment_method_title ?? null,
      is_first_order: Boolean(p._is_first_order ?? false),
      line_items: p.line_items ?? [],
      billing: p.billing ?? {},
      raw_payload: p,
      order_created_at: p.date_created ?? null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('orders').upsert(row, { onConflict: 'woo_order_id' });
    if (error) {
      console.warn(`[runner] orders upsert failed for woo_order_id=${wooId}: ${error.message}`);
    } else {
      console.log(`[runner] orders upsert ok woo_order_id=${wooId} contact_id=${contactId ?? 'null'}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.warn(`[runner] orders upsert exception: ${msg}`);
  }
}

// ─── Event processing ─────────────────────────────────────────────────

async function processEvent(supabase: any, event: any) {
  // Claim an event lease so receiver callbacks and the periodic runner cannot
  // evaluate the same event concurrently. Expired leases recover crashed workers.
  const { data: claimed, error: leaseError } = await supabase.from('webhook_events')
    .update({ processing_at: new Date().toISOString() }).eq('id', event.id).eq('processed', false)
    .or(`processing_at.is.null,processing_at.lt.${new Date(Date.now() - 5 * 60_000).toISOString()}`)
    .select('id').maybeSingle();
  if (leaseError) throw leaseError;
  if (!claimed) return { queuedWhatsapp: false };

  // For order.* events, read the LAST PROCESSED status (set after the previous
  // event finished evaluating rules) so changed_to filters compare against the
  // real prior state — even when webhooks arrive out of order.
  const prevState: Record<string, any> = {};
  let externalId: string | null = null;
  let wooIdForStateUpdate: number | null = null;
  if (event?.topic?.startsWith('order.')) {
    const wooId = Number(event?.payload?.id);
    if (Number.isFinite(wooId)) {
      externalId = String(wooId);
      wooIdForStateUpdate = wooId;
      const { data: prevOrder } = await supabase
        .from('orders').select('last_processed_status').eq('woo_order_id', wooId).maybeSingle();
      prevState.status = prevOrder?.last_processed_status ?? null;
    }
  }

  // Persist order data (non-blocking on failure)
  if (!event.dry_run) await upsertOrderFromEvent(supabase, event);

  // ── Inject computed fields into the payload ────────────────────────────
  // _order_age_hours: how many hours since the order was created. Use with
  // operator "lte" to skip automations for old orders.
  if (event.payload && (event.payload.date_created_gmt || event.payload.date_created)) {
    try {
      const dateStr = event.payload.date_created_gmt || event.payload.date_created;
      const iso = dateStr.endsWith('Z') ? dateStr : dateStr + 'Z';
      const ageMs = Date.now() - new Date(iso).getTime();
      event.payload._order_age_hours = Math.round((ageMs / (1000 * 60 * 60)) * 10) / 10;
    } catch { /* ignore malformed dates */ }
  }

  // For order.created events, ALSO evaluate order.updated rules — orders that
  // arrive already paid (status=processing/completed) never emit a separate
  // order.updated, so "paid" rules would otherwise never fire. The
  // automation_executions idempotency claim prevents duplicate firing when the
  // matching order.updated webhook arrives later.
  const topicsToMatch = event.topic === 'order.created'
    ? ['order.created', 'order.updated']
    : [event.topic];

  const { data: rules, error: rulesErr } = await supabase
    .from('automation_rules').select('*').eq('active', true).in('trigger_topic', topicsToMatch);
  if (rulesErr) throw rulesErr;
  console.log(
    `[runner] event=${event.id} topic=${event.topic} matched ${rules?.length || 0} active rule(s)` +
    ` prev_status=${prevState.status ?? 'null'} order_age_hours=${event.payload?._order_age_hours ?? 'n/a'}`
  );

  let queuedWhatsapp = false;
  let actionFailed = false;

  for (const rule of rules || []) {
    try {
      if (!matchesFilters(event.payload, rule.filters, prevState)) {
        await supabase.from('automation_logs').insert({
          rule_id: rule.id, event_id: event.id, status: 'skipped',
          result: { reason: 'filters_not_matched', prev_status: prevState.status ?? null },
        });
        continue;
      }

      if (event.dry_run) {
        await supabase.from('automation_logs').insert({
          rule_id: rule.id, event_id: event.id, status: 'skipped',
          result: { reason: 'dry_run', filters_matched: true, action_type: rule.action_type, delay_minutes: rule.delay_minutes || 0 },
        });
        continue;
      }

      // Idempotency guard: claim the (rule, external_id, target_signature) slot
      // BEFORE running the action. If insert fails with 23505, the rule already
      // fired for this transition — skip silently.
      const targetSignature = buildTargetSignature(rule.filters, event.id);
      const claimExternalId = externalId ?? `event:${event.id}`;
      const { error: claimErr } = await supabase
        .from('automation_executions')
        .insert({
          rule_id: rule.id,
          external_id: claimExternalId,
          target_signature: targetSignature,
          event_id: event.id,
        });
      if (claimErr) {
        if ((claimErr as any).code === '23505') {
          await supabase.from('automation_logs').insert({
            rule_id: rule.id, event_id: event.id, status: 'skipped',
            result: { reason: 'already_executed_for_transition', external_id: claimExternalId, target_signature: targetSignature },
          });
          console.log(`[runner] rule=${rule.id} skipped (already executed) ext=${claimExternalId} sig=${targetSignature}`);
          continue;
        }
        throw new Error(`execution claim failed: ${claimErr.message}`);
      }

      // If the rule has a delay, schedule it instead of running now.
      const delayMin = Number(rule.delay_minutes ?? 0);
      if (delayMin > 0) {
        const scheduledFor = new Date(Date.now() + delayMin * 60_000).toISOString();
        const statusAtSchedule = event.payload?.status != null ? String(event.payload.status) : null;
        const { error: schedErr } = await supabase.from('automation_scheduled').insert({
          rule_id: rule.id,
          event_id: event.id,
          external_id: claimExternalId,
          target_signature: targetSignature,
          payload: event.payload || {},
          status_at_schedule: statusAtSchedule,
          scheduled_for: scheduledFor,
          status: 'pending',
        });
        if (schedErr) throw new Error(`schedule insert failed: ${schedErr.message}`);
        await supabase.from('automation_logs').insert({
          rule_id: rule.id, event_id: event.id, status: 'scheduled',
          result: { reason: 'delayed_execution', scheduled_for: scheduledFor, delay_minutes: delayMin },
        });
        continue;
      }

      let outcome: { status: string; result: any };
      switch (rule.action_type) {
        case 'whatsapp_message': outcome = await actionWhatsapp(supabase, rule, event); if (outcome.status === 'success') queuedWhatsapp = true; break;
        case 'crm_update': outcome = await actionCrmUpdate(supabase, rule, event); break;
        case 'internal_notification': outcome = await actionInternalNotification(supabase, rule, event); break;
        case 'outbound_webhook': outcome = await actionOutboundWebhook(rule, event); break;
        default:
          outcome = { status: 'skipped', result: { reason: 'unknown_action_type', action_type: rule.action_type } };
      }

      await supabase.from('automation_logs').insert({
        rule_id: rule.id, event_id: event.id, status: outcome.status, result: outcome.result,
      });
      if (outcome.status === 'failed') {
        actionFailed = true;
        const { error: releaseError } = await supabase.from('automation_executions').delete()
          .eq('rule_id', rule.id).eq('external_id', claimExternalId).eq('target_signature', targetSignature);
        if (releaseError) throw releaseError;
      }

      console.log(`[runner] rule=${rule.id} action=${rule.action_type} → ${outcome.status}`);

    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      console.error(`[runner] rule ${rule.id} failed:`, msg);
      actionFailed = true;
      await supabase.from('automation_executions').delete().eq('rule_id', rule.id)
        .eq('external_id', externalId ?? `event:${event.id}`)
        .eq('target_signature', buildTargetSignature(rule.filters, event.id));
      await supabase.from('automation_logs').insert({
        rule_id: rule.id, event_id: event.id, status: 'failed',
        result: { reason: 'exception', error: msg },
      });
    }
  }

  if (actionFailed) throw new Error('One or more automation actions failed; retrying failed actions only');

  // Persist the status the runner just processed so the NEXT event for this
  // order sees the correct `prev_status`, even if webhooks arrive out of order.
  if (!event.dry_run && wooIdForStateUpdate != null && event.payload?.status != null) {
    await supabase.from('orders')
      .update({ last_processed_status: String(event.payload.status) })
      .eq('woo_order_id', wooIdForStateUpdate);
  }

  await supabase.from('webhook_events')
    .update({ processed: true, error: null, next_retry_at: null, processing_at: null }).eq('id', event.id);
  return { queuedWhatsapp };
}

async function scheduleRetry(supabase: any, event: any, errorMsg: string) {
  const attempt = (event.retry_count ?? 0) + 1;
  if (attempt > MAX_RETRIES) {
    await supabase.from('webhook_events').update({
      processed: true, // give up
      error: `[max_retries] ${errorMsg}`, processing_at: null,
      retry_count: attempt,
      last_error_at: new Date().toISOString(),
      next_retry_at: null,
    }).eq('id', event.id);
    await supabase.from('automation_logs').insert({
      rule_id: null, event_id: event.id, status: 'failed',
      result: { reason: 'max_retries_exceeded', attempts: attempt, error: errorMsg },
    });
    console.warn(`[runner] event ${event.id} exhausted retries`);
    return;
  }
  const minutes = RETRY_BACKOFF_MIN[attempt - 1];
  const next = new Date(Date.now() + minutes * 60_000).toISOString();
  await supabase.from('webhook_events').update({
    error: errorMsg, retry_count: attempt, processing_at: null,
    last_error_at: new Date().toISOString(),
    next_retry_at: next,
  }).eq('id', event.id);
  console.log(`[runner] event ${event.id} retry ${attempt}/${MAX_RETRIES} scheduled at ${next}`);
}

// Version tag — update this to confirm a new deployment is running in Supabase logs.
const RUNNER_VERSION = '2026-06-18-v5';

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


    console.log(`[runner] version=${RUNNER_VERSION} start`);

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    let events: any[] = [];
    if (body.event_id) {
      const { data, error } = await supabase
        .from('webhook_events').select('*').eq('id', body.event_id).maybeSingle();
      if (error) throw error;
      if (data && (!data.processed || body.reprocess === true)) {
        // Manual reprocess resets retry counter
        if (body.reprocess === true && data.processed) {
          await supabase.from('webhook_events').update({
            processed: false, error: null, retry_count: 0, next_retry_at: null,
          }).eq('id', data.id);
          data.processed = false; data.retry_count = 0; data.next_retry_at = null;
        }
        events = [data];
      }
    } else {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('webhook_events').select('*').eq('processed', false)
        .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
        .order('received_at', { ascending: true }).limit(50);
      if (error) throw error;
      events = data || [];
    }

    console.log(`[runner] processing ${events.length} event(s)`);
    let triggerSender = false;
    for (const ev of events) {
      try {
        const r = await processEvent(supabase, ev);
        if (r.queuedWhatsapp) triggerSender = true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown';
        console.error(`[runner] event ${ev.id} failed:`, msg);
        await scheduleRetry(supabase, ev, msg);
      }
    }

    if (triggerSender) {
      // Use EdgeRuntime.waitUntil so the runtime keeps the function alive until the sender
      // request is established — same fix as wc-receiver → automation-runner.
      const senderCall = fetch(`${supabaseUrl}/functions/v1/whatsapp-sender`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).catch((e) => console.warn('[runner] sender trigger failed:', e));

      // @ts-ignore — EdgeRuntime.waitUntil is available in Supabase Edge Runtime
      try { EdgeRuntime.waitUntil(senderCall); } catch (_) { /* outside edge runtime */ }
    }

    return new Response(JSON.stringify({ success: true, processed: events.length }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[runner] fatal:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
