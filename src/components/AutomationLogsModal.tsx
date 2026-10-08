import React, { useEffect, useState } from 'react';
import { X, Loader2, CheckCircle2, XCircle, MinusCircle, Clock, Ban } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { AutomationLog, AutomationRule } from '@/hooks/useAutomations';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  rule: AutomationRule | null;
}

const STATUS_FILTERS = ['all', 'success', 'scheduled', 'cancelled', 'failed', 'skipped'] as const;
const STATUS_LABEL: Record<string, string> = {
  all: 'Todos', success: 'Sucesso', scheduled: 'Agendados', cancelled: 'Cancelados', failed: 'Falhas', skipped: 'Ignorados',
};

const AutomationLogsModal: React.FC<Props> = ({ isOpen, onClose, rule }) => {
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<typeof STATUS_FILTERS[number]>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !rule) return;
    setLoading(true);
    let q = supabase.from('automation_logs').select('*')
      .eq('rule_id', rule.id).order('executed_at', { ascending: false }).limit(100);
    if (filter !== 'all') q = q.eq('status', filter);
    q.then(({ data }) => { setLogs((data || []) as any); setLoading(false); });

    const ch = supabase.channel(`logs-${rule.id}`).on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'automation_logs', filter: `rule_id=eq.${rule.id}` },
      (p: any) => { if (filter === 'all' || p.new.status === filter) setLogs(prev => [p.new, ...prev].slice(0, 100)); }
    ).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isOpen, rule, filter]);

  if (!isOpen || !rule) return null;

  const icon = (s: string) => s === 'success'
    ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
    : s === 'failed'
      ? <XCircle className="w-4 h-4 text-red-400" />
      : s === 'scheduled'
        ? <Clock className="w-4 h-4 text-sky-400" />
        : s === 'cancelled'
          ? <Ban className="w-4 h-4 text-amber-400" />
          : <MinusCircle className="w-4 h-4 text-slate-500" />;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-white">Histórico de execuções</h2>
            <p className="text-xs text-slate-400 mt-0.5">{rule.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-3 border-b border-slate-800 flex gap-2">
          {STATUS_FILTERS.map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium ${
                filter === s ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-800/50 text-slate-400 hover:text-slate-200'
              }`}>
              {s === 'all' ? 'Todos' : STATUS_LABEL[s] || s}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
          {loading ? (
            <div className="flex justify-center p-8"><Loader2 className="w-5 h-5 animate-spin text-cyan-400" /></div>
          ) : logs.length === 0 ? (
            <p className="text-center text-sm text-slate-500 py-8">Nenhuma execução ainda.</p>
          ) : (
            <div className="space-y-2">
              {logs.map(l => (
                <div key={l.id} className="border border-slate-800 rounded-lg overflow-hidden">
                  <button onClick={() => setExpanded(expanded === l.id ? null : l.id)}
                    className="w-full flex items-center justify-between p-3 hover:bg-slate-800/30 text-left">
                    <div className="flex items-center gap-3">
                      {icon(l.status)}
                      <div>
                        <p className="text-sm text-slate-200 capitalize">{l.status}</p>
                        <p className="text-xs text-slate-500">{new Date(l.executed_at).toLocaleString('pt-BR')}</p>
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 truncate max-w-[40%]">
                      {l.status === 'scheduled' && l.result?.scheduled_for
                        ? `→ ${new Date(l.result.scheduled_for).toLocaleString('pt-BR')}`
                        : l.status === 'cancelled'
                          ? (l.result?.reason || 'cancelado')
                          : (l.result?.reason || l.result?.template || l.result?.url || '')}
                    </span>
                  </button>
                  {expanded === l.id && (
                    <pre className="p-3 bg-slate-950 text-xs text-slate-400 overflow-x-auto border-t border-slate-800">
{JSON.stringify(l.result, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AutomationLogsModal;
