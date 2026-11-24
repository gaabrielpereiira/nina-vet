import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowDown, ArrowLeft, Check, CheckCheck, Clock, Info, RotateCw, Send, Smile, UserCheck, X } from 'lucide-react';
import { client } from './client';
import type { Message } from './api-client';
import { appendOlder, avatarTone, buildTimeline, composerState, displayName, firstUnreadId, mergeThread, richText, timeLabel, type LoadedThread, type OutboxItem } from './chat-logic';
import { inboxChanged } from './ChatSession';
import { Attachment } from './MessageHistory';
import { dateLabel, ErrorNotice, Loading } from './ui';

export const messageTypes: Record<string, string> = { audio: 'Áudio', image: 'Imagem', video: 'Vídeo', document: 'Documento' };
const teamAuthors: Record<string, string> = { human: 'Equipe', nina: 'Nina', external: 'WhatsApp' };
const deliveryLabels: Record<string, string> = { sent: 'Enviada', delivered: 'Entregue', read: 'Lida', failed: 'Falha na entrega', processing: 'Processando' };
const emojis = '😊 😀 😂 😍 🥰 😉 🙂 😢 😅 🤔 👍 👏 🙏 💪 ❤️ 💚 🐾 🐶 🐱 🐰 🦜 🐢 🦴 🩺 💊 💉 🏥 🚑 📅 ⏰ 📍 📞 📎 ✅ ❗ ⭐ 🎉 ☀️ 🌙 👋'.split(' ');
export const errorText = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível carregar a conversa.';

export function useVisiblePoll(load: (signal: AbortSignal) => Promise<void>, revision: number, interval: number) {
  useEffect(() => {
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
        if (!controller.signal.aborted) timer = setTimeout(refresh, interval);
      }
    };
    void refresh();
    document.addEventListener('visibilitychange', refresh);
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [load, revision, interval]);
}

export function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase();
  return <span className={`chat-avatar tone-${avatarTone(name)}` + (large ? ' large' : '')} aria-hidden="true">{/\p{L}/u.test(initials) ? initials : 'WA'}</span>;
}
export function Ticks({ status, title }: { status: string; title?: string }) {
  const label = title ?? deliveryLabels[status];
  if (!label) return null;
  const icon = status === 'failed' ? <AlertCircle size={14} /> : status === 'processing' ? <Clock size={13} /> :
    status === 'sent' ? <Check size={15} /> : <CheckCheck size={15} />;
  return <span className={'chat-ticks ' + status} role="img" aria-label={label} title={label}>{icon}</span>;
}
function RichText({ text }: { text: string }) {
  return <p className="chat-text">{richText(text).map((token, index) => token.kind === 'link' ?
    <a key={index} href={token.value} target="_blank" rel="noreferrer noopener">{token.value}</a> : token.kind === 'bold' ? <strong key={index}>{token.value}</strong> :
      token.kind === 'italic' ? <em key={index}>{token.value}</em> : token.kind === 'strike' ? <s key={index}>{token.value}</s> :
        token.kind === 'code' ? <code key={index}>{token.value}</code> : token.value)}</p>;
}
function Bubble({ message, first }: { message: Message; first: boolean }) {
  const inbound = message.from_type === 'user';
  return <li className={'chat-bubble ' + (inbound ? 'in' : 'out') + (first ? ' first' : '')}>
    <span className="sr-only">{inbound ? 'Tutor' : message.author || teamAuthors[message.from_type] || 'Equipe'}:</span>
    {!inbound && first && <span className="chat-author" aria-hidden="true">{message.author || teamAuthors[message.from_type] || 'Equipe'}</span>}
    {message.attachments?.map(file => <Attachment key={`${file.position}:${file.id}`} file={file} />)}
    {message.content ? <RichText text={message.content} /> : !message.attachments?.length ? <p className="chat-text muted">{messageTypes[message.type] || 'Mensagem'}</p> : null}
    <span className="chat-meta"><time dateTime={message.sent_at} title={dateLabel(message.sent_at, true)}>{timeLabel(message.sent_at)}</time>{!inbound && <Ticks status={message.status} />}</span>
  </li>;
}
function OutboxBubble({ item, retry, discard }: { item: OutboxItem; retry: () => void; discard: () => void }) {
  const waiting = item.status === 'queued' || item.status === 'sending';
  const problem = item.status === 'failed' ? item.error || 'Não foi possível enviar.' :
    item.status === 'rejected' ? 'O WhatsApp recusou esta mensagem.' :
      item.status === 'uncertain' ? 'Sem confirmação de envio. Confira no WhatsApp antes de repetir.' : null;
  return <li className={'chat-bubble out first' + (problem ? ' problem' : '')}>
    <RichText text={item.text} />
    <span className="chat-meta"><time dateTime={item.createdAt}>{timeLabel(item.createdAt)}</time>
      {waiting ? <span className="chat-ticks" role="img" aria-label="Enviando" title="Enviando"><Clock size={13} /></span> : <Ticks status={problem ? 'failed' : 'sent'} title={item.status === 'uncertain' ? 'Sem confirmação' : problem ? 'Não enviada' : undefined} />}</span>
    {problem && <div className="chat-problem" role="alert"><span>{problem}</span>
      {item.status !== 'uncertain' && <button type="button" onClick={retry}><RotateCw size={13} aria-hidden="true" /> Tentar de novo</button>}
      <button type="button" onClick={discard}><X size={13} aria-hidden="true" /> Descartar</button></div>}
  </li>;
}

