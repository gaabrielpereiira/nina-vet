import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, MessageCircle, RefreshCw, Search, Send, UserCheck } from 'lucide-react';
import { client } from './client';
import { ClientError, type InboxCursor, type InboxFilter, type InboxPage as InboxResult, type InboxSendStatus, type InboxThread as Thread, type Message } from './api-client';
import { Attachment } from './MessageHistory';
import { dateLabel, ErrorNotice, Loading } from './ui';
import './inbox.css';

const inboxFilters: { value: InboxFilter; label: string }[] = [
  { value: 'all', label: 'Todas' }, { value: 'unassigned', label: 'Sem responsável' }, { value: 'mine', label: 'Minhas' },
];
const messageTypes: Record<string,string> = { audio:'Áudio', image:'Imagem', video:'Vídeo', document:'Documento' };
const authors: Record<string,string> = { user:'Tutor', human:'Equipe', nina:'Nina', external:'WhatsApp' };
const delivery: Record<string,string> = { sent:'Enviada', delivered:'Entregue', read:'Lida', failed:'Falha na entrega' };
const sendStatus: Record<InboxSendStatus,string> = {
  accepted:'Mensagem enviada. A entrega aparece no histórico.',
  rejected:'O WhatsApp recusou o envio. Confira o canal antes de tentar de novo.',
  uncertain:'A confirmação do envio não chegou. Confira a conversa antes de repetir a mensagem.',
  sending:'Envio registrado. Confira o histórico para acompanhar a confirmação.',
};
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const timeFormat = new Intl.DateTimeFormat('pt-BR',{ hour:'2-digit',minute:'2-digit' });
const timeLabel = (value: string) => Number.isFinite(Date.parse(value)) ? timeFormat.format(new Date(value)) : '';
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível carregar a conversa.';

function useVisiblePoll(load: (signal: AbortSignal) => Promise<void>, active: boolean, revision: number) {
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    const refresh = async () => {
      if (busy || controller.signal.aborted || document.visibilityState === 'hidden') return;
      clearTimeout(timer);
      busy = true;
      try { await load(controller.signal); }
      finally {
        busy = false;
        if (!controller.signal.aborted) timer = setTimeout(refresh, 8000);
      }
    };
    void refresh();
    document.addEventListener('visibilitychange',refresh);
    return () => {
      controller.abort(); clearTimeout(timer);
      document.removeEventListener('visibilitychange',refresh);
    };
  }, [load, active, revision]);
}

function Initials({ name }: { name: string }) {
  const initials = name.trim().split(/\s+/).slice(0,2).map(part=>Array.from(part)[0]).join('').toUpperCase();
  return <span className="inbox-avatar" aria-hidden="true">{initials || 'WA'}</span>;
}

function ThreadMessage({ message }: { message: Message }) {
  const inbound = message.from_type === 'user';
  return <li className={'inbox-bubble' + (inbound ? ' inbound' : ' outbound')}>
    <strong>{authors[message.from_type] || 'WhatsApp'}</strong>
    {message.content ? <p className="preserve">{message.content}</p> : !message.attachments?.length ? <p>{messageTypes[message.type] || 'Mensagem'}</p> : null}
    {message.attachments?.map(file=><Attachment key={`${file.position}:${file.id}`} file={file} />)}
    <footer><time dateTime={message.sent_at} title={dateLabel(message.sent_at,true)}>{timeLabel(message.sent_at)}</time>
      {!inbound && delivery[message.status] && <span>{delivery[message.status]}</span>}</footer>
  </li>;
}

