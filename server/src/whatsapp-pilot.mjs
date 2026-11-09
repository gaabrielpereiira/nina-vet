import { randomUUID } from 'node:crypto';
import { ApiError } from './errors.mjs';
import { sendZernioText } from './zernio-send.mjs';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const noPilot = { available: false, status: null };
const unavailable = () => new ApiError(409, 'PILOT_REPLY_UNAVAILABLE', 'A conversa de teste não está disponível para resposta.');

export function createWhatsAppPilot(db, auth, config, fetcher = fetch, log = () => {}) {
  const scope = config.zernio;
  const pilot = config.whatsappPilot;
  const withActor = (user, run) => db.transaction(async tx => {
    await tx.query("SELECT set_config('nina.user_id', $1, true)", [user.id]);
    return run(tx);
  });
  return async (request, contactId, parseBody) => {
    const { user } = await auth.authenticate(request);
    const read = request.method === 'GET';
    if (!uuid.test(contactId) || new URL(request.url).search) throw unavailable();
    if (!pilot?.enabled || contactId !== pilot.contactId || !user.roles.includes('admin')) {
      if (read) return noPilot;
      throw unavailable();
    }
    let message, inboundId;
    if (!read) {
      const body = await parseBody();
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2 ||
          typeof body.inbound_id !== 'string' || !uuid.test(body.inbound_id) ||
          typeof body.message !== 'string' || !body.message.trim() || body.message.length > 1000 ||
          /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body.message)) {
        throw new ApiError(400, 'PILOT_REPLY_INVALID', 'Escreva uma mensagem de até 1.000 caracteres.');
      }
      message = body.message.trim();
      inboundId = body.inbound_id;
    }
    const route = await withActor(user, async tx => {
      const [target] = await tx.query('SELECT * FROM nina_channels.pilot_reply_target($1,$2,$3,$4)',
        [scope.accountId, scope.profileId, pilot.conversationId, pilot.contactId]);
      if (!target || !/^[a-f0-9]{24}$/.test(target.provider_conversation_id)) return null;
      const keys = [pilot.conversationId, target.inbound_message_id];
      if (!read) {
        if (inboundId !== target.inbound_message_id) return null;
        const [reserved] = await tx.query(`INSERT INTO nina_channels.pilot_replies (conversation_id,inbound_message_id,actor_id)
          VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING status`, [...keys, user.id]);
        if (reserved) return { reserved: true, target, keys };
      }
      const [receipt] = await tx.query('SELECT status FROM nina_channels.pilot_replies WHERE conversation_id=$1 AND inbound_message_id=$2', keys);
      return { reserved: false, status: receipt?.status ?? null, inboundId: target.inbound_message_id };
    });
    if (!route) {
      if (read) return noPilot;
      throw unavailable();
    }
    if (!route.reserved) return route.status ? { available: false, status: route.status }
      : { available: true, status: null, inbound_id: route.inboundId };
    const { status } = await sendZernioText(fetcher, scope, route.target.provider_conversation_id, message, randomUUID(), log);
    await withActor(user, tx => tx.query(`UPDATE nina_channels.pilot_replies SET status=$3
      WHERE conversation_id=$1 AND inbound_message_id=$2 AND status='sending'`, [...route.keys, status]));
    return { available: false, status };
  };
}
