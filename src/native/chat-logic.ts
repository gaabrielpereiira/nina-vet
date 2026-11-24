// Regras do chat sem React nem rede, para serem testadas isoladamente.
import type { InboxCursor, InboxSendStatus, InboxThread, Message } from './api-client';

export interface LoadedThread { conversation: InboxThread['conversation']; messages: Message[]; next: InboxCursor | null }
const older = (a: Message, b: Message) => a.sent_at < b.sent_at || (a.sent_at === b.sent_at && a.id < b.id);

// Mensagens sempre da mais nova para a mais antiga.
export function mergeThread(previous: LoadedThread | null, page: InboxThread): LoadedThread {
  const latest = { conversation: page.conversation, messages: page.data, next: page.next };
  const edge = page.data.at(-1);
  if (!previous?.messages.length || !edge || !page.next) return latest;
  const ids = new Set(page.data.map(message => message.id));
  // Sem sobreposição existe um intervalo não carregado: recomeça da página atual.
  if (!previous.messages.some(message => ids.has(message.id))) return latest;
  const retained = previous.messages.filter(message => !ids.has(message.id) && older(message, edge));
  return retained.length ? { ...latest, messages: [...page.data, ...retained], next: previous.next } : latest;
}
export function appendOlder(previous: LoadedThread, page: InboxThread): LoadedThread {
  const ids = new Set(previous.messages.map(message => message.id));
  return { ...previous, messages: [...previous.messages, ...page.data.filter(message => !ids.has(message.id))], next: page.next };
}

const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const daysBetween = (value: Date, now: Date) => Math.round((day(now).getTime() - day(value).getTime()) / 86400000);
const clock = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' });
const fullDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const parse = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
export function timeLabel(value: string) { const date = parse(value); return date ? clock.format(date) : ''; }
export function dayLabel(value: string, now = new Date()) {
  const date = parse(value);
  if (!date) return '';
  const days = daysBetween(date, now);
  return days === 0 ? 'Hoje' : days === 1 ? 'Ontem' : days > 1 && days < 7 ? weekday.format(date) : fullDate.format(date);
}
export function listTimeLabel(value: string, now = new Date()) {
  return dayLabel(value, now) === 'Hoje' ? timeLabel(value) : dayLabel(value, now);
}

export function firstUnreadId(messages: Message[], unread: number) {
  let found: string | null = null;
  let count = 0;
  for (const message of messages) {
    if (message.from_type !== 'user' || count >= unread) break;
    found = message.id; count++;
  }
  return found;
}

export type TimelineItem =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'unread'; key: string }
  | { kind: 'message'; key: string; message: Message; first: boolean };
const side = (message: Message) => message.from_type === 'user' ? 'in' : 'out:' + (message.author ?? message.from_type);
export function buildTimeline(messages: Message[], unreadId: string | null, now = new Date()): TimelineItem[] {
  const items: TimelineItem[] = [];
  let lastDay = '';
  let previous: Message | null = null;
  for (const message of [...messages].reverse()) {
    const label = dayLabel(message.sent_at, now);
    const boundary = label !== lastDay || message.id === unreadId;
    if (label !== lastDay) { items.push({ kind: 'day', key: 'day:' + message.id, label }); lastDay = label; }
    if (message.id === unreadId) items.push({ kind: 'unread', key: 'unread' });
    const close = previous !== null && Math.abs(Date.parse(message.sent_at) - Date.parse(previous.sent_at)) < 300000;
    items.push({ kind: 'message', key: message.id, message, first: boundary || !close || previous === null || side(previous) !== side(message) });
    previous = message;
  }
  return items;
}

export type ComposerState = 'ready' | 'assume' | 'other' | 'blocked' | 'closed' | 'readonly';
export function composerState(conversation: InboxThread['conversation'], writable: boolean, now = Date.now()): ComposerState {
  if (!writable) return 'readonly';
  if (conversation.blocked) return 'blocked';
  if (conversation.assignee && !conversation.assigned_to_me) return 'other';
  if (!conversation.reply_until || !(Date.parse(conversation.reply_until) > now)) return 'closed';
  return conversation.assigned_to_me ? 'ready' : 'assume';
}

export interface TextToken { kind: 'text' | 'bold' | 'italic' | 'strike' | 'code' | 'link'; value: string }
const markup = /(https?:\/\/[^\s<>"']{1,2000})|\*([^*\n]{1,400})\*|_([^_\n]{1,400})_|~([^~\n]{1,400})~|```([^`]{1,1000})```/g;
const word = /[\p{L}\p{N}]/u;
// Mesmo estilo do WhatsApp: *negrito*, _itálico_, ~riscado~, ```código``` e links.
export function richText(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  let position = 0;
  const push = (kind: TextToken['kind'], value: string) => {
    if (!value) return;
    const last = tokens.at(-1);
    if (kind === 'text' && last?.kind === 'text') last.value += value; else tokens.push({ kind, value });
  };
  for (const match of text.matchAll(markup)) {
    const start = match.index, [whole, link, bold, italic, strike, code] = match;
    push('text', text.slice(position, start));
    position = start + whole.length;
    if (link) {
      const url = link.replace(/[.,;:!?)\]}]+$/, '');
      push('link', url); push('text', link.slice(url.length));
      continue;
    }
    const inner = bold ?? italic ?? strike ?? code;
    const touching = word.test(text[start - 1] ?? '') || word.test(text[position] ?? '');
    if (code === undefined && (touching || inner !== inner.trim())) { push('text', whole); continue; }
    push(bold !== undefined ? 'bold' : italic !== undefined ? 'italic' : strike !== undefined ? 'strike' : 'code', inner);
  }
  push('text', text.slice(position));
  return tokens;
}

