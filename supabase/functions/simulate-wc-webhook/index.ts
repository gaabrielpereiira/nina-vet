import { authorizeAutomationRequest } from "../_shared/automation-auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Sample payloads for each WooCommerce topic — minimal but realistic
const SAMPLES: Record<string, any> = {
  'pipeline.deal.won': { deal: { id: 'simulated', title: 'Consulta veterinária', company: 'Clínica', value: 297 }, contact: { name: 'Tutor Teste', phone: '5511999990001', email: 'tutor@example.com' }, order: {} },
  'order.created': {
    id: 9001, status: 'processing', currency: 'BRL', total: '297.00',
    payment_method: 'pix', payment_method_title: 'PIX',
    customer_id: 42, _is_first_order: true,
    billing: {
      first_name: 'Cliente', last_name: 'Teste',
      email: 'cliente@exemplo.com', phone: '5511999990001',
      address_1: 'Rua de Teste, 123', city: 'São Paulo', state: 'SP',
    },
    line_items: [{ id: 1, name: 'Produto Demo', product_id: 555, quantity: 1, total: '297.00' }],
    date_created: new Date().toISOString(),
  },
  'order.updated': {
    id: 9001, status: 'completed', currency: 'BRL', total: '297.00',
    customer_id: 42,
    billing: { first_name: 'Cliente', last_name: 'Teste', email: 'cliente@exemplo.com', phone: '5511999990001' },
    line_items: [{ id: 1, name: 'Produto Demo', product_id: 555, quantity: 1, total: '297.00' }],
    date_modified: new Date().toISOString(),
  },
  'order.deleted': {
    id: 9001, status: 'trash',
    billing: { phone: '5511999990001' },
  },
  'customer.created': {
    id: 42, email: 'cliente@exemplo.com', first_name: 'Cliente', last_name: 'Teste',
    role: 'customer', date_created: new Date().toISOString(),
    billing: { first_name: 'Cliente', last_name: 'Teste', phone: '5511999990001', email: 'cliente@exemplo.com' },
  },
  'customer.updated': {
    id: 42, email: 'cliente@exemplo.com', first_name: 'Cliente', last_name: 'Atualizado',
    billing: { phone: '5511999990001', email: 'cliente@exemplo.com' },
  },
  'product.updated': {
    id: 555, name: 'Produto Demo', slug: 'produto-demo',
    status: 'publish', price: '297.00', regular_price: '397.00', sale_price: '297.00',
    stock_quantity: 12, stock_status: 'instock',
    date_modified: new Date().toISOString(),
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ topics: Object.keys(SAMPLES) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

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


    const body = await req.json().catch(() => ({}));
    const topic = String(body.topic || 'order.created');
    if (!SAMPLES[topic] && !body.payload) {
      return new Response(JSON.stringify({ error: `unknown topic: ${topic}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Allow user to override individual fields (e.g. phone, total) via overrides
    const base = body.payload && typeof body.payload === 'object' ? body.payload : SAMPLES[topic];
    const payload = { ...base, ...(body.overrides || {}) };

    // If overrides include billing.* keys, merge nested
    if (body.overrides?.billing) {
      payload.billing = { ...(base.billing || {}), ...body.overrides.billing };
    }

    const { data: event, error } = await supabase.from('webhook_events').insert({
      topic, payload, source: 'simulator', processed: false, dry_run: body.dry_run !== false,
    }).select('id').single();
    if (error) throw error;

    // Fire-and-forget runner
    const runnerCall = fetch(`${supabaseUrl}/functions/v1/automation-runner`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: event.id }),
    }).catch((e) => console.warn('[simulator] runner trigger failed:', e));
    try { EdgeRuntime.waitUntil(runnerCall); } catch { await runnerCall; }

    return new Response(JSON.stringify({ success: true, event_id: event.id, topic }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[simulator] error:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
