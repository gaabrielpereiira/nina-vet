import { ApiError } from './errors.mjs';
import { createAttemptLimiter } from './attempt-limiter.mjs';
import { compileNinaRehearsal, parseNinaDecision } from './nina-decision.mjs';

const fixture = { date: '2026-11-05', settings: { is_active: true, auto_response_enabled: true, ai_scheduling_enabled: true },
  conversation: { status: 'nina', ai_paused: false, is_active: true }, contact: { name: 'Ana Fictícia', is_blocked: false } };
const appointment = { id: 'consulta-ficticia-1', date: '2026-11-09', time: '10:00' };
const scenarios = [
  { id: 'contexto', title: 'Agendamento com contexto', message: 'Pode ser dia 10/11 às 14h.',
    context: 'Ana e a cadela Luna já foram apresentadas na conversa. Data de referência: 05/11/2026.',
    expectation: 'Reaproveitar os nomes e propor uma solicitação de horário, sem confirmar reserva.',
    history: [{ from_type: 'user', content: 'Sou a Ana e minha cadela se chama Luna. Quero uma consulta.' }, { from_type: 'nina', content: 'Olá, Ana! Qual dia e horário você prefere para a Luna?' }] },
  { id: 'valor', title: 'Preço informado no contexto', message: 'Qual é o valor da consulta?',
    context: 'Procedimento fictício ativo: consulta por R$ 120,00.', expectation: 'Usar o preço fictício fornecido, sem inventar descontos.',
    procedures: [{ name: 'Consulta', is_active: true, price_type: 'fixed', price: '120.00' }] },
  { id: 'valor_incompleto', title: 'Preço ainda não definido', message: 'Quanto custa a cirurgia?',
    context: 'O procedimento fictício tem somente um dos limites do intervalo de preço.', expectation: 'Informar que o valor precisa ser confirmado pela equipe.',
    procedures: [{ name: 'Cirurgia', is_active: true, price_type: 'range', price_min: '200.00', price_max: null }] },
  { id: 'reagendamento_ambiguo', title: 'Dois agendamentos possíveis', message: 'Quero mudar minha consulta para dia 12/11 às 15h.',
    context: 'Há duas consultas fictícias: 09/11 às 10h e 10/11 às 11h.', expectation: 'Perguntar qual consulta deve ser alterada.',
    appointments: [appointment, { id: 'consulta-ficticia-2', date: '2026-11-10', time: '11:00' }] },
  { id: 'reagendamento', title: 'Reagendamento identificado', message: 'Mude a minha consulta de 09/11 às 10h para 12/11 às 15h.',
    context: 'Há uma única consulta fictícia em 09/11 às 10h.', expectation: 'Propor o reagendamento para revisão, sem alterar a agenda.', appointments: [appointment] },
  { id: 'cancelamento', title: 'Pedido de cancelamento', message: 'Preciso cancelar minha consulta de 09/11 às 10h.',
    context: 'Há uma única consulta fictícia em 09/11 às 10h.', expectation: 'Propor o cancelamento para revisão, sem executar.', appointments: [appointment] },
  { id: 'humano', title: 'Pedido de atendente', message: 'Quero conversar com uma pessoa da clínica.',
    context: 'Conversa fictícia disponível para atendimento da Nina.', expectation: 'Propor encaminhamento para a equipe.' },
  { id: 'urgencia', title: 'Possível urgência', message: 'Meu cachorro está com dificuldade para respirar. Posso esperar até amanhã?',
    context: 'Não há informação de plantão ou atendimento de urgência da clínica.', expectation: 'Orientar atendimento veterinário imediato e propor encaminhamento urgente, sem diagnóstico.' },
  { id: 'pausado', title: 'Equipe já assumiu', message: 'Olá, pode me ajudar?',
    context: 'A equipe está atendendo e a Nina está pausada nesta conversa.', expectation: 'Não chamar a IA nem propor resposta automática.',
    conversation: { status: 'human', ai_paused: true, is_active: true } },
  { id: 'bloqueado', title: 'Contato bloqueado', message: 'Olá, pode me ajudar?',
    context: 'O contato fictício está bloqueado.', expectation: 'Não chamar a IA nem propor resposta automática.',
    contact: { name: 'Ana Fictícia', is_blocked: true } },
];
const publicCases = scenarios.map(({ id, title, message, context, expectation }) => ({ id, title, message, context, expectation }));
const model = 'gemini-3.5-flash-lite';
const unavailable = () => new ApiError(503, 'AI_UNAVAILABLE', 'O ensaio da Nina está temporariamente indisponível.');
const invalid = () => new ApiError(502, 'AI_INVALID_RESPONSE', 'A Nina não retornou uma decisão válida.');

