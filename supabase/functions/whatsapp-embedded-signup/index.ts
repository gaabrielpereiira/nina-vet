// Edge function: troca o `code` do Meta Embedded Signup por um token permanente,
// busca os detalhes do WABA/número, assina o webhook do app com messages + message_echoes,
// e persiste as credenciais em nina_settings.
//
// Fluxo (Coexistência):
//   Frontend abre FB.login(config_id) -> usuário autoriza -> retorna { code }
//   Frontend POSTa { code, redirect_uri } aqui
//   1) Trocamos code por system user access_token (long-lived) via GET /oauth/access_token
//   2) Buscamos WABAs autorizados via GET /debug_token
//   3) Registramos o phone_number no cliente (subscribed_apps)
//   4) Assinamos o webhook do WABA (messages + message_echoes)
//   5) Salvamos em nina_settings

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GRAPH = 'https://graph.facebook.com/v21.0';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const APP_ID = Deno.env.get('META_APP_ID');
    const APP_SECRET = Deno.env.get('META_APP_SECRET');

    if (!APP_ID || !APP_SECRET) {
      return json({
        error: 'META_APP_ID / META_APP_SECRET não configurados. Registre um App na Meta e cole as credenciais.',
      }, 400);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Autenticação necessária' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: 'Token inválido' }, 401);
    const userId = userData.user.id;

    const body = await req.json();
    const { code } = body;
    if (!code) return json({ error: 'code obrigatório' }, 400);

    // ── 1) Trocar code por access_token permanente ─────────────────────────
    const tokenUrl = `${GRAPH}/oauth/access_token`
      + `?client_id=${APP_ID}`
      + `&client_secret=${APP_SECRET}`
      + `&code=${encodeURIComponent(code)}`;

    const tokenRes = await fetch(tokenUrl);
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || !tokenJson.access_token) {
      console.error('[embedded-signup] Falha ao trocar code:', tokenJson);
      return json({ error: 'Falha ao obter token', details: tokenJson }, 400);
    }
    const accessToken: string = tokenJson.access_token;

    // ── 2) Descobrir WABA + phone_number via debug_token ───────────────────
    const debugRes = await fetch(
      `${GRAPH}/debug_token?input_token=${accessToken}&access_token=${APP_ID}|${APP_SECRET}`,
    );
    const debugJson = await debugRes.json();
    const granular = debugJson?.data?.granular_scopes || [];
    const wabaScope = granular.find((g: any) =>
      g.scope === 'whatsapp_business_management' || g.scope === 'whatsapp_business_messaging'
    );
    const wabaId: string | undefined = wabaScope?.target_ids?.[0];
    if (!wabaId) {
      console.error('[embedded-signup] Nenhum WABA no debug_token', debugJson);
      return json({ error: 'Nenhuma conta WhatsApp Business autorizada' }, 400);
    }

    // Buscar phone numbers da WABA
    const phonesRes = await fetch(
      `${GRAPH}/${wabaId}/phone_numbers?access_token=${accessToken}`,
    );
    const phonesJson = await phonesRes.json();
    const phone = phonesJson?.data?.[0];
    if (!phone?.id) {
      console.error('[embedded-signup] Nenhum phone_number na WABA', phonesJson);
      return json({ error: 'Nenhum número WhatsApp na conta' }, 400);
    }
    const phoneNumberId: string = phone.id;
    const displayPhone: string = phone.display_phone_number || '';

    // ── 3) Registrar phone_number no nosso app (subscribed_apps do WABA) ───
    const subRes = await fetch(
      `${GRAPH}/${wabaId}/subscribed_apps`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
    const subJson = await subRes.json();
    if (!subRes.ok) {
      console.warn('[embedded-signup] subscribed_apps falhou (pode ser ok se já assinado):', subJson);
    }

    // ── 4) Persistir credenciais em nina_settings (global — single tenant) ─
    // Verify token: reaproveita o existente ou gera um novo
    const { data: existing } = await supabase
      .from('nina_settings')
      .select('id, whatsapp_verify_token')
      .maybeSingle();

    const verifyToken = existing?.whatsapp_verify_token
      || `vetmais-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

    const updatePayload = {
      whatsapp_access_token: accessToken,
      whatsapp_phone_number_id: phoneNumberId,
      whatsapp_business_account_id: wabaId,
      whatsapp_verify_token: verifyToken,
    };

    if (existing?.id) {
      const { error: upErr } = await supabase
        .from('nina_settings')
        .update(updatePayload)
        .eq('id', existing.id);
      if (upErr) throw upErr;
    } else {
      const { error: insErr } = await supabase
        .from('nina_settings')
        .insert({ ...updatePayload, user_id: userId });
      if (insErr) throw insErr;
    }

    return json({
      ok: true,
      phone_number_id: phoneNumberId,
      display_phone_number: displayPhone,
      waba_id: wabaId,
      verify_token: verifyToken,
      subscribed: subRes.ok,
    });
  } catch (e) {
    console.error('[embedded-signup] error:', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
