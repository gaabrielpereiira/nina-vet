export interface NativeUser { id: string; email: string; full_name: string; roles: ('admin' | 'user')[] }
export interface NativeSession { user: NativeUser; expires_at: string }
export interface Page<T> { data: T[]; next_offset: number | null }
export interface AiTestCase { id: string; title: string; message: string; expectation: string }
export interface AiTestResult { case_id: string; reply: string; model: string; elapsed_ms: number }
export interface Contact {
  revision: number; id: string; name: string | null; call_name: string | null; phone_number: string;
  email: string | null; tags: string[] | null; notes: string | null;
  is_blocked: boolean; first_contact_date: string; last_activity: string;
}
export interface Animal { revision: number; contact_id: string; id: string; name: string; species: string | null; breed: string | null;
  sex: string | null; birth_date: string | null; notes: string | null }
export interface Appointment { revision: number; contact_id: string | null; animal_id: string | null; procedure_id: string | null; type: string; id: string; title: string; description: string | null; date: string;
  time: string; status: string | null; contact_name: string | null; animal_name: string | null;
  procedure_name: string | null; duration: number }
export interface Message { id: string; conversation_id: string; type: string; from_type: string;
  content: string | null; status: string; sent_at: string; created_at: string }
export interface Procedure { revision: number; id: string; name: string; description: string | null; category: string | null;
  requirements: string | null; price_type: string; price: number | string | null;
  price_min: number | string | null; price_max: number | string | null;
  duration_minutes: number | null; is_active: boolean }

const messages: Record<string, string> = {
  INVALID_AI_TEST: 'Escolha um dos exemplos disponíveis.',
  AI_UNAVAILABLE: 'A conexão com a IA está indisponível. Tente novamente mais tarde.',
  AI_PROVIDER_LIMIT: 'O limite do provedor de IA foi atingido. Tente novamente mais tarde.',
  AI_INVALID_RESPONSE: 'A Nina não conseguiu concluir a resposta. Tente novamente mais tarde.',
  BODY_TOO_LARGE: 'Reduza o tamanho das observações e tente novamente.',
  VERSION_CONFLICT: 'Outra pessoa alterou este registro. Feche a edição, atualize a página e confira os dados antes de editar novamente.',
  IDEMPOTENCY_CONFLICT: 'Esta operação já foi recebida. Feche a edição e atualize a página para conferir o resultado.',
  DUPLICATE_PHONE: 'Já existe um tutor com esse telefone. Procure o cadastro existente.',
  INVALID_RECORD: 'Confira os campos obrigatórios e os limites de cada campo.',
  INVALID_PHONE: 'Informe um telefone válido com DDI e DDD, usando de 8 a 15 dígitos.',
  INVALID_EMAIL: 'Confira o formato do e-mail.',
  INVALID_DATE: 'Confira as datas. O nascimento não pode estar no futuro.',
  INVALID_TIME: 'Informe um horário válido.',
  INVALID_DURATION: 'Informe uma duração entre 5 e 1440 minutos.',
  INVALID_PRICE: 'Confira os valores e o intervalo de preços.',
  INVALID_LINK: 'Confira o tutor, o animal e o procedimento. O animal deve pertencer ao tutor e o procedimento deve estar ativo.',
  FORBIDDEN: 'Sua conta não tem permissão para esta alteração.',
  INVALID_CREDENTIALS: 'E-mail ou senha inválidos.',
  TOO_MANY_ATTEMPTS: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
  AUTH_BUSY: 'Aguarde um instante antes de tentar novamente.',
  EMAIL_UNAVAILABLE: 'A recuperação de senha está temporariamente indisponível. Entre em contato com a clínica.',
  RESET_LINK_INVALID: 'Este link expirou ou já foi usado. Solicite um novo link.',
  WEAK_PASSWORD: 'Use uma senha com pelo menos 12 caracteres.',
  NOT_FOUND: 'Cadastro não encontrado.',
  UNAUTHENTICATED: 'Sua sessão terminou. Entre novamente.',
};
export class ClientError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(messages[code] ?? 'Não foi possível concluir. Tente novamente.');
    this.status = status; this.code = code;
  }
}

