// WhatsApp de mentira para o ambiente LOCAL. Nenhuma chamada sai da máquina:
// os eventos entram pela rota assinada da própria API, como o provedor faria.
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { deflateSync } from 'node:zlib';
import { createMediaArchive } from '../../src/channel-media.mjs';

export const tutors = [
  { key: 'mariana', name: 'Mariana Duarte', phone: '5551900000001' },
  { key: 'rafael', name: 'Rafael Nunes', phone: '5551900000002' },
  { key: 'beatriz', name: 'Beatriz Alves', phone: '5551900000003' },
  { key: 'carlos', name: 'Carlos Prado', phone: '5551900000004' },
  { key: 'juliana', name: 'Juliana Reis', phone: '5551900000005' },
  { key: 'pedro', name: 'Pedro Lima', phone: '5551900000006' },
  { key: 'sofia', name: 'Sofia Teixeira', phone: '5551900000007' },
  { key: 'semnome', name: null, phone: '5551900000008' },
];
export const conversationId = phone => createHash('sha256').update('conversa:' + phone).digest('hex').slice(0, 24);
const byConversation = new Map(tutors.map(tutor => [conversationId(tutor.phone), tutor]));

export function assertLocal(config, env = process.env) {
  const host = new URL(config.database.url).hostname;
  if (config.production || env.NODE_ENV !== 'development' || !['localhost', '127.0.0.1', '[::1]'].includes(host) ||
      !env.ZERNIO_API_KEY?.startsWith('dev-local-')) throw new Error('O simulador só roda no ambiente local de desenvolvimento.');
}

export function incoming(config, tutor, { text = null, attachments = [], at = new Date() }) {
  const sentAt = at.toISOString();
  return { id: randomUUID(), event: 'message.received', timestamp: sentAt,
    account: { accountId: config.zernio.accountId, profileId: config.zernio.profileId, platform: 'whatsapp' },
    conversation: { id: conversationId(tutor.phone) },
    message: { platform: 'whatsapp', platformMessageId: 'wamid.' + randomUUID().replaceAll('-', ''), direction: 'incoming',
      conversationId: conversationId(tutor.phone), sentAt, text, attachments,
      sender: { id: tutor.phone, phoneNumber: '+' + tutor.phone, ...(tutor.name ? { name: tutor.name } : {}) } } };
}
export function outgoing(config, conversation, { text, at = new Date(), sentVia = 'human', providerId }) {
  const sentAt = at.toISOString();
  const tutor = byConversation.get(conversation);
  return { id: randomUUID(), event: 'message.sent', timestamp: sentAt,
    account: { accountId: config.zernio.accountId, profileId: config.zernio.profileId, platform: 'whatsapp' },
    conversation: { id: conversation, ...(tutor ? { participantId: tutor.phone } : {}) },
    message: { platform: 'whatsapp', platformMessageId: providerId ?? 'wamid.' + randomUUID().replaceAll('-', ''),
      direction: 'outgoing', conversationId: conversation, sentAt, text, attachments: [], sentVia } };
}
export function receipt(config, kind, providerId, at = new Date()) {
  return { id: randomUUID(), event: 'message.' + kind, timestamp: at.toISOString(), statusAt: at.toISOString(),
    account: { accountId: config.zernio.accountId, profileId: config.zernio.profileId, platform: 'whatsapp' },
    message: { platform: 'whatsapp', platformMessageId: providerId } };
}
export async function deliver(app, config, event) {
  const body = JSON.stringify(event);
  const response = await app(new Request(config.apiOrigin + '/v1/webhooks/zernio', { method: 'POST', body, headers: {
    'content-type': 'application/json', 'x-zernio-signature': createHmac('sha256', config.zernio.secret).update(body).digest('hex') } }));
  if (!response.ok) throw new Error('Evento simulado recusado: HTTP ' + response.status);
}

// Arquivos sintéticos, gerados em memória.
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    Buffer.from(pixel(x / width, y / height)).copy(raw, y * (width * 3 + 1) + 1 + x * 3);
  }
  const table = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
  const crc = data => { let c = 0xffffffff; for (const byte of data) c = table[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const head = Buffer.from(type), size = Buffer.alloc(4), sum = Buffer.alloc(4);
    size.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([head, data]))); return Buffer.concat([size, head, data, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function wav(seconds = 3) {
  const rate = 8000, samples = rate * seconds, out = Buffer.alloc(44 + samples * 2);
  out.write('RIFF', 0); out.writeUInt32LE(36 + samples * 2, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) out.writeInt16LE(Math.round(Math.sin(i / rate * 2 * Math.PI * (220 + 60 * Math.sin(i / 900))) * 5000), 44 + i * 2);
  return out;
}
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 58>>stream\nBT /F1 16 Tf 40 110 Td (Exame ficticio - Vet+) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const files = {
  '/foto.png': () => ['image/png', png(480, 360, (x, y) => [Math.round(150 + 70 * x), Math.round(180 - 60 * y), Math.round(120 + 60 * Math.sin(x * 6 + y * 4))])],
  '/audio.wav': () => ['audio/wav', wav()],
  '/exame.pdf': () => ['application/pdf', pdf],
};
export const mediaUrl = name => 'https://midia.example.test/' + name;
export function simulatedArchive(config, apiKey) {
  return createMediaArchive({ ...config.media, accountId: config.zernio.accountId, apiKey }, {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    transport: async ({ url }) => {
      const [mime, body] = files[url.pathname]?.() ?? [];
      return body ? { status: 200, headers: { 'content-type': mime, 'content-length': String(body.length) }, body: Readable.from([body]) }
        : { status: 404, headers: {}, body: Readable.from([]) };
    },
  });
}

const answers = ['Sim, pode ser!', 'Perfeito, muito obrigada pela atenção 🐾', 'Vou conferir e já te aviso.', 'Ele comeu bem hoje, só está um pouco quietinho.',
  'Consigo levar depois das 17h, tudo bem?'];
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
// Textos especiais: #falha (recusado), #incerto (sem confirmação), #lento (demora).
// Uma pergunta (terminada em "?") recebe resposta do tutor fictício.
export function simulatedProvider(config, send, log = () => {}) {
  let turn = 0;
  return async (url, options) => {
    const target = new URL(url).pathname.split('/').at(-2);
    const { message } = JSON.parse(options.body);
    if (message.includes('#falha')) return new Response('{}', { status: 400 });
    if (message.includes('#incerto')) throw new Error('simulated timeout');
    if (message.includes('#lento')) await wait(5000);
    const providerId = 'wamid.' + randomUUID().replaceAll('-', '');
    void (async () => {
      await wait(700); await send(outgoing(config, target, { text: message, sentVia: 'api', providerId }));
      await wait(900); await send(receipt(config, 'delivered', providerId));
      await wait(1800); await send(receipt(config, 'read', providerId));
      const tutor = byConversation.get(target);
      if (tutor && message.trim().endsWith('?')) {
        await wait(2200); await send(incoming(config, tutor, { text: answers[turn++ % answers.length] }));
      }
    })().catch(error => log({ event: 'simulator_failed', code: error.message }));
    return Response.json({ success: true, data: { messageId: providerId, conversationId: target } });
  };
}
