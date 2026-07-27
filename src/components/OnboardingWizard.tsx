import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Loader2, Settings2, SkipForward } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Button } from '@/components/Button';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { useAuth } from '@/hooks/useAuth';
import { StepIdentity } from './onboarding/StepIdentity';
import { StepWhatsApp } from './onboarding/StepWhatsApp';
import { StepAgent } from './onboarding/StepAgent';
import { StepElevenLabs } from './onboarding/StepElevenLabs';
import { StepBusinessHours } from './onboarding/StepBusinessHours';
import { StepVerification } from './onboarding/StepVerification';
import { StepFinish } from './onboarding/StepFinish';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import PromptGeneratorSheet from './settings/PromptGeneratorSheet';
import { DEFAULT_NINA_PROMPT } from '@/prompts/default-nina-prompt';

interface OnboardingWizardProps {
  isOpen: boolean;
  onClose: () => void;
}

// Premium cinematic step transitions with blur + scale
const stepVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
    scale: 0.9,
    filter: 'blur(10px)',
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
    filter: 'blur(0px)',
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 80 : -80,
    opacity: 0,
    scale: 0.9,
    filter: 'blur(10px)',
  }),
};

// Modal animations
const modalVariants = {
  hidden: { opacity: 0, scale: 0.9, y: 30 },
  visible: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.9, y: 30 },
};

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

// Animated checkmark SVG component with draw effect
const AnimatedCheckmark = () => (
  <motion.svg 
    viewBox="0 0 24 24" 
    className="w-4 h-4"
    initial="hidden"
    animate="visible"
  >
    <motion.path
      d="M5 13l4 4L19 7"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      variants={{
        hidden: { pathLength: 0, opacity: 0 },
        visible: { 
          pathLength: 1, 
          opacity: 1,
          transition: { 
            pathLength: { duration: 0.4, ease: "easeOut" },
            opacity: { duration: 0.1 }
          }
        }
      }}
    />
  </motion.svg>
);

