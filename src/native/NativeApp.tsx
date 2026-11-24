import { useEffect, useState } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { CalendarDays, ClipboardList, LogOut, MessageCircle, Settings, Sparkles, Users } from 'lucide-react';
import { NativeAuthProvider, useNativeAuth } from './NativeAuth';
import { LoginPage, RecoveryPage, ResetPage } from './AuthPages';
import { AgendaPage, ContactsPage, ProceduresPage } from './Lists';
import { ContactPage } from './ContactPage';
import { WhatsAppPage } from './WhatsAppPage';
import { InboxPage } from './InboxPage';
import { ChatSessionProvider } from './ChatSession';
import { AiTestsPage } from './AiTestsPage';
import { AgentSettingsPage } from './AgentSettingsPage';
import { client } from './client';
import { Brand, ErrorNotice, Loading } from './ui';

function useUnreadConversations() {
  const [total, setTotal] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') {
        try { const data = await client.inboxUnread(controller.signal); if (!controller.signal.aborted) setTotal(data.conversations); }
        catch { /* O contador volta na próxima leitura. */ }
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 15000);
    };
    void refresh();
    window.addEventListener('nina:inbox-changed', refresh);
    window.addEventListener('nina:unread-changed', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener('nina:inbox-changed', refresh);
      window.removeEventListener('nina:unread-changed', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  useEffect(() => {
    const title = document.title.replace(/^\(\d+\+?\) /, '');
    document.title = total ? `(${total > 99 ? '99+' : total}) ${title}` : title;
    return () => { document.title = title; };
  }, [total]);
  return total;
}
function Workspace() {
  const auth = useNativeAuth();
  const unread = useUnreadConversations();
  const location = useLocation();
  const chat = location.pathname === '/conversas';
  const chatOpen = chat && new URLSearchParams(location.search).has('conversa');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <div className={'workspace' + (chat ? ' chat-route' : '') + (chatOpen ? ' chat-open' : '')}><aside className="sidebar"><Link className="brand-link" to="/contatos" aria-label="Nina, página inicial"><Brand /></Link>
    <p className="nav-label">Seu dia a dia</p><nav aria-label="Menu principal">
      <NavLink to="/conversas"><MessageCircle size={19} aria-hidden="true" /> Conversas{unread > 0 && <span className="nav-count" aria-label={`${unread} conversas não lidas`}>{unread > 99 ? '99+' : unread}</span>}</NavLink>
      <NavLink to="/contatos"><Users size={19} aria-hidden="true" /> Cadastros</NavLink>
      <NavLink to="/agenda"><CalendarDays size={19} aria-hidden="true" /> Agenda</NavLink>
      <NavLink to="/procedimentos"><ClipboardList size={19} aria-hidden="true" /> Procedimentos</NavLink>
      {auth.session?.user.roles.includes('admin') && <NavLink to="/nina/whatsapp"><MessageCircle size={19} aria-hidden="true" /> Conexão WhatsApp</NavLink>}
      {auth.session?.user.roles.includes('admin') && <NavLink to="/nina/testes"><Sparkles size={19} aria-hidden="true" /> Testes da Nina</NavLink>}
      {auth.session?.user.roles.includes('admin') && <NavLink to="/nina/configuracoes"><Settings size={19} aria-hidden="true" /> Configurações da Nina</NavLink>}
    </nav><div className="sidebar-footer"><span className="status-dot" /> Clínica Vet+</div></aside>
    <div className="workspace-main"><header className="topbar"><span>Bom cuidado começa com uma boa conversa.</span><div className="account"><div><strong>{auth.session?.user.full_name || 'Equipe Vet+'}</strong><small>{auth.session?.user.email}</small></div>
      <button className="button secondary" disabled={busy} onClick={async () => {
        if (busy) return; setBusy(true); setError(null);
        try { await auth.signOut(); } catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível sair.'); }
        finally { setBusy(false); }
      }}><LogOut size={16} aria-hidden="true" />{busy ? 'Saindo…' : 'Sair'}</button></div></header>
      <main id="main-content" className="content">{error && <ErrorNotice message={error} />}<ChatSessionProvider><Outlet /></ChatSessionProvider></main>
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
      <Route path="/conversas" element={<InboxPage />} />
      <Route path="/contatos" element={<ContactsPage />} />
      <Route path="/contatos/:id" element={<ContactPage />} />
      <Route path="/agenda" element={<AgendaPage />} />
      <Route path="/procedimentos" element={<ProceduresPage />} />
      <Route path="/nina/whatsapp" element={<WhatsAppPage />} />
      <Route path="/nina/testes" element={<AiTestsPage />} />
      <Route path="/nina/configuracoes" element={<AgentSettingsPage />} />
      <Route path="/contacts" element={<Navigate to="/contatos" replace />} />
      <Route path="/scheduling" element={<Navigate to="/agenda" replace />} />
      <Route path="/dashboard" element={<Navigate to="/contatos" replace />} />
      <Route path="*" element={<section className="panel empty"><h1>Página não encontrada</h1><Link to="/contatos">Voltar aos cadastros</Link></section>} />
    </Route>
  </Routes></BrowserRouter></NativeAuthProvider>;
}
