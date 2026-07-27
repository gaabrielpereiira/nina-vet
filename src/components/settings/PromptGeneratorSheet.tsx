import React, { useState, useEffect } from 'react';
import { Wand2, Loader2 } from 'lucide-react';
import { Button } from '../Button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

interface PromptGeneratorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPromptGenerated: (prompt: string) => void;
}

interface FormData {
  sdr_name: string;
  role: string;
  company_name: string;
  paper_type: string;
  personality: string;
  tone: string;
  prohibited_terms: string;
  philosophy_name: string;
  lead_talk_percentage: number;
  max_lines: number;
  products: string;
  differentials: string;
  conversion_action: string;
  tools: string;
}

const PromptGeneratorSheet: React.FC<PromptGeneratorSheetProps> = ({
  open,
  onOpenChange,
  onPromptGenerated,
}) => {
  const { companyName, sdrName } = useCompanySettings();
  const [loading, setLoading] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [formData, setFormData] = useState<FormData>({
    sdr_name: '',
    role: 'SDR',
    company_name: '',
    paper_type: 'consultor amigo',
    personality: 'Profissional, consultivo, empático e focado em entender necessidades reais',
    tone: 'consultivo',
    prohibited_terms: 'gírias, jargões complexos, pressão por venda',
    philosophy_name: 'Venda Consultiva',
    lead_talk_percentage: 80,
    max_lines: 3,
    products: '',
    differentials: '',
    conversion_action: 'Agendar reunião',
    tools: 'agendamento, reagendamento, cancelamento',
  });

  // Pre-populate form with company settings
  useEffect(() => {
    if (companyName && sdrName) {
      setFormData(prev => ({
        ...prev,
        company_name: companyName,
        sdr_name: sdrName,
      }));
    }
  }, [companyName, sdrName]);

  const handleGenerate = async () => {
    // Validação
    if (!formData.sdr_name || !formData.company_name || !formData.products || !formData.differentials) {
      toast.error('Preencha todos os campos obrigatórios');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-prompt', {
        body: formData,
      });

      if (error) throw error;

      if (data?.prompt) {
        setGeneratedPrompt(data.prompt);
        toast.success('Prompt gerado com sucesso!');
      }
    } catch (error) {
      console.error('Error generating prompt:', error);
      toast.error('Erro ao gerar prompt. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleUsePrompt = () => {
    onPromptGenerated(generatedPrompt);
    setGeneratedPrompt('');
    onOpenChange(false);
    toast.success('Prompt aplicado!');
  };

  const handleReset = () => {
    setGeneratedPrompt('');
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-cyan-400" />
            Gerador de Prompt com IA
          </SheetTitle>
          <SheetDescription>
            Preencha as informações abaixo para gerar um prompt personalizado para seu agente
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 mt-6">
          {/* Informações Básicas */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-cyan-400 flex items-center gap-2">
              📋 Informações Básicas
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">
                  Nome do SDR <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.sdr_name}
                  onChange={(e) => setFormData({ ...formData, sdr_name: e.target.value })}
                  placeholder="ex: Assistente"
                  className="flex h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">
                  Cargo/Função <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  placeholder="ex: SDR, Closer, CS"
                  className="flex h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">
                  Nome da Empresa <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.company_name}
                  onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                  placeholder="ex: Minha Empresa"
                  className="flex h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">
                  Tipo de Papel <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.paper_type}
                  onChange={(e) => setFormData({ ...formData, paper_type: e.target.value })}
                  placeholder="ex: consultor amigo"
                  className="flex h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>
            </div>
          </div>

          {/* Personalidade e Tom */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-violet-400 flex items-center gap-2">
              🎭 Personalidade e Tom
            </h3>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                Personalidade <span className="text-red-400">*</span>
              </label>
              <textarea
                value={formData.personality}
                onChange={(e) => setFormData({ ...formData, personality: e.target.value })}
                placeholder="ex: Profissional, consultivo, empático"
                rows={2}
                className="flex w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Tom de Voz</label>
                <select
                  value={formData.tone}
                  onChange={(e) => setFormData({ ...formData, tone: e.target.value })}
                  className="flex h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                >
                  <option value="formal">Formal</option>
                  <option value="informal">Informal</option>
                  <option value="amigavel">Amigável</option>
                  <option value="tecnico">Técnico</option>
                  <option value="consultivo">Consultivo</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Termos Proibidos</label>
                <input
                  type="text"
                  value={formData.prohibited_terms}
                  onChange={(e) => setFormData({ ...formData, prohibited_terms: e.target.value })}
                  placeholder="ex: gírias, jargões"
                  className="flex h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>
            </div>
          </div>

          {/* Filosofia de Vendas */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-indigo-400 flex items-center gap-2">
              📊 Filosofia de Vendas
            </h3>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Nome da Filosofia</label>
              <input
                type="text"
                value={formData.philosophy_name}
                onChange={(e) => setFormData({ ...formData, philosophy_name: e.target.value })}
                placeholder="ex: Venda Consultiva"
                className="flex h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300 flex justify-between">
                  <span>Lead fala</span>
                  <span className="text-cyan-400 font-mono">{formData.lead_talk_percentage}%</span>
                </label>
                <input
                  type="range"
                  min="50"
                  max="90"
                  step="5"
                  value={formData.lead_talk_percentage}
                  onChange={(e) => setFormData({ ...formData, lead_talk_percentage: parseInt(e.target.value) })}
                  className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300 flex justify-between">
                  <span>Máximo de linhas</span>
                  <span className="text-cyan-400 font-mono">{formData.max_lines}</span>
                </label>
                <input
                  type="range"
                  min="2"
                  max="6"
                  step="1"
                  value={formData.max_lines}
                  onChange={(e) => setFormData({ ...formData, max_lines: parseInt(e.target.value) })}
                  className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Produtos e Diferenciais */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
              📦 Produtos e Diferenciais
            </h3>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                Produtos/Serviços <span className="text-red-400">*</span>
              </label>
              <textarea
                value={formData.products}
                onChange={(e) => setFormData({ ...formData, products: e.target.value })}
                placeholder="ex: - Produto A: Valor X a Y (Prazo Z). Uso: [Casos de Uso]&#10;- Produto B: Valor X a Y. Benefício principal: [Benefício]"
                rows={4}
                className="flex w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 resize-none font-mono"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                Diferenciais Competitivos <span className="text-red-400">*</span>
              </label>
              <textarea
                value={formData.differentials}
                onChange={(e) => setFormData({ ...formData, differentials: e.target.value })}
                placeholder="ex: - Diferencial 1: [Descrição]&#10;- Diferencial 2: [Descrição]"
                rows={3}
                className="flex w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 resize-none font-mono"
              />
            </div>
          </div>

          {/* Conversão */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-amber-400 flex items-center gap-2">
              🎯 Conversão
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Ação de Conversão</label>
                <select
                  value={formData.conversion_action}
                  onChange={(e) => setFormData({ ...formData, conversion_action: e.target.value })}
                  className="flex h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                >
                  <option value="Agendar reunião">Agendar reunião</option>
                  <option value="Agendar Demo">Agendar Demo</option>
                  <option value="Enviar proposta">Enviar proposta</option>
                  <option value="Qualificar lead">Qualificar lead</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Tools Disponíveis</label>
                <input
                  type="text"
                  value={formData.tools}
                  onChange={(e) => setFormData({ ...formData, tools: e.target.value })}
                  placeholder="ex: agendamento, reagendamento"
                  className="flex h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>
            </div>
          </div>

          {/* Botão de Gerar */}
          {!generatedPrompt && (
            <Button
              onClick={handleGenerate}
              disabled={loading}
              className="w-full shadow-lg shadow-cyan-500/20"
              size="lg"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Gerando prompt...
                </>
              ) : (
                <>
                  <Wand2 className="w-5 h-5 mr-2" />
                  Gerar Prompt
                </>
              )}
            </Button>
          )}

          {/* Preview do Prompt Gerado */}
          {generatedPrompt && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-cyan-400">📝 Prompt Gerado</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  className="text-slate-400 hover:text-slate-200"
                >
                  Gerar Novamente
                </Button>
              </div>
              <textarea
                value={generatedPrompt}
                onChange={(e) => setGeneratedPrompt(e.target.value)}
                rows={12}
                className="flex w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 resize-none font-mono"
              />
              <div className="flex gap-3">
                <Button
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                  className="flex-1"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleUsePrompt}
                  className="flex-1 shadow-lg shadow-cyan-500/20"
                >
                  ✅ Usar este prompt
                </Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default PromptGeneratorSheet;
