import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { FunctionsHttpError } from '@supabase/supabase-js';

export type SyncArea = 'procedures' | 'clients' | 'pets' | 'agenda';

export interface SyncRun {
  id: string;
  area: SyncArea;
  status: 'running' | 'success' | 'failed';
  triggered_by: 'cron' | 'manual';
  started_at: string;
  finished_at: string | null;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  total_count: number;
  error: string | null;
}

export const SYNC_AREAS: { key: SyncArea; label: string }[] = [
  { key: 'procedures', label: 'Procedimentos e valores' },
  { key: 'clients', label: 'Tutores' },
  { key: 'pets', label: 'Pets' },
  { key: 'agenda', label: 'Agenda' },
];

export function useVetsoftSyncStatus() {
  const [runs, setRuns] = useState<Record<string, SyncRun | undefined>>({});
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('vetsoft_sync_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(60);
      if (error) throw error;

      const latest: Record<string, SyncRun> = {};
      for (const row of (data || []) as SyncRun[]) {
        if (!latest[row.area]) latest[row.area] = row;
      }
      setRuns(latest);
    } catch (e) {
      console.error('[useVetsoftSyncStatus]', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const syncNow = useCallback(async () => {
    setTriggering(true);
    try {
      const { data, error } = await supabase.functions.invoke('vetsoft-auto-sync', {
        body: { triggered_by: 'manual' },
      });
      if (error) {
        let message = error.message;
        if (error instanceof FunctionsHttpError) {
          try {
            const payload = await error.context.json();
            if (payload?.error) message = payload.error;
          } catch { /* corpo não-JSON */ }
        }
        throw new Error(message);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    } finally {
      setTriggering(false);
      setTimeout(fetchRuns, 4000);
    }
  }, [fetchRuns]);

  return { runs, loading, triggering, syncNow, refetch: fetchRuns };
}
