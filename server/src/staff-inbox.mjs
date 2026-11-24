import { createHash } from 'node:crypto';
import { ApiError } from './errors.mjs';
import { sendZernioText } from './zernio-send.mjs';

const MAX_REPLY_LENGTH = 4000;
const readFunctions = ['staff_chat_list(text,text,text,text,integer)','staff_chat_unread(text,text)',
  'staff_chat_read(text,text,uuid,uuid)','staff_chat_thread(text,text,uuid,timestamptz,uuid,boolean)'];
const writeFunctions = ['staff_inbox_assign(text,text,uuid,boolean)','staff_inbox_reserve(text,text,uuid,uuid,text)',
  'staff_chat_finish(text,text,uuid,uuid,text,text,text)'];
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
const disabled = [409,'INBOX_DISABLED','O envio pela caixa de entrada ainda não está liberado.'];
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
  const scope = config.zernio;
  // The API may be published before migration 0010 and before the write grants.
  // Until each is in place the chat answers as disabled or read-only.
  let granted = { readable:false, writable:false };
  async function availability() {
    const { enabled=false, writable=false } = config.staffInbox ?? {};
    if (!enabled) return { enabled:false, writable:false };
    if (!granted.readable || (writable && !granted.writable)) {
      const can = names => names.map(name => `coalesce(has_function_privilege(current_user,to_regprocedure('nina_channels.${name}'),'EXECUTE'),false)`).join(' AND ');
      [granted] = await db.query(`SELECT ${can(readFunctions)} AS readable, ${can(writeFunctions)} AS writable`);
    }
    return { enabled:granted.readable, writable:writable && granted.readable && granted.writable };
  }
  return async (request, id, action, parseBody) => {
    const { user } = await auth.authenticate(request);
    if (!user.roles.some(role => role === 'admin' || role === 'user')) throw new ApiError(...failures.denied);
    const inbox = await availability();
    const url = new URL(request.url);
    const asActor = run => db.transaction(async tx => {
      await tx.query("SELECT set_config('nina.user_id',$1,true)",[user.id]);
      return run(tx);
    });
    const withActor = async run => {
      try { return await asActor(run); }
      catch (error) {
        // Grants revoked while running: refuse now and check them again next time.
        if (error.code !== '42501') throw error;
        granted = { readable:false, writable:false };
        throw new ApiError(...disabled);
      }
    };
    if (request.method === 'GET' && action === 'unread') {
      validateQuery(url, []);
      if (!inbox?.enabled) return { enabled:false, conversations:0 };
      const [row] = await withActor(tx => tx.query('SELECT nina_channels.staff_chat_unread($1,$2) AS total',[scope.accountId,scope.profileId]));
      return { enabled:true, conversations:row.total };
    }
    if (request.method === 'GET' && !id) {
      validateQuery(url, ['filter','q','offset']);
      if (!inbox?.enabled) return { enabled:false, writable:false, data:[], next_offset:null };
      const filter = url.searchParams.get('filter') ?? 'all';
      const query = (url.searchParams.get('q') ?? '').trim();
      const offset = url.searchParams.get('offset') ?? '0';
      if (!['all','unread','mine','unassigned'].includes(filter) || query.length>100 || /[\x00-\x1f]/.test(query) ||
          !/^\d{1,6}$/.test(offset) || Number(offset)>100000) throw invalid();
      const rows = await withActor(tx => tx.query('SELECT * FROM nina_channels.staff_chat_list($1,$2,$3,$4,$5)',
        [scope.accountId,scope.profileId,filter,query,Number(offset)]));
      return { enabled:true, writable:inbox.writable, data:rows.slice(0,30), next_offset:rows.length>30?Number(offset)+30:null };
    }
    if (!uuid.test(id ?? '')) throw invalid();
    // A read position belongs only to the signed-in person; it is not a channel write.
    if (!inbox?.enabled || (request.method === 'POST' && action !== 'read' && !inbox.writable)) {
      throw new ApiError(...disabled);
    }
    if (request.method === 'GET' && !action) {
      validateQuery(url, ['before_at','before_id']);
      const at = url.searchParams.get('before_at'), beforeId = url.searchParams.get('before_id');
      if ((at === null) !== (beforeId === null) || (at !== null && (!timestamp.test(at) || !Number.isFinite(Date.parse(at)) || !uuid.test(beforeId)))) throw invalid();
      const [row] = await withActor(tx => tx.query('SELECT nina_channels.staff_chat_thread($1,$2,$3,$4,$5,$6) AS data',
        [scope.accountId,scope.profileId,id,at,beforeId,config.media?.enabled===true]));
      if (!row.data) throw new ApiError(...failures.missing);
      const { messages, ...conversation } = row.data;
      const page = messages.slice(0,40);
      return { conversation, data:page, next:messages.length>40?{ at:page[39].sent_at,id:page[39].id }:null };
    }
    if (request.method !== 'POST' || !['assume','release','reply','read'].includes(action)) throw new ApiError(...failures.missing);
    validateQuery(url, []);
    const body = await parseBody();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid();
    if (action === 'read') {
      if (Object.keys(body).length!==1 || typeof body.message_id!=='string' || !uuid.test(body.message_id)) throw invalid();
      const [row] = await withActor(tx => tx.query('SELECT nina_channels.staff_chat_read($1,$2,$3,$4) AS status',
        [scope.accountId,scope.profileId,id,body.message_id]));
      assertOutcome(row.status);
      return { status:'ok' };
    }
    if (action !== 'reply') {
      if (Object.keys(body).length) throw invalid();
      const [row] = await withActor(tx => tx.query('SELECT nina_channels.staff_inbox_assign($1,$2,$3,$4) AS status',
        [scope.accountId,scope.profileId,id,action==='assume']));
      assertOutcome(row.status);
      if (row.status !== 'ok') throw new Error('Unexpected inbox assignment result');
      return { status:'ok' };
    }
    if (Object.keys(body).length!==2 || typeof body.operation_id!=='string' || !uuid.test(body.operation_id) ||
        typeof body.message!=='string' || !body.message.trim() || body.message.length>MAX_REPLY_LENGTH ||
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
    // The provider already answered: a failure to record it can never look like "not sent".
    try {
      const [completed] = await asActor(tx => tx.query('SELECT nina_channels.staff_chat_finish($1,$2,$3,$4,$5,$6,$7) AS ok',
        [scope.accountId,scope.profileId,id,body.operation_id,result.status,result.providerId ?? null,message]));
      return { status:completed.ok?result.status:'uncertain' };
    } catch (error) {
      log({ event:'whatsapp_reply_unrecorded', code:error.code ?? 'DATABASE_ERROR' });
      return { status:'uncertain' };
    }
  };
}
