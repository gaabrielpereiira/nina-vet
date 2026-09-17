// Edge function: orquestra a sincronização automática do VetSoft (procedimentos, tutores,
// pets e agenda). Chamada pelo cron a cada 6 horas ou manualmente pelo painel de Configurações.
//
// Cada etapa é disparada como uma chamada interna à função de importação correspondente,
// que roda no seu próprio tempo limite e registra o resultado em `vetsoft_sync_runs`.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const triggeredBy = body?.triggered_by === 'manual' ? 'manual' : 'cron';

    // Dono dos registros gravados (appointments/contacts precisam de user_id).
    let userId: string | null = null;
    const { data: admin } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle();
    userId = admin?.user_id ?? null;
    if (!userId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('user_id')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      userId = profile?.user_id ?? null;
    }
    if (!userId) return json({ error: 'Nenhum usuário encontrado para associar os registros' }, 400);

    const today = new Date();
    const steps: Array<{ area: string; fn: string; payload: Record<string, unknown> }> = [
      { area: 'procedures', fn: 'vetsoft-import-procedures', payload: { mode: 'sync' } },
      { area: 'clients', fn: 'vetsoft-import-clients', payload: { mode: 'sync', user_id: userId } },
      { area: 'pets', fn: 'vetsoft-import-clients', payload: { mode: 'pets', user_id: userId } },
      {
        area: 'agenda',
        fn: 'vetsoft-import-agenda',
        payload: {
          user_id: userId,
          from: isoDate(today),
          to: isoDate(new Date(today.getTime() + 30 * 86400000)),
        },
      },
    ];

    const dispatched: string[] = [];
    for (const step of steps) {
      // Dispara sem aguardar: cada função roda no seu próprio tempo limite e grava o log.
      fetch(`${supabaseUrl}/functions/v1/${step.fn}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-sync': serviceKey,
          apikey: serviceKey,
        },
        body: JSON.stringify({ ...step.payload, triggered_by: triggeredBy }),
      }).catch((e) => console.error(`[vetsoft-auto-sync] ${step.area}:`, e?.message || e));
      dispatched.push(step.area);
      await sleep(3000);
    }

    return json({ ok: true, triggered_by: triggeredBy, dispatched });
  } catch (e: any) {
    console.error('[vetsoft-auto-sync]', e);
    return json({ error: e?.message || 'Erro inesperado' }, 500);
  }
});
