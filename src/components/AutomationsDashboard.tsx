import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, TrendingUp, CheckCircle2, XCircle, Clock, Inbox, BarChart3 } from 'lucide-react';
import { TRIGGER_TOPICS } from '@/hooks/useAutomations';

interface LogRow { status: string; executed_at: string; rule_id: string | null }
interface EventRow { topic: string; received_at: string; processed: boolean; retry_count: number | null }
interface RuleRow { id: string; name: string; active: boolean }

const RANGES = [
  { value: '24h', label: '24h', hours: 24 },
  { value: '7d', label: '7 dias', hours: 24 * 7 },
  { value: '30d', label: '30 dias', hours: 24 * 30 },
];

const AutomationsDashboard: React.FC = () => {
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('7d');
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [rules, setRules] = useState<RuleRow[]>([]);

  const load = React.useCallback(async () => {
    const hours = RANGES.find(r => r.value === range)!.hours;
    const since = new Date(Date.now() - hours * 3600_000).toISOString();
    const [logsRes, eventsRes, rulesRes] = await Promise.all([
      supabase.from('automation_logs').select('status, executed_at, rule_id')
        .gte('executed_at', since).order('executed_at', { ascending: false }).limit(2000),
      supabase.from('webhook_events').select('topic, received_at, processed, retry_count')
        .gte('received_at', since).order('received_at', { ascending: false }).limit(2000),
      supabase.from('automation_rules').select('id, name, active'),
    ]);
    setLogs((logsRes.data as any) || []);
    setEvents((eventsRes.data as any) || []);
    setRules((rulesRes.data as any) || []);
    setLoading(false);
  }, [range]);

  useEffect(() => { load(); }, [load]);

  // Background realtime updates (no spinner)
  useEffect(() => {
    const ch = supabase
      .channel('automations-dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'automation_logs' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'webhook_events' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'automation_rules' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const stats = useMemo(() => {
    const total = logs.length;
    const success = logs.filter(l => l.status === 'success').length;
    const failed = logs.filter(l => l.status === 'failed').length;
    const skipped = logs.filter(l => l.status === 'skipped').length;
    const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
    const evtTotal = events.length;
    const evtPending = events.filter(e => !e.processed).length;
    const evtRetrying = events.filter(e => !e.processed && (e.retry_count ?? 0) > 0).length;
    return { total, success, failed, skipped, successRate, evtTotal, evtPending, evtRetrying };
  }, [logs, events]);

  const topRules = useMemo(() => {
    const counts = new Map<string, { success: number; failed: number; skipped: number }>();
    logs.forEach(l => {
      if (!l.rule_id) return;
      const c = counts.get(l.rule_id) || { success: 0, failed: 0, skipped: 0 };
      (c as any)[l.status] = ((c as any)[l.status] || 0) + 1;
      counts.set(l.rule_id, c);
    });
    return Array.from(counts.entries())
      .map(([id, c]) => {
        const r = rules.find(x => x.id === id);
        const total = c.success + c.failed + c.skipped;
        return { id, name: r?.name || '(removida)', active: r?.active ?? false, ...c, total };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [logs, rules]);

  const eventsByTopic = useMemo(() => {
    const counts = new Map<string, number>();
    events.forEach(e => counts.set(e.topic, (counts.get(e.topic) || 0) + 1));
    const max = Math.max(1, ...counts.values());
    return Array.from(counts.entries())
      .map(([topic, count]) => ({
        topic,
        label: TRIGGER_TOPICS.find(t => t.value === topic)?.label || topic,
        count,
        pct: Math.round((count / max) * 100),
      }))
      .sort((a, b) => b.count - a.count);
  }, [events]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Range selector */}
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-slate-500" />
        <span className="text-xs text-slate-500 mr-2">Período:</span>
        {RANGES.map(r => (
          <button key={r.value} onClick={() => setRange(r.value as any)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition ${
              range === r.value
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}>
            {r.label}
          </button>
        ))}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={<TrendingUp className="w-4 h-4" />} label="Execuções" value={stats.total} accent="cyan" />
        <KpiCard icon={<CheckCircle2 className="w-4 h-4" />} label="Taxa de sucesso" value={`${stats.successRate}%`} accent="emerald" />
        <KpiCard icon={<XCircle className="w-4 h-4" />} label="Falhas" value={stats.failed} accent="red" />
        <KpiCard icon={<Inbox className="w-4 h-4" />} label="Eventos recebidos" value={stats.evtTotal} accent="amber" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat label="Sucessos" value={stats.success} color="text-emerald-400" />
        <MiniStat label="Skipped" value={stats.skipped} color="text-slate-400" />
        <MiniStat label="Pendentes" value={stats.evtPending} color="text-amber-400" />
        <MiniStat label="Em retry" value={stats.evtRetrying} color="text-orange-400" icon={<Clock className="w-3 h-3" />} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Top rules */}
        <Panel title="Regras mais ativas">
          {topRules.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">Sem execuções no período.</p>
          ) : (
            <div className="space-y-2">
              {topRules.map(r => (
                <div key={r.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${r.active ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                    <span className="text-slate-200 truncate">{r.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs flex-shrink-0">
                    <span className="text-emerald-400">{r.success}✓</span>
                    {r.failed > 0 && <span className="text-red-400">{r.failed}✕</span>}
                    {r.skipped > 0 && <span className="text-slate-500">{r.skipped}⊘</span>}
                    <span className="text-slate-400 font-medium ml-1">{r.total}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Events by topic */}
        <Panel title="Eventos por topic">
          {eventsByTopic.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">Nenhum evento no período.</p>
          ) : (
            <div className="space-y-2">
              {eventsByTopic.map(t => (
                <div key={t.topic}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-300">{t.label}</span>
                    <span className="text-slate-400 font-medium">{t.count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full bg-cyan-500/70" style={{ width: `${t.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
};

const KpiCard: React.FC<{ icon: React.ReactNode; label: string; value: number | string; accent: string }> = ({ icon, label, value, accent }) => {
  const cls: Record<string, string> = {
    cyan: 'text-cyan-400 bg-cyan-500/10',
    emerald: 'text-emerald-400 bg-emerald-500/10',
    red: 'text-red-400 bg-red-500/10',
    amber: 'text-amber-400 bg-amber-500/10',
  };
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${cls[accent]} mb-2`}>{icon}</div>
      <div className="text-2xl font-bold text-slate-50 leading-tight">{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
};

const MiniStat: React.FC<{ label: string; value: number; color: string; icon?: React.ReactNode }> = ({ label, value, color, icon }) => (
  <div className="rounded-lg border border-slate-800/60 bg-slate-900/30 px-3 py-2 flex items-center justify-between">
    <span className="text-xs text-slate-500 flex items-center gap-1">{icon}{label}</span>
    <span className={`text-sm font-semibold ${color}`}>{value}</span>
  </div>
);

const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
    <h3 className="text-sm font-medium text-slate-200 mb-3">{title}</h3>
    {children}
  </div>
);

export default AutomationsDashboard;