// Step circle component (without label)
const StepCircle = ({ 
  index, 
  activeStep, 
  isOptional,
  onClick 
}: { 
  index: number; 
  activeStep: number;
  isOptional?: boolean;
  onClick: () => void;
}) => {
  const isCompleted = index < activeStep;
  const isActive = index === activeStep;

  return (
    <motion.button
      onClick={onClick}
      className="relative z-10 flex-shrink-0"
      whileHover={{ scale: 1.15 }}
      whileTap={{ scale: 0.95 }}
    >
      {/* Outer glow ring for active step */}
      {isActive && (
        <motion.div
          className="absolute inset-0 rounded-full bg-cyan-500/30"
          animate={{
            scale: [1, 1.5, 1],
            opacity: [0.5, 0, 0.5],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut"
          }}
          style={{ margin: '-4px' }}
        />
      )}
      
      {/* Main circle */}
      <motion.div
        className={`
          relative flex items-center justify-center w-8 h-8 rounded-full 
          border-2 transition-colors duration-300
          ${isCompleted 
            ? 'bg-gradient-to-br from-cyan-400 to-cyan-600 border-cyan-400 text-white shadow-lg shadow-cyan-500/40' 
            : isActive 
              ? 'border-cyan-500 text-cyan-400 bg-cyan-500/10 shadow-lg shadow-cyan-500/20' 
              : isOptional
                ? 'border-slate-600 text-slate-500 bg-slate-800/50 border-dashed'
                : 'border-slate-700 text-slate-500 bg-slate-800/50'
          }
        `}
        animate={isActive ? {
          boxShadow: [
            '0 0 0px rgba(6,182,212,0.4)',
            '0 0 25px rgba(6,182,212,0.6)',
            '0 0 0px rgba(6,182,212,0.4)',
          ],
        } : {}}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      >
        {isCompleted ? (
          <AnimatedCheckmark />
        ) : (
          <motion.span 
            key={index}
            className="text-xs font-semibold"
            initial={{ rotateY: -90, opacity: 0 }}
            animate={{ rotateY: 0, opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            {index + 1}
          </motion.span>
        )}
      </motion.div>
    </motion.button>
  );
};

// Connecting line between steps (inline with circles)
const ConnectingLine = ({ isCompleted }: { isCompleted: boolean }) => (
  <div className="relative flex-1 h-0.5 mx-1 bg-slate-700/50 rounded-full overflow-hidden self-center min-w-[12px]">
    <motion.div
      className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-cyan-500"
      initial={{ scaleX: 0 }}
      animate={{ scaleX: isCompleted ? 1 : 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      style={{ transformOrigin: 'left' }}
    />
  </div>
);

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ isOpen, onClose }) => {
  const { steps, currentStep, refetch, markWizardSeen } = useOnboardingStatus();
  const { user } = useAuth();
  const [activeStep, setActiveStep] = useState(0);
  const [direction, setDirection] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [showPromptGenerator, setShowPromptGenerator] = useState(false);
  const [verificationPassed, setVerificationPassed] = useState(false);

  // Form state - Identity
  const [companyName, setCompanyName] = useState('');
  const [sdrName, setSdrName] = useState('');
  
  // Form state - WhatsApp
  const [accessToken, setAccessToken] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [businessAccountId, setBusinessAccountId] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  
  // Form state - Agent
  const [systemPrompt, setSystemPrompt] = useState('');
  const [aiModelMode, setAiModelMode] = useState('flash');
  
  // Form state - ElevenLabs
  const [elevenLabsApiKey, setElevenLabsApiKey] = useState('');
  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState('33B4UnXyTNbgLmdEDh5P');
  const [elevenLabsModel, setElevenLabsModel] = useState('eleven_turbo_v2_5');
  const [audioResponseEnabled, setAudioResponseEnabled] = useState(false);
  const [elevenLabsStability, setElevenLabsStability] = useState(0.75);
  const [elevenLabsSimilarityBoost, setElevenLabsSimilarityBoost] = useState(0.8);
  const [elevenLabsSpeed, setElevenLabsSpeed] = useState(1.0);
  
  // Form state - Business Hours
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [businessHoursStart, setBusinessHoursStart] = useState('09:00');
  const [businessHoursEnd, setBusinessHoursEnd] = useState('18:00');
  const [businessDays, setBusinessDays] = useState<number[]>([1, 2, 3, 4, 5]);

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-webhook`;

  // Initialize system and load settings
  useEffect(() => {
    const initializeAndLoad = async () => {
      setIsInitializing(true);
      
      try {
        // System already initialized during signUp (useAuth.tsx calls initialize-system)
        // Just load the settings for this user
        // Single-tenant: busca configuração global (user_id pode ser NULL)
        const { data } = await supabase
          .from('nina_settings')
          .select('*')
          .limit(1)
          .maybeSingle();

        if (data) {
          // Identity
          setCompanyName(data.company_name || '');
          setSdrName(data.sdr_name || '');
          
          // WhatsApp
          setAccessToken(data.whatsapp_access_token || '');
          setPhoneNumberId(data.whatsapp_phone_number_id || '');
          setBusinessAccountId((data as any).whatsapp_business_account_id || '');
          setVerifyToken(data.whatsapp_verify_token || '');
          
          // Agent - usar prompt padrão se vazio
          setSystemPrompt(data.system_prompt_override || DEFAULT_NINA_PROMPT);
          setAiModelMode(data.ai_model_mode || 'flash');
          
          // ElevenLabs
          setElevenLabsApiKey(data.elevenlabs_api_key || '');
          setElevenLabsVoiceId(data.elevenlabs_voice_id || '33B4UnXyTNbgLmdEDh5P');
          setElevenLabsModel(data.elevenlabs_model || 'eleven_turbo_v2_5');
          setAudioResponseEnabled(data.audio_response_enabled || false);
          setElevenLabsStability(data.elevenlabs_stability || 0.75);
          setElevenLabsSimilarityBoost(data.elevenlabs_similarity_boost || 0.8);
          setElevenLabsSpeed(data.elevenlabs_speed || 1.0);
          
          // Business Hours
          setTimezone(data.timezone || 'America/Sao_Paulo');
          setBusinessHoursStart(data.business_hours_start?.substring(0, 5) || '09:00');
          setBusinessHoursEnd(data.business_hours_end?.substring(0, 5) || '18:00');
          setBusinessDays(data.business_days || [1, 2, 3, 4, 5]);
        }
      } catch (error) {
        console.error('[OnboardingWizard] Error:', error);
      } finally {
        setIsInitializing(false);
      }
    };

    if (isOpen) {
      initializeAndLoad();
      setActiveStep(0);
    }
  }, [isOpen]);

  // Validate current step data before saving
  const validateStepData = useCallback((stepIndex: number): { valid: boolean; issues: string[] } => {
    const issues: string[] = [];
    
    console.log(`[OnboardingWizard] Validating step ${stepIndex} data...`);
    
    switch (stepIndex) {
      case 0: // Identity
        console.log('[OnboardingWizard] Step 0 (Identity) values:', { companyName, sdrName });
        if (!companyName?.trim()) issues.push('Nome da empresa está vazio');
        if (!sdrName?.trim()) issues.push('Nome do SDR está vazio');
        break;
      case 1: // WhatsApp
        console.log('[OnboardingWizard] Step 1 (WhatsApp) values:', { 
          accessToken: accessToken ? `${accessToken.substring(0, 10)}...` : 'EMPTY',
          phoneNumberId: phoneNumberId || 'EMPTY',
          businessAccountId: businessAccountId || 'EMPTY',
          verifyToken: verifyToken || 'EMPTY'
        });
        if (!accessToken?.trim()) issues.push('Access Token está vazio');
        if (!phoneNumberId?.trim()) issues.push('Phone Number ID está vazio');
        break;
      case 2: // Agent
        console.log('[OnboardingWizard] Step 2 (Agent) values:', { 
          systemPrompt: systemPrompt ? `${systemPrompt.substring(0, 30)}...` : 'EMPTY',
          aiModelMode
        });
        // System prompt has default, so no validation needed
        break;
      case 3: // ElevenLabs (optional)
        console.log('[OnboardingWizard] Step 3 (ElevenLabs) values:', { 
          elevenLabsApiKey: elevenLabsApiKey ? '***configured***' : 'EMPTY',
          audioResponseEnabled
        });
        break;
      case 4: // Business Hours (optional)
        console.log('[OnboardingWizard] Step 4 (BusinessHours) values:', { 
          timezone, businessHoursStart, businessHoursEnd, businessDays
        });
        break;
    }
    
    if (issues.length > 0) {
      console.warn('[OnboardingWizard] Validation issues:', issues);
    } else {
      console.log('[OnboardingWizard] Step validation passed');
    }
    
    return { valid: issues.length === 0, issues };
  }, [companyName, sdrName, accessToken, phoneNumberId, businessAccountId, verifyToken, 
      systemPrompt, aiModelMode, elevenLabsApiKey, audioResponseEnabled,
      timezone, businessHoursStart, businessHoursEnd, businessDays]);

  const saveSettings = useCallback(async () => {
    if (!user) {
      console.error('[OnboardingWizard] ❌ No user found, cannot save settings');
      toast.error('Erro: usuário não autenticado');
      return false;
    }
    
    setIsSaving(true);
    console.log('[OnboardingWizard] ========================================');
    console.log('[OnboardingWizard] Starting saveSettings for user:', user.id);
    console.log('[OnboardingWizard] Current activeStep:', activeStep);
    
    // Log all current state values
    console.log('[OnboardingWizard] Current form state:', {
      // Identity
      companyName: companyName || '(empty)',
      sdrName: sdrName || '(empty)',
      // WhatsApp
      accessToken: accessToken ? `${accessToken.substring(0, 15)}...` : '(empty)',
      phoneNumberId: phoneNumberId || '(empty)',
      businessAccountId: businessAccountId || '(empty)',
      verifyToken: verifyToken || '(empty)',
      // Agent
      systemPrompt: systemPrompt ? `${systemPrompt.substring(0, 50)}...` : '(empty)',
      aiModelMode,
      // ElevenLabs
      elevenLabsApiKey: elevenLabsApiKey ? '***' : '(empty)',
      audioResponseEnabled,
      // Business Hours
      timezone,
      businessHoursStart,
      businessHoursEnd,
      businessDays,
    });
    
    try {
      // Step 1: Check if settings exist
      console.log('[OnboardingWizard] Step 1: Checking for existing settings...');
      // Single-tenant: busca configuração global (user_id pode ser NULL)
      const { data: existing, error: fetchError } = await supabase
        .from('nina_settings')
        .select('id, user_id, company_name, whatsapp_phone_number_id')
        .limit(1)
        .maybeSingle();

      if (fetchError) {
        console.error('[OnboardingWizard] ❌ Error fetching existing settings:', fetchError);
        toast.error('Erro ao verificar configurações existentes');
        return false;
      }

      console.log('[OnboardingWizard] Existing settings found:', existing ? {
        id: existing.id,
        user_id: existing.user_id,
        company_name: existing.company_name,
        whatsapp_phone_number_id: existing.whatsapp_phone_number_id ? '***' : null
      } : 'NONE');

      // Step 2: Build settings object with explicit values
      const settings = {
        // Identity - trim whitespace
        company_name: companyName?.trim() || null,
        sdr_name: sdrName?.trim() || null,
        
        // WhatsApp - trim whitespace
        whatsapp_access_token: accessToken?.trim() || null,
        whatsapp_phone_number_id: phoneNumberId?.trim() || null,
        whatsapp_business_account_id: businessAccountId?.trim() || null,
        whatsapp_verify_token: verifyToken?.trim() || null,
        
        // Agent - use default prompt if empty
        system_prompt_override: systemPrompt?.trim() || DEFAULT_NINA_PROMPT,
        ai_model_mode: aiModelMode || 'flash',
        
        // ElevenLabs
        elevenlabs_api_key: elevenLabsApiKey?.trim() || null,
        elevenlabs_voice_id: elevenLabsVoiceId || '33B4UnXyTNbgLmdEDh5P',
        elevenlabs_model: elevenLabsModel || 'eleven_turbo_v2_5',
        audio_response_enabled: Boolean(audioResponseEnabled),
        elevenlabs_stability: Number(elevenLabsStability) || 0.75,
        elevenlabs_similarity_boost: Number(elevenLabsSimilarityBoost) || 0.8,
        elevenlabs_speed: Number(elevenLabsSpeed) || 1.0,
        
        // Business Hours
        timezone: timezone || 'America/Sao_Paulo',
        business_hours_start: businessHoursStart || '09:00',
        business_hours_end: businessHoursEnd || '18:00',
        business_days: businessDays?.length > 0 ? businessDays : [1, 2, 3, 4, 5],
        
        // Ensure Nina is active
        is_active: true,
        auto_response_enabled: true,
      };

      console.log('[OnboardingWizard] Step 2: Settings object built:', {
        company_name: settings.company_name,
        sdr_name: settings.sdr_name,
        whatsapp_phone_number_id: settings.whatsapp_phone_number_id ? '✓ SET' : '✗ EMPTY',
        whatsapp_access_token: settings.whatsapp_access_token ? '✓ SET' : '✗ EMPTY',
        system_prompt_override: settings.system_prompt_override ? '✓ SET' : '✗ EMPTY',
        elevenlabs_api_key: settings.elevenlabs_api_key ? '✓ SET' : '✗ EMPTY',
        is_active: settings.is_active,
        auto_response_enabled: settings.auto_response_enabled,
      });

      // Step 3: Save to database
      let result;
      if (existing) {
        console.log('[OnboardingWizard] Step 3: Updating existing settings by ID:', existing.id);
        result = await supabase
          .from('nina_settings')
          .update(settings)
          .eq('id', existing.id)  // Single-tenant: usa ID do registro existente
          .select()
          .single();
      } else {
        console.log('[OnboardingWizard] Step 3: Inserting new global settings...');
        result = await supabase
          .from('nina_settings')
          .insert({
            ...settings,
            user_id: null,  // Single-tenant: configuração global
          })
          .select()
          .single();
      }

      // Step 4: Check result
      if (result.error) {
        console.error('[OnboardingWizard] ❌ Database error:', result.error);
        toast.error('Erro ao salvar: ' + result.error.message);
        return false;
      }

      if (!result.data) {
        console.error('[OnboardingWizard] ❌ No data returned - possible RLS issue');
        toast.error('Erro: configurações não foram salvas (RLS)');
        return false;
      }

      console.log('[OnboardingWizard] Step 4: Save result:', {
        id: result.data.id,
        company_name: result.data.company_name,
        sdr_name: result.data.sdr_name,
        whatsapp_phone_number_id: result.data.whatsapp_phone_number_id ? '✓ SAVED' : '✗ NOT SAVED',
        whatsapp_access_token: result.data.whatsapp_access_token ? '✓ SAVED' : '✗ NOT SAVED',
        system_prompt_override: result.data.system_prompt_override ? '✓ SAVED' : '✗ NOT SAVED',
        is_active: result.data.is_active,
      });

      // Step 5: Verify data was actually saved by re-fetching
      console.log('[OnboardingWizard] Step 5: Verifying saved data...');
      const { data: verifyData, error: verifyError } = await supabase
        .from('nina_settings')
        .select('company_name, sdr_name, whatsapp_phone_number_id, whatsapp_access_token, system_prompt_override, is_active')
        .eq('id', result.data.id)
        .maybeSingle();

      if (verifyError) {
        console.error('[OnboardingWizard] ❌ Verification query failed:', verifyError);
      } else {
        console.log('[OnboardingWizard] ✓ Verification result:', {
          company_name: verifyData?.company_name || '(null)',
          sdr_name: verifyData?.sdr_name || '(null)',
          whatsapp_phone_number_id: verifyData?.whatsapp_phone_number_id ? '✓ VERIFIED' : '✗ NULL',
          whatsapp_access_token: verifyData?.whatsapp_access_token ? '✓ VERIFIED' : '✗ NULL',
          system_prompt_override: verifyData?.system_prompt_override ? '✓ VERIFIED' : '✗ NULL',
          is_active: verifyData?.is_active,
        });

        // Check if critical fields were saved
        if (settings.company_name && !verifyData?.company_name) {
          console.error('[OnboardingWizard] ❌ CRITICAL: company_name not persisted!');
        }
        if (settings.whatsapp_phone_number_id && !verifyData?.whatsapp_phone_number_id) {
          console.error('[OnboardingWizard] ❌ CRITICAL: whatsapp_phone_number_id not persisted!');
        }
        if (settings.whatsapp_access_token && !verifyData?.whatsapp_access_token) {
          console.error('[OnboardingWizard] ❌ CRITICAL: whatsapp_access_token not persisted!');
        }
      }
      
      console.log('[OnboardingWizard] ✓ Settings saved successfully!');
      console.log('[OnboardingWizard] ========================================');
      
      toast.success('Configurações salvas!');
      await refetch();
      return true;
    } catch (error) {
      console.error('[OnboardingWizard] ❌ Unexpected error:', error);
      toast.error('Erro inesperado ao salvar configurações');
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [
    user, activeStep, companyName, sdrName, accessToken, phoneNumberId, businessAccountId, verifyToken, 
    systemPrompt, aiModelMode, elevenLabsApiKey, elevenLabsVoiceId, elevenLabsModel,
    audioResponseEnabled, elevenLabsStability, elevenLabsSimilarityBoost, elevenLabsSpeed,
    timezone, businessHoursStart, businessHoursEnd, businessDays, refetch
  ]);

  const handleNext = async () => {
    await saveSettings();
    if (activeStep < steps.length - 1) {
      setDirection(1);
      setActiveStep(activeStep + 1);
    }
  };

  const handleSkip = async () => {
    await saveSettings();
    if (activeStep < steps.length - 1) {
      setDirection(1);
      setActiveStep(activeStep + 1);
    }
  };

  const handlePrev = () => {
    if (activeStep > 0) {
      setDirection(-1);
      setActiveStep(activeStep - 1);
    }
  };

  const handleStepClick = (index: number) => {
    setDirection(index > activeStep ? 1 : -1);
    setActiveStep(index);
  };

  const fireConfetti = () => {
    const count = 200;
    const defaults = {
      origin: { y: 0.7 },
      zIndex: 9999,
    };

    function fire(particleRatio: number, opts: confetti.Options) {
      confetti({
        ...defaults,
        ...opts,
        particleCount: Math.floor(count * particleRatio),
      });
    }

    fire(0.25, { spread: 26, startVelocity: 55 });
    fire(0.2, { spread: 60 });
    fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
    fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
    fire(0.1, { spread: 120, startVelocity: 45 });
  };

  const handleComplete = async () => {
    await saveSettings();
    markWizardSeen();
    fireConfetti();
    toast.success('Configuração concluída! Bem-vindo ao sistema.');
    onClose();
    // Refresh após delay para atualizar o estado do onboarding em toda a aplicação
    setTimeout(() => window.location.reload(), 800);
  };

  const handlePromptGenerated = (prompt: string) => {
    setSystemPrompt(prompt);
    setShowPromptGenerator(false);
  };

  const isOptionalStep = (stepId: string) => {
    return ['elevenlabs', 'business_hours'].includes(stepId);
  };

  const renderStep = () => {
    switch (activeStep) {
      case 0:
        return (
          <StepIdentity
            companyName={companyName}
            sdrName={sdrName}
            onCompanyNameChange={setCompanyName}
            onSdrNameChange={setSdrName}
          />
        );
      case 1:
        return (
          <StepWhatsApp
            accessToken={accessToken}
            phoneNumberId={phoneNumberId}
            businessAccountId={businessAccountId}
            verifyToken={verifyToken}
            onAccessTokenChange={setAccessToken}
            onPhoneNumberIdChange={setPhoneNumberId}
            onBusinessAccountIdChange={setBusinessAccountId}
            onVerifyTokenChange={setVerifyToken}
            webhookUrl={webhookUrl}
          />
        );
      case 2:
        return (
          <StepAgent
            systemPrompt={systemPrompt}
            aiModelMode={aiModelMode}
            onSystemPromptChange={setSystemPrompt}
            onAiModelModeChange={setAiModelMode}
            onGeneratePrompt={() => setShowPromptGenerator(true)}
          />
        );
      case 3:
        return (
          <StepElevenLabs
            elevenLabsApiKey={elevenLabsApiKey}
            elevenLabsVoiceId={elevenLabsVoiceId}
            elevenLabsModel={elevenLabsModel}
            audioResponseEnabled={audioResponseEnabled}
            elevenLabsStability={elevenLabsStability}
            elevenLabsSimilarityBoost={elevenLabsSimilarityBoost}
            elevenLabsSpeed={elevenLabsSpeed}
            onApiKeyChange={setElevenLabsApiKey}
            onVoiceIdChange={setElevenLabsVoiceId}
            onModelChange={setElevenLabsModel}
            onAudioEnabledChange={setAudioResponseEnabled}
            onStabilityChange={setElevenLabsStability}
            onSimilarityBoostChange={setElevenLabsSimilarityBoost}
            onSpeedChange={setElevenLabsSpeed}
          />
        );
      case 4:
        return (
          <StepBusinessHours
            timezone={timezone}
            businessHoursStart={businessHoursStart}
            businessHoursEnd={businessHoursEnd}
            businessDays={businessDays}
            onTimezoneChange={setTimezone}
            onBusinessHoursStartChange={setBusinessHoursStart}
            onBusinessHoursEndChange={setBusinessHoursEnd}
            onBusinessDaysChange={setBusinessDays}
          />
        );
      case 5:
        return (
          <StepVerification
            onAllChecked={setVerificationPassed}
          />
        );
      case 6:
        return (
          <StepFinish
            steps={steps}
            companyName={companyName}
            sdrName={sdrName}
            onComplete={handleComplete}
          />
        );
      default:
        return null;
    }
  };

  const progressPercentage = ((activeStep + 1) / steps.length) * 100;
  const currentStepData = steps[activeStep];
  const showSkipButton = currentStepData && isOptionalStep(currentStepData.id);

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop with blur */}
            <motion.div 
              variants={backdropVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={{ duration: 0.3 }}
              className="absolute inset-0 bg-slate-950/90 backdrop-blur-md"
              onClick={onClose}
            />

            {/* Modal */}
            <motion.div 
              variants={modalVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={{ 
                duration: 0.4, 
                type: "spring", 
                stiffness: 260, 
                damping: 25 
              }}
              className="relative w-full max-w-2xl max-h-[90vh] mx-4 bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col"
            >
              {/* Gradient Progress Bar at top */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-slate-800">
                <motion.div
                  className="h-full bg-gradient-to-r from-cyan-500 via-violet-500 to-fuchsia-500"
                  initial={{ width: '0%' }}
                  animate={{ width: `${progressPercentage}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between p-6 pt-7 border-b border-slate-800/50">
                <div className="flex items-center gap-3">
                  <motion.div
                    className="p-2 rounded-lg bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-cyan-500/30"
                    animate={{ 
                      boxShadow: [
                        '0 0 0px rgba(6,182,212,0.3)',
                        '0 0 15px rgba(6,182,212,0.4)',
                        '0 0 0px rgba(6,182,212,0.3)',
                      ]
                    }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    <Settings2 className="w-5 h-5 text-cyan-400" />
                  </motion.div>
                  <div>
                    <h2 className="text-xl font-semibold text-white">Configuração Inicial</h2>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-sm text-slate-400">Passo</span>
                      <motion.span 
                        key={activeStep}
                        initial={{ y: 10, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        className="text-sm font-semibold text-cyan-400"
                      >
                        {activeStep + 1}
                      </motion.span>
                      <span className="text-sm text-slate-400">de {steps.length}</span>
                    </div>
                  </div>
                </div>
                <motion.button
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  transition={{ type: "spring", stiffness: 400, damping: 15 }}
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              {/* Progress Steps */}
              <div className="px-6 py-4 border-b border-slate-800/30 bg-slate-900/50">
                {/* Row 1: Circles + Connecting Lines */}
                <div className="flex items-center justify-center max-w-lg mx-auto">
                  {steps.map((step, index) => (
                    <React.Fragment key={step.id}>
                      <StepCircle
                        index={index}
                        activeStep={activeStep}
                        isOptional={isOptionalStep(step.id)}
                        onClick={() => handleStepClick(index)}
                      />
                      {index < steps.length - 1 && (
                        <ConnectingLine isCompleted={index < activeStep} />
                      )}
                    </React.Fragment>
                  ))}
                </div>
                
                {/* Current step label */}
                <div className="text-center mt-3">
                  <motion.span
                    key={activeStep}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-sm font-medium text-cyan-400"
                  >
                    {currentStepData?.title}
                    {showSkipButton && (
                      <span className="text-slate-500 font-normal ml-2">(opcional)</span>
                    )}
                  </motion.span>
                </div>
              </div>

              {/* Content with cinematic transitions */}
              <div className="flex-1 overflow-y-auto p-6 custom-scrollbar overflow-x-hidden">
                {isInitializing ? (
                  <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-4">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                    >
                      <Loader2 className="w-8 h-8 text-cyan-500" />
                    </motion.div>
                    <div className="text-center">
                      <p className="text-slate-300 font-medium">Preparando sistema...</p>
                      <p className="text-sm text-slate-500 mt-1">Inicializando configurações necessárias</p>
                    </div>
                  </div>
                ) : (
                  <AnimatePresence mode="wait" custom={direction}>
                    <motion.div
                      key={activeStep}
                      custom={direction}
                      variants={stepVariants}
                      initial="enter"
                      animate="center"
                      exit="exit"
                      transition={{
                        x: { type: "spring", stiffness: 200, damping: 25 },
                        opacity: { duration: 0.3 },
                        scale: { duration: 0.3 },
                        filter: { duration: 0.3 },
                      }}
                    >
                      {renderStep()}
                    </motion.div>
                  </AnimatePresence>
                )}
              </div>

              {/* Footer with premium buttons */}
              {activeStep < steps.length - 1 && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="flex items-center justify-between p-6 border-t border-slate-800/50 bg-slate-900/80 backdrop-blur-sm"
                >
                  <motion.div
                    whileHover={{ scale: 1.02, x: -3 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Button
                      variant="ghost"
                      onClick={handlePrev}
                      disabled={activeStep === 0}
                      className="gap-2 group"
                    >
                      <motion.div
                        animate={{ x: [0, -3, 0] }}
                        transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 1 }}
                      >
                        <ChevronLeft className="w-4 h-4 group-hover:text-cyan-400 transition-colors" />
                      </motion.div>
                      Anterior
                    </Button>
                  </motion.div>

                  {/* Saving indicator */}
                  <AnimatePresence>
                    {isSaving && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="flex items-center gap-2 text-xs text-slate-400"
                      >
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        >
                          <Loader2 className="w-3 h-3" />
                        </motion.div>
                        <motion.span
                          animate={{ opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 1.5, repeat: Infinity }}
                        >
                          Salvando...
                        </motion.span>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="flex gap-2">
                    {showSkipButton && (
                      <motion.div
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <Button
                          variant="ghost"
                          onClick={handleSkip}
                          disabled={isSaving}
                          className="gap-2 text-slate-400 hover:text-slate-300"
                        >
                          Pular
                          <SkipForward className="w-4 h-4" />
                        </Button>
                      </motion.div>
                    )}
                    
                    <motion.div
                      whileHover={{ scale: 1.02, x: 3 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <Button
                        variant="primary"
                        onClick={handleNext}
                        disabled={isSaving}
                        className="gap-2 group bg-gradient-to-r from-cyan-600 to-violet-600 hover:from-cyan-500 hover:to-violet-500 border-0 shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40 transition-all"
                      >
                        Próximo
                        <motion.div
                          animate={{ x: [0, 3, 0] }}
                          transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 1 }}
                        >
                          <ChevronRight className="w-4 h-4 group-hover:text-white transition-colors" />
                        </motion.div>
                      </Button>
                    </motion.div>
                  </div>
                </motion.div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <PromptGeneratorSheet
        open={showPromptGenerator}
        onOpenChange={setShowPromptGenerator}
        onPromptGenerated={handlePromptGenerated}
      />
    </>
  );
};