// Sem nome cadastrado, o contato aparece pelo telefone.
export function phoneLabel(value: string | null | undefined) {
  const digits = (value ?? '').replace(/\D/g, '');
  const local = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  return local ? `+55 ${local[1]} ${local[2]}-${local[3]}` : digits ? '+' + digits : '';
}
export const displayName = (name: string) => /^\+?\d{8,15}$/.test(name) ? phoneLabel(name) : name;

export function avatarTone(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) % 9973;
  return hash % 6;
}

export type OutboxStatus = 'queued' | 'sending' | 'accepted' | 'failed' | 'rejected' | 'uncertain';
export interface OutboxItem { operationId: string; text: string; createdAt: string; status: OutboxStatus; error?: string }
interface OutboxDependencies {
  reply: (conversation: string, operationId: string, text: string) => Promise<{ status: InboxSendStatus }>;
  wait: (milliseconds: number) => Promise<void>;
  changed: (conversation: string, items: OutboxItem[]) => void;
  accepted: (conversation: string) => void;
  newId: () => string;
}
// Uma mensagem por vez em cada conversa. Repetir a MESMA operação nunca gera um
// segundo envio (o servidor devolve o resultado anterior); só uma recusa
// definitiva, repetida por escolha da pessoa, recebe uma operação nova.
export function createOutbox({ reply, wait, changed, accepted, newId }: OutboxDependencies) {
  const queues = new Map<string, OutboxItem[]>();
  const active = new Set<string>();
  let running = true;
  const items = (conversation: string) => queues.get(conversation) ?? [];
  const store = (conversation: string, next: OutboxItem[]) => { queues.set(conversation, next); if (running) changed(conversation, next); };
  const patch = (conversation: string, operationId: string, change: Partial<OutboxItem>) =>
    store(conversation, items(conversation).map(item => item.operationId === operationId ? { ...item, ...change } : item));

  async function attempt(conversation: string, item: OutboxItem) {
    const settle = (status: OutboxStatus, error?: string) => patch(conversation, item.operationId, { status, error });
    settle('sending');
    for (let tries = 1; running; tries++) {
      try {
        const { status } = await reply(conversation, item.operationId, item.text);
        if (status !== 'sending') { settle(status); if (status === 'accepted') accepted(conversation); return; }
        if (tries >= 8) return settle('uncertain');
        await wait(2500);
      } catch (error) {
        const { status = 0, code = '', message = '' } = (error ?? {}) as { status?: number; code?: string; message?: string };
        if (code === 'INBOX_BUSY' && tries < 10) { await wait(3200); continue; }
        if ((status === 0 || status >= 500) && tries < 3) { await wait(1500 * tries); continue; }
        return settle('failed', message || 'Não foi possível enviar.');
      }
    }
  }
  async function drain(conversation: string) {
    if (active.has(conversation)) return;
    active.add(conversation);
    try {
      for (;;) {
        const item = items(conversation).find(candidate => candidate.status === 'queued');
        if (!item || !running) return;
        await attempt(conversation, item);
      }
    } finally { active.delete(conversation); }
  }
  return {
    items,
    pending: () => [...queues.values()].some(queue => queue.some(item => item.status === 'queued' || item.status === 'sending')),
    start() { running = true; for (const conversation of queues.keys()) void drain(conversation); },
    stop() { running = false; },
    send(conversation: string, text: string) {
      store(conversation, [...items(conversation), { operationId: newId(), text, createdAt: new Date().toISOString(), status: 'queued' }]);
      return drain(conversation);
    },
    retry(conversation: string, operationId: string) {
      const item = items(conversation).find(candidate => candidate.operationId === operationId);
      if (!item || !['failed', 'rejected'].includes(item.status)) return Promise.resolve();
      patch(conversation, operationId, { status: 'queued', error: undefined, ...(item.status === 'rejected' ? { operationId: newId() } : {}) });
      return drain(conversation);
    },
    discard(conversation: string, operationId: string) {
      store(conversation, items(conversation).filter(item => item.operationId !== operationId || ['queued', 'sending'].includes(item.status)));
    },
    // O histórico do servidor já mostra estas mensagens. Uma aceita há mais de
    // dois minutos também está lá, mesmo fora da página carregada.
    confirm(conversation: string, messages: Message[], now = Date.now()) {
      const shown = new Set(messages.map(message => message.operation_id).filter(Boolean));
      const left = items(conversation).filter(item => !shown.has(item.operationId) &&
        !(item.status === 'accepted' && now - Date.parse(item.createdAt) > 120000));
      if (left.length !== items(conversation).length) store(conversation, left);
    },
  };
}
