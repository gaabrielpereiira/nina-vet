// Edge function: espelha os agendamentos da agenda do VetSoft na agenda da Nina (`appointments`).
//
// Body: { from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD' }  (padrão: hoje-7 até hoje+90)
// Grava por lote, casando pelo vetsoft_event_id. Agendamentos criados manualmente na Nina
// (sem vetsoft_event_id) nunca são alterados nem excluídos.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getVetsoftAccessToken, listAgendaEvents } from "../_shared/vetsoft.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CANCELLED = /cancel/i;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Converte o instante ISO para data/hora no fuso configurado (padrão São Paulo).
function splitLocal(iso: string, timeZone: string): { date: string; time: string } {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const [date, time] = fmt.format(d).split(' ');
  return { date, time: `${time}:00` };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const internal = isInternalCall(req);
    const body = await req.json().catch(() => ({}));
    let userId: string | null = null;

    if (internal) {
      userId = typeof body?.user_id === 'string' ? body.user_id : null;
    } else {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) return json({ error: 'Autenticação necessária' }, 401);
      const { data: userData, error: userErr } = await supabase.auth.getUser(
        authHeader.replace('Bearer ', ''),
      );
      if (userErr || !userData?.user) return json({ error: 'Token inválido' }, 401);
      userId = userData.user.id;
    }

    const triggeredBy = body?.triggered_by === 'manual' ? 'manual' : 'cron';
    const runId = internal ? await startSyncRun(supabase, 'agenda', triggeredBy) : null;

    const today = new Date();
    const from = typeof body?.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.from)
      ? body.from
      : isoDate(new Date(today.getTime() - 7 * 86400000));
    const to = typeof body?.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.to)
      ? body.to
      : isoDate(new Date(today.getTime() + 90 * 86400000));

    try {
      await getVetsoftAccessToken(supabase);
    } catch (loginErr: any) {
      const message = loginErr?.message || 'Falha ao conectar com o VetSoft';
      await finishSyncRun(supabase, runId, 'failed', {}, message);
      return json({ error: message }, 400);
    }

    const { data: settings } = await supabase
      .from('nina_settings')
      .select('timezone')
      .limit(1)
      .maybeSingle();
    const timeZone = settings?.timezone || 'America/Sao_Paulo';

    let events;
    try {
      ({ events } = await listAgendaEvents(supabase, from, to));
    } catch (e: any) {
      const message = e?.message || 'Falha ao ler a agenda do VetSoft';
      await finishSyncRun(supabase, runId, 'failed', {}, message);
      return json({ error: message }, 400);
    }

    // Índices para vincular tutor e pet já importados.
    const [{ data: contacts }, { data: animals }, { data: existing }] = await Promise.all([
      supabase.from('contacts').select('id, vetsoft_client_id').not('vetsoft_client_id', 'is', null),
      supabase.from('animals').select('id, vetsoft_animal_id').not('vetsoft_animal_id', 'is', null),
      supabase.from('appointments').select('id, vetsoft_event_id').not('vetsoft_event_id', 'is', null),
    ]);

    const contactByExternal = new Map<number, string>();
    for (const c of contacts || []) contactByExternal.set(Number(c.vetsoft_client_id), c.id);
    const animalByExternal = new Map<number, string>();
    for (const a of animals || []) animalByExternal.set(Number(a.vetsoft_animal_id), a.id);
    const apptByExternal = new Map<number, string>();
    for (const a of existing || []) apptByExternal.set(Number(a.vetsoft_event_id), a.id);

    const now = new Date().toISOString();
    const toInsert: any[] = [];
    const toUpdate: any[] = [];
    let cancelled = 0;
    let withoutTutor = 0;

    for (const ev of events) {
      const { date, time } = splitLocal(ev.starts_at, timeZone);
      const contactId = ev.client_external_id != null
        ? contactByExternal.get(Number(ev.client_external_id)) ?? null
        : null;
      if (!contactId && ev.client_external_id != null) withoutTutor++;

      const status = ev.status && CANCELLED.test(ev.status) ? 'cancelled' : 'scheduled';
      if (status === 'cancelled') cancelled++;

      const row = {
        title: ev.title,
        description: ev.description,
        date,
        time,
        duration: ev.duration,
        type: 'consultoria',
        status,
        contact_id: contactId,
        animal_id: ev.animal_external_id != null
          ? animalByExternal.get(Number(ev.animal_external_id)) ?? null
          : null,
        vetsoft_event_id: ev.external_id,
        vetsoft_synced_at: now,
        vetsoft_sync_error: null,
        user_id: userId,
      };

      const known = apptByExternal.get(Number(ev.external_id));
      if (known) toUpdate.push({ id: known, ...row });
      else toInsert.push(row);
    }

    const errors: string[] = [];
    let created = 0;
    let updated = 0;

    for (const batch of chunk(toInsert, 200)) {
      const { error } = await supabase.from('appointments').insert(batch);
      if (error) errors.push(error.message);
      else created += batch.length;
    }
    for (const batch of chunk(toUpdate, 200)) {
      const { error } = await supabase.from('appointments').upsert(batch, { onConflict: 'id' });
      if (error) errors.push(error.message);
      else updated += batch.length;
    }

    await finishSyncRun(
      supabase,
      runId,
      errors.length > 0 ? 'failed' : 'success',
      { created, updated, skipped: withoutTutor, total: events.length },
      errors.join(' | ') || null,
    );

    return json({
      ok: true,
      from,
      to,
      events_total: events.length,
      created,
      updated,
      cancelled,
      without_tutor: withoutTutor,
      errors,
    });
  } catch (e: any) {
    console.error('[vetsoft-import-agenda]', e);
    return json({ error: e?.message || 'Erro inesperado' }, 500);
  }
});
