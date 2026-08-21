// Edge function: salva a escolha (feita no Settings) do tipo de atendimento e do usuário
// responsável padrão usados pela Nina ao criar eventos na agenda do VetSoft.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Autenticação necessária' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (userErr || !userData?.user) return json({ error: 'Token inválido' }, 401);

    const body = await req.json();
    const { service_type_id, service_type_name, user_id, user_name } = body || {};

    const { data: settings } = await supabase
      .from('nina_settings')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!settings) return json({ error: 'Configurações não encontradas' }, 404);

    const update: Record<string, any> = {};
    if (service_type_id !== undefined) {
      update.vetsoft_default_service_type_id = service_type_id;
      update.vetsoft_default_service_type_name = service_type_name ?? null;
    }
    if (user_id !== undefined) {
      update.vetsoft_default_user_id = user_id;
      update.vetsoft_default_user_name = user_name ?? null;
    }

    const { error: upErr } = await supabase.from('nina_settings').update(update).eq('id', settings.id);
    if (upErr) throw upErr;

    return json({ ok: true });
  } catch (e) {
    console.error('[vetsoft-save-defaults] error:', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
