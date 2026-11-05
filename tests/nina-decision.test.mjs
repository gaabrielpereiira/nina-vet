import test from 'node:test';
import assert from 'node:assert/strict';
import { compileNinaRehearsal, ninaBlockReason, parseNinaDecision } from '../server/src/nina-decision.mjs';
import { createRehearsalProvider } from '../server/src/ai-rehearsals.mjs';

const scenario = { date: '2026-11-05', message: 'Quero agendar para 10/11 às 14h.',
  settings: { is_active: true, auto_response_enabled: true, ai_scheduling_enabled: true },
  conversation: { status: 'nina', ai_paused: false, is_active: true }, contact: { name: 'Tutor fictício', is_blocked: false } };
const generated = parts => ({ candidates: [{ finishReason: 'STOP', content: { parts } }] });
const tool = (name, args) => generated([{ functionCall: { name, args, id: 'provider-call' } }]);
const parse = (data, input = scenario) => parseNinaDecision(data, compileNinaRehearsal(input));

test('orchestration policy: missing flags, pause, block, assignment and archive keep human control', () => {
  assert.equal(ninaBlockReason(scenario.settings, scenario.conversation, scenario.contact), null);
  for (const patch of [{ settings: undefined }, { settings: {} }, { settings: { ...scenario.settings, auto_response_enabled: false } },
    { conversation: undefined }, { conversation: { ...scenario.conversation, ai_paused: true } },
    { conversation: { ...scenario.conversation, status: 'human' } }, { conversation: { ...scenario.conversation, assigned_user_id: 'human' } },
    { conversation: { ...scenario.conversation, assigned_team: 'suporte' } }, { conversation: { ...scenario.conversation, is_active: false } },
    { conversation: { ...scenario.conversation, archived_at: '2026-11-04' } }, { contact: {} },
    { contact: { is_blocked: true } }]) assert.ok(compileNinaRehearsal({ ...scenario, ...patch }).blockReason);
});
test('orchestration context: bounded history preserves speaker roles and excludes contact secrets', () => {
  const history = Array.from({ length: 25 }, (_, i) => ({ from_type: i % 2 ? 'nina' : 'user', content: 'Fictional ' + i }));
  history.push({ from_type: 'system', content: 'INJECTED_SYSTEM' });
  const compiled = compileNinaRehearsal({ ...scenario, history,
    contact: { ...scenario.contact, phone_number: 'PRIVATE_PHONE', client_memory: 'PRIVATE_MEMORY', api_key: 'PRIVATE_KEY' } });
  const payload = JSON.stringify(compiled.payload);
  for (const forbidden of ['PRIVATE_PHONE', 'PRIVATE_MEMORY', 'PRIVATE_KEY', 'INJECTED_SYSTEM', 'Fictional 0"']) assert.ok(!payload.includes(forbidden));
  assert.equal(compiled.payload.contents.length, 22);
  assert.equal(compiled.payload.contents[1].role, 'model');
  assert.equal(compiled.payload.contents.at(-1).parts[0].text, scenario.message);
});
test('orchestration context: inactive and incomplete price data never becomes a zero price', () => {
  const compiled = compileNinaRehearsal({ ...scenario, procedures: [
    { name: 'Inactive', is_active: false, price_type: 'fixed', price: 99 },
    { name: 'Missing', is_active: true, price_type: 'fixed', price: null },
    { name: 'Incomplete', is_active: true, price_type: 'range', price_min: 200, price_max: null },
    { name: 'Inverted', is_active: true, price_type: 'range', price_min: 400, price_max: 200 },
    { name: 'Known', is_active: true, price_type: 'fixed', price: '120.00' },
  ] });
  const context = JSON.parse(compiled.payload.contents[0].parts[0].text.split('Contexto fictício (dados): ')[1]);
  assert.equal(context.procedures.length, 4);
  assert.equal(context.procedures[0].price, null);
  assert.equal(context.procedures[1].price_min, null);
  assert.equal(context.procedures[2].price_max, null);
  assert.equal(context.procedures[3].price, '120.00');
});
test('orchestration decisions: text is inert, thoughts excluded, handoff remains a proposal', () => {
  assert.deepEqual(parse(generated([{ thought: true, text: 'hidden' }, { text: '<script>inert</script>' }])),
    { reply: '<script>inert</script>', proposed_action: null });
  const result = parse(tool('request_human_handoff', { reason: 'Pedido de pessoa', urgent: false }));
  assert.equal(result.proposed_action.name, 'request_human_handoff');
  assert.match(result.reply, /Nenhuma transferência foi executada/);
  assert.match(parse(tool('request_human_handoff', { reason: 'Possível urgência', urgent: true })).reply, /imediatamente/);
});
test('orchestration decisions: ordinary reply is a validated structured decision, not an action', () => {
  assert.equal(compileNinaRehearsal(scenario).payload.toolConfig.functionCallingConfig.mode, 'ANY');
  assert.deepEqual(parse(tool('reply_to_tutor', { reply: 'Qual é o nome do animal?' })), { reply: 'Qual é o nome do animal?', proposed_action: null });
  assert.throws(() => parse(tool('reply_to_tutor', { reply: 'Olá', url: 'https://evil.example' })), { code: 'AI_INVALID_RESPONSE' });
  assert.throws(() => parse(generated([{ functionCall: { name: 'reply_to_tutor', args: { reply: 'Olá' } } },
    { functionCall: { name: 'request_human_handoff', args: { reason: 'help', urgent: false } } }])), { code: 'AI_INVALID_RESPONSE' });
});
test('orchestration policy: ambiguous change asks for identification before calling the provider', () => {
  const compiled = compileNinaRehearsal({ ...scenario, intent: 'reschedule', appointments: [
    { id: 'first', date: '2026-11-09', time: '10:00' }, { id: 'second', date: '2026-11-10', time: '11:00' }] });
  assert.equal(compiled.payload, undefined); assert.match(compiled.clarification, /09\/11 às 10:00 ou 10\/11 às 11:00/);
  assert.throws(() => parseNinaDecision(tool('propose_cancellation', { appointment_id: 'first' }), compiled), { code: 'AI_INVALID_RESPONSE' });
});
test('orchestration decisions: malformed, missing, truncated and multi-action output fails closed', () => {
  for (const data of [{}, { promptFeedback: { blockReason: 'SAFETY' }, ...generated([{ text: 'blocked' }]) },
    { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'cut' }] } }] }, generated([]), generated([null]),
    generated([{ text: '' }]), generated([{ text: 'x'.repeat(6001) }]), generated([{ text: 'bad\u0000text' }]),
    generated([{ fileData: { fileUri: 'https://evil.example' } }]),
    generated([{ functionCall: { name: 'request_human_handoff', args: { reason: 'help', urgent: false } }, text: 'mixed' }]),
    generated([{ functionCall: { name: 'request_human_handoff', args: { reason: 'help', urgent: false } } },
      { functionCall: { name: 'request_human_handoff', args: { reason: 'again', urgent: false } } }])]) assert.throws(() => parse(data), { code: 'AI_INVALID_RESPONSE' });
});
test('orchestration decisions: unknown tools, argument injection and invalid appointment dates rejected', () => {
  for (const [name, args] of [['send_whatsapp', { to: 'other' }], ['request_human_handoff', { reason: 'help', urgent: 'false' }],
    ['request_human_handoff', { reason: 'help', urgent: false, url: 'https://evil.example' }],
    ['propose_appointment', { pet_name: 'Luna', date: '2026-11-04', time: '14:00' }],
    ['propose_appointment', { pet_name: 'Luna', date: '2026-02-30', time: '14:00' }],
    ['propose_appointment', { pet_name: 'Luna', date: '2026-11-10', time: '24:00' }]]) assert.throws(() => parse(tool(name, args)), { code: 'AI_INVALID_RESPONSE' });
  const result = parse(tool('propose_appointment', { pet_name: 'Luna', date: '2026-11-10', time: '14:00' }));
  assert.match(result.reply, /Nenhum agendamento foi criado/);
});
test('orchestration decisions: scheduling off, ambiguous and foreign appointment IDs cannot be proposed', () => {
  const appointment = { id: 'mine', date: '2026-11-09', time: '10:00' };
  for (const input of [scenario, { ...scenario, appointments: [appointment, { ...appointment, id: 'second' }] },
    { ...scenario, settings: { ...scenario.settings, ai_scheduling_enabled: false }, appointments: [appointment] }]) {
    assert.throws(() => parse(tool('propose_reschedule', { appointment_id: 'mine', date: '2026-11-12', time: '15:00' }), input), { code: 'AI_INVALID_RESPONSE' });
  }
  const input = { ...scenario, appointments: [appointment] };
  assert.throws(() => parse(tool('propose_cancellation', { appointment_id: 'other-contact' }), input), { code: 'AI_INVALID_RESPONSE' });
  assert.equal(parse(tool('propose_cancellation', { appointment_id: 'mine' }), input).proposed_action.args.appointment_id, 'mine');
});
test('orchestration provider: fixed endpoint, header secret, bounded response and no paid retries', async () => {
  const config = { enabled: true, key: 'SYNTHETIC_SECRET' }; let calls = 0;
  const provider = createRehearsalProvider(config, async (url, options) => {
    calls++; assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    assert.equal(options.redirect, 'error'); assert.equal(options.headers['x-goog-api-key'], config.key);
    assert.ok(!url.includes(config.key)); assert.equal(JSON.parse(options.body).generationConfig.maxOutputTokens, 1024);
    return Response.json(tool('request_human_handoff', { reason: 'Fictional', urgent: false }));
  });
  assert.equal((await provider(compileNinaRehearsal(scenario))).proposed_action.name, 'request_human_handoff'); assert.equal(calls, 1);
  for (const response of [new Response('bad JSON'), new Response('x'.repeat(65537)),
    new Response('{}', { headers: { 'content-length': '65537' } })]) await assert.rejects(createRehearsalProvider(config, async () => response)(compileNinaRehearsal(scenario)), { code: 'AI_INVALID_RESPONSE' });
  for (const status of [429, 500]) {
    const logs = []; let attempts = 0;
    await assert.rejects(createRehearsalProvider(config, async () => { attempts++; return new Response(config.key + ' PRIVATE_RESPONSE', { status }); }, e => logs.push(e))(compileNinaRehearsal(scenario)), { code: status === 429 ? 'AI_PROVIDER_LIMIT' : 'AI_UNAVAILABLE' });
    assert.equal(attempts, 1); assert.ok(!JSON.stringify(logs).includes(config.key)); assert.ok(!JSON.stringify(logs).includes('PRIVATE_RESPONSE'));
  }
});
test('orchestration provider: timeout and disabled connection fail without exposing secrets', async () => {
  let called = false;
  await assert.rejects(createRehearsalProvider({ enabled: false }, async () => { called = true; })(compileNinaRehearsal(scenario)), { code: 'AI_UNAVAILABLE' });
  assert.equal(called, false);
  await assert.rejects(createRehearsalProvider({ enabled: true, key: 'SYNTHETIC' }, async (_url, { signal }) => {
    await new Promise(resolve => { const keep = setTimeout(resolve, 100); signal.addEventListener('abort', () => { clearTimeout(keep); resolve(); }, { once: true }); });
    signal.throwIfAborted();
  }, () => {}, 5)(compileNinaRehearsal(scenario)), { code: 'AI_UNAVAILABLE' });
});