export function createNativeClient(base: string, fetcher: typeof fetch = fetch) {
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Invalid Nina API origin');
  }
  let expired: (() => void) | undefined;
  async function request<T>(path: string, options: { body?: object; signal?: AbortSignal; protected?: boolean } = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(url.origin + path, { method: options.body ? 'POST' : 'GET',
        credentials: 'include', cache: 'no-store', signal: options.signal,
        headers: options.body ? { 'content-type': 'application/json' } : {},
        ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ClientError(0, 'NETWORK_ERROR');
    }
    if (response.status === 401 && options.protected && !options.signal?.aborted) expired?.();
    let body: unknown;
    try { body = await response.json(); } catch { throw new ClientError(response.status, 'INVALID_RESPONSE'); }
    if (!response.ok) {
      const code = typeof body === 'object' && body !== null && 'error' in body &&
        typeof body.error === 'object' && body.error !== null && 'code' in body.error && typeof body.error.code === 'string'
        ? body.error.code : 'REQUEST_FAILED';
      throw new ClientError(response.status, code);
    }
    return body as T;
  }
  async function list<T>(resource: string, params: Record<string, string | number | undefined>, signal?: AbortSignal) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') query.set(key, String(value));
    const page = await request<Page<T>>('/v1/clinic/' + resource + '?' + query.toString(), { signal, protected: true });
    if (!Array.isArray(page.data) || !(page.next_offset === null || (Number.isInteger(page.next_offset) && page.next_offset >= 0))) {
      throw new ClientError(502, 'INVALID_RESPONSE');
    }
    return page;
  }
  return {
    onSessionExpired(handler?: () => void) { expired = handler; },
    async session(signal?: AbortSignal): Promise<NativeSession | null> {
      try { return await request<NativeSession>('/v1/auth/session', { signal }); }
      catch (error) { if (error instanceof ClientError && error.status === 401) return null; throw error; }
    },
    login: (email: string, password: string) => request<NativeSession>('/v1/auth/login', { body: { email: email.trim(), password } }),
    logout: () => request<{ ok: boolean }>('/v1/auth/logout', { body: {}, protected: true }),
    forgot: (email: string) => request<{ message: string }>('/v1/auth/forgot-password', { body: { email: email.trim() } }),
    reset: (token: string, password: string) => request<{ ok: boolean }>('/v1/auth/reset-password', { body: { token, password } }),
    aiTestCases: async (signal?: AbortSignal) => {
      const data = await request<{ enabled: boolean; cases: AiTestCase[] }>('/v1/ai/tests', { signal, protected: true });
      if (!data || typeof data !== 'object' || typeof data.enabled !== 'boolean' || !Array.isArray(data.cases) || data.cases.length > 10 || data.cases.some(item =>
        !item || !['id','title','message','expectation'].every(key => typeof item[key as keyof AiTestCase] === 'string'))) {
        throw new ClientError(502, 'INVALID_RESPONSE');
      }
      return data;
    },
    aiTest: async (case_id: string, signal?: AbortSignal) => {
      const result = await request<AiTestResult>('/v1/ai/tests', { body: { case_id }, signal, protected: true });
      if (!result || typeof result !== 'object' || result.case_id !== case_id || typeof result.reply !== 'string' || !result.reply.trim() || result.reply.length > 6000 ||
          typeof result.model !== 'string' || !Number.isFinite(result.elapsed_ms) || result.elapsed_ms < 0) throw new ClientError(502, 'INVALID_RESPONSE');
      return result;
    },
    contacts: (q = '', offset = 0, signal?: AbortSignal) => list<Contact>('contacts', { q, limit: 50, offset }, signal),
    contact: async (id: string, signal?: AbortSignal) => (await request<{ data: Contact }>('/v1/clinic/contacts/' + encodeURIComponent(id), { signal, protected: true })).data,
    animals: (id: string, offset = 0, signal?: AbortSignal, q = '') => list<Animal>('contacts/' + encodeURIComponent(id) + '/animals', { limit: 50, offset, q }, signal),
    animal: async (contact: string, id: string, signal?: AbortSignal) => (await request<{ data: Animal }>('/v1/clinic/contacts/' + encodeURIComponent(contact) + '/animals/' + encodeURIComponent(id), { signal, protected: true })).data,
    appointment: async (id: string, signal?: AbortSignal) => (await request<{ data: Appointment }>('/v1/clinic/appointments/' + encodeURIComponent(id), { signal, protected: true })).data,
    procedure: async (id: string, signal?: AbortSignal) => (await request<{ data: Procedure }>('/v1/clinic/procedures/' + encodeURIComponent(id), { signal, protected: true })).data,
    save: (resource: string, data: Record<string, unknown>, operation_id: string, version?: number) =>
      request<{ data: { id: string; revision: number } }>('/v1/clinic/' + resource, { body: { data, operation_id, ...(version === undefined ? {} : { version }) }, protected: true }),
    contactAppointments: (id: string, offset = 0, signal?: AbortSignal) => list<Appointment>('contacts/' + encodeURIComponent(id) + '/appointments', { limit: 20, offset }, signal),
    contactMessages: (id: string, offset = 0, signal?: AbortSignal) => list<Message>('contacts/' + encodeURIComponent(id) + '/messages', { limit: 30, offset }, signal),
    appointments: (from: string, to: string, offset = 0, signal?: AbortSignal) => list<Appointment>('appointments', { from, to, limit: 50, offset }, signal),
    procedures: (q = '', offset = 0, signal?: AbortSignal) => list<Procedure>('procedures', { q, limit: 50, offset }, signal),
  };
}

export function consumeRecoveryToken(location: Pick<Location, 'pathname' | 'hash' | 'search'>, replace: (path: string) => void) {
  if (location.pathname !== '/auth/set-password') return '';
  const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
  // Consume once at app bootstrap, before React StrictMode or any network request.
  if (location.hash) replace(location.pathname + location.search);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '';
}
