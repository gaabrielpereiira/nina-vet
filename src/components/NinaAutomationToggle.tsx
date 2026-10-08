import { useId } from 'react';
import { Bot, Loader2, User } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from './ui/switch';
import { useNinaAutomation } from '@/hooks/useNinaAutomation';
import { useCompanySettings } from '@/hooks/useCompanySettings';

export function NinaAutomationToggle() {
  const id = useId();
  const { enabled, available, loading, error, saving, setEnabled } = useNinaAutomation();
  const { isAdmin } = useCompanySettings();
  const busy = loading || saving;

  const handleChange = async (next: boolean) => {
    try {
      await setEnabled(next);
      toast.success(next ? 'Nina automática ativada' : 'Nina pausada em todas as conversas. Somente humanos podem responder.');
    } catch {
      toast.error('Não foi possível alterar o atendimento. Tente novamente.');
    }
  };

  return (
    <div className={`rounded-xl border p-3 ${available && !enabled ? 'border-amber-500/30 bg-amber-500/10' : 'border-slate-800 bg-slate-950/50'}`}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium text-white">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : enabled ? <Bot className="h-4 w-4 text-cyan-400" /> : <User className="h-4 w-4 text-amber-400" />}
          {loading ? 'Carregando atendimento...' : !available ? 'Atendimento indisponível' : enabled ? 'Nina automática' : 'Somente humanos'}
        </label>
        <Switch
          id={id}
          aria-label="Respostas automáticas da Nina em todas as conversas"
          aria-describedby={`${id}-description`}
          checked={enabled}
          disabled={busy || !available || !isAdmin}
          onCheckedChange={handleChange}
        />
      </div>
      <p id={`${id}-description`} className="mt-2 text-xs leading-relaxed text-slate-400" aria-live="polite">
        {error ? 'Não foi possível consultar o estado da Nina.'
          : loading ? 'Consultando a configuração da clínica.'
          : !available ? 'Configure a Nina para habilitar esta opção.'
          : enabled ? 'A Nina responde nas conversas habilitadas para IA.'
          : 'Nina pausada em todas as conversas, inclusive novas. O atendimento humano continua disponível.'}
        {!isAdmin && available && ' Apenas administradores podem alterar esta opção.'}
        {isAdmin && available && ' A alteração é salva imediatamente.'}
      </p>
    </div>
  );
}
