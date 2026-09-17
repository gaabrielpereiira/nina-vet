// Registro das rodadas de sincronização com o VetSoft (`vetsoft_sync_runs`).
// Usado tanto pelas importações manuais quanto pela sincronização automática (cron).

export type SyncArea = 'procedures' | 'clients' | 'pets' | 'agenda';

export interface SyncCounts {
  created?: number;
  updated?: number;
  skipped?: number;
  total?: number;
}

export async function startSyncRun(
  supabase: any,
  area: SyncArea,
  triggeredBy: 'cron' | 'manual',
): Promise<string | null> {
  const { data, error } = await supabase
    .from('vetsoft_sync_runs')
    .insert({ area, triggered_by: triggeredBy, status: 'running' })
    .select('id')
    .maybeSingle();
  if (error) {
    console.warn('[sync-log] falha ao abrir rodada:', error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function finishSyncRun(
  supabase: any,
  runId: string | null,
  status: 'success' | 'failed',
  counts: SyncCounts = {},
  error?: string | null,
) {
  if (!runId) return;
  const { error: updErr } = await supabase
    .from('vetsoft_sync_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      created_count: counts.created ?? 0,
      updated_count: counts.updated ?? 0,
      skipped_count: counts.skipped ?? 0,
      total_count: counts.total ?? 0,
      error: error ? String(error).slice(0, 1000) : null,
    })
    .eq('id', runId);
  if (updErr) console.warn('[sync-log] falha ao fechar rodada:', updErr.message);
}

// Chamada interna (cron / auto-sync): autenticada pela service role key.
export function isInternalCall(req: Request): boolean {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret) return false;
  const header = req.headers.get('x-internal-sync');
  return header === secret;
}
