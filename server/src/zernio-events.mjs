// Pure translation of signed, decrypted Zernio events. No SQL, fetch or side effects.
// Recipient identity is never taken from the business sender on outgoing echoes.
import { matchesZernioScope } from './zernio-scope.mjs';
export class ChannelEventError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new ChannelEventError(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const messageEvents = new Set(['message.received', 'message.sent']);
const statusEvents = new Set(['message.delivered', 'message.read', 'message.failed']);
const sentVia = new Set(['human', 'api', 'broadcast', 'sequence', 'workflow', 'comment_automation', 'bulk-api']);

function identifier(value, optional = false, max = 512) {
  if ((value === undefined || value === null) && optional) return null;
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\x00-\x20\x7f]/.test(value)) fail('CHANNEL_INVALID_ID');
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
      !Number.isFinite(Date.parse(value))) fail('CHANNEL_INVALID_TIME');
  return new Date(value).toISOString();
}
function displayName(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') fail('CHANNEL_INVALID_NAME');
  return value.normalize('NFC').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 240) || null;
}
function phone(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\+?[1-9][0-9]{9,14}$/.test(value)) fail('CHANNEL_INVALID_PHONE');
  return value.replace(/^\+/, '');
}
function incomingIdentity(message) {
  if (!object(message.sender)) fail('CHANNEL_MISSING_PEER');
  const sender = message.sender;
  const platformId = identifier(sender.id, false, 256);
  const bsuid = identifier(sender.businessScopedUserId, true, 256);
  const number = phone(sender.phoneNumber);
  const keys = [...(bsuid ? [{ kind: 'bsuid', value: bsuid }] : []), { kind: 'platform', value: platformId },
    ...(number ? [{ kind: 'phone', value: number }] : [])];
  return { keys, phone: number, name: displayName(sender.name) };
}
function outgoingIdentity(conversation) {
  // participantId can be a BSUID. A numeric-looking ID is not proof of a phone.
  if (!object(conversation) || !conversation.participantId) return null;
  return { keys: [{ kind: 'platform', value: identifier(conversation.participantId, false, 256) }],
    phone: null, name: displayName(conversation.participantName) };
}
function attachment(value, index) {
  if (!object(value)) fail('CHANNEL_INVALID_ATTACHMENT');
  const originalType = identifier(value.type, false, 50);
  const type = ({ image: 'image', sticker: 'image', video: 'video', audio: 'audio', file: 'document',
    share: 'document', unsupported_type: 'document' })[originalType];
  if (!type) fail('CHANNEL_UNSUPPORTED_ATTACHMENT');
  let url;
  try { url = new URL(value.url); } catch { fail('CHANNEL_INVALID_MEDIA_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      (url.port && url.port !== '443') || url.href.length > 4096) fail('CHANNEL_INVALID_MEDIA_URL');
  const name = value.filename ?? value.payload?.filename;
  return { index, type, original_type: originalType, url: url.href,
    filename: displayName(name)?.replace(/[\\/]/g, '_') ?? null,
    is_sticker: originalType === 'sticker', voice: value.payload?.voice === true };
}

export function normalizeZernioEvent(payload, scope, receipt) {
  if (!object(payload) || !uuid.test(payload.id ?? '') || payload.test === true) fail('CHANNEL_INVALID_EVENT');
  const eventId = payload.id.toLowerCase();
  if (receipt && (eventId !== receipt.event_id || payload.event !== receipt.event_type)) fail('CHANNEL_RECEIPT_MISMATCH');
  if (!matchesZernioScope(payload, scope)) fail('CHANNEL_SCOPE_MISMATCH');
  const message = payload.message;
  if (!object(message) || message.platform !== 'whatsapp') fail('CHANNEL_INVALID_MESSAGE');
  const base = { event_id: eventId, event_type: payload.event, account_id: scope.accountId,
    provider_message_id: identifier(message.platformMessageId), event_at: timestamp(payload.timestamp) };
  if (statusEvents.has(payload.event)) {
    const code = payload.error?.code;
    return { ...base, kind: 'status', status: payload.event.slice('message.'.length), status_at: timestamp(payload.statusAt),
      failure_code: typeof code === 'number' && Number.isSafeInteger(code) ? String(code) :
        typeof code === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(code) ? code : null };
  }
  if (!messageEvents.has(payload.event)) fail('CHANNEL_UNSUPPORTED_EVENT');
  const incoming = payload.event === 'message.received';
  if (message.direction !== (incoming ? 'incoming' : 'outgoing')) fail('CHANNEL_DIRECTION_MISMATCH');
  const conversationId = identifier(message.conversationId);
  if (payload.conversation?.id !== undefined && payload.conversation.id !== conversationId) fail('CHANNEL_CONVERSATION_MISMATCH');
  if (message.text !== null && typeof message.text !== 'string') fail('CHANNEL_INVALID_TEXT');
  if (message.text?.length > 32768 || message.text?.includes('\u0000')) fail('CHANNEL_INVALID_TEXT');
  if (!Array.isArray(message.attachments) || message.attachments.length > 10) fail('CHANNEL_INVALID_ATTACHMENT');
  const attachments = message.attachments.map(attachment);
  if (!message.text && !attachments.length) fail('CHANNEL_EMPTY_MESSAGE');
  return { ...base, kind: 'message', direction: incoming ? 'incoming' : 'outgoing',
    provider_conversation_id: conversationId,
    platform_conversation_id: identifier(payload.conversation?.platformConversationId,true),
    sent_at: timestamp(message.sentAt), text: message.text,
    from_type: incoming ? 'user' : message.sentVia === 'human' ? 'human' : 'external',
    sent_via: sentVia.has(message.sentVia) ? message.sentVia : null,
    peer: incoming ? incomingIdentity(message) : outgoingIdentity(payload.conversation),
    standby: payload.metadata?.standby === true, attachments };
}
