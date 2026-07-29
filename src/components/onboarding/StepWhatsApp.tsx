import React, { useState, useEffect, useCallback } from 'react';
import { MessageSquare, ExternalLink, CheckCircle2, Loader2, ChevronDown, Key, Phone, Building2, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/Button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface StepWhatsAppProps {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  verifyToken: string;
  onAccessTokenChange: (value: string) => void;
  onPhoneNumberIdChange: (value: string) => void;
  onBusinessAccountIdChange: (value: string) => void;
  onVerifyTokenChange: (value: string) => void;
  webhookUrl: string;
}

// ⚠️ App Meta público. Precisa estar exposto no cliente para o FB SDK.
// Vem do build: defina VITE_META_APP_ID no .env quando registrar o App na Meta.
const META_APP_ID = import.meta.env.VITE_META_APP_ID as string | undefined;
const META_CONFIG_ID = import.meta.env.VITE_META_CONFIG_ID_COEXISTENCE as string | undefined;

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1, delayChildren: 0.1 } },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } },
};

export const StepWhatsApp: React.FC<StepWhatsAppProps> = ({
  accessToken,
  phoneNumberId,
  businessAccountId,
  verifyToken,
  onAccessTokenChange,
  onPhoneNumberIdChange,
  onBusinessAccountIdChange,
  onVerifyTokenChange,
  webhookUrl,
}) => {
  const [fbReady, setFbReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectedPhone, setConnectedPhone] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const embeddedSignupEnabled = Boolean(META_APP_ID && META_CONFIG_ID);
  const alreadyConnected = Boolean(accessToken && phoneNumberId);

  // Carregar Facebook SDK
  useEffect(() => {
    if (!embeddedSignupEnabled) return;
    if (window.FB) { setFbReady(true); return; }

    window.fbAsyncInit = () => {
      window.FB.init({
        appId: META_APP_ID,
        cookie: true,
        xfbml: false,
        version: 'v21.0',
      });
      setFbReady(true);
    };

    const id = 'facebook-jssdk';
    if (!document.getElementById(id)) {
      const s = document.createElement('script');
      s.id = id;
      s.async = true;
      s.defer = true;
      s.crossOrigin = 'anonymous';
      s.src = 'https://connect.facebook.net/en_US/sdk.js';
      document.body.appendChild(s);
    }
  }, [embeddedSignupEnabled]);

  // Escutar session_info messages do popup do Meta
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!event.origin.endsWith('facebook.com')) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type === 'WA_EMBEDDED_SIGNUP') {
          console.log('[Embedded Signup] session event:', data);
        }
      } catch {
        // não é JSON, ignora
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const launchSignup = useCallback(() => {
    if (!window.FB || !META_CONFIG_ID) return;
    setConnecting(true);

    window.FB.login(
      (response: any) => {
        if (response?.authResponse?.code) {
          exchangeCode(response.authResponse.code);
        } else {
          setConnecting(false);
          if (response?.status !== 'unknown') {
            toast.error('Conexão cancelada ou falhou');
          }
        }
      },
      {
        config_id: META_CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: { solutionType: 'COEXISTENCE' },
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: '3',
        },
      },
    );
  }, []);

  const exchangeCode = async (code: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('whatsapp-embedded-signup', {
        body: { code },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      onAccessTokenChange('***conectado***'); // placeholder; token real fica no backend
      onPhoneNumberIdChange(data.phone_number_id || '');
      onBusinessAccountIdChange(data.waba_id || '');
      onVerifyTokenChange(data.verify_token || '');
      setConnectedPhone(data.display_phone_number || data.phone_number_id);
      toast.success(`WhatsApp conectado: ${data.display_phone_number || 'ativo'}`);
    } catch (e: any) {
      console.error('[Embedded Signup] exchange error:', e);
      toast.error(e?.message || 'Falha ao conectar WhatsApp');
    } finally {
      setConnecting(false);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <motion.div className="space-y-8" variants={containerVariants} initial="hidden" animate="visible">
      <motion.div variants={itemVariants} className="text-center mb-8">
        <motion.div
          className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-green-500/20 border border-emerald-500/30 flex items-center justify-center"
          whileHover={{ scale: 1.05, rotate: 5 }}
          transition={{ type: 'spring', stiffness: 400 }}
        >
          <MessageSquare className="w-8 h-8 text-emerald-400" />
        </motion.div>
        <h3 className="text-xl font-semibold text-foreground mb-2">Conectar WhatsApp Business</h3>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          Conecte em modo <strong>Coexistência</strong> — você continua usando o app do WhatsApp no celular normalmente, e a Nina responde em paralelo.
        </p>
      </motion.div>

      <div className="max-w-md mx-auto space-y-6">
        {/* Estado: conectado */}
        {(alreadyConnected || connectedPhone) && (
          <motion.div
            variants={itemVariants}
            className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-3"
          >
            <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-emerald-100">WhatsApp conectado</p>
              <p className="text-xs text-emerald-300/80 font-mono">
                {connectedPhone || phoneNumberId}
              </p>
            </div>
            {embeddedSignupEnabled && (
              <Button variant="ghost" size="sm" onClick={launchSignup} disabled={!fbReady || connecting}>
                Trocar
              </Button>
            )}
          </motion.div>
        )}

        {/* Estado: não conectado + Embedded Signup habilitado */}
        {!alreadyConnected && !connectedPhone && embeddedSignupEnabled && (
          <motion.div variants={itemVariants}>
            <Button
              onClick={launchSignup}
              disabled={!fbReady || connecting}
              className="w-full bg-[#1877F2] hover:bg-[#166FE0] text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-3 shadow-lg shadow-blue-500/20 disabled:opacity-60"
            >
              {connecting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Conectando…
                </>
              ) : !fbReady ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Carregando Facebook…
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                  Conectar com Facebook
                </>
              )}
            </Button>
            <p className="text-[11px] text-muted-foreground text-center mt-3">
              Autorização oficial da Meta • Modo Coexistência • Não interrompe o app no celular
            </p>
          </motion.div>
        )}

        {/* Aviso: Embedded Signup ainda não configurado */}
        {!embeddedSignupEnabled && !alreadyConnected && (
          <motion.div
            variants={itemVariants}
            className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-100 space-y-2"
          >
            <p className="font-semibold">Conexão automática ainda não disponível</p>
            <p className="text-amber-200/80 leading-relaxed">
              Para o botão "Conectar com Facebook" funcionar, você precisa registrar um App na Meta uma única vez e me passar 3 valores (App ID, App Secret, Configuration ID de Coexistência). Enquanto isso, use o preenchimento manual abaixo.
            </p>
          </motion.div>
        )}

        {/* Preenchimento manual (colapsável, fallback) */}
        <motion.div variants={itemVariants} className="pt-2 border-t border-border">
          <button
            onClick={() => setShowManual(!showManual)}
            className="flex items-center justify-between w-full text-left text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
          >
            <span>Preencher manualmente (avançado)</span>
            <motion.div animate={{ rotate: showManual ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown className="w-4 h-4" />
            </motion.div>
          </button>

          <AnimatePresence>
            {showManual && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="accessToken" className="flex items-center gap-2 text-xs">
                      <Key className="w-3.5 h-3.5" /> Access Token
                    </Label>
                    <Input
                      id="accessToken"
                      type="password"
                      value={accessToken}
                      onChange={(e) => onAccessTokenChange(e.target.value)}
                      placeholder="EAAxxxxxxxx..."
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phoneNumberId" className="flex items-center gap-2 text-xs">
                      <Phone className="w-3.5 h-3.5" /> Phone Number ID
                    </Label>
                    <Input
                      id="phoneNumberId"
                      value={phoneNumberId}
                      onChange={(e) => onPhoneNumberIdChange(e.target.value)}
                      placeholder="123456789012345"
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="businessAccountId" className="flex items-center gap-2 text-xs">
                      <Building2 className="w-3.5 h-3.5" /> WABA ID
                    </Label>
                    <Input
                      id="businessAccountId"
                      value={businessAccountId}
                      onChange={(e) => onBusinessAccountIdChange(e.target.value)}
                      placeholder="123456789012345"
                      className="font-mono text-xs"
                    />
                  </div>

                  {/* Webhook info */}
                  <div className="pt-3 border-t border-border space-y-3">
                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-[11px]">Webhook URL</Label>
                      <div className="flex gap-2">
                        <Input value={webhookUrl} readOnly className="font-mono text-[11px] flex-1" />
                        <Button variant="ghost" size="sm" onClick={() => copyToClipboard(webhookUrl, 'url')} className="px-2">
                          {copied === 'url' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-[11px]">Verify Token</Label>
                      <div className="flex gap-2">
                        <Input value={verifyToken} readOnly className="font-mono text-[11px] flex-1" />
                        <Button variant="ghost" size="sm" onClick={() => copyToClipboard(verifyToken, 'token')} className="px-2" disabled={!verifyToken}>
                          {copied === 'token' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* Tutorial */}
      <motion.div variants={itemVariants} className="text-center pt-4">
        <a
          href="https://developers.facebook.com/docs/whatsapp/embedded-signup"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-xs text-primary hover:text-primary/80 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Documentação Meta Embedded Signup (Coexistência)
        </a>
      </motion.div>
    </motion.div>
  );
};