function ConversationPane({ id, writable, changed }: { id: string; writable: boolean; changed: () => void }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [history, setHistory] = useState<{ data: Message[]; next: InboxCursor | null }>();
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'send' | 'owner' | 'history' | null>(null);
  const operation = useRef<{ id: string; text: string }>();
  const request = useRef<AbortController>();
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const previousHeight = useRef<number>();
  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const data = await client.inboxThread(id,null,signal);
      if (!signal.aborted) {
        setThread(old => {
          if (!old || !data.data.length || !data.next) return data;
          const ids = new Set(data.data.map(message=>message.id));
          const edge = data.data.at(-1)!;
          const retained = old.data.filter(message=>!ids.has(message.id) &&
            (message.sent_at < edge.sent_at || (message.sent_at === edge.sent_at && message.id < edge.id)));
          return retained.length ? { ...data, data:[...data.data,...retained], next:old.next } : data;
        });
        setLoadError(null);
      }
    } catch (error) { if (!signal.aborted) setLoadError(errorText(error)); }
  }, [id]);
  useVisiblePoll(load,true,revision);
  useEffect(() => () => request.current?.abort(), []);
  const current = thread?.data ?? [];
  const currentIds = new Set(current.map(message=>message.id));
  const messages = [...current,...(history?.data ?? []).filter(message=>!currentIds.has(message.id))].reverse();
  const newestId = current[0]?.id;
  const olderId = history?.data.at(-1)?.id;
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    if (previousHeight.current !== undefined) {
      box.scrollTop += box.scrollHeight - previousHeight.current;
      previousHeight.current = undefined;
    } else if (pinned.current) box.scrollTop = box.scrollHeight;
  }, [newestId, olderId]);

  async function run(kind: NonNullable<typeof busy>, action: (signal: AbortSignal) => Promise<void>) {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(kind); setActionError(null);
    try { await action(controller.signal); }
    catch (error) { if (!controller.signal.aborted) setActionError(errorText(error)); }
    finally { request.current = undefined; if (!controller.signal.aborted) setBusy(null); }
  }
  const cursor = history ? history.next : thread?.next;
  const older = () => {
    if (!cursor) return;
    void run('history',async signal => {
      const page = await client.inboxThread(id,cursor,signal);
      if (signal.aborted) return;
      previousHeight.current = scroller.current?.scrollHeight;
      setHistory(old=>({ data:[...(old?.data ?? []),...page.data],next:page.next }));
    });
  };
  const assign = (action: 'assume' | 'release') => void run('owner',async signal=>{
    await client.assignInbox(id,action,signal);
    if (signal.aborted) return;
    setNotice(action === 'assume' ? 'Você assumiu esta conversa.' : 'Conversa devolvida à fila.');
    setRevision(n=>n+1); changed();
  });
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    void run('send',async signal=>{
      if (operation.current?.text !== text) operation.current = { id:crypto.randomUUID(),text };
      setNotice('');
      try {
        const result = await client.replyInbox(id,operation.current.id,text,signal);
        if (signal.aborted) return;
        setNotice(sendStatus[result.status]);
        if (result.status === 'accepted') { setDraft(''); operation.current = undefined; pinned.current = true; }
        else if (result.status === 'rejected') operation.current = undefined;
      } catch (error) {
        if (signal.aborted) return;
        if (!(error instanceof ClientError) || error.status === 0 || error.status >= 500) setNotice(sendStatus.uncertain);
        else throw error;
      } finally {
        if (!signal.aborted) { setRevision(n=>n+1); changed(); }
      }
    });
  };
  if (!thread) return <section className="inbox-thread">
    <div className="inbox-thread-top"><Link className="inbox-back button secondary" to="/conversas"><ArrowLeft size={16} aria-hidden="true"/> Voltar às conversas</Link></div>
    {loadError ? <ErrorNotice message={loadError} retry={()=>setRevision(n=>n+1)} /> : <Loading>Carregando conversa…</Loading>}
  </section>;
  const contact = thread.conversation;
  const canAssume = writable && !contact.assignee && !contact.blocked;
  const windowOpen = !!contact.reply_until && Date.parse(contact.reply_until)>Date.now();
  const canReply = writable && contact.assigned_to_me && !contact.blocked && windowOpen;
  const composerHint = !writable ? 'Modo de consulta. O envio pela Nina ainda não está liberado.' : contact.blocked
    ? 'Este contato está bloqueado.' : !contact.assigned_to_me
      ? (contact.assignee ? `${contact.assignee} está atendendo.` : 'Assuma a conversa para responder.') : !windowOpen
        ? 'A janela de resposta encerrou. Aguarde uma nova mensagem do tutor.' : null;
  return <section className="inbox-thread" aria-label="Conversa selecionada">
    <header className="inbox-thread-top">
      <Link className="inbox-back button secondary" to="/conversas" aria-label="Voltar às conversas"><ArrowLeft size={18} aria-hidden="true"/></Link>
      <Initials name={contact.name} />
      <div className="inbox-person"><h2>{contact.name}</h2><p>{contact.assigned_to_me ? 'Com você' : contact.assignee || 'Sem responsável'}</p></div>
      <Link className="inbox-profile" to={`/contatos/${contact.contact_id}`}>Ver cadastro</Link>
      {canAssume && <button className="button primary" disabled={busy!==null} onClick={()=>assign('assume')}><UserCheck size={16} aria-hidden="true"/> Assumir</button>}
      {writable && contact.assigned_to_me && <button className="button secondary" disabled={busy!==null} onClick={()=>assign('release')}>Devolver à fila</button>}
    </header>
    <div className="inbox-scroll" ref={scroller} onScroll={event=>{
      const box = event.currentTarget; pinned.current = box.scrollHeight-box.scrollTop-box.clientHeight<96;
    }}>
      {loadError && <ErrorNotice message={loadError} retry={()=>setRevision(n=>n+1)} />}
      {cursor && <button className="button secondary inbox-older" disabled={busy!==null} onClick={older}>{busy==='history'?'Carregando…':'Mensagens anteriores'}</button>}
      {messages.length ? <ol className="inbox-messages" aria-label="Histórico da conversa">{messages.map(message=><ThreadMessage key={message.id} message={message}/>)}</ol>
        : <p className="empty">Nenhuma mensagem nesta conversa.</p>}
    </div>
    <div className="inbox-bottom">
      {notice && <p className="inbox-feedback" role="status">{notice}</p>}
      {actionError && <ErrorNotice message={actionError} />}
      {canReply ? <form className="inbox-compose" onSubmit={event=>{event.preventDefault();send();}}>
        <label className="sr-only" htmlFor="inbox-draft">Mensagem para {contact.name}</label>
        <textarea id="inbox-draft" rows={2} placeholder="Escreva uma mensagem…" maxLength={1000} value={draft}
          disabled={busy==='send'} onChange={event=>setDraft(event.target.value)}/>
        <button className="button primary" type="submit" disabled={!draft.trim()||busy!==null}><Send size={17} aria-hidden="true"/>{busy==='send'?'Enviando…':'Enviar'}</button>
      </form> : <p className="inbox-hint">{composerHint}</p>}
    </div>
  </section>;
}

