import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

const readLinkError = () => {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, '') + '&' + window.location.search.replace(/^\?/, ''));
  return params.get('error_code') || params.get('error');
};

const SetPassword: React.FC = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [waited, setWaited] = useState(false);
  const [linkError] = useState(readLinkError);
  const [resendEmail, setResendEmail] = useState('');
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (linkError) { setWaited(true); return; }
    // Dá tempo para conexões lentas lerem a sessão do link
    const t = setTimeout(() => setWaited(true), 12000);
    return () => clearTimeout(t);
  }, [linkError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return toast.error('A senha precisa ter pelo menos 8 caracteres.');
    if (password !== confirm) return toast.error('As senhas não conferem.');
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setSaving(false);
      return toast.error(`Não foi possível salvar a senha: ${error.message}`);
    }
    if (user) {
      await supabase.from('team_members').update({ status: 'active', last_active: new Date().toISOString() }).eq('user_id', user.id);
    }
    toast.success('Senha criada! Bem-vindo(a) à equipe.');
    navigate('/dashboard', { replace: true });
  };

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = resendEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast.error('Digite um email válido.');
    setResending(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/set-password`,
    });
    setResending(false);
    if (error) return toast.error(`Não foi possível reenviar: ${error.message}`);
    toast.success('Link enviado! Confira sua caixa de entrada e o spam.');
  };

  const noSession = !user && (linkError || (!loading && waited));

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-xl bg-primary/15 p-3 text-primary"><Lock className="h-5 w-5" /></div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Crie sua senha</h1>
            <p className="text-sm text-muted-foreground">Finalize seu acesso ao sistema da Vet+.</p>
          </div>
        </div>

        {user ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">Conta: <span className="text-foreground">{user.email}</span></p>
            <input type="password" placeholder="Nova senha (mín. 8 caracteres)" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring" />
            <input type="password" placeholder="Confirme a senha" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring" />
            <button type="submit" disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar senha e entrar
            </button>
          </form>
        ) : noSession ? (
          <div className="space-y-4 text-sm text-muted-foreground">
            <p>Este link expirou ou já foi usado. Digite seu email para receber um link novo:</p>
            <form onSubmit={handleResend} className="space-y-3">
              <input type="email" placeholder="seu@email.com" value={resendEmail} onChange={(e) => setResendEmail(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring" />
              <button type="submit" disabled={resending}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60">
                {resending && <Loader2 className="h-4 w-4 animate-spin" />} Reenviar link de acesso
              </button>
            </form>
            <button onClick={() => navigate('/auth')} className="w-full rounded-lg border border-border px-4 py-2 font-medium text-foreground">Ir para o login</button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            Validando seu link...
          </div>
        )}
      </div>
    </div>
  );
};

export default SetPassword;
