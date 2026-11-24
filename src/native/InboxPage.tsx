import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MessageCircle, Search } from 'lucide-react';
import { client } from './client';
import type { InboxFilter, InboxPage as InboxResult, InboxPreview, Message } from './api-client';
import { displayName, listTimeLabel } from './chat-logic';
import { useChatSession } from './ChatSession';
import { Avatar, ChatThread, errorText, messageTypes, Ticks, useVisiblePoll } from './ChatThread';
import { ChatContactPanel } from './ChatContactPanel';
import { useDebounced } from './usePage';
import { dateLabel, ErrorNotice, Loading } from './ui';
import './inbox.css';

const inboxFilters: { value: InboxFilter; label: string }[] = [
  { value: 'all', label: 'Todas' }, { value: 'unread', label: 'Não lidas' }, { value: 'mine', label: 'Minhas' }, { value: 'unassigned', label: 'Na fila' },
];
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

function ConversationRow({ item, selected, draft }: { item: InboxPreview; selected: boolean; draft: string | undefined }) {
  const preview = item.preview || messageTypes[item.message_type || ''] || 'Conversa do WhatsApp';
  const unread = selected ? 0 : item.unread;
  return <li><Link className={'chat-row' + (unread ? ' unread' : '')} to={`/conversas?conversa=${item.id}`} aria-current={selected ? 'true' : undefined}>
    <Avatar name={item.name} />
    <span className="chat-row-main"><span className="chat-row-top"><strong>{displayName(item.name)}</strong>
      <time dateTime={item.last_message_at} title={dateLabel(item.last_message_at, true)}>{listTimeLabel(item.last_message_at)}</time></span>
    <span className="chat-row-bottom">{draft && !selected ? <span className="chat-preview"><em>Rascunho:</em> {draft}</span> :
      <span className="chat-preview">{item.last_direction === 'out' && <Ticks status={item.last_status || ''} />}{preview}</span>}
      {unread > 0 && <span className="chat-count" aria-label={`${unread} não lidas`}>{unread > 99 ? '99+' : unread}</span>}</span>
    <small className={item.assigned_to_me ? 'mine' : item.assignee ? '' : 'free'}>{item.assigned_to_me ? 'Com você' : item.assignee ? 'Com ' + item.assignee : 'Sem responsável'}</small></span>
  </Link></li>;
}

export function InboxPage() {
  const [params] = useSearchParams();
  const requested = params.get('conversa');
  const selected = requested && uuid.test(requested) ? requested : null;
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim());
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<InboxResult | null>(null);
  const [access, setAccess] = useState<{ enabled: boolean; writable: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [panel, setPanel] = useState(false);
  const { sender, outbox, drafts } = useChatSession();
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    window.addEventListener('nina:inbox-changed', refresh);
    return () => window.removeEventListener('nina:inbox-changed', refresh);
  }, [refresh]);
  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const data = await client.inboxConversations(filter, query, offset, signal);
      if (!signal.aborted) { setPage(data); setAccess({ enabled: data.enabled, writable: data.writable }); setError(null); }
    } catch (error) { if (!signal.aborted) setError(errorText(error)); }
  }, [filter, query, offset]);
  useVisiblePoll(load, revision, 4000);
  const confirm = useCallback((messages: Message[]) => { if (selected) sender.confirm(selected, messages); }, [sender, selected]);
  // Em tela estreita a ficha cobre a conversa; não deve cobrir a próxima.
  useEffect(() => { if (window.matchMedia('(max-width:1240px)').matches) setPanel(false); }, [selected]);
  // A lista atualiza antes do menu; quando ela muda, o contador acompanha.
  const signature = page?.data.map(item => `${item.id}:${item.unread}:${item.assigned_to_me}`).join();
  useEffect(() => { if (signature !== undefined) window.dispatchEvent(new Event('nina:unread-changed')); }, [signature]);
  const current = page?.data.find(item => item.id === selected);
  const [contactId, setContactId] = useState<{ conversation: string; contact: string } | null>(null);
  useEffect(() => { if (current) setContactId({ conversation: current.id, contact: current.contact_id }); }, [current]);
  const contact = contactId?.conversation === selected ? contactId?.contact : undefined;
  // Um link direto pode chegar antes da lista, que traz as não lidas. Depois da
  // primeira carga, trocar de filtro ou busca nunca remonta a conversa aberta.
  const ready = access !== null || error !== null;

  if (access?.enabled === false) return <section className="chat-empty"><MessageCircle size={42} aria-hidden="true" />
    <h1>Caixa de entrada em preparação</h1><p>As conversas aparecerão aqui quando a conexão estiver pronta.</p></section>;
  return <div className={'chat' + (selected ? ' has-thread' : '') + (panel && contact ? ' with-panel' : '')}>
    <section className="chat-queue" aria-label="Lista de conversas">
      <div className="chat-queue-head"><h1>Conversas</h1>
        <div className="chat-search"><Search size={18} aria-hidden="true" /><label className="sr-only" htmlFor="chat-search">Buscar por nome ou telefone</label>
          <input id="chat-search" type="search" value={search} maxLength={100} placeholder="Buscar nome ou telefone" onChange={event => { setSearch(event.target.value); setOffset(0); }} /></div>
        <div className="chat-filters" role="group" aria-label="Filtrar conversas">{inboxFilters.map(item => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => { if (item.value !== filter) { setFilter(item.value); setOffset(0); setPage(null); } }}>{item.label}</button>)}</div></div>
      <div className="chat-list">
        {error && <ErrorNotice message={error} retry={refresh} />}
        {!page && !error ? <Loading>Carregando conversas…</Loading> : page?.data.length ? <ul>{page.data.map(item =>
          <ConversationRow key={item.id} item={item} selected={selected === item.id} draft={drafts.current.get(item.id)} />)}</ul> :
          !error ? <p className="empty">{query ? 'Nenhuma conversa com essa busca.' : filter === 'unread' ? 'Tudo em dia por aqui.' : 'Nenhuma conversa encontrada.'}</p> : null}
      </div>
      {(offset > 0 || page?.next_offset != null) && <div className="chat-pages">
        <button className="button secondary" disabled={!offset} onClick={() => { setOffset(Math.max(0, offset - 30)); setPage(null); }}>Anterior</button>
        <button className="button secondary" disabled={page?.next_offset == null} onClick={() => { if (page?.next_offset != null) { setOffset(page.next_offset); setPage(null); } }}>Próxima</button>
      </div>}
    </section>
    {selected && ready ? <ChatThread key={selected} id={selected} writable={access?.writable === true} unread={current?.unread ?? 0} drafts={drafts} outbox={outbox[selected] ?? []}
      send={text => void sender.send(selected, text)} retry={operationId => void sender.retry(selected, operationId)} discard={operationId => sender.discard(selected, operationId)}
      confirm={confirm} panelOpen={panel} togglePanel={() => setPanel(open => !open)} /> :
      <section className="chat-empty"><MessageCircle size={46} aria-hidden="true" /><h2>Escolha uma conversa</h2><p>As mensagens do WhatsApp da clínica aparecem aqui.</p></section>}
    {panel && contact && <ChatContactPanel key={contact} contactId={contact} close={() => setPanel(false)} />}
  </div>;
}
