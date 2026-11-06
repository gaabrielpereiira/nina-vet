import { ApiError } from './errors.mjs';
import { createAttemptLimiter } from './attempt-limiter.mjs';

const unavailable = () => new ApiError(503, 'VETSOFT_UNAVAILABLE', 'A conexão com o VetSoft está temporariamente indisponível.');
const invalid = () => new ApiError(502, 'VETSOFT_INVALID_RESPONSE', 'O VetSoft não retornou uma resposta válida.');
async function boundedJson(response) {
  if (Number(response.headers.get('content-length')) > 65536 || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    await response.body?.cancel(); throw invalid();
  }
  const reader = response.body?.getReader(); if (!reader) throw invalid();
  const chunks = []; let bytes = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > 65536) { await reader.cancel(); throw invalid(); } chunks.push(Buffer.from(value)); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw invalid(); }
  } finally { reader.releaseLock(); }
}
async function checkStatus(response, login) {
  if (response.ok) return;
  await response.body?.cancel();
  if (response.status === 429) throw new ApiError(503, 'VETSOFT_PROVIDER_LIMIT', 'O limite de consultas do VetSoft foi atingido. Aguarde antes de tentar novamente.');
  if (login && response.status === 401) throw new ApiError(503, 'VETSOFT_AUTH_FAILED', 'O VetSoft não aceitou os dados de acesso. Confira a configuração da conexão.');
  if (response.status === 401 || response.status === 403) throw new ApiError(503, 'VETSOFT_ACCESS_DENIED', 'A conta do VetSoft não permitiu essa consulta.');
  throw unavailable();
}

export function createVetsoftReadOnlyProvider(config, fetcher = fetch, log = () => {}, timeout = 15000) {
  return async () => {
    if (!config?.enabled) throw unavailable();
    const signal = AbortSignal.timeout(timeout), started = Date.now(); let status, stage = 'login';
    const headers = { accept: 'application/json', 'content-type': 'application/json', 'X-Tenant': config.tenant, 'user-agent': 'NinaVet/1.0' };
    try {
      // Fixed destination and operations only. No credentials in URLs or redirects.
      const login = await fetcher('https://api.vetsoft.com.br/login', { method: 'POST', headers,
        redirect: 'error', credentials: 'omit', cache: 'no-store', signal,
        body: JSON.stringify({ email: config.email, password: config.password }) });
      status = login.status; await checkStatus(login, true); const data = await boundedJson(login);
      if (typeof data?.access_token !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(data.access_token) ||
          typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer' ||
          !Number.isInteger(data.expires_in) || data.expires_in < 1 || data.expires_in > 86400) throw invalid();
      stage = 'service_types';
      // Five is the documented minimum page size; do not enumerate patient records.
      const response = await fetcher('https://api.vetsoft.com.br/service-types?per_page=5&status=active', {
        method: 'GET', headers: { ...headers, authorization: 'Bearer ' + data.access_token },
        redirect: 'error', credentials: 'omit', cache: 'no-store', signal });
      status = response.status; await checkStatus(response, false); const result = await boundedJson(response);
      if (!Array.isArray(result?.data) || result.data.length > 5 || result.data.some(item => !item ||
          !Number.isSafeInteger(item.cod_tipo_atendimento) || item.cod_tipo_atendimento < 1 ||
          typeof item.nom_tipo_atendimento !== 'string' || item.nom_tipo_atendimento.length < 1 || item.nom_tipo_atendimento.length > 100)) throw invalid();
      // No token, names, raw responses or pagination URLs reach the browser/logs.
      return { authenticated: true, service_types_readable: true, sample_count: result.data.length,
        checked_at: new Date().toISOString(), elapsed_ms: Date.now() - started, mode: 'read_only',
        patient_sync_enabled: false, appointment_writes_enabled: false };
    } catch (error) {
      log({ event: 'vetsoft_check_failed', stage, code: signal.aborted ? 'TIMEOUT' : error instanceof ApiError ? error.code : 'NETWORK_ERROR',
        http_status: status ?? null, elapsed_ms: Date.now() - started });
      if (error instanceof ApiError) throw error;
      throw unavailable();
    }
  };
}

export function createVetsoftReadOnly(db, auth, config, fetcher, log) {
  const check = createVetsoftReadOnlyProvider(config.vetsoftReadOnly, fetcher, log);
  // Vendor login brute-force limit is five per 15 minutes. Stay below it locally.
  const window = createAttemptLimiter(db, { prefix: 'vetsoft-check-window:', windowSeconds: 900, globalLimit: 3, identityLimit: 3 });
  const daily = createAttemptLimiter(db, { prefix: 'vetsoft-check-day:', windowSeconds: 86400, globalLimit: 10, identityLimit: 5 });
  return async (request, parseBody) => {
    const { user } = await auth.authenticate(request);
    if (!user.roles.includes('admin')) throw new ApiError(403, 'FORBIDDEN', 'Acesso restrito à administração.');
    if (new URL(request.url).search) throw new ApiError(400, 'INVALID_VETSOFT_CHECK', 'Consulta inválida.');
    if (request.method === 'GET') return { enabled: config.vetsoftReadOnly?.enabled === true, mode: 'read_only',
      patient_sync_enabled: false, appointment_writes_enabled: false };
    const body = await parseBody();
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new ApiError(400, 'INVALID_VETSOFT_CHECK', 'Consulta inválida.');
    if (!config.vetsoftReadOnly?.enabled) throw unavailable();
    await window(user.id); await daily(user.id); return check();
  };
}
