import { useState } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { CalendarDays, ClipboardList, LogOut, MessageCircle, Sparkles, Users } from 'lucide-react';
import { NativeAuthProvider, useNativeAuth } from './NativeAuth';
import { LoginPage, RecoveryPage, ResetPage } from './AuthPages';
import { AgendaPage, ContactsPage, ProceduresPage } from './Lists';
import { ContactPage } from './ContactPage';
import { WhatsAppPage } from './WhatsAppPage';
import { AiTestsPage } from './AiTestsPage';
import { Brand, ErrorNotice, Loading } from './ui';

function Workspace() {
  const auth = useNativeAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <div className="workspace"><aside className="sidebar"><Link className="brand-link" to="/contatos" aria-label="Nina, página inicial"><Brand /></Link>
    <p className="nav-label">Seu dia a dia</p><nav aria-label="Menu principal">
      <NavLink to="/contatos"><Users size={19} aria-hidden="true" /> Cadastros</NavLink>
      <NavLink to="/agenda"><CalendarDays size={19} aria-hidden="true" /> Agenda</NavLink>
      <NavLink to="/procedimentos"><ClipboardList size={19} aria-hidden="true" /> Procedimentos</NavLink>
      {auth.session?.user.roles.includes('admin') && <NavLink to="/nina/whatsapp"><MessageCircle size={19} aria-hidden="true" /> WhatsApp</NavLink>}
      {auth.session?.user.roles.includes('admin') && <NavLink to="/nina/testes"><Sparkles size={19} aria-hidden="true" /> Testes da Nina</NavLink>}
    </nav><div className="sidebar-footer"><span className="status-dot" /> Clínica Vet+</div></aside>
    <div className="workspace-main"><header className="topbar"><span>Bom cuidado começa com uma boa conversa.</span><div className="account"><div><strong>{auth.session?.user.full_name || 'Equipe Vet+'}</strong><small>{auth.session?.user.email}</small></div>
      <button className="button secondary" disabled={busy} onClick={async () => {
        if (busy) return; setBusy(true); setError(null);
        try { await auth.signOut(); } catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível sair.'); }
        finally { setBusy(false); }
      }}><LogOut size={16} aria-hidden="true" />{busy ? 'Saindo…' : 'Sair'}</button></div></header>
      <main id="main-content" className="content">{error && <ErrorNotice message={error} />}<Outlet /></main>
    </div></div>;
}
function ProtectedWorkspace() {
  const auth = useNativeAuth();
  if (auth.status === 'checking') return <Loading>Conferindo seu acesso…</Loading>;
  if (auth.status === 'unavailable') return <main className="center-page"><ErrorNotice message="Não foi possível conectar à Nina. Tente novamente." retry={auth.refresh} /></main>;
  if (!auth.session) return <Navigate to="/auth" replace />;
  // A new identity/session remounts every patient view; no previous user's data is retained.
  return <Workspace key={auth.session.user.id + ':' + auth.session.expires_at} />;
}
export default function NativeApp({ initialRecoveryToken = '' }: { initialRecoveryToken?: string }) {
  const [token, setToken] = useState(initialRecoveryToken);
  return <NativeAuthProvider><BrowserRouter><a className="skip-link" href="#main-content">Pular para o conteúdo</a><Routes>
    <Route path="/auth" element={<LoginPage />} />
    <Route path="/auth/recuperar" element={<RecoveryPage />} />
    <Route path="/auth/set-password" element={<ResetPage token={token} clearToken={() => setToken('')} />} />
    <Route element={<ProtectedWorkspace />}>
      <Route index element={<Navigate to="/contatos" replace />} />
      <Route path="/contatos" element={<ContactsPage />} />
      <Route path="/contatos/:id" element={<ContactPage />} />
      <Route path="/agenda" element={<AgendaPage />} />
      <Route path="/procedimentos" element={<ProceduresPage />} />
      <Route path="/nina/whatsapp" element={<WhatsAppPage />} />
      <Route path="/nina/testes" element={<AiTestsPage />} />
      <Route path="/contacts" element={<Navigate to="/contatos" replace />} />
      <Route path="/scheduling" element={<Navigate to="/agenda" replace />} />
      <Route path="/dashboard" element={<Navigate to="/contatos" replace />} />
      <Route path="*" element={<section className="panel empty"><h1>Página não encontrada</h1><Link to="/contatos">Voltar aos cadastros</Link></section>} />
    </Route>
  </Routes></BrowserRouter></NativeAuthProvider>;
}