function Composer({ name, drafts, id, hint, busy, send }: { name: string; drafts: MutableRefObject<Map<string, string>>; id: string;
  hint: string | null; busy: boolean; send: (text: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState(() => drafts.current.get(id) ?? '');
  const [picker, setPicker] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLFormElement>(null);
  const change = (value: string) => { setDraft(value); if (value) drafts.current.set(id, value); else drafts.current.delete(id); };
  useLayoutEffect(() => {
    const area = field.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = Math.min(area.scrollHeight + 2, 148) + 'px';
  }, [draft]);
  useEffect(() => { if (window.matchMedia('(pointer: fine)').matches) field.current?.focus(); }, [id]);
  useEffect(() => {
    if (!picker) return;
    const close = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setPicker(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [picker]);
  const submit = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (await send(text)) { change(''); setPicker(false); field.current?.focus(); }
  };
  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') setPicker(false);
    // No teclado do celular, Enter continua quebrando a linha.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || window.matchMedia('(pointer: coarse)').matches) return;
    event.preventDefault();
    void submit();
  };
  const insert = (emoji: string) => {
    const area = field.current;
    const start = area?.selectionStart ?? draft.length, end = area?.selectionEnd ?? draft.length;
    if (draft.length + emoji.length > 4000) return;
    change(draft.slice(0, start) + emoji + draft.slice(end));
    requestAnimationFrame(() => { area?.focus(); area?.setSelectionRange(start + emoji.length, start + emoji.length); });
  };
  return <form ref={box} className="chat-composer" onSubmit={event => { event.preventDefault(); void submit(); }}>
    {picker && <div className="chat-emojis" role="group" aria-label="Emojis">{emojis.map(emoji => <button key={emoji} type="button" onClick={() => insert(emoji)}>{emoji}</button>)}</div>}
    {hint && <p className="chat-composer-hint">{hint}</p>}
    <div className="chat-composer-row">
      <button type="button" className="chat-icon" aria-label="Emojis" aria-expanded={picker} onClick={() => setPicker(open => !open)}><Smile size={22} aria-hidden="true" /></button>
      <label className="sr-only" htmlFor="chat-draft">Mensagem para {name}</label>
      <textarea id="chat-draft" ref={field} rows={1} maxLength={4000} placeholder="Digite uma mensagem" value={draft} onChange={event => change(event.target.value)} onKeyDown={keys} />
      <button type="submit" className="chat-send" aria-label="Enviar mensagem" disabled={!draft.trim() || busy}><Send size={19} aria-hidden="true" /></button>
    </div>
  </form>;
}

export function ChatThread({ id, writable, unread, drafts, outbox, send, retry, discard, confirm, panelOpen, togglePanel }: {
  id: string; writable: boolean; unread: number; drafts: MutableRefObject<Map<string, string>>; outbox: OutboxItem[];
  send: (text: string) => void; retry: (operationId: string) => void; discard: (operationId: string) => void;
  confirm: (messages: Message[]) => void; panelOpen: boolean; togglePanel: () => void;
}) {
  const [thread, setThread] = useState<LoadedThread | null>(null);
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'owner' | 'history' | null>(null);
  const [away, setAway] = useState(false);
  const [arrived, setArrived] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [unreadId, setUnreadId] = useState<string | null>(null);
  const opened = useRef(false);
  const unreadAtOpen = useRef(unread);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const previousHeight = useRef<number>();
  const newestSeen = useRef<string>();
  const reading = useRef<string>();
  const request = useRef<AbortController>();
  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const page = await client.inboxThread(id, null, signal);
      if (signal.aborted) return;
      if (!opened.current) { opened.current = true; setUnreadId(firstUnreadId(page.data, unreadAtOpen.current)); }
      setThread(previous => mergeThread(previous, page));
      setLoadError(null); setNow(Date.now());
    } catch (error) { if (!signal.aborted) setLoadError(errorText(error)); }
  }, [id]);
  useVisiblePoll(load, revision, 3000);
  useEffect(() => () => request.current?.abort(), []);
  const messages = useMemo(() => thread?.messages ?? [], [thread]);
  const newest = messages[0];
  useEffect(() => { if (messages.length) confirm(messages); }, [messages, confirm]);

  const markRead = useCallback((message: Message | undefined) => {
    if (!message || reading.current === message.id || document.visibilityState === 'hidden') return;
    reading.current = message.id;
    client.readInbox(id, message.id, new AbortController().signal).then(inboxChanged)
      .catch(() => { if (reading.current === message.id) reading.current = undefined; });
  }, [id]);
  useEffect(() => { if (pinned.current && newest?.from_type === 'user') markRead(newest); }, [newest, markRead]);

  const outboxSize = outbox.length;
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    if (previousHeight.current !== undefined) {
      box.scrollTop += box.scrollHeight - previousHeight.current;
      previousHeight.current = undefined;
    } else if (pinned.current) box.scrollTop = box.scrollHeight;
    else if (newest && newestSeen.current && newest.id !== newestSeen.current) {
      const index = messages.findIndex(message => message.id === newestSeen.current);
      setArrived(count => count + messages.slice(0, index < 0 ? 1 : index).filter(message => message.from_type === 'user').length);
    }
    newestSeen.current = newest?.id;
  }, [messages, newest, outboxSize]);
  const toBottom = () => {
    const box = scroller.current;
    pinned.current = true; setAway(false); setArrived(0);
    if (box) box.scrollTop = box.scrollHeight;
    if (newest?.from_type === 'user') markRead(newest);
  };
  async function run(kind: NonNullable<typeof busy>, action: (signal: AbortSignal) => Promise<void>) {
    if (request.current) return false;
    const controller = new AbortController(); request.current = controller;
    setBusy(kind); setActionError(null);
    try { await action(controller.signal); return !controller.signal.aborted; }
    catch (error) { if (!controller.signal.aborted) setActionError(errorText(error)); return false; }
    finally { request.current = undefined; if (!controller.signal.aborted) setBusy(null); }
  }
  const loadOlder = () => {
    if (!thread?.next) return;
    void run('history', async signal => {
      const page = await client.inboxThread(id, thread.next, signal);
      if (signal.aborted) return;
      previousHeight.current = scroller.current?.scrollHeight;
      setThread(previous => previous && appendOlder(previous, page));
    });
  };
  const assign = (action: 'assume' | 'release') => run('owner', async signal => {
    await client.assignInbox(id, action, signal);
    if (signal.aborted) return;
    setThread(previous => previous && { ...previous, conversation: { ...previous.conversation,
      assigned_to_me: action === 'assume', assignee: action === 'assume' ? previous.conversation.assignee ?? 'Você' : null } });
    setRevision(n => n + 1); inboxChanged();
  });
  const timeline = useMemo(() => buildTimeline(messages, unreadId), [messages, unreadId]);

  if (!thread) return <section className="chat-thread">
    <header className="chat-head"><Link className="chat-icon chat-back" to="/conversas" aria-label="Voltar às conversas"><ArrowLeft size={21} aria-hidden="true" /></Link></header>
    <div className="chat-scroll">{loadError ? <ErrorNotice message={loadError} retry={() => setRevision(n => n + 1)} /> : <Loading>Carregando conversa…</Loading>}</div>
  </section>;
  const contact = thread.conversation;
  const state = composerState(contact, writable, now);
  const closedHint = state === 'readonly' ? 'Modo de consulta. O envio pela Nina ainda não está liberado.' : state === 'blocked' ? 'Este contato está bloqueado.' :
    state === 'other' ? `${contact.assignee} está atendendo esta conversa.` :
      state === 'closed' ? 'A janela de 24 horas do WhatsApp encerrou. Dá para responder quando o tutor mandar uma nova mensagem.' : null;
  const submit = async (text: string) => {
    if (state === 'assume' && !await assign('assume')) return false;
    pinned.current = true; setAway(false); setUnreadId(null);
    send(text);
    return true;
  };
  return <section className="chat-thread" aria-label={'Conversa com ' + displayName(contact.name)}>
    <header className="chat-head">
      <Link className="chat-icon chat-back" to="/conversas" aria-label="Voltar às conversas"><ArrowLeft size={21} aria-hidden="true" /></Link>
      <button type="button" className="chat-person" onClick={togglePanel} aria-expanded={panelOpen}>
        <Avatar name={contact.name} /><span><strong>{displayName(contact.name)}</strong>
          <small>{contact.assigned_to_me ? 'Com você' : contact.assignee ? 'Com ' + contact.assignee : 'Sem responsável'}</small></span></button>
      {state === 'assume' && <button className="button primary" disabled={busy !== null} onClick={() => void assign('assume')}><UserCheck size={16} aria-hidden="true" /> Assumir</button>}
      {writable && contact.assigned_to_me && <button className="button secondary" disabled={busy !== null} onClick={() => void assign('release')}>Devolver à fila</button>}
      <button type="button" className="chat-icon" onClick={togglePanel} aria-label="Dados do tutor" aria-pressed={panelOpen}><Info size={21} aria-hidden="true" /></button>
    </header>
    <div className="chat-scroll" ref={scroller} onScroll={event => {
      const box = event.currentTarget, near = box.scrollHeight - box.scrollTop - box.clientHeight < 96;
      pinned.current = near;
      if (near !== !away) setAway(!near);
      if (near && arrived) { setArrived(0); if (newest?.from_type === 'user') markRead(newest); }
    }}>
      {loadError && <ErrorNotice message={loadError} retry={() => setRevision(n => n + 1)} />}
      {thread.next && <button className="button secondary chat-older" disabled={busy !== null} onClick={loadOlder}>{busy === 'history' ? 'Carregando…' : 'Mensagens anteriores'}</button>}
      {!messages.length && !outbox.length ? <p className="empty">Nenhuma mensagem nesta conversa.</p> :
        <ol className="chat-messages" role="log" aria-label="Mensagens">{timeline.map(item => item.kind === 'day' ? <li key={item.key} className="chat-day"><span>{item.label}</span></li> :
          item.kind === 'unread' ? <li key={item.key} className="chat-unread-line"><span>Mensagens não lidas</span></li> :
            <Bubble key={item.key} message={item.message} first={item.first} />)}
          {outbox.map(item => <OutboxBubble key={item.operationId} item={item} retry={() => retry(item.operationId)} discard={() => discard(item.operationId)} />)}</ol>}
    </div>
    {away && <button type="button" className="chat-jump" onClick={toBottom} aria-label={arrived ? `Ir para as ${arrived} mensagens novas` : 'Ir para o fim da conversa'}>
      {arrived > 0 && <span>{arrived}</span>}<ArrowDown size={20} aria-hidden="true" /></button>}
    <footer className="chat-foot">
      {actionError && <ErrorNotice message={actionError} />}
      {closedHint ? <p className="chat-closed">{closedHint}</p> :
        <Composer key={id} id={id} name={displayName(contact.name)} drafts={drafts} busy={busy === 'owner'} send={submit}
          hint={state === 'assume' ? 'Ao enviar, esta conversa passa a ficar com você.' : null} />}
    </footer>
  </section>;
}
