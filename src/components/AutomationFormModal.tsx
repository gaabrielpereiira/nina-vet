import React, { useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2, Loader2, Code, Wand2 } from 'lucide-react';
import { Button } from './Button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { TRIGGER_TOPICS, FIELD_SUGGESTIONS, OPERATORS, ACTION_TYPES, ORDER_STATUSES, WEBHOOK_FIELDS, PIPELINE_FIELDS, PIPELINE_FIELD_SUGGESTIONS, isPipelineTrigger, getByPath, AutomationRule } from '@/hooks/useAutomations';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  rule: AutomationRule | null;
  onSaved: () => void;
}

interface Condition { field: string; operator: string; value: string; }
interface WhatsAppTemplate { id: string; name: string; status: string; components: any; }
interface PipelineStage { id: string; title: string; }

const AutomationFormModal: React.FC<Props> = ({ isOpen, onClose, rule, onSaved }) => {
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState('order.created');
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [logic, setLogic] = useState<'AND' | 'OR'>('AND');
  const [actionType, setActionType] = useState('whatsapp_message');
  const [cfg, setCfg] = useState<Record<string, any>>({});
  const [cooldownHours, setCooldownHours] = useState(0);
  const [delayValue, setDelayValue] = useState(0); // amount in selected unit
  const [delayUnit, setDelayUnit] = useState<'minutes' | 'hours' | 'days'>('hours');
  const [cancelIfChanged, setCancelIfChanged] = useState(true);
  const [active, setActive] = useState(true);
  const [showJson, setShowJson] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncingTemplates, setSyncingTemplates] = useState(false);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [samplePayload, setSamplePayload] = useState<any>(null);

  useEffect(() => {
    if (!isOpen) return;
    supabase.from('whatsapp_templates').select('id, name, status, components').eq('status', 'APPROVED')
      .then(({ data }) => setTemplates((data || []) as any));
    supabase.from('pipeline_stages').select('id, title').eq('is_active', true).order('position')
      .then(({ data }) => setStages((data || []) as any));

    if (rule) {
      setName(rule.name);
      setTrigger(rule.trigger_topic);
      setConditions(rule.filters?.conditions || []);
      setLogic((rule.filters?.logic as any) || 'AND');
      setActionType(rule.action_type);
      setCfg(rule.action_config || {});
      setCooldownHours(rule.cooldown_hours || 0);
      setActive(rule.active);
      // Hydrate delay in friendliest unit
      const dm = rule.delay_minutes || 0;
      if (dm === 0) { setDelayValue(0); setDelayUnit('hours'); }
      else if (dm % 1440 === 0) { setDelayValue(dm / 1440); setDelayUnit('days'); }
      else if (dm % 60 === 0) { setDelayValue(dm / 60); setDelayUnit('hours'); }
      else { setDelayValue(dm); setDelayUnit('minutes'); }
      setCancelIfChanged(rule.cancel_if_changed ?? true);
    } else {
      setName(''); setTrigger('order.created'); setConditions([]); setLogic('AND');
      setActionType('whatsapp_message');
      setCfg({ phone_field: 'billing.phone', variables: [] });
      setCooldownHours(0); setActive(true);
      setDelayValue(0); setDelayUnit('hours'); setCancelIfChanged(true);
    }
    // When editing a pipeline rule, reset cfg defaults to no phone_field
    // (handled below in the render — phone_field is hidden for pipeline triggers)
  }, [isOpen, rule]);

  const syncTemplates = async () => {
    setSyncingTemplates(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-whatsapp-templates', { body: {} });
      if (error || data?.error) throw error || new Error(data.error);
      const { data: templates, error: queryError } = await supabase.from('whatsapp_templates')
        .select('id, name, status, components').eq('status', 'APPROVED');
      if (queryError) throw queryError;
      setTemplates((templates || []) as unknown as WhatsAppTemplate[]);
      toast.success(`${data.synced} templates sincronizados`);
    } catch { toast.error('Não foi possível sincronizar os templates. Confira a conexão Zernio.'); }
    finally { setSyncingTemplates(false); }
  };

  // Carrega último payload do tópico para preview ao vivo
  useEffect(() => {
    if (!isOpen || !trigger) return;
    supabase.from('webhook_events')
      .select('payload')
      .eq('topic', trigger)
      .order('received_at', { ascending: false })
      .limit(1).maybeSingle()
      .then(({ data }) => setSamplePayload(data?.payload ?? null));
  }, [isOpen, trigger]);

  // Whether the selected trigger is a pipeline event (no webhook payload; uses deal/contact context)
  const isPipeline = isPipelineTrigger(trigger);

  // Active field groups for variable pickers (depends on trigger type)
  const activeFields = isPipeline ? PIPELINE_FIELDS : WEBHOOK_FIELDS;
  const activeFieldSuggestions = isPipeline ? PIPELINE_FIELD_SUGGESTIONS : FIELD_SUGGESTIONS;

  // Variables (whatsapp) — declarado cedo pois é usado por preview e auto-fill
  const variables: string[] = Array.isArray(cfg.variables) ? cfg.variables : [];
  const setVariables = (v: string[]) => setCfg(prev => ({ ...prev, variables: v }));

  // Texto do corpo do template selecionado
  const selectedTemplateBody = useMemo(() => {
    const tpl = templates.find(t => t.id === cfg.template_id);
    if (!tpl) return '';
    const body = (tpl.components || []).find((c: any) => (c.type || '').toUpperCase() === 'BODY');
    return body?.text || '';
  }, [templates, cfg.template_id]);

  // Quantidade de placeholders {{n}} no template
  const templatePlaceholderCount = useMemo(() => {
    const matches = selectedTemplateBody.match(/\{\{\s*\d+\s*\}\}/g) || [];
    const nums = matches.map((m: string) => parseInt(m.replace(/\D/g, ''), 10)).filter((n: number) => !isNaN(n));
    return nums.length ? Math.max(...nums) : 0;
  }, [selectedTemplateBody]);

  // Sugestão heurística por placeholder, baseada no texto ao redor
  const suggestPathForPlaceholder = (n: number): string => {
    const re = new RegExp(`([\\s\\S]{0,40})\\{\\{\\s*${n}\\s*\\}\\}([\\s\\S]{0,40})`, 'i');
    const m = selectedTemplateBody.match(re);
    const ctx = ((m?.[1] || '') + ' ' + (m?.[2] || '')).toLowerCase();

    // Pipeline trigger suggestions
    if (isPipeline) {
      if (/(ol[áa]|nome|cliente|sr[a]?\.?)/.test(ctx)) return 'contact.name';
      if (/(empresa|compan)/.test(ctx)) return 'deal.company';
      if (/(pedido|order|n[úu]mero|n[º°]|#)/.test(ctx)) return 'order.number';
      if (/(total|valor|pre[çc]o|r\$)/.test(ctx)) return 'order.total';
      if (/(status|situa[çc][ãa]o)/.test(ctx)) return 'order.status';
      if (/(deal|oportunidade)/.test(ctx)) return 'deal.value';
      if (/(telefone|whats|celular)/.test(ctx)) return 'contact.phone';
      if (/(email|e-mail)/.test(ctx)) return 'contact.email';
      return '';
    }

    // Webhook (WooCommerce) suggestions
    if (/(ol[áa]|nome|cliente|sr[a]?\.?)/.test(ctx)) return 'billing.first_name';
    if (/(pedido|order|n[úu]mero|n[º°]|#)/.test(ctx)) return 'id';
    if (/(total|valor|pre[çc]o|r\$)/.test(ctx)) return 'total';
    if (/(status|situa[çc][ãa]o)/.test(ctx)) return 'status';
    if (/(pagamento|m[ée]todo)/.test(ctx)) return 'payment_method_title';
    if (/(produto|item)/.test(ctx)) return 'line_items[0].name';
    if (/(email|e-mail)/.test(ctx)) return 'billing.email';
    if (/(telefone|whats|celular)/.test(ctx)) return 'billing.phone';
    return '';
  };

  const autoFillVariables = () => {
    if (!templatePlaceholderCount) {
      toast.info('Selecione um template com variáveis primeiro');
      return;
    }
    const filled = Array.from({ length: templatePlaceholderCount }, (_, i) =>
      variables[i] || suggestPathForPlaceholder(i + 1)
    );
    setVariables(filled);
    toast.success(`${templatePlaceholderCount} variável(is) preenchida(s)`);
  };

  const labelForPath = (path: string): string => {
    for (const g of [...WEBHOOK_FIELDS, ...PIPELINE_FIELDS]) {
      const item = g.items.find(i => i.path === path);
      if (item) return item.label;
    }
    return path || '—';
  };

  const previewValueFor = (path: string): string => {
    if (!path) return '';
    if (!samplePayload) return '';
    const v = getByPath(samplePayload, path);
    if (v == null) return '';
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 40);
    return String(v);
  };

  const isCustomPath = (path: string): boolean => {
    if (!path) return false;
    return !activeFieldSuggestions.includes(path);
  };

  const renderedTemplatePreview = useMemo(() => {
    if (!selectedTemplateBody) return '';
    return selectedTemplateBody.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m: string, n: string) => {
      const path = variables[parseInt(n, 10) - 1];
      if (!path) return `{{${n}}}`;
      const val = previewValueFor(path);
      return val ? val : `[${labelForPath(path)}]`;
    });
  }, [selectedTemplateBody, variables, samplePayload]);

  const addCondition = () => {
    const defaultOp = trigger.startsWith('order.') ? 'changed_to' : 'eq';
    setConditions(c => [...c, { field: isPipeline ? 'deal.value' : 'status', operator: defaultOp, value: '' }]);
  };
  const removeCondition = (i: number) => setConditions(c => c.filter((_, idx) => idx !== i));
  const updateCondition = (i: number, patch: Partial<Condition>) =>
    setConditions(c => c.map((co, idx) => idx === i ? { ...co, ...patch } : co));

  const setCfgField = (k: string, v: any) => setCfg(prev => ({ ...prev, [k]: v }));

  // Tags (crm_update) — comma-separated text input
  const tagsText = Array.isArray(cfg.add_tags) ? (cfg.add_tags as string[]).join(', ') : '';

  const validate = (): string | null => {
    if (!name.trim()) return 'Dê um nome à automação';
    if (actionType === 'whatsapp_message' && !cfg.template_id) return 'Selecione um template';
    if (actionType === 'whatsapp_message' && (variables.length !== templatePlaceholderCount || variables.some(v => !v.trim())))
      return 'Configure todas as variáveis do template, na ordem indicada';
    if (actionType === 'crm_update' && !cfg.move_deal_stage_id && !(Array.isArray(cfg.add_tags) && cfg.add_tags.length))
      return 'Configure ao menos uma alteração (mover deal ou adicionar tag)';
    if (actionType === 'internal_notification' && !cfg.title?.trim()) return 'Informe o título da notificação';
    if (actionType === 'outbound_webhook' && !cfg.url?.trim()) return 'Informe a URL do webhook';
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }

    setSaving(true);
    try {
      // Trim variables on whatsapp
      const action_config = actionType === 'whatsapp_message'
        ? { ...cfg, variables: (variables || []).map(v => v.trim()) }
        : cfg;

      const delay_minutes = delayValue > 0
        ? (delayUnit === 'days' ? delayValue * 1440 : delayUnit === 'hours' ? delayValue * 60 : delayValue)
        : 0;

      const payload = {
        name: name.trim(), trigger_topic: trigger,
        filters: { conditions: conditions.filter(c => c.field), logic },
        action_type: actionType, action_config,
        cooldown_hours: cooldownHours, active,
        delay_minutes, cancel_if_changed: cancelIfChanged,
      };
      const { error } = rule
        ? await supabase.from('automation_rules').update(payload as any).eq('id', rule.id)
        : await supabase.from('automation_rules').insert(payload as any);
      if (error) throw error;
      toast.success(rule ? 'Automação atualizada' : 'Automação criada');
      onSaved(); onClose();
    } catch (e) {
      toast.error('Erro ao salvar', { description: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
          <h2 className="text-xl font-bold text-white">{rule ? 'Editar' : 'Nova'} Automação</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* Nome */}
          <div>
            <label className="text-xs font-medium text-slate-300 mb-1 block">Nome</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Confirmar pedido criado"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50 focus:outline-none focus:border-cyan-500" />
          </div>

          {/* Quando */}
          <div className="border border-slate-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-cyan-500/10 text-cyan-400 text-xs rounded font-medium">QUANDO</span>
              <span className="text-sm text-slate-300">o evento ocorrer</span>
            </div>
            <select value={trigger} onChange={e => setTrigger(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50">
              {TRIGGER_TOPICS.map(t => <option key={t.value} value={t.value}>{t.label} ({t.value})</option>)}
            </select>
          </div>

          {/* Se */}
          <div className="border border-slate-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 text-xs rounded font-medium">SE</span>
                <span className="text-sm text-slate-300">os filtros baterem (opcional)</span>
              </div>
              {conditions.length > 1 && (
                <select value={logic} onChange={e => setLogic(e.target.value as any)}
                  className="px-2 py-1 bg-slate-950 border border-slate-800 rounded text-xs text-slate-50">
                  <option value="AND">Todos (AND)</option>
                  <option value="OR">Qualquer (OR)</option>
                </select>
              )}
            </div>
            {isPipeline && (
              <p className="text-xs text-slate-500">
                Use campos como <code>deal.value</code>, <code>contact.name</code> e <code>order.status</code> para filtrar os negócios marcados como Ganho.
              </p>
            )}
            {conditions.map((c, i) => (
              <div key={i} className="flex flex-col md:flex-row gap-2">
                <input list="field-suggestions" value={c.field} onChange={e => updateCondition(i, { field: e.target.value })}
                  placeholder="campo (ex: total)"
                  className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50" />
                <select value={c.operator} onChange={e => updateCondition(i, { operator: e.target.value })}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50 md:w-48">
                  {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {c.field === 'status' && (c.operator === 'eq' || c.operator === 'neq' || c.operator === 'changed_to') ? (
                  <select value={c.value} onChange={e => updateCondition(i, { value: e.target.value })}
                    className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50">
                    <option value="">Selecione o status...</option>
                    {ORDER_STATUSES.map(s => (
                      <option key={s.slug} value={s.slug}>{s.label} ({s.slug})</option>
                    ))}
                  </select>
                ) : (
                  <input value={c.value} onChange={e => updateCondition(i, { value: e.target.value })}
                    placeholder="valor"
                    className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50" />
                )}
                <button onClick={() => removeCondition(i)} className="p-2 text-slate-400 hover:text-red-400">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <datalist id="field-suggestions">
              {activeFieldSuggestions.map(f => <option key={f} value={f} />)}
            </datalist>
            <Button variant="ghost" size="sm" onClick={addCondition} className="gap-2">
              <Plus className="w-4 h-4" /> Adicionar filtro
            </Button>
            {conditions.some(c => c.operator === 'changed_to') && (
              <p className="text-xs text-slate-500">
                <span className="text-cyan-400">mudou para</span> só dispara no momento exato em que o pedido entra
                naquele status. Reentregas do mesmo webhook não disparam de novo.
              </p>
            )}
            {conditions.length > 0 && (
              <div>
                <button onClick={() => setShowJson(!showJson)}
                  className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1">
                  <Code className="w-3 h-3" /> {showJson ? 'Esconder' : 'Mostrar'} JSON
                </button>
                {showJson && (
                  <pre className="mt-2 p-3 bg-slate-950 border border-slate-800 rounded text-xs text-slate-400 overflow-x-auto">
{JSON.stringify({ conditions, logic }, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>

          {/* Aguardar antes de executar */}
          <div className="border border-slate-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-sky-500/10 text-sky-400 text-xs rounded font-medium">AGUARDAR</span>
              <span className="text-sm text-slate-300">antes de executar (opcional)</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="number" min={0} value={delayValue}
                onChange={e => setDelayValue(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full sm:w-32 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50"
              />
              <select
                value={delayUnit}
                onChange={e => setDelayUnit(e.target.value as any)}
                className="w-full sm:w-48 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50"
              >
                <option value="minutes">minuto(s)</option>
                <option value="hours">hora(s)</option>
                <option value="days">dia(s)</option>
              </select>
            </div>
            <p className="text-xs text-slate-500">
              {delayValue > 0
                ? `A ação será executada ${delayValue} ${delayUnit === 'minutes' ? 'minuto(s)' : delayUnit === 'hours' ? 'hora(s)' : 'dia(s)'} depois do gatilho bater.`
                : 'Sem espera — executa imediatamente quando o gatilho bater.'}
            </p>
            {delayValue > 0 && trigger.startsWith('order.') && (
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox" checked={cancelIfChanged}
                  onChange={e => setCancelIfChanged(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-950"
                />
                <span className="text-xs text-slate-300">
                  Cancelar se o status do pedido mudar antes do prazo
                  <span className="block text-slate-500">
                    Recomendado. Evita disparar (ex.) lembrete de "Pago" se o pedido for cancelado nesse meio tempo.
                  </span>
                </span>
              </label>
            )}
          </div>



          {/* Então */}
          <div className="border border-slate-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-xs rounded font-medium">ENTÃO</span>
              <span className="text-sm text-slate-300">execute esta ação</span>
            </div>
            <select value={actionType} onChange={e => { setActionType(e.target.value); setCfg({}); }}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50">
              {ACTION_TYPES.map(a => <option key={a.value} value={a.value} disabled={!a.enabled}>{a.label}</option>)}
            </select>

            {/* WhatsApp config */}
            {actionType === 'whatsapp_message' && (
              <div className="space-y-3 pt-2">
                {/* Pipeline trigger context hint */}
                {isPipeline && (
                  <div className="flex items-start gap-2 px-3 py-2 bg-cyan-500/10 border border-cyan-500/20 rounded-lg">
                    <span className="text-cyan-400 text-lg leading-none mt-0.5">🏆</span>
                    <p className="text-xs text-cyan-300">
                      Esta automação dispara quando um deal é movido para <strong>Ganho</strong>.
                      O WhatsApp será enviado para o contato vinculado ao deal.
                      Use os campos <span className="font-mono">contact.*</span> e <span className="font-mono">deal.*</span> nas variáveis abaixo.
                    </p>
                  </div>
                )}
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <label className="text-xs font-medium text-slate-300">Template aprovado</label>
                    <button type="button" disabled={syncingTemplates} onClick={syncTemplates} className="text-xs text-cyan-400 disabled:opacity-50">
                      {syncingTemplates ? 'Sincronizando...' : 'Sincronizar Zernio'}
                    </button>
                  </div>
                  <select value={cfg.template_id || ''} onChange={e => setCfgField('template_id', e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50">
                    <option value="">Selecione...</option>
                    {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  {templates.length === 0 && (
                    <p className="text-xs text-amber-400 mt-1">Nenhum template aprovado. Crie e aprove os templates na Zernio e sincronize abaixo.</p>
                  )}
                </div>
                {/* Phone field — hidden for pipeline triggers (contact is resolved via deal.contact_id) */}
                {!isPipeline && (
                <div>
                  <label className="text-xs font-medium text-slate-300 mb-1 block">Campo do telefone (no payload)</label>
                  <input value={cfg.phone_field || 'billing.phone'} onChange={e => setCfgField('phone_field', e.target.value)}
                    placeholder="billing.phone"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50 font-mono" />
                </div>
                )}
                {/* Preview do template */}
                {selectedTemplateBody && (
                  <div>
                    <label className="text-xs font-medium text-slate-300 mb-1 block">Preview da mensagem</label>
                    <div className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 whitespace-pre-wrap">
                      {renderedTemplatePreview}
                    </div>
                    {!samplePayload && (
                      <p className="text-xs text-slate-500 mt-1">Sem webhook de exemplo ainda — os valores aparecem como rótulos <span className="text-slate-400">[Nome do cliente]</span>.</p>
                    )}
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-slate-300">
                      Variáveis do template {templatePlaceholderCount > 0 && <span className="text-slate-500">({templatePlaceholderCount} no template)</span>}
                    </label>
                    {templatePlaceholderCount > 0 && (
                      <button onClick={autoFillVariables}
                        className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                        <Wand2 className="w-3 h-3" /> Auto-preencher
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {variables.map((v, i) => {
                      const custom = isCustomPath(v);
                      const previewVal = previewValueFor(v);
                      return (
                        <div key={i} className="flex flex-col gap-1">
                          <div className="flex gap-2 items-center">
                            <span className="text-xs text-slate-400 w-10 font-mono">{`{{${i + 1}}}`}</span>
                            <select
                              value={custom ? '__custom__' : (v || '')}
                              onChange={e => {
                                const val = e.target.value;
                                setVariables(variables.map((va, idx) =>
                                  idx === i ? (val === '__custom__' ? (custom ? v : '') : val) : va
                                ));
                              }}
                              className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50"
                            >
                              <option value="">Selecione um campo…</option>
                              {activeFields.map(g => (
                                <optgroup key={g.group} label={g.group}>
                                  {g.items.map(it => (
                                    <option key={it.path} value={it.path}>{it.label}</option>
                                  ))}
                                </optgroup>
                              ))}
                              <option value="__custom__">Personalizado…</option>
                            </select>
                            <button onClick={() => setVariables(variables.filter((_, idx) => idx !== i))}
                              className="p-2 text-slate-400 hover:text-red-400">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          {custom && (
                            <input
                              value={v}
                              onChange={e => setVariables(variables.map((va, idx) => idx === i ? e.target.value : va))}
                              placeholder="caminho no payload (ex: meta_data[0].value)"
                              className="ml-12 flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-50 font-mono"
                            />
                          )}
                          {v && (
                            <div className="ml-12 text-xs text-slate-500">
                              Valor de exemplo:{' '}
                              {previewVal
                                ? <span className="text-emerald-400 font-mono">{previewVal}</span>
                                : <span className="text-amber-400">{samplePayload ? '(vazio neste webhook)' : '(sem exemplo)'}</span>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setVariables([...variables, ''])} className="gap-2 mt-2">
                    <Plus className="w-4 h-4" /> Adicionar variável
                  </Button>
                </div>
              </div>
            )}

            {/* CRM update config */}
            {actionType === 'crm_update' && (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="text-xs font-medium text-slate-300 mb-1 block">Campo do telefone (para localizar contato)</label>
                  <input value={cfg.phone_field || 'billing.phone'} onChange={e => setCfgField('phone_field', e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50 font-mono" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-300 mb-1 block">Mover deal mais recente para o estágio</label>
                  <select value={cfg.move_deal_stage_id || ''} onChange={e => setCfgField('move_deal_stage_id', e.target.value || null)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50">
                    <option value="">— Não mover —</option>
                    {stages.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-300 mb-1 block">Adicionar tags ao contato (separe por vírgula)</label>
                  <input value={tagsText}
                    onChange={e => setCfgField('add_tags', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                    placeholder="cliente, comprou_curso"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50" />
                </div>
              </div>
            )}

            {/* Internal notification config */}
            {actionType === 'internal_notification' && (
              <div className="space-y-3 pt-2">
                <p className="text-xs text-slate-500">Use {'{{ campo.do.payload }}'} para interpolar dados.</p>
                <div>
                  <label className="text-xs font-medium text-slate-300 mb-1 block">Título</label>
                  <input value={cfg.title || ''} onChange={e => setCfgField('title', e.target.value)}
                    placeholder="Novo pedido de {{ billing.first_name }}"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-300 mb-1 block">Mensagem (opcional)</label>
                  <textarea value={cfg.body || ''} onChange={e => setCfgField('body', e.target.value)} rows={2}
                    placeholder="Total: R$ {{ total }}"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-300 mb-1 block">Vincular contato pelo telefone (opcional)</label>
                  <input value={cfg.phone_field || ''} onChange={e => setCfgField('phone_field', e.target.value)}
                    placeholder="billing.phone"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50 font-mono" />
                </div>
              </div>
            )}

            {/* Outbound webhook config */}
            {actionType === 'outbound_webhook' && (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="text-xs font-medium text-slate-300 mb-1 block">URL</label>
                  <input value={cfg.url || ''} onChange={e => setCfgField('url', e.target.value)}
                    placeholder="https://exemplo.com/webhook"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50 font-mono" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-300 mb-1 block">Método</label>
                  <select value={cfg.method || 'POST'} onChange={e => setCfgField('method', e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50">
                    <option>POST</option><option>PUT</option><option>PATCH</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-300 mb-1 block">Body (JSON, opcional — use {'{{ campo }}'})</label>
                  <textarea value={cfg.body_template || ''} onChange={e => setCfgField('body_template', e.target.value)}
                    rows={4} placeholder='{"order_id": "{{ id }}", "total": "{{ total }}"}'
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-50 font-mono" />
                  <p className="text-xs text-slate-500 mt-1">Em branco envia o evento completo.</p>
                </div>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-slate-300 mb-1 block">
                Cooldown (não reenviar para o mesmo contato por X horas)
              </label>
              <input type="number" min={0} value={cooldownHours}
                onChange={e => setCooldownHours(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-32 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50" />
              {actionType !== 'whatsapp_message' && (
                <p className="text-xs text-slate-500 mt-1">Cooldown só se aplica a mensagens WhatsApp.</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="active" checked={active} onChange={e => setActive(e.target.checked)}
              className="w-4 h-4 rounded border-slate-700 bg-slate-950" />
            <label htmlFor="active" className="text-sm text-slate-300">Ativa</label>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-6 border-t border-slate-800 sticky bottom-0 bg-slate-900">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {rule ? 'Salvar' : 'Criar automação'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AutomationFormModal;
