import { randomUUID } from 'node:crypto';
import { createAuth } from './auth.mjs';
import { ApiError } from './errors.mjs';
import { assertRuntimeRole } from './database.mjs';
import { checkSchema } from './migrations.mjs';
import { createPasswordRecovery } from './password-recovery.mjs';
import { createClinic } from './clinic.mjs';
import { createClinicWriter } from './clinic-writes.mjs';
import { createAiTests } from './ai-tests.mjs';
import { createAiRehearsals } from './ai-rehearsals.mjs';
import { createAgentSettings } from './agent-settings.mjs';
import { createZernioWebhook } from './zernio-webhook.mjs';
import { createChannelFiles } from './channel-files.mjs';

const MAX_BODY_BYTES = 16 * 1024;

async function jsonBody(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new ApiError(415, 'JSON_REQUIRED', 'Envie os dados em JSON.');
  }
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    throw new ApiError(413, 'BODY_TOO_LARGE', 'Conteúdo muito grande.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'INVALID_JSON', 'Dados inválidos.');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        throw new ApiError(413, 'BODY_TOO_LARGE', 'Conteúdo muito grande.');
      }
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new ApiError(400, 'INVALID_JSON', 'Dados inválidos.'); }
  } finally {
    reader.releaseLock();
  }
}

