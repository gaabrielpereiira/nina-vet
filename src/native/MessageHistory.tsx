import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { client } from './client';
import { ClientError, type MediaAttachment, type Message, type Page, type WhatsAppPilotState } from './api-client';
import { dateLabel, ErrorNotice } from './ui';
import { useNativeAuth } from './NativeAuth';

const authors: Record<string, string> = { user: 'Tutor', human: 'Equipe', nina: 'Nina', external: 'WhatsApp / CRM' };
const statuses: Record<string, string> = { sent: 'Enviada', delivered: 'Entregue', read: 'Lida', failed: 'Falha no envio', received: 'Recebida', pending: 'Pendente' };
const media: Record<string, string> = { audio: 'Mensagem de áudio', image: 'Imagem', video: 'Vídeo', document: 'Documento' };
export function Attachment({ file }: { file: MediaAttachment }) {
  const url = client.fileUrl(file.id);
  const [failed, setFailed] = useState(false);
  const name = file.filename || media[file.type] || 'Arquivo';
  return <div className="message-attachment">
    {!failed && (file.type === 'image' && ['image/jpeg','image/png','image/webp','image/gif'].includes(file.mime) ?
      <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={file.is_sticker ? 'Figurinha recebida' : name} loading="lazy" crossOrigin="use-credentials" onError={() => setFailed(true)} /></a> :
      file.type === 'audio' && file.mime.startsWith('audio/') ? <audio controls preload="none" src={url} crossOrigin="use-credentials" onError={() => setFailed(true)} aria-label={name} /> :
      file.type === 'video' && ['video/mp4','video/webm'].includes(file.mime) ? <video controls preload="none" src={url} crossOrigin="use-credentials" onError={() => setFailed(true)} aria-label={name} /> : null)}
    {failed && <p className="muted">Não foi possível exibir a prévia. Tente baixar o arquivo.</p>}
    <a className="attachment-download" href={client.fileUrl(file.id, true)}><Download size={15} aria-hidden="true" />{name} <span className="muted">({Math.max(1, Math.ceil(file.bytes / 1024)).toLocaleString('pt-BR')} KB)</span></a>
  </div>;
}
const sendLabels = {
  sending: 'Tentativa registrada. Atualize o histórico para conferir se o WhatsApp recebeu a resposta.',
  accepted: 'Resposta aceita pelo WhatsApp. Atualize o histórico para acompanhar a entrega.',
  rejected: 'O WhatsApp recusou esta tentativa. A equipe pode conferir o canal antes de fazer outro teste.',
  uncertain: 'A confirmação do envio não chegou. Confira o WhatsApp antes de fazer outro teste.',
};

function PilotReply({ contactId, revision }: { contactId: string; revision: number }) {
  const [state, setState] = useState<WhatsAppPilotState>();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendRequest = useRef<AbortController>();
  useEffect(() => {
    const controller = new AbortController();
    if (!sendRequest.current) client.whatsAppPilot(contactId, controller.signal).then(result => {
      if (!controller.signal.aborted && !sendRequest.current) setState(result);
    }).catch(() => {
      if (!controller.signal.aborted && !sendRequest.current) setState(undefined);
    });
    return () => controller.abort();
  }, [contactId, revision]);
  useEffect(() => () => sendRequest.current?.abort(), []);
  const send = async () => {
    if (!state?.available || sendRequest.current || !message.trim()) return;
    const controller = new AbortController();
    sendRequest.current = controller;
    setSending(true); setError(null);
    try {
      const result = await client.sendWhatsAppPilot(contactId, state.inbound_id, message, controller.signal);
      if (!controller.signal.aborted) { setState(result); setMessage(''); }
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof ClientError && [400, 409].includes(error.status)) {
          setError(error.message);
        } else {
          setState({ available: false, status: 'uncertain' });
        }
      }
    } finally {
      sendRequest.current = undefined;
      if (!controller.signal.aborted) setSending(false);
    }
  };
  if (!state?.available && !state?.status) return null;
  return <div className="editor-field">
    <h3>Resposta de teste pelo WhatsApp</h3>
    {state.available && <form className="editor-field" onSubmit={event => { event.preventDefault(); void send(); }}>
      <label htmlFor="pilot-reply">Mensagem para esta conversa</label>
      <textarea id="pilot-reply" rows={3} maxLength={1000} required disabled={sending} value={message} onChange={event => setMessage(event.target.value)} />
      <button className="button primary" type="submit" disabled={sending || !message.trim()}>{sending ? 'Enviando…' : 'Enviar mensagem de teste'}</button>
    </form>}
    {state.status && <p role="status" className="muted">{sendLabels[state.status]}</p>}
    {error && <ErrorNotice message={error} />}
  </div>;
}

export function MessageHistory({ contactId, initial }: { contactId: string; initial: Page<Message> }) {
  const [page, setPage] = useState(initial);
  const [pilotRevision, setPilotRevision] = useState(0);
  const admin = useNativeAuth().session?.user.roles.includes('admin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController>();
  useEffect(() => () => active.current?.abort(), []);
  const load = async (refresh: boolean) => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(null);
    try {
      const next = await client.contactMessages(contactId, refresh ? 0 : page.next_offset ?? 0, controller.signal);
      if (!controller.signal.aborted && refresh) setPilotRevision(previous => previous + 1);
      if (!controller.signal.aborted) setPage(previous => {
        if (refresh) return next;
        const ids = new Set(previous.data.map(row => row.id));
        return { data: [...previous.data, ...next.data.filter(row => !ids.has(row.id))], next_offset: next.next_offset };
      });
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Não foi possível carregar as mensagens.'); }
    finally { active.current = undefined; if (!controller.signal.aborted) setBusy(false); }
  };
  return <section className="panel detail-section" aria-busy={busy}><div className="section-heading message-heading"><h2>Histórico de conversas</h2>
    <button className="button secondary" disabled={busy} onClick={() => load(true)}><RefreshCw size={16} aria-hidden="true" />{busy ? 'Carregando…' : 'Atualizar mensagens'}</button></div>
    <p className="muted">Mensagens mais recentes primeiro. Atualize para conferir novas mensagens e confirmações de leitura.</p>
    {error && <ErrorNotice message={error} />}
    {admin && <PilotReply contactId={contactId} revision={pilotRevision} />}
    {!page.data.length ? <p className="muted">Nenhuma mensagem registrada.</p> : <ol className="message-list">{page.data.map(message => <li className={'message ' + (message.from_type === 'user' ? 'from-tutor' : '')} key={message.id}>
      <header><strong>{authors[message.from_type] || 'Mensagem'}</strong><time dateTime={message.sent_at}>{dateLabel(message.sent_at, true)}</time></header>
      {(message.content || !message.attachments?.length) && <p className="preserve">{message.content || media[message.type] || 'Mensagem sem texto'}</p>}
      {message.attachments?.map(file => <Attachment file={file} key={file.id} />)}
      {message.from_type !== 'user' && statuses[message.status] && <small className="muted">{statuses[message.status]}</small>}
    </li>)}</ol>}
    {page.next_offset !== null && <button className="button secondary load-more" disabled={busy} onClick={() => load(false)}>Carregar mais mensagens</button>}
  </section>;
}
