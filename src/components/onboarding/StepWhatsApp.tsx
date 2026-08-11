import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, ExternalLink, CheckCircle2, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/Button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface StepWhatsAppProps {
  connected: boolean;
  displayPhoneNumber: string | null;
  onConnectedChange: (connected: boolean, displayPhoneNumber: string | null) => void;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1, delayChildren: 0.1 } },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } },
};

export const StepWhatsApp: React.FC<StepWhatsAppProps> = ({ connected, displayPhoneNumber, onConnectedChange }) => {
  const [connecting, setConnecting] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<number | null>(null);

  const cleanupPopupWatchers = useCallback(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (data?.type === 'zernio-whatsapp-connected') {
        setConnecting(false);
        cleanupPopupWatchers();
        onConnectedChange(true, data.displayPhoneNumber || null);
        toast.success(`WhatsApp conectado: ${data.displayPhoneNumber || 'ativo'}`);
      } else if (data?.type === 'zernio-whatsapp-error') {
        setConnecting(false);
        cleanupPopupWatchers();
        toast.error(data.error || 'Falha ao conectar WhatsApp');
      }
    };
    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
      cleanupPopupWatchers();
    };
  }, [onConnectedChange, cleanupPopupWatchers]);

  const launchConnect = useCallback(async () => {
    setConnecting(true);
    try {
      const redirectUrl = `${window.location.origin}/whatsapp/callback`;
      const { data, error } = await supabase.functions.invoke('zernio-connect', {
        body: { redirect_url: redirectUrl },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.authUrl) throw new Error('Zernio não retornou a URL de conexão');

      const popup = window.open(
        data.authUrl,
        'zernio-connect-whatsapp',
        'width=640,height=760,noopener=no,noreferrer=no',
      );
      popupRef.current = popup;

      if (!popup) {
        // Popup bloqueado pelo navegador: navega a própria aba.
        window.location.href = data.authUrl;
        return;
      }

      pollRef.current = window.setInterval(() => {
        if (popup.closed) {
          cleanupPopupWatchers();
          setConnecting(false);
        }
      }, 800);
    } catch (e: any) {
      console.error('[StepWhatsApp] Erro ao iniciar conexão:', e);
      toast.error(e?.message || 'Falha ao iniciar conexão com a Zernio');
      setConnecting(false);
    }
  }, [cleanupPopupWatchers]);

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
          Conecte via Zernio em modo <strong>Coexistência</strong> — você continua usando o app do WhatsApp no
          celular normalmente, e a Nina responde em paralelo.
        </p>
      </motion.div>

      <div className="max-w-md mx-auto space-y-6">
        {connected ? (
          <motion.div
            variants={itemVariants}
            className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-3"
          >
            <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-emerald-100">WhatsApp conectado</p>
              <p className="text-xs text-emerald-300/80 font-mono">{displayPhoneNumber}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={launchConnect} disabled={connecting}>
              Trocar
            </Button>
          </motion.div>
        ) : (
          <motion.div variants={itemVariants}>
            <Button
              onClick={launchConnect}
              disabled={connecting}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-3 shadow-lg shadow-emerald-500/20 disabled:opacity-60"
            >
              {connecting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Aguardando conexão…
                </>
              ) : (
                <>
                  <MessageSquare className="w-5 h-5" />
                  Conectar com Zernio
                </>
              )}
            </Button>
            <p className="text-[11px] text-muted-foreground text-center mt-3">
              Você será levado ao Embedded Signup da Meta • Escolha "Conectar app do WhatsApp Business
              existente" para ativar a Coexistência
            </p>
          </motion.div>
        )}
      </div>

      <motion.div variants={itemVariants} className="text-center pt-4">
        <a
          href="https://docs.zernio.com/platforms/whatsapp/connection"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-xs text-primary hover:text-primary/80 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Documentação Zernio — Conexão do WhatsApp (Coexistência)
        </a>
      </motion.div>
    </motion.div>
  );
};
