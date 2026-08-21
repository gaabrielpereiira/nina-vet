// Edge function: testa a conexão com o VetSoft (login com os secrets VETSOFT_TENANT/EMAIL/PASSWORD)
// e devolve as listas de "tipos de atendimento" e "usuários" pro Settings popular os dois
// dropdowns de configuração fixa da clínica (cod_tipo_atentimento / cod_usuario_responsavel),
// exigidos pela API do VetSoft em todo evento de agenda.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getVetsoftAccessToken, listServiceTypes, listTenantUsers } from "../_shared/vetsoft.ts";

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

    try {
      await getVetsoftAccessToken(supabase);
    } catch (loginErr: any) {
      const message = loginErr?.message || 'Falha ao conectar com o VetSoft';
      const { data: settings } = await supabase
        .from('nina_settings')
        .select('id')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (settings) {
        await supabase.from('nina_settings').update({ vetsoft_last_error: message }).eq('id', settings.id);
      }
      return json({ error: message }, 400);
    }

    const [serviceTypes, tenantUsers] = await Promise.all([
      listServiceTypes(supabase).catch((e) => {
        console.warn('[vetsoft-connect] Falha ao listar tipos de atendimento:', e);
        return [];
      }),
      listTenantUsers(supabase).catch((e) => {
        console.warn('[vetsoft-connect] Falha ao listar usuários:', e);
        return [];
      }),
    ]);

    return json({ ok: true, serviceTypes, tenantUsers });
  } catch (e) {
    console.error('[vetsoft-connect] error:', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
