// Edge function: inicia a conexão do WhatsApp via Zernio (modo Coexistência).
//
// Fluxo:
//   1) Garante que existe um profile na Zernio para esta instalação (cria uma vez, reaproveita depois).
//   2) Garante que o webhook da Zernio está registrado apontando para zernio-webhook (cria uma vez).
//   3) Pede a authUrl do fluxo de redirect (GET /v1/connect/whatsapp) e devolve pro frontend.
//
// O frontend abre `authUrl` (popup ou redirect). A Meta cuida do Embedded Signup —
// inclusive da opção "Conectar app do WhatsApp Business existente" que ativa a Coexistência.
// Ao final, a Zernio redireciona para `redirect_url` com ?connected=whatsapp&accountId=...

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ZERNIO_API = 'https://zernio.com/api/v1';

const WEBHOOK_EVENTS = [
  'account.connected',
  'account.disconnected',
  'message.received',
  'message.sent',
  'whatsapp.template.status_updated',
  'whatsapp.number.suspended',
  'whatsapp.number.reactivated',
];

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const ZERNIO_API_KEY = Deno.env.get('ZERNIO_API_KEY');
    const ZERNIO_WEBHOOK_SECRET = Deno.env.get('ZERNIO_WEBHOOK_SECRET');
    if (!ZERNIO_API_KEY) {
      return json({ error: 'ZERNIO_API_KEY não configurada nos secrets do Supabase.' }, 400);
    }
    if (!ZERNIO_WEBHOOK_SECRET) {
      return json({ error: 'ZERNIO_WEBHOOK_SECRET não configurada nos secrets do Supabase.' }, 400);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Autenticação necessária' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (userErr || !userData?.user) return json({ error: 'Token inválido' }, 401);

    const body = await req.json().catch(() => ({}));
    const redirectUrl: string | undefined = body?.redirect_url;
    if (!redirectUrl) return json({ error: 'redirect_url obrigatório' }, 400);

    const zernio = (path: string, init: RequestInit = {}) =>
      fetch(`${ZERNIO_API}${path}`, {
        ...init,
        headers: {
          'Authorization': `Bearer ${ZERNIO_API_KEY}`,
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
      });

    // ── Settings (linha única) ──────────────────────────────────────────
    let { data: settings } = await supabase
      .from('nina_settings')
      .select('id, zernio_profile_id')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!settings) {
      const { data: created, error: createErr } = await supabase
        .from('nina_settings')
        .insert({ is_active: true })
        .select('id, zernio_profile_id')
        .single();
      if (createErr) throw createErr;
      settings = created;
    }

    // ── 1) Profile Zernio ────────────────────────────────────────────────
    let profileId = settings.zernio_profile_id as string | null;

    if (!profileId) {
      const listRes = await zernio('/profiles?name=nina-vet');
      const listJson = await listRes.json();
      profileId = listJson?.profiles?.[0]?._id || null;

      if (!profileId) {
        const createRes = await zernio('/profiles', {
          method: 'POST',
          body: JSON.stringify({ name: 'nina-vet', description: 'Nina Vet - WhatsApp' }),
        });
        const createJson = await createRes.json();
        if (!createRes.ok) {
          // 409 = já existe (corrida); tenta recuperar pelo details.existingProfileId
          profileId = createJson?.details?.existingProfileId || null;
          if (!profileId) {
            console.error('[zernio-connect] Falha ao criar profile:', createJson);
            return json({ error: 'Falha ao criar profile na Zernio', details: createJson }, 400);
          }
        } else {
          profileId = createJson?.profile?._id;
        }
      }

      await supabase.from('nina_settings').update({ zernio_profile_id: profileId }).eq('id', settings.id);
    }

    // ── 2) Webhook registrado ───────────────────────────────────────────
    const webhookUrl = `${supabaseUrl}/functions/v1/zernio-webhook`;
    const hooksRes = await zernio('/webhooks/settings');
    const hooksJson = await hooksRes.json();
    const existingHook = (hooksJson?.webhooks || []).find((w: any) => w.url === webhookUrl);

    if (!existingHook) {
      const createHookRes = await zernio('/webhooks/settings', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Nina Vet - WhatsApp',
          url: webhookUrl,
          secret: ZERNIO_WEBHOOK_SECRET,
          events: WEBHOOK_EVENTS,
          isActive: true,
        }),
      });
      if (!createHookRes.ok) {
        const errJson = await createHookRes.json().catch(() => ({}));
        console.warn('[zernio-connect] Falha ao criar webhook (seguindo mesmo assim):', errJson);
      }
    }

    // ── 3) Auth URL do fluxo de conexão ─────────────────────────────────
    const connectRes = await zernio(
      `/connect/whatsapp?profileId=${encodeURIComponent(profileId!)}&redirect_url=${encodeURIComponent(redirectUrl)}`,
    );
    const connectJson = await connectRes.json();
    if (!connectRes.ok || !connectJson?.authUrl) {
      console.error('[zernio-connect] Falha ao obter authUrl:', connectJson);
      return json({ error: 'Falha ao iniciar conexão com a Zernio', details: connectJson }, 400);
    }

    return json({ authUrl: connectJson.authUrl, profileId });
  } catch (e) {
    console.error('[zernio-connect] error:', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
