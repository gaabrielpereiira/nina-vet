import React from 'react';
import { RefreshCw, CheckCircle2, AlertTriangle, Clock, Loader2 } from 'lucide-react';
import { Button } from '../Button';
import { useVetsoftSyncStatus, SYNC_AREAS } from '@/hooks/useVetsoftSyncStatus';
import { toast } from 'sonner';

const formatWhen = (iso?: string | null) => {
  if (!iso) return 'nunca';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'nunca';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const VetsoftSyncStatus: React.FC = () => {
  const { runs, loading, triggering, syncNow, refetch } = useVetsoftSyncStatus();

  const handleSyncNow = async () => {
    try {
      await syncNow();
      toast.success('Sincronização iniciada', {
        description: 'Pode levar alguns minutos. Atualize o painel para ver o resultado.',
      });
    } catch (e: any) {
      toast.error('Não foi possível iniciar a sincronização', { description: e?.message });
    }
  };

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h3 className="text-lg font-semibold text-white">Sincronização VetSoft</h3>
          <p className="text-sm text-slate-400 mt-1">
            Roda sozinha a cada 6 horas: procedimentos e valores, tutores, pets e agenda (hoje até 30 dias à frente).
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="ghost" size="sm" onClick={refetch} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
          <Button variant="primary" size="sm" onClick={handleSyncNow} disabled={triggering} className="gap-2">
            {triggering ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Sincronizar agora
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {SYNC_AREAS.map(({ key, label }) => {
          const run = runs[key];
          const status = run?.status;
          return (
            <div
              key={key}
              className="flex items-start justify-between gap-4 p-3 rounded-lg bg-slate-950/50 border border-slate-800"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {status === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  {status === 'failed' && <AlertTriangle className="w-4 h-4 text-red-400" />}
                  {(status === 'running' || !status) && <Clock className="w-4 h-4 text-slate-500" />}
                  <span className="text-sm font-medium text-white">{label}</span>
                </div>
                {run?.error && (
                  <p className="text-xs text-red-400 mt-1 break-words">{run.error}</p>
                )}
                {!run && (
                  <p className="text-xs text-slate-500 mt-1">Ainda não sincronizado.</p>
                )}
                {run && !run.error && (
                  <p className="text-xs text-slate-400 mt-1">
                    {run.created_count} novos · {run.updated_count} atualizados
                    {run.skipped_count > 0 && ` · ${run.skipped_count} ignorados`}
                    {run.total_count > 0 && ` · ${run.total_count} lidos do VetSoft`}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-slate-500">Última: {formatWhen(run?.finished_at || run?.started_at)}</p>
                {run && (
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    {run.triggered_by === 'manual' ? 'manual' : 'automática'}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default VetsoftSyncStatus;
