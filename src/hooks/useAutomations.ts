import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface AutomationRule {
  id: string;
  name: string;
  trigger_topic: string;
  filters: { conditions: Array<{ field: string; operator: string; value: string }>; logic: 'AND' | 'OR' };
  action_type: string;
  action_config: Record<string, any>;
  active: boolean;
  cooldown_hours: number;
  delay_minutes: number;
  cancel_if_changed: boolean;
  created_at: string;
  updated_at: string;
}

export interface AutomationLog {
  id: string;
  rule_id: string | null;
  event_id: string | null;
  status: 'success' | 'failed' | 'skipped' | string;
  result: Record<string, any>;
  executed_at: string;
}

export interface WebhookEvent {
  id: string;
  topic: string;
  payload: any;
  source: string;
  processed: boolean;
  error: string | null;
  received_at: string;
}

export function useAutomations() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingEvents, setPendingEvents] = useState(0);

  const refresh = useCallback(async () => {
    const [rulesRes, eventsRes] = await Promise.all([
      supabase.from('automation_rules').select('*').order('created_at', { ascending: false }),
      supabase.from('webhook_events').select('id', { count: 'exact', head: true }).eq('processed', false),
    ]);
    setError(rulesRes.error || eventsRes.error ? 'Não foi possível carregar as automações.' : null);
    if (!rulesRes.error) setRules((rulesRes.data || []) as any);
    if (!eventsRes.error) setPendingEvents(eventsRes.count || 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    let timer: ReturnType<typeof setTimeout>;
    const scheduleRefresh = () => { clearTimeout(timer); timer = setTimeout(refresh, 300); };
    const channel = supabase
      .channel('automations-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'automation_rules' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'webhook_events' }, scheduleRefresh)
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, [refresh]);

  return { rules, loading, error, pendingEvents, refresh };
}

export const TRIGGER_TOPICS = [
  { value: 'order.created', label: 'Pedido criado' },
  { value: 'order.updated', label: 'Pedido atualizado' },
  { value: 'order.deleted', label: 'Pedido removido' },
  { value: 'customer.created', label: 'Cliente criado' },
  { value: 'customer.updated', label: 'Cliente atualizado' },
  { value: 'product.updated', label: 'Produto atualizado' },
  { value: 'pipeline.deal.won', label: 'Deal movido para Ganho (Pipeline)' },
];

/** Returns true for pipeline-originated triggers (no webhook payload, uses deal/contact context) */
export const isPipelineTrigger = (topic: string) => topic.startsWith('pipeline.');

export interface WebhookField { path: string; label: string }
export interface WebhookFieldGroup { group: string; items: WebhookField[] }

export const WEBHOOK_FIELDS: WebhookFieldGroup[] = [
  { group: 'Cliente', items: [
    { path: 'billing.first_name',     label: 'Nome do cliente' },
    { path: 'billing.last_name',      label: 'Sobrenome do cliente' },
    { path: 'billing.phone',          label: 'Telefone' },
    { path: 'billing.email',          label: 'E-mail' },
    { path: 'billing.company',        label: 'Empresa' },
    { path: 'billing.city',           label: 'Cidade' },
    { path: 'billing.state',          label: 'Estado' },
  ]},
  { group: 'Pedido', items: [
    { path: 'id',                     label: 'Número do pedido' },
    { path: 'number',                 label: 'Número de exibição' },
    { path: 'total',                  label: 'Valor total' },
    { path: 'currency',               label: 'Moeda' },
    { path: 'status',                 label: 'Status' },
    { path: 'payment_method',         label: 'Forma de pagamento (slug)' },
    { path: 'payment_method_title',   label: 'Forma de pagamento' },
    { path: 'date_created',           label: 'Data do pedido' },
  ]},
  { group: 'Itens', items: [
    { path: 'line_items[0].name',     label: 'Nome do 1º produto' },
    { path: 'line_items[0].quantity', label: 'Quantidade do 1º produto' },
    { path: 'line_items[0].total',    label: 'Total do 1º produto' },
    { path: 'line_items[0].product_id', label: 'ID do 1º produto' },
  ]},
];

export const FIELD_SUGGESTIONS = WEBHOOK_FIELDS.flatMap(g => g.items.map(i => i.path));

/** Fields available when trigger is pipeline.deal.won */
export const PIPELINE_FIELDS: WebhookFieldGroup[] = [
  { group: 'Deal', items: [
    { path: 'deal.title',   label: 'Título do deal' },
    { path: 'deal.company', label: 'Empresa' },
    { path: 'deal.value',   label: 'Valor do deal' },
  ]},
  { group: 'Contato', items: [
    { path: 'contact.name',  label: 'Nome do contato' },
    { path: 'contact.phone', label: 'Telefone' },
    { path: 'contact.email', label: 'E-mail' },
  ]},
  { group: 'Último Pedido', items: [
    { path: 'order.number',  label: 'Número do pedido' },
    { path: 'order.total',   label: 'Total do pedido' },
    { path: 'order.status',  label: 'Status do pedido' },
  ]},
];

export const PIPELINE_FIELD_SUGGESTIONS = PIPELINE_FIELDS.flatMap(g => g.items.map(i => i.path));

export function getByPath(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

export const OPERATORS = [
  { value: 'changed_to', label: 'mudou para' },
  { value: 'eq', label: 'igual a (=)' },
  { value: 'neq', label: 'diferente de (≠)' },
  { value: 'gte', label: 'maior ou igual (≥)' },
  { value: 'lte', label: 'menor ou igual (≤)' },
  { value: 'contains', label: 'contém' },
  { value: 'is_first_order', label: 'é primeiro pedido' },
];

export const ORDER_STATUSES = [
  { slug: 'pending',          label: 'Novo Pedido' },
  { slug: 'on-hold',          label: 'Em orçamento' },
  { slug: 'checkout-draft',   label: 'Rascunho' },
  { slug: 'processing',       label: 'Pago Online' },
  { slug: 'completed',        label: 'Pago Manual / Confirmado' },
  { slug: 'em-producao',      label: 'Impresso' },
  { slug: 'pedido-pronto',    label: 'Pronto' },
  { slug: 'retirado-entrega', label: 'Retirado' },
  { slug: 'negado',           label: 'Proposta negada' },
  { slug: 'cancelled',        label: 'Cancelado' },
  { slug: 'refunded',         label: 'Estornado' },
  { slug: 'failed',           label: 'CHARGEBACK' },
];

export const ACTION_TYPES = [
  { value: 'whatsapp_message', label: 'Enviar mensagem WhatsApp', enabled: true },
  { value: 'crm_update', label: 'Atualizar CRM (tags / mover deal)', enabled: true },
  { value: 'internal_notification', label: 'Notificação interna', enabled: true },
  { value: 'outbound_webhook', label: 'Webhook externo', enabled: true },
];
