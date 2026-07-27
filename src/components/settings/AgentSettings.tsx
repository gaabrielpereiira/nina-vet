import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Bot, Loader2, Calendar, Wand2, Building2, RotateCcw, Info } from 'lucide-react';
import { Button } from '../Button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import PromptGeneratorSheet from './PromptGeneratorSheet';
import { DEFAULT_NINA_PROMPT } from '@/prompts/default-nina-prompt';
import { useAuth } from '@/hooks/useAuth';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface AgentSettings {
  id?: string;
  system_prompt_override: string | null;
  is_active: boolean;
  auto_response_enabled: boolean;
  ai_model_mode: 'flash' | 'pro' | 'pro3' | 'adaptive';
  message_breaking_enabled: boolean;
  business_hours_start: string;
  business_hours_end: string;
  business_days: number[];
  company_name: string | null;
  sdr_name: string | null;
  ai_scheduling_enabled: boolean;
}

const DAYS_OF_WEEK = [
  { value: 0, label: 'Dom' },
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
];

// Using shared prompt from @/prompts/default-nina-prompt

export interface AgentSettingsRef {
  save: () => Promise<void>;
  cancel: () => void;
  isSaving: boolean;
}

const AgentSettings = forwardRef<AgentSettingsRef, {}>((props, ref) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const [settings, setSettings] = useState<AgentSettings>({
    system_prompt_override: null,
    is_active: true,
    auto_response_enabled: true,
    ai_model_mode: 'flash',
    message_breaking_enabled: true,
    business_hours_start: '09:00',
    business_hours_end: '18:00',
    business_days: [1, 2, 3, 4, 5],
    company_name: null,
    sdr_name: null,
    ai_scheduling_enabled: true,
  });

  useImperativeHandle(ref, () => ({
    save: handleSave,
    cancel: loadSettings,
    isSaving: saving
  }));

  useEffect(() => {
    if (user?.id) {
      loadSettings();
    }
  }, [user?.id]);

  const loadSettings = async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    
    try {
      // Fetch global nina_settings (no user_id filter - single tenant)
      const { data, error } = await supabase
        .from('nina_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      // Se não existe registro, admin precisa configurar via onboarding
      if (!data) {
        console.log('[AgentSettings] No global settings found');
        setLoading(false);
        return;
      }

      // Load settings from global data
      setSettings({
        id: data.id,
        system_prompt_override: data.system_prompt_override,
        is_active: data.is_active,
        auto_response_enabled: data.auto_response_enabled,
        ai_model_mode: (data.ai_model_mode === 'flash' || data.ai_model_mode === 'pro' || data.ai_model_mode === 'pro3' || data.ai_model_mode === 'adaptive') 
          ? data.ai_model_mode 
          : 'flash',
        message_breaking_enabled: data.message_breaking_enabled,
        business_hours_start: data.business_hours_start,
        business_hours_end: data.business_hours_end,
        business_days: data.business_days,
        company_name: data.company_name,
        sdr_name: data.sdr_name,
        ai_scheduling_enabled: data.ai_scheduling_enabled ?? true,
      });
    } catch (error) {
      console.error('[AgentSettings] Error loading settings:', error);
      toast.error('Erro ao carregar configurações do agente');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Update global settings (no user_id filter needed - RLS handles admin check)
      const { error } = await supabase
        .from('nina_settings')
        .update({
          system_prompt_override: settings.system_prompt_override,
          is_active: settings.is_active,
          auto_response_enabled: settings.auto_response_enabled,
          ai_model_mode: settings.ai_model_mode,
          message_breaking_enabled: settings.message_breaking_enabled,
          business_hours_start: settings.business_hours_start,
          business_hours_end: settings.business_hours_end,
          business_days: settings.business_days,
          company_name: settings.company_name,
          sdr_name: settings.sdr_name,
          ai_scheduling_enabled: settings.ai_scheduling_enabled,
          updated_at: new Date().toISOString(),
        })
        .eq('id', settings.id!);

      if (error) throw error;

      toast.success('Configurações do agente salvas com sucesso!');
    } catch (error) {
      console.error('Error saving agent settings:', error);
      toast.error('Erro ao salvar configurações do agente');
    } finally {
      setSaving(false);
    }
  };

  const toggleBusinessDay = (day: number) => {
    setSettings(prev => ({
      ...prev,
      business_days: prev.business_days.includes(day)
        ? prev.business_days.filter(d => d !== day)
        : [...prev.business_days, day].sort()
    }));
  };

  const handlePromptGenerated = (prompt: string) => {
    setSettings(prev => ({ ...prev, system_prompt_override: prompt }));
  };

  const handleRestoreDefault = () => {
    setSettings(prev => ({ ...prev, system_prompt_override: DEFAULT_NINA_PROMPT }));
    toast.success('Prompt restaurado para o padrão');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
      </div>
    );
  }

  return (
    <>
      <PromptGeneratorSheet
        open={isGeneratorOpen}
        onOpenChange={setIsGeneratorOpen}
        onPromptGenerated={handlePromptGenerated}
      />
      
      <TooltipProvider>
      <div className="space-y-6">
        {/* System Prompt - PRIMEIRA SEÇÃO */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Bot className="w-5 h-5 text-cyan-400" />
              <h3 className="font-semibold text-white">Prompt do Sistema</h3>
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRestoreDefault}
                className="text-slate-400 hover:text-white hover:bg-slate-700"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Restaurar Padrão
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsGeneratorOpen(true)}
                className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10"
              >
                <Wand2 className="w-4 h-4 mr-2" />
                Gerar com IA
              </Button>
            </div>
          </div>
          
          {/* Nota explicativa sobre o prompt */}
          <div className="mb-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
            <p className="flex items-start gap-2">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                <strong>Template de exemplo:</strong> Este é um modelo inicial para você começar. 
                Personalize completamente com as informações da sua empresa, produtos, serviços e tom de comunicação.
              </span>
            </p>
          </div>
          
          <textarea
            value={settings.system_prompt_override || ''}
            onChange={(e) => setSettings({ ...settings, system_prompt_override: e.target.value || null })}
            placeholder="Cole ou escreva o prompt do agente aqui..."
            rows={12}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 resize-y font-mono custom-scrollbar"
          />
          <details className="mt-3">
            <summary className="text-xs text-cyan-400 cursor-pointer hover:text-cyan-300 flex items-center gap-2">
              <span>📋</span> Variáveis dinâmicas disponíveis
            </summary>
            <div className="mt-2 p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono space-y-1">
              <div><span className="text-cyan-400">{"{{ data_hora }}"}</span> → Data e hora atual (ex: 29/11/2024 14:35:22)</div>
              <div><span className="text-cyan-400">{"{{ data }}"}</span> → Apenas data (ex: 29/11/2024)</div>
              <div><span className="text-cyan-400">{"{{ hora }}"}</span> → Apenas hora (ex: 14:35:22)</div>
              <div><span className="text-cyan-400">{"{{ dia_semana }}"}</span> → Dia da semana por extenso (ex: sexta-feira)</div>
              <div><span className="text-cyan-400">{"{{ cliente_nome }}"}</span> → Nome do cliente na conversa</div>
              <div><span className="text-cyan-400">{"{{ cliente_telefone }}"}</span> → Telefone do cliente</div>
            </div>
          </details>
        </div>

        {/* 2-Column Grid: Company Info + Business Hours */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Company Info */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Building2 className="w-5 h-5 text-blue-400" />
              <h3 className="font-semibold text-white">Informações da Empresa</h3>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">
                  Nome da Empresa <span className="text-amber-400 text-[10px]">(recomendado)</span>
                </label>
                <input
                  type="text"
                  value={settings.company_name || ''}
                  onChange={(e) => setSettings({ ...settings, company_name: e.target.value || null })}
                  placeholder="Nome da sua empresa"
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">
                  Nome do Agente <span className="text-amber-400 text-[10px]">(recomendado)</span>
                </label>
                <input
                  type="text"
                  value={settings.sdr_name || ''}
                  onChange={(e) => setSettings({ ...settings, sdr_name: e.target.value || null })}
                  placeholder="Nome do agente (ex: Ana, Sofia)"
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
            </div>
          </div>

          {/* Business Hours */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Calendar className="w-5 h-5 text-indigo-400" />
              <h3 className="font-semibold text-white">Horário de Atendimento</h3>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1.5 block">Início</label>
                  <input
                    type="time"
                    value={settings.business_hours_start}
                    onChange={(e) => setSettings({ ...settings, business_hours_start: e.target.value })}
                    className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1.5 block">Fim</label>
                  <input
                    type="time"
                    value={settings.business_hours_end}
                    onChange={(e) => setSettings({ ...settings, business_hours_end: e.target.value })}
                    className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 mb-2 block">Dias da Semana</label>
                <div className="flex gap-2">
                  {DAYS_OF_WEEK.map(day => (
                    <button
                      key={day.value}
                      onClick={() => toggleBusinessDay(day.value)}
                      className={`flex-1 h-9 text-xs font-medium rounded-lg transition-all ${
                        settings.business_days.includes(day.value)
                          ? 'bg-indigo-500 text-white'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Comportamento */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex items-center gap-3 mb-4">
            <Bot className="w-5 h-5 text-violet-400" />
            <h3 className="font-semibold text-white">Comportamento</h3>
          </div>
          
          {/* AI Model Selection */}
          <div className="mb-4">
            <label className="text-xs font-medium text-slate-400 mb-3 block">Modelo de IA</label>
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => setSettings({ ...settings, ai_model_mode: 'flash' })}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all ${
                  settings.ai_model_mode === 'flash'
                    ? 'bg-violet-500/20 border-violet-500 text-violet-300'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <span className="text-lg">⚡</span>
                <span className="text-xs font-medium">Flash</span>
                <span className="text-[10px] text-center opacity-70">Rápido</span>
              </button>
              <button
                type="button"
                onClick={() => setSettings({ ...settings, ai_model_mode: 'pro' })}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all ${
                  settings.ai_model_mode === 'pro'
                    ? 'bg-violet-500/20 border-violet-500 text-violet-300'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <span className="text-lg">🧠</span>
                <span className="text-xs font-medium">Pro 2.5</span>
                <span className="text-[10px] text-center opacity-70">Inteligente</span>
              </button>
              <button
                type="button"
                onClick={() => setSettings({ ...settings, ai_model_mode: 'pro3' })}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all ${
                  settings.ai_model_mode === 'pro3'
                    ? 'bg-violet-500/20 border-violet-500 text-violet-300'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <span className="text-lg">🚀</span>
                <span className="text-xs font-medium">Pro 3</span>
                <span className="text-[10px] text-center opacity-70">Mais Recente</span>
              </button>
              <button
                type="button"
                onClick={() => setSettings({ ...settings, ai_model_mode: 'adaptive' })}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all ${
                  settings.ai_model_mode === 'adaptive'
                    ? 'bg-violet-500/20 border-violet-500 text-violet-300'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <span className="text-lg">🎯</span>
                <span className="text-xs font-medium">Adaptativo</span>
                <span className="text-[10px] text-center opacity-70">Contexto</span>
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {settings.ai_model_mode === 'flash' && 'Gemini 2.5 Flash: respostas rápidas e econômicas'}
              {settings.ai_model_mode === 'pro' && 'Gemini 2.5 Pro: respostas elaboradas e inteligentes'}
              {settings.ai_model_mode === 'pro3' && 'Gemini 3 Pro: modelo mais recente e avançado'}
              {settings.ai_model_mode === 'adaptive' && 'Alterna automaticamente baseado no contexto da conversa'}
            </p>
          </div>

          {/* Toggles em grid 2x2 com tooltips */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-slate-950/50 border border-slate-800">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-sm text-slate-300 cursor-help flex items-center gap-1.5">
                    Agente Ativo
                    <Info className="w-3 h-3 text-slate-500" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs max-w-[200px]">Liga ou desliga o agente de IA completamente. Quando desativado, nenhuma resposta automática será enviada.</p>
                </TooltipContent>
              </Tooltip>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.is_active}
                  onChange={(e) => setSettings({ ...settings, is_active: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-cyan-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
              </label>
            </div>

            <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-slate-950/50 border border-slate-800">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-sm text-slate-300 cursor-help flex items-center gap-1.5">
                    Resposta Automática
                    <Info className="w-3 h-3 text-slate-500" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs max-w-[200px]">Quando ativo, o agente responde automaticamente sem necessidade de aprovação humana.</p>
                </TooltipContent>
              </Tooltip>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.auto_response_enabled}
                  onChange={(e) => setSettings({ ...settings, auto_response_enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-cyan-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
              </label>
            </div>

            <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-slate-950/50 border border-slate-800">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-sm text-slate-300 cursor-help flex items-center gap-1.5">
                    Quebrar Mensagens
                    <Info className="w-3 h-3 text-slate-500" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs max-w-[200px]">Divide respostas longas em várias mensagens menores, simulando uma conversa mais natural.</p>
                </TooltipContent>
              </Tooltip>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.message_breaking_enabled}
                  onChange={(e) => setSettings({ ...settings, message_breaking_enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-cyan-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
              </label>
            </div>

            <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-slate-950/50 border border-slate-800">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-sm text-slate-300 cursor-help flex items-center gap-1.5">
                    Agendamento via IA
                    <Info className="w-3 h-3 text-slate-500" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs max-w-[200px]">Permite que o agente crie, altere e cancele agendamentos automaticamente durante a conversa.</p>
                </TooltipContent>
              </Tooltip>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.ai_scheduling_enabled}
                  onChange={(e) => setSettings({ ...settings, ai_scheduling_enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-cyan-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
              </label>
            </div>
          </div>
        </div>

      </div>
      </TooltipProvider>
    </>
  );
});

AgentSettings.displayName = 'AgentSettings';

export default AgentSettings;
