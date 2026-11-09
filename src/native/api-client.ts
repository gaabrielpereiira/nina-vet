export interface NativeUser { id: string; email: string; full_name: string; roles: ('admin' | 'user')[] }
export interface NativeSession { user: NativeUser; expires_at: string }
export interface Page<T> { data: T[]; next_offset: number | null }
export interface AiTestCase { id: string; title: string; message: string; expectation: string }
export interface AiTestResult { case_id: string; reply: string; model: string; elapsed_ms: number }
export interface AgentSettings {
  company_name: string; assistant_name: string; system_prompt: string; timezone: string;
  business_hours_start: string; business_hours_end: string; business_days: number[];
  scheduling_policy: 'human_only'; response_delay_min: number; response_delay_max: number;
  message_breaking_enabled: boolean; audio_response_requested: boolean; source_scheduling_flag: boolean;
  source_automation_active: boolean; source_auto_response_enabled: boolean; source_model_mode: string;
  source_business_hours_end: string; review_notes: string[];
}
export interface AgentSettingsResponse { configured: boolean; settings: AgentSettings | null;
  imported_at: string | null; payload_sha256: string | null; automatic_replies_enabled: false; appointment_actions_enabled: false }
export interface VetsoftConnectionStatus { enabled: boolean; mode: 'read_only'; patient_sync_enabled: false; appointment_writes_enabled: false }
export interface VetsoftConnectionResult { authenticated: true; service_types_readable: true; sample_count: number;
  checked_at: string; elapsed_ms: number; mode: 'read_only'; patient_sync_enabled: false; appointment_writes_enabled: false }
export interface AiRehearsalCase extends AiTestCase { context: string }
export interface AiRehearsalResult {
  case_id: string; reply: string; model: string | null; elapsed_ms: number;
  simulated: true; clinical_writes: 0; outbound_messages: 0; provider_called: boolean;
  blocked_reason: 'global_paused' | 'contact_blocked' | 'conversation_paused' | 'human_control' | null;
  proposed_action: { name: 'request_human_handoff' | 'propose_appointment' | 'propose_reschedule' | 'propose_cancellation';
    args: Record<string, string | boolean> } | null;
}
export interface Contact {
  revision: number; id: string; name: string | null; call_name: string | null; phone_number: string | null;
  email: string | null; tags: string[] | null; notes: string | null;
  is_blocked: boolean; first_contact_date: string; last_activity: string;
}
export interface Animal { revision: number; contact_id: string; id: string; name: string; species: string | null; breed: string | null;
  sex: string | null; birth_date: string | null; notes: string | null }
export interface Appointment { revision: number; contact_id: string | null; animal_id: string | null; procedure_id: string | null; type: string; id: string; title: string; description: string | null; date: string;
  time: string; status: string | null; contact_name: string | null; animal_name: string | null;
  procedure_name: string | null; duration: number }
export interface MediaAttachment { id: string; position: number; type: string; is_sticker: boolean; voice: boolean; mime: string; bytes: number; filename: string | null }
export interface ChannelStatus { receiving_enabled: boolean; processing_enabled: boolean; media_enabled: boolean; status: null | { scope_matches: boolean; pending: number; processing: number; needs_review: number; processed: number; last_processed_at: string | null } }
export type WhatsAppPilotState =
  | { available: true; status: null; inbound_id: string }
  | { available: false; status: null | 'sending' | 'accepted' | 'rejected' | 'uncertain' };

export interface Message { id: string; conversation_id: string; type: string; from_type: string;
  content: string | null; status: string; sent_at: string; created_at: string; attachments?: MediaAttachment[] }
export interface Procedure { revision: number; id: string; name: string; description: string | null; category: string | null;
  requirements: string | null; price_type: string; price: number | string | null;
  price_min: number | string | null; price_max: number | string | null;
  duration_minutes: number | null; is_active: boolean }

