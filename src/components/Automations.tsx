import React, { useState, useMemo } from 'react';
import { Zap, Plus, Search, Pencil, Trash2, Loader2, Activity, FileClock, Inbox, BarChart3, FlaskConical, RefreshCw, Clock } from 'lucide-react';
import { Button } from './Button';
import { useAutomations, AutomationRule, TRIGGER_TOPICS, ACTION_TYPES } from '@/hooks/useAutomations';
import AutomationFormModal from './AutomationFormModal';
import AutomationLogsModal from './AutomationLogsModal';
import WebhookEventsMonitor from './WebhookEventsMonitor';
import AutomationsDashboard from './AutomationsDashboard';
import SimulateWebhookModal from './SimulateWebhookModal';
import WebhookEndpointCard from './automations/WebhookEndpointCard';
import { supabase } from '@/integrations/supabase/client';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { toast } from 'sonner';

type Tab = 'rules' | 'events' | 'dashboard';

const Automations: React.FC = () => {
  const { isAdmin } = useCompanySettings();
  const { rules, loading, error, pendingEvents, refresh } = useAutomations();
  const [tab, setTab] = useState<Tab>('rules');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [logsRule, setLogsRule] = useState<AutomationRule | null>(null);
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);

  const reprocessPending = async () => {
    if (reprocessing || !isAdmin) return;
    setReprocessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('automation-runner', { body: {} });
      if (error) throw error;
      const processed = (data as any)?.processed ?? 0;
      if (processed > 0) {
        toast.success(`${processed} evento(s) reprocessado(s) com sucesso`);
      } else {
        toast.info('Nenhum evento pendente encontrado');
      }
      refresh();
    } catch (e) {
      toast.error('Erro ao reprocessar', { description: e instanceof Error ? e.message : '' });
    } finally {
      setReprocessing(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rules.filter(r => !q || r.name.toLowerCase().includes(q) || r.trigger_topic.includes(q));
  }, [rules, search]);

  const triggerLabel = (v: string) => TRIGGER_TOPICS.find(t => t.value === v)?.label || v;
  const actionLabel = (v: string) => ACTION_TYPES.find(a => a.value === v)?.label || v;
  const formatDelay = (min: number) => {
    if (!min) return '';
    if (min % 1440 === 0) return `${min / 1440}d`;
    if (min % 60 === 0) return `${min / 60}h`;
    return `${min}min`;
  };

  const toggleActive = async (r: AutomationRule) => {
    if (!isAdmin) return;
    const { error } = await supabase.from('automation_rules').update({ active: !r.active }).eq('id', r.id);
    if (error) toast.error('Erro ao atualizar');
    else { toast.success(r.active ? 'Pausada' : 'Ativada'); await refresh(); }
  };

  const remove = async (r: AutomationRule) => {
    if (!isAdmin) return;
    if (!confirm(`Excluir "${r.name}"?`)) return;
    const { error } = await supabase.from('automation_rules').delete().eq('id', r.id);
    if (error) toast.error('Erro ao excluir');
    else { toast.success('Automação excluída'); await refresh(); }
  };

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto h-full overflow-y-auto bg-slate-950 text-slate-50 custom-scrollbar">
      <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            <Zap className="w-7 h-7 text-cyan-400" />
            Automações
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Regras que executam ações a partir de eventos do WooCommerce e do Pipeline da Nina.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs">
            <Activity className="w-4 h-4 text-amber-400" />
            <span className="text-slate-300">{pendingEvents}</span>
            <span className="text-slate-500">pendentes</span>
          </div>
          {pendingEvents > 0 && isAdmin && (
            <Button
              variant="ghost"
              onClick={reprocessPending}
              disabled={reprocessing}
              className="gap-2 border border-amber-500/30 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
            >
              {reprocessing
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <RefreshCw className="w-4 h-4" />}
              <span className="hidden sm:inline">Reprocessar pendentes</span>
              <span className="sm:hidden">Reprocessar</span>
            </Button>
          )}
          <Button disabled={!isAdmin} variant="ghost" onClick={() => setSimulateOpen(true)} className="gap-2">
            <FlaskConical className="w-4 h-4" />
            <span className="hidden sm:inline">Simular evento</span>
          </Button>
          {tab === 'rules' && isAdmin && (
            <Button variant="primary" onClick={() => { setEditing(null); setModalOpen(true); }} className="gap-2">
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Nova automação</span>
              <span className="sm:hidden">Nova</span>
            </Button>
          )}
        </div>
      </div>

      {error && <div role="alert" className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
        {error} <button type="button" onClick={refresh} className="underline">Tentar novamente</button>
      </div>}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-800 overflow-x-auto">
        <button onClick={() => setTab('rules')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 whitespace-nowrap ${
            tab === 'rules' ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}>
          <Zap className="w-4 h-4" /> Regras
        </button>
        <button onClick={() => setTab('dashboard')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 whitespace-nowrap ${
            tab === 'dashboard' ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}>
          <BarChart3 className="w-4 h-4" /> Painel
        </button>
        <button onClick={() => setTab('events')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 whitespace-nowrap ${
            tab === 'events' ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}>
          <Inbox className="w-4 h-4" /> Eventos recebidos
        </button>
      </div>

      {tab === 'dashboard' && <AutomationsDashboard />}
      {tab === 'events' && <WebhookEventsMonitor />}
      <div hidden={tab !== 'rules'}>
        <WebhookEndpointCard onSimulate={() => setSimulateOpen(true)} />

        <div className="mb-4 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..."
            className="w-full pl-10 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-50 focus:outline-none focus:border-cyan-500" />
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-500" />
          </div>
        ) : error ? null : filtered.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-slate-800 rounded-xl">
            <Zap className="w-10 h-10 mx-auto text-slate-700 mb-3" />
            <p className="text-slate-400">Nenhuma automação ainda.</p>
            <p className="text-xs text-slate-500 mt-1">Crie a primeira regra para eventos do WooCommerce ou negócios ganhos no Pipeline.</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-900 border-b border-slate-800 text-xs uppercase text-slate-400">
                  <tr>
                    <th className="text-left p-3">Nome</th>
                    <th className="text-left p-3">Quando</th>
                    <th className="text-left p-3">Então</th>
                    <th className="text-left p-3">Cooldown</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-right p-3">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <tr key={r.id} className="border-b border-slate-800/50 hover:bg-slate-900/50">
                      <td className="p-3 font-medium text-slate-100">
                        <div className="flex items-center gap-2">
                          <span>{r.name}</span>
                          {r.delay_minutes > 0 && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 text-[10px] font-medium">
                              <Clock className="w-3 h-3" /> {formatDelay(r.delay_minutes)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-slate-300">{triggerLabel(r.trigger_topic)}</td>
                      <td className="p-3 text-slate-300">{actionLabel(r.action_type)}</td>
                      <td className="p-3 text-slate-400">{r.cooldown_hours > 0 ? `${r.cooldown_hours}h` : '—'}</td>
                      <td className="p-3">
                        <button disabled={!isAdmin} onClick={() => toggleActive(r)}
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            r.active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700/30 text-slate-400'
                          }`}>
                          {r.active ? 'Ativa' : 'Pausada'}
                        </button>
                      </td>
                      <td className="p-3 text-right">
                        <button onClick={() => setLogsRule(r)} title="Ver logs"
                          className="p-1.5 text-slate-400 hover:text-cyan-400">
                          <FileClock className="w-4 h-4" />
                        </button>
                        <button disabled={!isAdmin} aria-label="Editar automação" onClick={() => { setEditing(r); setModalOpen(true); }}
                          className="p-1.5 text-slate-400 hover:text-cyan-400">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button disabled={!isAdmin} aria-label="Excluir automação" onClick={() => remove(r)} className="p-1.5 text-slate-400 hover:text-red-400">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {filtered.map(r => (
                <div key={r.id} className="p-4 rounded-xl border border-slate-800 bg-slate-900/50">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-medium text-slate-100 flex items-center gap-2">
                      {r.name}
                      {r.delay_minutes > 0 && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 text-[10px] font-medium">
                          <Clock className="w-3 h-3" /> {formatDelay(r.delay_minutes)}
                        </span>
                      )}
                    </h3>
                    <button disabled={!isAdmin} onClick={() => toggleActive(r)}
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        r.active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700/30 text-slate-400'
                      }`}>
                      {r.active ? 'Ativa' : 'Pausada'}
                    </button>
                  </div>
                  <div className="text-xs text-slate-400 space-y-1">
                    <div><span className="text-slate-500">Quando:</span> {triggerLabel(r.trigger_topic)}</div>
                    <div><span className="text-slate-500">Então:</span> {actionLabel(r.action_type)}</div>
                    {r.cooldown_hours > 0 && <div><span className="text-slate-500">Cooldown:</span> {r.cooldown_hours}h</div>}
                  </div>
                  <div className="flex gap-2 mt-3 pt-3 border-t border-slate-800">
                    <Button variant="ghost" size="sm" onClick={() => setLogsRule(r)} className="flex-1 gap-2">
                      <FileClock className="w-3.5 h-3.5" /> Logs
                    </Button>
                    <Button disabled={!isAdmin} variant="ghost" size="sm" onClick={() => { setEditing(r); setModalOpen(true); }}
                      className="flex-1 gap-2">
                      <Pencil className="w-3.5 h-3.5" /> Editar
                    </Button>
                    <Button disabled={!isAdmin} variant="ghost" size="sm" onClick={() => remove(r)}
                      className="text-red-400 hover:text-red-300 gap-2">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <AutomationFormModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        rule={editing}
        onSaved={refresh}
      />
      <AutomationLogsModal
        isOpen={!!logsRule}
        onClose={() => setLogsRule(null)}
        rule={logsRule}
      />
      <SimulateWebhookModal isOpen={simulateOpen} onClose={() => setSimulateOpen(false)} />
    </div>
  );
};

export default Automations;
