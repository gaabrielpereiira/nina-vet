// Edge function: chamada pela página de callback (src/pages/WhatsAppCallback.tsx) logo após
// o redirect da Zernio, para persistir a conexão imediatamente (sem esperar o webhook
// account.connected, que também faz o mesmo persist de forma assíncrona/idempotente).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getZernioApiKey } from "../_shared/zernio.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ZERNIO_API = 'https://zernio.com/api/v1';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Autenticação necessária' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const ZERNIO_API_KEY = await getZernioApiKey(supabase);
    if (!ZERNIO_API_KEY) return json({ error: 'API Key da Zernio não configurada. Preencha em Configurações > APIs.' }, 400);

    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (userErr || !userData?.user) return json({ error: 'Token inválido' }, 401);

    const body = await req.json();
    const accountId: string | undefined = body?.accountId;
    if (!accountId) return json({ error: 'accountId obrigatório' }, 400);

    const { data: settings } = await supabase
      .from('nina_settings')
      .select('id, zernio_profile_id')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!settings) return json({ error: 'Configurações não encontradas' }, 404);

    // Não existe GET /v1/accounts/{id} na Zernio — lista e filtra pelo _id.
    const listUrl = settings.zernio_profile_id
      ? `${ZERNIO_API}/accounts?platform=whatsapp&profileId=${encodeURIComponent(settings.zernio_profile_id)}`
      : `${ZERNIO_API}/accounts?platform=whatsapp`;
    const accRes = await fetch(listUrl, {
      headers: { 'Authorization': `Bearer ${ZERNIO_API_KEY}` },
    });
    const accJson = await accRes.json();
    if (!accRes.ok) {
      console.error('[zernio-save-connection] Falha ao listar contas:', accJson);
      return json({ error: 'Falha ao buscar conta na Zernio', details: accJson }, 400);
    }

    const account = (accJson?.accounts || []).find((a: any) => a._id === accountId);
    if (!account) {
      return json({ error: 'Conta não encontrada na Zernio' }, 404);
    }
    if (account.platform !== 'whatsapp') {
      return json({ error: 'Conta conectada não é do WhatsApp' }, 400);
    }

    const { error: upErr } = await supabase
      .from('nina_settings')
      .update({
        zernio_account_id: accountId,
        zernio_display_phone_number: account.username || null,
        zernio_display_name: account.displayName || null,
        zernio_connected_at: new Date().toISOString(),
        zernio_disconnected_at: null,
        zernio_disconnect_reason: null,
      })
      .eq('id', settings.id);
    if (upErr) throw upErr;

    return json({
      ok: true,
      accountId,
      displayPhoneNumber: account.username || null,
      displayName: account.displayName || null,
    });
  } catch (e) {
    console.error('[zernio-save-connection] error:', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
