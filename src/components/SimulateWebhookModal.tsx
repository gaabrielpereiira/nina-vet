import React, { useState } from 'react';
import { X, Play, Loader2, FlaskConical } from 'lucide-react';
import { Button } from './Button';
import { TRIGGER_TOPICS } from '@/hooks/useAutomations';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props { isOpen: boolean; onClose: () => void; }

const SimulateWebhookModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [topic, setTopic] = useState('order.created');
  const [phone, setPhone] = useState('5511999990001');
  const [total, setTotal] = useState('297.00');
  const [firstName, setFirstName] = useState('Cliente');
  const [sending, setSending] = useState(false);
  const [executeActions, setExecuteActions] = useState(false);

  if (!isOpen) return null;

  const submit = async () => {
    setSending(true);
    try {
      const overrides: Record<string, unknown> = topic.startsWith('pipeline.')
        ? { contact: { phone, name: firstName } }
        : { billing: { phone, first_name: firstName } };
      if (topic.startsWith('order.')) overrides.total = total;
      const { data, error } = await supabase.functions.invoke('simulate-wc-webhook', {
        body: { topic, overrides, dry_run: !executeActions },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(executeActions ? 'Evento disparado' : 'Simulação criada, sem executar ações');
      onClose();
    } catch (e: any) {
      toast.error('Erro ao simular', { description: e?.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-slate-50 flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-cyan-400" /> Simular evento
          </h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-400">
            Teste quais regras correspondem ao evento. Por padrão, nenhuma mensagem é enviada e o CRM não é alterado.
          </p>

          <label className="flex items-start gap-2 text-xs text-amber-200">
            <input type="checkbox" checked={executeActions} onChange={e => setExecuteActions(e.target.checked)} />
            Executar ações reais para este teste, incluindo mensagens de WhatsApp e alterações no CRM.
          </label>
          <Field label="Tipo de evento">
            <select value={topic} onChange={e => setTopic(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-50 focus:outline-none focus:border-cyan-500">
              {TRIGGER_TOPICS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>

          <Field label="Telefone (billing.phone)">
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="5511999990001"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-50 focus:outline-none focus:border-cyan-500" />
          </Field>

          <Field label="Nome (billing.first_name)">
            <input value={firstName} onChange={e => setFirstName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-50 focus:outline-none focus:border-cyan-500" />
          </Field>

          {topic.startsWith('order.') && (
            <Field label="Valor total">
              <input value={total} onChange={e => setTotal(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-50 focus:outline-none focus:border-cyan-500" />
            </Field>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-slate-800">
          <Button variant="ghost" onClick={onClose} disabled={sending}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={sending} className="gap-2">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {executeActions ? 'Executar evento' : 'Testar regras'}
          </Button>
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="text-xs font-medium text-slate-400 mb-1 block">{label}</label>
    {children}
  </div>
);

export default SimulateWebhookModal;
