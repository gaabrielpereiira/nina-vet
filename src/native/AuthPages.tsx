import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { client } from './client';
import { useNativeAuth } from './NativeAuth';
import { Brand, ErrorNotice, Loading } from './ui';

export function LoginPage() {
  const auth = useNativeAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (auth.status === 'authenticated') return <Navigate to="/contatos" replace />;
  return <div className="auth-page"><section className="auth-story"><Brand /><div><p className="eyebrow">Mais perto de cada cuidado</p>
    <h1>O dia a dia da clínica,<br />em um só lugar.</h1><p>Cadastros, agenda e o histórico de cada atendimento, sempre à mão.</p></div><small>Clínica Vet+</small></section>
    <main id="main-content" className="auth-form-area"><div className="auth-card"><div className="mobile-brand"><Brand /></div><p className="eyebrow">Bem-vindo de volta</p>
      <h2>Entre na Nina</h2><p className="muted">Use o e-mail e a senha da sua conta.</p>
      {auth.status === 'checking' ? <Loading>Conferindo seu acesso…</Loading> : auth.status === 'unavailable' ?
        <ErrorNotice message="Não foi possível conectar à Nina. Tente novamente." retry={auth.refresh} /> :
        <form onSubmit={async (event: FormEvent) => {
          event.preventDefault(); if (busy) return; setBusy(true); setError(null);
          try { await auth.signIn(email, password); setPassword(''); }
          catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível entrar.'); }
          finally { setBusy(false); }
        }}>
          <label htmlFor="login-email">E-mail</label><input id="login-email" type="email" autoComplete="username" required maxLength={320}
            value={email} onChange={e => setEmail(e.target.value)} disabled={busy} />
          <label htmlFor="login-password">Senha</label><input id="login-password" type="password" autoComplete="current-password" required
            value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />
          <Link className="forgot-link" to="/auth/recuperar">Esqueci minha senha</Link>
          {error && <ErrorNotice message={error} />}
          <button className="button primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        </form>}
      <p className="auth-help">Precisa de acesso? Fale com a administração da clínica.</p>
    </div></main></div>;
}

export function RecoveryPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <main id="main-content" className="center-page"><section className="auth-card"><Brand /><h1>Recuperar acesso</h1>
    <p className="muted">Informe o e-mail da sua conta para receber um link de redefinição de senha.</p>
    {sent ? <p className="success" role="status">Se houver uma conta ativa com esse e-mail, você receberá um link. Confira também o spam.</p> :
      <form onSubmit={async event => {
        event.preventDefault(); if (busy) return; setBusy(true); setError(null);
        try { await client.forgot(email); setSent(true); } catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível enviar o link.'); }
        finally { setBusy(false); }
      }}><label htmlFor="recover-email">E-mail</label><input id="recover-email" type="email" autoComplete="username" required maxLength={320}
        value={email} onChange={e => setEmail(e.target.value)} disabled={busy} />
        {error && <ErrorNotice message={error} />}<button className="button primary" disabled={busy}>{busy ? 'Enviando…' : 'Enviar link'}</button>
      </form>}
    <Link className="back-link" to="/auth">Voltar para o login</Link>
  </section></main>;
}

export function ResetPage({ token, clearToken }: { token: string; clearToken: () => void }) {
  const auth = useNativeAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <main id="main-content" className="center-page"><section className="auth-card"><Brand /><h1>Defina sua nova senha</h1>
    {saved ? <p className="success" role="status">Senha atualizada. Entre novamente com sua nova senha.</p> : !token ?
      <p className="notice" role="alert">Abra o link recebido por e-mail para continuar. Se ele expirou ou já foi usado, solicite um novo.</p> :
      <form onSubmit={async event => {
        event.preventDefault(); if (busy) return; setError(null);
        if (password !== confirm) { setError('As senhas não conferem.'); return; }
        if (password.length < 12 || new TextEncoder().encode(password).length > 1024) { setError('Use uma senha com pelo menos 12 caracteres e até 1024 bytes.'); return; }
        setBusy(true);
        try { await client.reset(token, password); setPassword(''); setConfirm(''); setSaved(true); clearToken(); auth.forgetSession(); }
        catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível salvar.'); }
        finally { setBusy(false); }
      }}>
        <p className="muted">Use pelo menos 12 caracteres.</p>
        <label htmlFor="new-password">Nova senha</label><input id="new-password" type="password" autoComplete="new-password" minLength={12} required
          value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />
        <label htmlFor="confirm-password">Confirme a senha</label><input id="confirm-password" type="password" autoComplete="new-password" minLength={12} required
          value={confirm} onChange={e => setConfirm(e.target.value)} disabled={busy} />
        {error && <ErrorNotice message={error} />}<button className="button primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar nova senha'}</button>
      </form>}
    {!saved && <Link className="back-link" to="/auth/recuperar">Solicitar outro link</Link>}
    <Link className="back-link" to="/auth">Voltar para o login</Link>
  </section></main>;
}
