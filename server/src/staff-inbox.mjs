import { createHash } from 'node:crypto';
import { ApiError } from './errors.mjs';
import { sendZernioText } from './zernio-send.mjs';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const timestamp = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/;
const invalid = () => new ApiError(400, 'INBOX_INVALID', 'Confira a conversa e os dados informados.');
const failures = {
  missing: [404, 'NOT_FOUND', 'Conversa não encontrada.'],
  denied: [403, 'FORBIDDEN', 'Sua conta não tem acesso às conversas.'],
  conflict: [409, 'INBOX_OWNERSHIP', 'A conversa mudou de responsável. Atualize e confira antes de responder.'],
  blocked: [409, 'INBOX_BLOCKED', 'Este contato está bloqueado.'],
  window: [409, 'INBOX_WINDOW', 'A janela para responder pelo WhatsApp encerrou.'],
  busy: [409, 'INBOX_BUSY', 'Aguarde alguns segundos antes de enviar outra mensagem.'],
};
function assertOutcome(status) {
  const error = Object.hasOwn(failures, status) ? failures[status] : null;
  if (error) throw new ApiError(...error);
}
function validateQuery(url, allowed) {
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw invalid();
  }
}

export function createStaffInbox(db, auth, config, fetcher = fetch, log = () => {}) {
  const inbox = config.staffInbox;
  const scope = config.zernio;
  return async (request, id, action, parseBody) => {
    const { user } = await auth.authenticate(request);
    if (!user.roles.some(role => role === 'admin' || role === 'user')) throw new ApiError(...failures.denied);
    const url = new URL(request.url);
    const withActor = run => db.transaction(async tx => {
      await tx.query("SELECT set_config('nina.user_id',$1,true)",[user.id]);
      return run(tx);
    });
    if (request.method === 'GET' && !id) {
      validateQuery(url, ['filter','q','offset']);
      if (!inbox?.enabled) return { enabled:false, writable:false, data:[], next_offset:null };
      const filter = url.searchParams.get('filter') ?? 'all';
      const query = (url.searchParams.get('q') ?? '').trim();
      const offset = url.searchParams.get('offset') ?? '0';
      if (!['all','mine','unassigned'].includes(filter) || query.length>100 || /[\x00-\x1f]/.test(query) ||
          !/^\d{1,6}$/.test(offset) || Number(offset)>100000) throw invalid();
      const rows = await withActor(tx => tx.query('SELECT * FROM nina_channels.staff_inbox_list($1,$2,$3,$4,$5)',
        [scope.accountId,scope.profileId,filter,query,Number(offset)]));
      return { enabled:true, writable:inbox.writable, data:rows.slice(0,30), next_offset:rows.length>30?Number(offset)+30:null };
    }
    if (!uuid.test(id ?? '')) throw invalid();
    if (!inbox?.enabled || (request.method === 'POST' && !inbox.writable)) {
      throw new ApiError(409,'INBOX_DISABLED','O envio pela caixa de entrada ainda não está liberado.');
    }
    if (request.method === 'GET' && !action) {
      validateQuery(url, ['before_at','before_id']);
      const at = url.searchParams.get('before_at'), beforeId = url.searchParams.get('before_id');
      if ((at === null) !== (beforeId === null) || (at !== null && (!timestamp.test(at) || !Number.isFinite(Date.parse(at)) || !uuid.test(beforeId)))) throw invalid();
      const [row] = await withActor(tx => tx.query('SELECT nina_channels.staff_inbox_thread($1,$2,$3,$4,$5,$6) AS data',
        [scope.accountId,scope.profileId,id,at,beforeId,config.media?.enabled===true]));
      if (!row.data) throw new ApiError(...failures.missing);
      const { messages, ...conversation } = row.data;
      const page = messages.slice(0,40);
      return { conversation, data:page, next:messages.length>40?{ at:page[39].sent_at,id:page[39].id }:null };
    }
    if (request.method !== 'POST' || !['assume','release','reply'].includes(action)) throw new ApiError(...failures.missing);
    validateQuery(url, []);
    const body = await parseBody();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid();
    if (action !== 'reply') {
      if (Object.keys(body).length) throw invalid();
      const [row] = await withActor(tx => tx.query('SELECT nina_channels.staff_inbox_assign($1,$2,$3,$4) AS status',
        [scope.accountId,scope.profileId,id,action==='assume']));
      assertOutcome(row.status);
      if (row.status !== 'ok') throw new Error('Unexpected inbox assignment result');
      return { status:'ok' };
    }
    if (Object.keys(body).length!==2 || typeof body.operation_id!=='string' || !uuid.test(body.operation_id) ||
        typeof body.message!=='string' || !body.message.trim() || body.message.length>1000 ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body.message)) throw invalid();
    const message = body.message.trim();
    const fingerprint = createHash('sha256').update(message).digest('hex');
    const [row] = await withActor(tx => tx.query('SELECT nina_channels.staff_inbox_reserve($1,$2,$3,$4,$5) AS result',
      [scope.accountId,scope.profileId,id,body.operation_id,fingerprint]));
    const { status, target } = row.result;
    assertOutcome(status);
    if (['sending','accepted','rejected','uncertain'].includes(status)) return { status };
    if (status!=='reserved' || typeof target!=='string' || !/^[a-f0-9]{24}$/.test(target)) throw new Error('Unexpected inbox reservation');
    const result = await sendZernioText(fetcher, scope, target, message, body.operation_id, log);
    const [completed] = await withActor(tx => tx.query('SELECT nina_channels.staff_inbox_finish($1,$2,$3,$4,$5) AS ok',
      [scope.accountId,id,body.operation_id,result.status,result.providerId ?? null]));
    return { status:completed.ok?result.status:'uncertain' };
  };
}
