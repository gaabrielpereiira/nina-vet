import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

// Página de retorno do fluxo de conexão da Zernio (redirect_url).
// A Zernio redireciona pra cá com ?connected=whatsapp&profileId=...&accountId=...&username=...
// depois que o usuário completa o Embedded Signup (incluindo a opção de Coexistência) no lado da Meta.
//
// Se aberta como popup (window.opener existe), avisa a janela original via postMessage e se fecha.
// Se aberta em tela cheia (usuário voltou de um redirect direto), mostra o resultado normalmente.
const WhatsAppCallback: React.FC = () => {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<'saving' | 'success' | 'error'>('saving');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const run = async () => {
      const errorParam = params.get('error') || params.get('error_description');
      if (errorParam) {
        setStatus('error');
        setMessage(errorParam);
        window.opener?.postMessage({ type: 'zernio-whatsapp-error', error: errorParam }, window.location.origin);
        return;
      }

      const connected = params.get('connected');
      const accountId = params.get('accountId');
      const username = params.get('username');

      if (connected !== 'whatsapp' || !accountId) {
        setStatus('error');
        setMessage('Resposta inesperada da Zernio.');
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke('zernio-save-connection', {
          body: { accountId },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        setStatus('success');
        setMessage(data?.displayPhoneNumber || username || 'Conectado');

        window.opener?.postMessage(
          {
            type: 'zernio-whatsapp-connected',
            accountId,
            displayPhoneNumber: data?.displayPhoneNumber || username || null,
            displayName: data?.displayName || null,
          },
          window.location.origin,
        );

        if (window.opener) {
          setTimeout(() => window.close(), 1200);
        }
      } catch (e: any) {
        setStatus('error');
        setMessage(e?.message || 'Falha ao salvar a conexão');
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white p-6">
      <div className="max-w-sm w-full text-center space-y-4">
        {status === 'saving' && (
          <>
            <Loader2 className="w-10 h-10 animate-spin mx-auto text-cyan-400" />
            <p className="text-slate-300">Finalizando conexão com o WhatsApp…</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-400" />
            <p className="text-lg font-semibold">WhatsApp conectado!</p>
            <p className="text-sm text-slate-400 font-mono">{message}</p>
            {!window.opener && (
              <p className="text-xs text-slate-500">Pode fechar esta aba e voltar ao sistema.</p>
            )}
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle className="w-12 h-12 mx-auto text-red-400" />
            <p className="text-lg font-semibold">Não foi possível conectar</p>
            <p className="text-sm text-slate-400">{message}</p>
          </>
        )}
      </div>
    </div>
  );
};

export default WhatsAppCallback;
