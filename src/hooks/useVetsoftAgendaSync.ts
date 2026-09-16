import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { FunctionsHttpError } from '@supabase/supabase-js';

export interface AgendaSyncResult {
  from: string;
  to: string;
  events_total: number;
  created: number;
  updated: number;
  cancelled: number;
  without_tutor: number;
  errors: string[];
}

export function useVetsoftAgendaSync() {
  const [syncing, setSyncing] = useState(false);

  const syncAgenda = useCallback(async (range?: { from?: string; to?: string }) => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('vetsoft-import-agenda', {
        body: range ?? {},
      });
      if (error) {
        let message = error.message;
        if (error instanceof FunctionsHttpError) {
          try {
            const body = await error.context.json();
            if (body?.error) message = body.error;
          } catch { /* corpo não-JSON */ }
        }
        throw new Error(message);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as AgendaSyncResult;
    } finally {
      setSyncing(false);
    }
  }, []);

  return { syncAgenda, syncing };
}
