import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-wc-webhook-signature, x-wc-webhook-topic, x-wc-webhook-source, x-wc-webhook-event, x-wc-webhook-resource, x-wc-webhook-id, x-wc-webhook-delivery-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function hmacBase64(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const rawBody = await req.text();
    const signature = req.headers.get('x-wc-webhook-signature') || '';
    const topic = req.headers.get('x-wc-webhook-topic') || 'unknown';

    // Use the same canonical settings row as the Nina controls and template sync.
    const { data: secretRow, error: settingsError } = await supabase
      .from('nina_settings')
      .select('wc_webhook_secret')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (settingsError) throw settingsError;

    const secret = secretRow?.wc_webhook_secret;
    if (!secret) {
      console.error('[wc-receiver] No wc_webhook_secret configured');
      return new Response(JSON.stringify({ error: 'Webhook not configured' }), {
        status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const expected = await hmacBase64(secret, rawBody);
    if (!signature || !timingSafeEqual(signature, expected)) {
      console.warn(`[wc-receiver] Invalid signature topic=${topic}`);
      return new Response(JSON.stringify({
        error: 'Invalid signature',
        hint: 'O Secret salvo no painel não bate com o Secret do webhook no WooCommerce. Gere um novo, cole nos dois lados (sem espaços), salve em ambos e tente de novo.',
      }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let payload: any = {};
    try { payload = JSON.parse(rawBody); } catch { return new Response('Invalid JSON', { status: 400, headers: corsHeaders }); }

    // Idempotency: derive a stable external_id and event_signature so that
    // re-deliveries of the same WooCommerce event are not re-processed.
    const externalId = payload?.id != null ? String(payload.id) : null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody));
    const eventSignature = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');

    const { data: ev, error: insErr } = await supabase
      .from('webhook_events')
      .insert({
        topic, payload, source: 'woocommerce', processed: false,
        external_id: externalId, event_signature: eventSignature,
      })
      .select('id')
      .single();

    if (insErr) {
      if ((insErr as any).code === '23505') {
        console.log(`[wc-receiver] Duplicate event topic=${topic} external_id=${externalId} sig=${eventSignature}`);

        // Bug fix: if the original event is still unprocessed (runner may have failed on first
        // delivery), re-trigger the runner so the automation eventually executes.
        if (externalId && eventSignature) {
          const { data: existing } = await supabase
            .from('webhook_events')
            .select('id, processed')
            .eq('source', 'woocommerce')
            .eq('topic', topic)
            .eq('external_id', externalId)
            .eq('event_signature', eventSignature)
            .maybeSingle();

          if (existing && !existing.processed) {
            console.log(`[wc-receiver] Re-triggering runner for unprocessed event ${existing.id}`);
            const retrigger = fetch(`${supabaseUrl}/functions/v1/automation-runner`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ event_id: existing.id }),
            }).catch((e) => console.warn('[wc-receiver] runner re-trigger failed:', e));
            // @ts-ignore — EdgeRuntime.waitUntil keeps the function alive after response
            try { EdgeRuntime.waitUntil(retrigger); } catch (_) { /* outside edge runtime */ }
          }
        }

        return new Response(JSON.stringify({ success: true, duplicate: true }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.error('[wc-receiver] Insert error:', insErr);
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[wc-receiver] Stored event ${ev.id} topic=${topic} external_id=${externalId}`);

    // Phase 2: trigger the automation runner.
    // Use EdgeRuntime.waitUntil so the runtime keeps the function alive until the HTTP
    // request completes — without it the Deno runtime can terminate the function as soon
    // as the response is returned, silently dropping the fire-and-forget call.
    const runnerCall = fetch(`${supabaseUrl}/functions/v1/automation-runner`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: ev.id }),
    }).catch((e) => console.warn('[wc-receiver] runner trigger failed:', e));

    // @ts-ignore — EdgeRuntime.waitUntil is available in Supabase Edge Runtime
    try { EdgeRuntime.waitUntil(runnerCall); } catch (_) { /* outside edge runtime */ }

    return new Response(JSON.stringify({ success: true, event_id: ev.id }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[wc-receiver] Error:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
