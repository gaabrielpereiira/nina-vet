import React, { useEffect, useState, useCallback } from 'react';
import { Loader2, RefreshCw, Play, CheckCircle2, Clock, AlertTriangle, ChevronRight } from 'lucide-react';
import { Button } from './Button';
import { supabase } from '@/integrations/supabase/client';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { toast } from 'sonner';
import type { WebhookEvent } from '@/hooks/useAutomations';

const WebhookEventsMonitor: React.FC = () => {
  const { isAdmin } = useCompanySettings();
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'processed' | 'error'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState<string | null>(null);

  const load = useCallback(async () => {
    let q = supabase.from('webhook_events').select('*').order('received_at', { ascending: false }).limit(100);
    if (filter === 'pending') q = q.eq('processed', false).is('error', null);
    else if (filter === 'processed') q = q.eq('processed', true);
    else if (filter === 'error') q = q.not('error', 'is', null);
    const { data } = await q;
    setEvents((data || []) as any);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    load();
    const ch = supabase.channel('events-monitor')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'webhook_events' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const reprocess = async (ev: WebhookEvent) => {
    if (!isAdmin) return;
    setReprocessing(ev.id);
    try {
      const { error } = await supabase.functions.invoke('automation-runner', {
        body: { event_id: ev.id, reprocess: true },
      });
      if (error) throw error;
      toast.success('Evento reprocessado');
      load();
    } catch (e) {
      toast.error('Erro ao reprocessar', { description: e instanceof Error ? e.message : '' });
    } finally {
      setReprocessing(null);
    }
  };

  const statusBadge = (ev: WebhookEvent) => {
    if (ev.error) return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/10 text-red-400 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" />erro</span>;
    if (ev.processed) return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />processado</span>;
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 inline-flex items-center gap-1"><Clock className="w-3 h-3" />pendente</span>;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="flex gap-2 flex-wrap">
          {(['all', 'pending', 'processed', 'error'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium ${
                filter === f ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-800/50 text-slate-400 hover:text-slate-200'
              }`}>
              {f === 'all' ? 'Todos' : f === 'pending' ? 'Pendentes' : f === 'processed' ? 'Processados' : 'Com erro'}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={load} className="gap-2">
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center p-8"><Loader2 className="w-5 h-5 animate-spin text-cyan-400" /></div>
      ) : events.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-slate-800 rounded-xl text-slate-500 text-sm">
          Nenhum evento {filter !== 'all' ? 'nesse filtro' : 'recebido ainda'}.
        </div>
      ) : (
        <div className="space-y-2">
          {events.map(ev => (
            <div key={ev.id} className="border border-slate-800 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between p-3 hover:bg-slate-800/30">
                <button onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left">
                  <ChevronRight className={`w-4 h-4 text-slate-500 transition-transform ${expanded === ev.id ? 'rotate-90' : ''}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-mono text-slate-200">{ev.topic}</span>
                      {statusBadge(ev)}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {new Date(ev.received_at).toLocaleString('pt-BR')}
                      {ev.error && <span className="ml-2 text-red-400 truncate">— {ev.error}</span>}
                    </p>
                  </div>
                </button>
                <Button variant="ghost" size="sm" onClick={() => reprocess(ev)} disabled={!isAdmin || reprocessing === ev.id} className="gap-1.5">
                  {reprocessing === ev.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">Reprocessar</span>
                </Button>
              </div>
              {expanded === ev.id && (
                <pre className="p-3 bg-slate-950 text-xs text-slate-400 overflow-x-auto border-t border-slate-800 max-h-96">
{JSON.stringify(ev.payload, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WebhookEventsMonitor;
