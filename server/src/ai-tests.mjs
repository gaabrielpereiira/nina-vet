import { ApiError } from './errors.mjs';
import { createAttemptLimiter } from './attempt-limiter.mjs';

// Only these fictional examples can leave the server during this migration stage.
const cases = Object.freeze([
  Object.freeze({ id: 'agendamento', title: 'Pedido de consulta',
    message: 'Olá! Quero marcar uma consulta para meu cachorro. Como faço?',
    expectation: 'Acolher o tutor e pedir as informações necessárias, sem confirmar um horário.' }),
  Object.freeze({ id: 'preco', title: 'Consulta de valor',
    message: 'Quanto custa uma vacina para gato?',
    expectation: 'Explicar que a equipe precisa confirmar a vacina e o valor, sem inventar preços.' }),
  Object.freeze({ id: 'urgencia', title: 'Possível urgência',
    message: 'Meu cachorro está com dificuldade para respirar. Posso esperar até amanhã?',
    expectation: 'Orientar atendimento veterinário imediato, sem diagnosticar nem indicar medicamentos.' }),
]);
const instructions = `Você é a Nina, assistente de recepção da Clínica Vet+.
Este é um ensaio com exemplos fictícios, sem acesso a agenda, cadastros ou procedimentos.
Responda em português brasileiro, de forma acolhedora e objetiva, em até 100 palavras.
Não invente preços, disponibilidade, endereço ou horários. Não afirme que realizou ações.
Para agendar, pergunte o nome do tutor e do animal e a preferência de dia e período;
explique que a equipe precisa confirmar a disponibilidade.
Para valores não fornecidos, diga que precisam ser confirmados pela equipe.
Não faça diagnósticos nem recomende medicamentos ou doses. Diante de dificuldade
para respirar, oriente procurar imediatamente atendimento veterinário de urgência,
sem esperar até o dia seguinte. Não presuma que a clínica atende urgências.
Retorne somente a mensagem de atendimento, em texto simples.`;
const model = 'gemini-3.5-flash-lite';
const unavailable = () => new ApiError(503, 'AI_UNAVAILABLE', 'Os testes da Nina estão temporariamente indisponíveis.');
const invalidResponse = () => new ApiError(502, 'AI_INVALID_RESPONSE', 'A IA não retornou uma resposta completa. Tente novamente mais tarde.');

async function boundedJSON(response) {
  const limit = 64 * 1024;
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel(); throw invalidResponse();
  }
  const reader = response.body?.getReader();
  if (!reader) throw invalidResponse();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw invalidResponse(); }
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw invalidResponse(); }
  } finally { reader.releaseLock(); }
}

export function createGeminiTestProvider(config, fetcher = fetch, timeoutMilliseconds = 45000, log = () => {}) {
  return async scenario => {
    if (!config?.enabled) throw unavailable();
    const started = Date.now();
    const signal = AbortSignal.timeout(timeoutMilliseconds);
    let httpStatus;
    try {
      // No automatic paid retries, and no redirects carrying the API key.
      const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': config.key },
        signal,
        body: JSON.stringify({ systemInstruction: { parts: [{ text: instructions }] },
          contents: [{ role: 'user', parts: [{ text: scenario.message }] }],
          generationConfig: { maxOutputTokens: 512, candidateCount: 1 } }),
      });
      httpStatus = response.status;
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) throw new ApiError(503, 'AI_PROVIDER_LIMIT', 'O limite do provedor de IA foi atingido. Tente novamente mais tarde.');
        throw unavailable();
      }
      const data = await boundedJSON(response);
      const candidate = data?.candidates?.[0];
      if (data?.promptFeedback?.blockReason || candidate?.finishReason !== 'STOP' ||
          !Array.isArray(candidate?.content?.parts)) throw invalidResponse();
      const parts = candidate.content.parts;
      if (parts.some(part => !part || typeof part !== 'object' ||
          (!part.thought && (typeof part.text !== 'string' || Object.keys(part).some(key => !['text','thought','thoughtSignature'].includes(key)))))) throw invalidResponse();
      const reply = parts.filter(part => !part.thought).map(part => part.text).join('\n').trim();
      if (!reply || reply.length > 6000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(reply)) throw invalidResponse();
      return { reply, model };
    } catch (error) {
      log({ event: 'ai_provider_failed', code: signal.aborted ? 'TIMEOUT' :
        error instanceof ApiError ? error.code : 'NETWORK_ERROR',
        http_status: httpStatus ?? null, elapsed_ms: Date.now() - started });
      if (error instanceof ApiError) throw error;
      throw unavailable();
    }
  };
}

export function createAiTests(db, auth, config, fetcher, log) {
  const generate = createGeminiTestProvider(config.aiTests, fetcher, 45000, log);
  const minute = createAttemptLimiter(db, { prefix: 'ai-test-minute:', windowSeconds: 60, globalLimit: 3, identityLimit: 3 });
  const daily = createAttemptLimiter(db, { prefix: 'ai-test-day:', windowSeconds: 86400, globalLimit: 20, identityLimit: 10 });
  return async (request, parseBody) => {
    const { user } = await auth.authenticate(request);
    if (!user.roles.includes('admin')) throw new ApiError(403, 'FORBIDDEN', 'Somente administradores podem testar a Nina.');
    const url = new URL(request.url);
    if (url.search) throw new ApiError(400, 'INVALID_AI_TEST', 'Escolha um dos exemplos disponíveis.');
    if (request.method === 'GET') return { enabled: Boolean(config.aiTests?.enabled), cases };
    const body = await parseBody();
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
        typeof body.case_id !== 'string') throw new ApiError(400, 'INVALID_AI_TEST', 'Escolha um dos exemplos disponíveis.');
    const scenario = cases.find(item => item.id === body.case_id);
    if (!scenario) throw new ApiError(400, 'INVALID_AI_TEST', 'Escolha um dos exemplos disponíveis.');
    if (!config.aiTests?.enabled) throw unavailable();
    await minute(user.id); await daily(user.id);
    const started = Date.now();
    const result = await generate(scenario);
    return { ...result, case_id: scenario.id, elapsed_ms: Date.now() - started };
  };
}
