import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

const SetPassword: React.FC = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 2500);
    return () => clearTimeout(t);
  }, []);

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

  const noSession = !loading && !user && waited;

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

        {(loading || (!user && !waited)) ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : noSession ? (
          <div className="space-y-4 text-sm text-muted-foreground">
            <p>Este link de convite expirou ou já foi usado.</p>
            <p>Peça um novo convite ao administrador ou entre pela tela de login usando "Esqueci a senha".</p>
            <button onClick={() => navigate('/auth')} className="w-full rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground">Ir para o login</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">Conta: <span className="text-foreground">{user?.email}</span></p>
            <input type="password" placeholder="Nova senha (mín. 8 caracteres)" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring" />
            <input type="password" placeholder="Confirme a senha" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring" />
            <button type="submit" disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar senha e entrar
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default SetPassword;