export function InboxPage() {
  const [params] = useSearchParams();
  const requested = params.get('conversa');
  const selected = requested && uuid.test(requested) ? requested : null;
  const [filter,setFilter] = useState<InboxFilter>('all');
  const [search,setSearch] = useState('');
  const [query,setQuery] = useState('');
  const [offset,setOffset] = useState(0);
  const [page,setPage] = useState<InboxResult | null>(null);
  const [error,setError] = useState<string | null>(null);
  const [revision,setRevision] = useState(0);
  const refresh = useCallback(()=>setRevision(n=>n+1),[]);
  const load = useCallback(async (signal: AbortSignal)=>{
    try {
      const data = await client.inboxConversations(filter,query,offset,signal);
      if (!signal.aborted) { setPage(data);setError(null); }
    } catch (error) { if (!signal.aborted) setError(errorText(error)); }
  },[filter,query,offset]);
  useVisiblePoll(load,true,revision);
  const changeFilter = (value: InboxFilter) => {
    if (value===filter) return;
    setFilter(value);setOffset(0);setPage(null);
  };
  return <div className="inbox-page">
    <header className="inbox-page-title"><div><p className="eyebrow">Atendimento · WhatsApp</p><h1>Conversas</h1></div>
      <button className="button secondary" onClick={refresh}><RefreshCw size={16} aria-hidden="true"/> Atualizar</button></header>
    {page?.enabled===false ? <section className="panel empty"><MessageCircle size={34} aria-hidden="true"/>
      <h2>Caixa de entrada em preparação</h2><p>As conversas aparecerão aqui quando a conexão estiver pronta.</p></section> :
      <div className={'inbox-layout panel'+(selected?' has-thread':'')}>
        <section className="inbox-queue" aria-label="Fila de conversas">
          <form className="inbox-search" onSubmit={event=>{event.preventDefault();const q=search.trim();if(q!==query||offset){setQuery(q);setOffset(0);setPage(null);}else refresh();}}>
            <label className="sr-only" htmlFor="inbox-search">Buscar por nome ou telefone</label>
            <input id="inbox-search" type="search" value={search} maxLength={100} onChange={event=>setSearch(event.target.value)} placeholder="Nome ou telefone"/>
            <button className="button secondary" type="submit" aria-label="Buscar conversas"><Search size={18} aria-hidden="true"/></button>
          </form>
          <div className="inbox-filters" role="group" aria-label="Filtrar conversas">{inboxFilters.map(item=><button key={item.value} type="button" aria-pressed={filter===item.value} onClick={()=>changeFilter(item.value)}>{item.label}</button>)}</div>
          <div className="inbox-list">
            {error && <ErrorNotice message={error} retry={refresh}/>}
            {!page && !error ? <Loading>Carregando conversas…</Loading> : page?.data.length ? <ul>{page.data.map(item=><li key={item.id}>
              <Link to={`/conversas?conversa=${item.id}`} aria-current={selected===item.id?'true':undefined}>
                <Initials name={item.name}/><div className="inbox-list-copy"><strong>{item.name}</strong><span>{item.preview || messageTypes[item.message_type || ''] || 'Conversa do WhatsApp'}</span>
                  <small>{item.assigned_to_me?'Com você':item.assignee||'Sem responsável'}</small></div>
                <time dateTime={item.last_message_at} title={dateLabel(item.last_message_at,true)}>{new Date(item.last_message_at).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}</time>
              </Link></li>)}</ul> : !error ? <p className="empty">Nenhuma conversa encontrada.</p> : null}
          </div>
          {(offset>0 || page?.next_offset!=null) && <div className="inbox-pages">
            <button className="button secondary" disabled={!offset} onClick={()=>{setOffset(Math.max(0,offset-30));setPage(null);}}>Anterior</button>
            <button className="button secondary" disabled={page?.next_offset==null} onClick={()=>{if(page?.next_offset!=null){setOffset(page.next_offset);setPage(null);}}}>Próxima</button>
          </div>}
        </section>
        {selected ? <ConversationPane key={selected} id={selected} writable={page?.writable===true} changed={refresh}/> :
          <section className="inbox-placeholder"><MessageCircle size={42} aria-hidden="true"/><h2>Abra uma conversa</h2><p>Selecione um contato na lista para ver as mensagens.</p></section>}
      </div>}
  </div>;
}