const messages: Record<string, string> = {
  INVALID_AI_TEST: 'Escolha um dos exemplos disponíveis.',
  AI_UNAVAILABLE: 'A conexão com a IA está indisponível. Tente novamente mais tarde.',
  AI_PROVIDER_LIMIT: 'O limite do provedor de IA foi atingido. Tente novamente mais tarde.',
  AI_INVALID_RESPONSE: 'A Nina não conseguiu concluir a resposta. Tente novamente mais tarde.',
  SETTINGS_UNAVAILABLE: 'As configurações da Nina estão temporariamente indisponíveis. Tente novamente mais tarde.',
  PILOT_REPLY_UNAVAILABLE: 'Esta conversa de teste não está disponível. Atualize as mensagens.',
  PILOT_REPLY_INVALID: 'Escreva uma mensagem de até 1.000 caracteres.',
  VETSOFT_UNAVAILABLE: 'A conexão com o VetSoft está temporariamente indisponível.',
  VETSOFT_INVALID_RESPONSE: 'O VetSoft não retornou uma resposta válida. Tente novamente mais tarde.',
  VETSOFT_AUTH_FAILED: 'O VetSoft não aceitou os dados de acesso. Confira a configuração da conexão.',
  VETSOFT_ACCESS_DENIED: 'A conta do VetSoft não permitiu essa consulta.',
  VETSOFT_PROVIDER_LIMIT: 'O limite de consultas do VetSoft foi atingido. Aguarde antes de tentar novamente.',
  INVALID_VETSOFT_CHECK: 'Não foi possível iniciar a verificação. Atualize a página e tente novamente.',
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
    vetsoftStatus: async (signal?: AbortSignal) => {
      const data = await request<VetsoftConnectionStatus>('/v1/integrations/vetsoft', { signal, protected: true });
      if (!data || typeof data.enabled !== 'boolean' || data.mode !== 'read_only' || data.patient_sync_enabled !== false || data.appointment_writes_enabled !== false) throw new ClientError(502, 'INVALID_RESPONSE');
      return data;
    },
    checkVetsoft: async (signal?: AbortSignal) => {
      const data = await request<VetsoftConnectionResult>('/v1/integrations/vetsoft/check', { body: {}, signal, protected: true });
      if (!data || data.authenticated !== true || data.service_types_readable !== true || data.mode !== 'read_only' ||
        data.patient_sync_enabled !== false || data.appointment_writes_enabled !== false || !Number.isInteger(data.sample_count) ||
        data.sample_count < 0 || data.sample_count > 5 || typeof data.checked_at !== 'string' || !Number.isFinite(Date.parse(data.checked_at)) ||
        !Number.isFinite(data.elapsed_ms) || data.elapsed_ms < 0) throw new ClientError(502, 'INVALID_RESPONSE');
      return data;
    },
    agentSettings: async (signal?: AbortSignal) => {
      const data = await request<AgentSettingsResponse>('/v1/agent/settings', { signal, protected: true });
      if (!data || typeof data.configured !== 'boolean' || data.automatic_replies_enabled !== false || data.appointment_actions_enabled !== false ||
        (data.configured !== (data.settings !== null)) || (data.imported_at !== null && typeof data.imported_at !== 'string') ||
        (data.payload_sha256 !== null && !/^[a-f0-9]{64}$/.test(data.payload_sha256)) ||
        (data.settings !== null && (!data.settings || typeof data.settings !== 'object' ||
          !['company_name','assistant_name','system_prompt','timezone','business_hours_start','business_hours_end'].every(k => typeof data.settings?.[k as keyof AgentSettings] === 'string') ||
          data.settings.system_prompt.length > 60000 || data.settings.scheduling_policy !== 'human_only' ||
          !Array.isArray(data.settings.business_days) || data.settings.business_days.length > 7 || data.settings.business_days.some(n => !Number.isInteger(n) || n < 0 || n > 6) ||
          !Array.isArray(data.settings.review_notes) || data.settings.review_notes.length > 10 || data.settings.review_notes.some(n => typeof n !== 'string' || n.length > 500)))) throw new ClientError(502, 'INVALID_RESPONSE');
      return data;
    },
    fileUrl(id: string, download = false) {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) throw new ClientError(400, 'INVALID_QUERY');
      return url.origin + '/v1/files/' + id.toLowerCase() + (download ? '?download=1' : '');
    },
    channelStatus: (signal?: AbortSignal) => request<ChannelStatus>('/v1/channels/status', { signal, protected: true }),
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
    aiRehearsalCases: async (signal?: AbortSignal) => {
      const data = await request<{ enabled: boolean; cases: AiRehearsalCase[] }>('/v1/ai/rehearsals', { signal, protected: true });
      if (!data || typeof data.enabled !== 'boolean' || !Array.isArray(data.cases) || data.cases.length > 10 || data.cases.some(item =>
        !item || !['id', 'title', 'message', 'context', 'expectation'].every(key => typeof item[key as keyof AiRehearsalCase] === 'string'))) throw new ClientError(502, 'INVALID_RESPONSE');
      return data;
    },
    aiRehearsal: async (case_id: string, signal?: AbortSignal) => {
      const result = await request<AiRehearsalResult>('/v1/ai/rehearsals', { body: { case_id }, signal, protected: true });
      if (!result || result.case_id !== case_id || result.simulated !== true || result.clinical_writes !== 0 || result.outbound_messages !== 0 ||
        typeof result.reply !== 'string' || !result.reply.trim() || result.reply.length > 6000 || typeof result.provider_called !== 'boolean' ||
        !(result.model === null || typeof result.model === 'string') || !Number.isFinite(result.elapsed_ms) || result.elapsed_ms < 0 ||
        !(result.blocked_reason === null || ['global_paused', 'contact_blocked', 'conversation_paused', 'human_control'].includes(result.blocked_reason)) ||
        !(result.proposed_action === null || (typeof result.proposed_action === 'object' &&
          ['request_human_handoff', 'propose_appointment', 'propose_reschedule', 'propose_cancellation'].includes(result.proposed_action.name) &&
          result.proposed_action.args && typeof result.proposed_action.args === 'object' && !Array.isArray(result.proposed_action.args) &&
          Object.entries(result.proposed_action.args).length <= 4 && Object.entries(result.proposed_action.args).every(([k, v]) =>
            ['reason', 'urgent', 'pet_name', 'date', 'time', 'appointment_id'].includes(k) &&
            (typeof v === 'boolean' || (typeof v === 'string' && v.length <= 300)))))) throw new ClientError(502, 'INVALID_RESPONSE');
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
    whatsAppPilot: (id: string, signal?: AbortSignal) => request<WhatsAppPilotState>(
      '/v1/clinic/contacts/' + encodeURIComponent(id) + '/whatsapp-pilot', { signal, protected: true }),
    sendWhatsAppPilot: (id: string, inboundId: string, message: string, signal?: AbortSignal) => request<WhatsAppPilotState>(
      '/v1/clinic/contacts/' + encodeURIComponent(id) + '/whatsapp-pilot',
      { body: { inbound_id: inboundId, message }, signal, protected: true }),
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