export function createApp({ db, config, migrations, log = () => {}, aiFetch = fetch, mediaReady = async()=>true }) {
  const auth = createAuth(db, config);
  const recovery = createPasswordRecovery(db, config);
  const clinic = createClinic(db, auth, {mediaEnabled:config.media?.enabled===true});
  const writeClinic = createClinicWriter(db, auth);
  const aiTests = createAiTests(db, auth, config, aiFetch, log);
  const aiRehearsals = createAiRehearsals(db, auth, config, aiFetch, log);
  const agentSettings = createAgentSettings(db, auth);
  const zernioWebhook = createZernioWebhook(db, config.zernio, log);
  const channelFiles = createChannelFiles(db,auth,config);
  return async function handle(request) {
    const requestId = randomUUID();
    const headers = new Headers({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      'x-request-id': requestId,
      vary: 'Origin',
    });
    if (config.production) headers.set('strict-transport-security', 'max-age=31536000');
    const origin = request.headers.get('origin');
    const allowedOrigin = origin === config.frontendOrigin;
    const respond = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status, headers });

    try {
      const path = new URL(request.url).pathname;
      const fileRequest = path.startsWith('/v1/files/');
      if (origin && !allowedOrigin) throw new ApiError(403, 'ORIGIN_DENIED', 'Origem não permitida.');
      if (allowedOrigin) {
        headers.set('access-control-allow-origin', origin);
        headers.set('access-control-allow-credentials', 'true');
        headers.set('access-control-expose-headers', 'X-Request-Id');
      }
      if (request.method === 'OPTIONS') {
        if (!allowedOrigin) throw new ApiError(403, 'ORIGIN_DENIED', 'Origem não permitida.');
        const method = request.headers.get('access-control-request-method');
        const requestedHeaders = (request.headers.get('access-control-request-headers') ?? '')
          .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
        if (!['GET', 'POST', ...(fileRequest?['HEAD']:[])].includes(method) ||
            requestedHeaders.some(value => value !== 'content-type' && !(fileRequest&&value==='range'))) {
          throw new ApiError(403, 'PREFLIGHT_DENIED', 'Requisição não permitida.');
        }
        headers.set('access-control-allow-methods', fileRequest?'GET, HEAD, OPTIONS':'GET, POST, OPTIONS');
        headers.set('access-control-allow-headers', fileRequest?'Content-Type, Range':'Content-Type');
        return respond(null, 204);
      }
      if (!['GET', 'POST', ...(fileRequest?['HEAD']:[])].includes(request.method)) {
        headers.set('allow', 'GET, POST, OPTIONS');
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
      }
      // Only this exact server-to-server route uses HMAC instead of browser CSRF validation.
      const webhook = request.method === 'POST' && path === '/v1/webhooks/zernio';
      // SameSite alone does not protect against other subdomains of the same site.
      if (request.method === 'POST' && !allowedOrigin && !webhook) {
        throw new ApiError(403, 'ORIGIN_REQUIRED', 'Origem não permitida.');
      }
      if (webhook) return respond(await zernioWebhook(request));
      if (request.method === 'GET' && path === '/healthz') return respond({ status: 'ok' });
      if (request.method === 'GET' && path === '/readyz') {
        try {
          await assertRuntimeRole(db);
          // Deploy intake disabled before granting its separate schema. The four
          // existing migrations stay mandatory; unknown/mismatched history fails.
          const channelsEnabled=config.zernio?.enabled||config.channelProcessing?.enabled||config.media?.enabled;
          const optionalVersions = channelsEnabled ? [] : ['0005_zernio_inbox.sql','0006_channel_processing.sql'];
          optionalVersions.push('0007_agent_settings.sql');
          if (await checkSchema(db, migrations, optionalVersions)) {
            if(config.media?.enabled){
              await mediaReady();
              const [access]=await db.query("SELECT has_column_privilege(current_user,'nina_channels.media_files','mime','SELECT') AS allowed");
              if(!access.allowed)return respond({status:'not_ready'},503);
            }
            if(config.channelProcessing?.enabled){
              const [status]=await db.query('SELECT nina_channels.runtime_status($1,$2) AS status',[config.zernio.accountId,config.zernio.profileId]);
              if(!status.status?.scope_matches)return respond({status:'not_ready'},503);
            }
            return respond({ status: 'ready' });
          }
        } catch (error) {
          log({ event: 'readiness_failed', request_id: requestId, code: error.code ?? 'DATABASE_ERROR' });
        }
        return respond({ status: 'not_ready' }, 503);
      }
      if(fileRequest&&['GET','HEAD'].includes(request.method)){
        const response=await channelFiles(request);
        for(const [key,value] of headers)if(key!=='content-type')response.headers.set(key,value);
        response.headers.set('access-control-expose-headers','X-Request-Id, Content-Length, Content-Range, Content-Disposition, Accept-Ranges');
        return response;
      }
      if(request.method==='GET'&&path==='/v1/channels/status'){
        const {user}=await auth.authenticate(request);
        if(!user.roles.includes('admin'))throw new ApiError(403,'FORBIDDEN','Acesso restrito à administração.');
        let status=null;
        if(config.channelProcessing?.enabled){
          [status]=await db.query('SELECT nina_channels.runtime_status($1,$2) AS data',[config.zernio.accountId,config.zernio.profileId]);
          status=status?.data??null;
        }
        return respond({receiving_enabled:config.zernio?.enabled===true,processing_enabled:config.channelProcessing?.enabled===true,media_enabled:config.media?.enabled===true,status});
      }
      if (request.method === 'POST' && path === '/v1/auth/login') {
        const result = await auth.login(await jsonBody(request));
        headers.set('set-cookie', result.cookie);
        return respond(result.body);
      }
      if (request.method === 'POST' && path === '/v1/auth/forgot-password') {
        return respond(await recovery.request(await jsonBody(request)), 202);
      }
      if (request.method === 'POST' && path === '/v1/auth/reset-password') {
        const result = await recovery.reset(await jsonBody(request));
        headers.set('set-cookie', auth.clearCookie());
        return respond(result);
      }
      if (request.method === 'GET' && path === '/v1/auth/session') {
        return respond(await auth.session(request));
      }
      if (request.method === 'POST' && ['/v1/auth/logout', '/v1/auth/logout-all'].includes(path)) {
        const result = await auth.logout(request, path.endsWith('logout-all'));
        headers.set('set-cookie', result.cookie);
        return respond(result.body);
      }
      if (path === '/v1/ai/tests') return respond(await aiTests(request, () => jsonBody(request)));
      if (path === '/v1/ai/rehearsals') return respond(await aiRehearsals(request, () => jsonBody(request)));
      if (path === '/v1/agent/settings' && request.method === 'GET') return respond(await agentSettings(request));
      if (request.method === 'POST' && path.startsWith('/v1/clinic/')) {
        return respond(await writeClinic(request, () => jsonBody(request)));
      }
      if (request.method === 'GET' && path.startsWith('/v1/clinic/')) {
        return respond(await clinic(request));
      }
      throw new ApiError(404, 'NOT_FOUND', 'Recurso não encontrado.');
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.retryAfter) headers.set('retry-after', String(error.retryAfter));
        return respond({ error: { code: error.code, message: error.message }, request_id: requestId }, error.status);
      }
      // Never include SQL, passwords, tokens, request bodies or database URLs in logs.
      log({ event: 'request_failed', request_id: requestId, code: error.code ?? 'INTERNAL_ERROR' });
      return respond({ error: { code: 'INTERNAL_ERROR', message: 'Não foi possível concluir a solicitação.' },
        request_id: requestId }, 500);
    }
  };
}
