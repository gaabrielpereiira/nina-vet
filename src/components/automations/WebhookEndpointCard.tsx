import React, { useEffect, useState } from 'react';
import { Webhook, Copy, Check, Eye, EyeOff, Loader2, Save, ChevronDown, FlaskConical, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { toast } from 'sonner';
import { Button } from '../Button';

interface Props {
  onSimulate?: () => void;
}

const WebhookEndpointCard: React.FC<Props> = ({ onSimulate }) => {
  const { isAdmin } = useCompanySettings();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [secret, setSecret] = useState('');
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wc-receiver`;

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from('nina_settings')
          .select('id, wc_webhook_secret')
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (data) {
          setSettingsId(data.id);
          const s = data.wc_webhook_secret || '';
          setSecret(s);
          setExpanded(!s);
        } else {
          setExpanded(true);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    if (!isAdmin) return;
    setSaving(true);
    try {
      if (settingsId) {
        const { error } = await supabase
          .from('nina_settings')
          .update({ wc_webhook_secret: secret || null, updated_at: new Date().toISOString() })
          .eq('id', settingsId).select('id').single();
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('nina_settings')
          .insert({ user_id: null, wc_webhook_secret: secret || null } as any)
          .select('id')
          .single();
        if (error) throw error;
        setSettingsId(data.id);
      }
      toast.success('Webhook configurado!');
      setExpanded(false);
    } catch (e) {
      toast.error('Erro ao salvar', { description: e instanceof Error ? e.message : 'Tente novamente' });
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    toast.success('URL copiada!');
    setTimeout(() => setCopied(false), 2000);
  };

  const generateSecret = () => {
    const arr = new Uint8Array(24);
    crypto.getRandomValues(arr);
    setSecret(btoa(String.fromCharCode(...arr)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32));
  };

  if (loading) {
    return (
      <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/50 p-6 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-cyan-500" />
      </div>
    );
  }

  const configured = !!secret;

  return (
    <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-900/80 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 shrink-0">
            <Webhook className="w-5 h-5" />
          </div>
          <div className="text-left min-w-0">
            <h3 className="font-semibold text-white text-sm">Endpoint do webhook</h3>
            <p className="text-xs text-slate-400 truncate">
              {configured ? 'Pronto para receber eventos do seu site' : 'Configure o Secret para começar a receber eventos'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className={`hidden sm:flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
            configured ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
          }`}>
            <span className={`h-2 w-2 rounded-full ${configured ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
            {configured ? 'Ativo' : 'Aguardando'}
          </div>
          <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-5 pt-1 space-y-4 border-t border-slate-800">
          <div className="text-xs text-slate-400 pt-3">
            Cole esta URL e o Secret no seu site (WooCommerce → Avançado → Webhooks) para que pedidos, clientes e produtos
            entrem aqui automaticamente e disparem as regras de automação.
          </div>

          <div>
            <label className="text-xs font-medium text-slate-300 mb-1 block">URL de entrega</label>
            <div className="flex gap-2">
              <input
                readOnly
                value={webhookUrl}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300 font-mono focus:outline-none focus:border-cyan-500"
              />
              <Button variant="ghost" size="sm" onClick={copyUrl} className="gap-2 shrink-0">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span className="hidden sm:inline">{copied ? 'Copiado' : 'Copiar'}</span>
              </Button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-300 mb-1 block">Secret (HMAC-SHA256)</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 relative">
                <input
                  disabled={!isAdmin}
                  type={showSecret ? 'text' : 'password'}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="Gere ou cole o mesmo Secret usado no site"
                  className="w-full px-3 py-2 pr-10 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-50 font-mono focus:outline-none focus:border-cyan-500"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200"
                >
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" disabled={!isAdmin} onClick={generateSecret}>Gerar</Button>
                <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || !isAdmin} className="gap-2">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Salvar
                </Button>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              O mesmo valor precisa estar nos dois lados — é o que valida a assinatura de cada evento.
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            <p className="text-xs font-medium text-slate-300 mb-2">Como conectar no WooCommerce</p>
            <ol className="list-decimal pl-4 space-y-1 text-xs text-slate-400">
              <li>Acesse <strong>WooCommerce → Configurações → Avançado → Webhooks</strong>.</li>
              <li>Clique em <strong>Adicionar webhook</strong>, escolha o tópico (ex.: <em>Pedido criado</em>).</li>
              <li>Cole a <strong>URL de entrega</strong> e o <strong>Secret</strong> acima.</li>
              <li>Salve. Os eventos aparecem aqui em <strong>Eventos recebidos</strong>.</li>
            </ol>
          </div>

          {onSimulate && (
            <div className="flex items-center justify-between pt-1">
              <a
                href="https://woocommerce.com/document/webhooks/"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-slate-500 hover:text-slate-300 inline-flex items-center gap-1"
              >
                Documentação do WooCommerce <ExternalLink className="w-3 h-3" />
              </a>
              <Button variant="ghost" size="sm" onClick={onSimulate} className="gap-2">
                <FlaskConical className="w-3.5 h-3.5" /> Testar agora
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WebhookEndpointCard;