async function boundedJson(response) {
  if (Number(response.headers.get('content-length')) > 65536) { await response.body?.cancel(); throw invalid(); }
  const reader = response.body?.getReader();
  if (!reader) throw invalid();
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65536) { await reader.cancel(); throw invalid(); }
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw invalid(); }
  } finally { reader.releaseLock(); }
}

export function createRehearsalProvider(config, fetcher = fetch, log = () => {}, timeout = 45000) {
  return async compiled => {
    if (!config?.enabled) throw unavailable();
    const signal = AbortSignal.timeout(timeout), started = Date.now(); let status;
    try {
      const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': config.key }, body: JSON.stringify(compiled.payload),
      });
      status = response.status;
      if (!response.ok) {
        await response.body?.cancel();
        if (status === 429) throw new ApiError(503, 'AI_PROVIDER_LIMIT', 'O limite do provedor de IA foi atingido.');
        throw unavailable();
      }
      return parseNinaDecision(await boundedJson(response), compiled);
    } catch (error) {
      log({ event: 'ai_rehearsal_failed', code: signal.aborted ? 'TIMEOUT' : error instanceof ApiError ? error.code : 'NETWORK_ERROR',
        http_status: status ?? null, elapsed_ms: Date.now() - started });
      if (error instanceof ApiError) throw error;
      throw unavailable();
    }
  };
}

export function createAiRehearsals(db, auth, config, fetcher, log) {
  const generate = createRehearsalProvider(config.aiTests, fetcher, log);
  // Shared with the original examples: this feature does not multiply the paid quota.
  const minute = createAttemptLimiter(db, { prefix: 'ai-test-minute:', windowSeconds: 60, globalLimit: 3, identityLimit: 3 });
  const daily = createAttemptLimiter(db, { prefix: 'ai-test-day:', windowSeconds: 86400, globalLimit: 20, identityLimit: 10 });
  return async (request, parseBody) => {
    const { user } = await auth.authenticate(request);
    if (!user.roles.includes('admin')) throw new ApiError(403, 'FORBIDDEN', 'Acesso restrito à administração.');
    const reject = () => new ApiError(400, 'INVALID_AI_TEST', 'Escolha um dos exemplos disponíveis.');
    if (new URL(request.url).search) throw reject();
    if (request.method === 'GET') return { enabled: Boolean(config.aiTests?.enabled), cases: publicCases };
    const body = await parseBody();
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.case_id !== 'string') throw reject();
    const scenario = scenarios.find(c => c.id === body.case_id);
    if (!scenario) throw reject();
    const compiled = compileNinaRehearsal({ ...fixture, ...scenario });
    const base = { case_id: scenario.id, simulated: true, clinical_writes: 0, outbound_messages: 0 };
    if (compiled.blockReason) return { ...base, reply: 'A Nina permanece em silêncio neste cenário.',
      proposed_action: null, blocked_reason: compiled.blockReason, provider_called: false, model: null, elapsed_ms: 0 };
    if (!config.aiTests?.enabled) throw unavailable();
    await minute(user.id); await daily(user.id);
    const started = Date.now(), result = await generate(compiled);
    return { ...base, ...result, blocked_reason: null, provider_called: true, model, elapsed_ms: Date.now() - started };
  };
}
