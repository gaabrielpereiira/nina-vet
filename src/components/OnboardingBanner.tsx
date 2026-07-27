import React from 'react';
import { Rocket, CheckCircle, Circle, AlertCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/Button';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';

interface OnboardingBannerProps {
  onOpenWizard: () => void;
}

export const OnboardingBanner: React.FC<OnboardingBannerProps> = ({ onOpenWizard }) => {
  const { loading, isComplete, steps, completionPercentage } = useOnboardingStatus();

  if (loading || isComplete) return null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-cyan-500/10 via-slate-900/50 to-violet-500/10 p-6 mb-8">
      {/* Background Glow */}
      <div className="absolute -top-20 -right-20 w-40 h-40 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-violet-500/20 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
                <Rocket className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Complete a configuração do sistema</h3>
                <p className="text-sm text-slate-400">Configure sua empresa para começar a usar o sistema</p>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>Progresso</span>
                <span className="text-cyan-400 font-medium">{completionPercentage}% concluído</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-cyan-500 to-violet-500 rounded-full transition-all duration-500"
                  style={{ width: `${completionPercentage}%` }}
                />
              </div>
            </div>

            {/* Steps Summary */}
            <div className="flex flex-wrap gap-3">
              {steps.map((step) => (
                <div
                  key={step.id}
                  className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${
                    step.isComplete
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : step.isRequired
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      : 'bg-slate-800/50 text-slate-500 border border-slate-700/50'
                  }`}
                >
                  {step.isComplete ? (
                    <CheckCircle className="w-3 h-3" />
                  ) : step.isRequired ? (
                    <AlertCircle className="w-3 h-3" />
                  ) : (
                    <Circle className="w-3 h-3" />
                  )}
                  {step.title}
                </div>
              ))}
            </div>
          </div>

          <div className="flex-shrink-0">
            <Button
              variant="primary"
              onClick={onOpenWizard}
              className="gap-2 whitespace-nowrap"
            >
              Continuar Configuração
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
