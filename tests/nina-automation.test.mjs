import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function loadFunction(path, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\s*$/gm, '')
    .replace(/^export /gm, '');
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const context = vm.createContext({ console: { log() {}, error() {} }, ...globals });
  vm.runInContext(code, context);
  return context;
}

const { getNinaAutomationBlockReason } = loadFunction('../supabase/functions/_shared/nina-automation.ts');

function database({ active = true, automatic = true, missing = false, queryError = null, status = 'nina', paused = false, archived = false, zernioConversationId = 'zernio-conversation-1' } = {}) {
  const writes = [];
  const reads = [];
  const db = {
    writes, reads,
    from(table) {
      let update;
      const filters = {};
      const result = () => {
        if (update) {
          writes.push({ table, update, filters });
          return { data: null, error: null };
        }
        reads.push(table);
        if (table === 'nina_settings') return {
          data: missing ? null : { is_active: active, auto_response_enabled: automatic }, error: queryError,
        };
        if (table === 'contacts') return { data: { phone_number: '5511999999999' }, error: null };
        if (table === 'conversations') return { data: {
          id: 'conversation-1', status, ai_paused: paused, archived_at: archived ? '2026-10-08' : null,
          zernio_conversation_id: zernioConversationId,
        }, error: null };
        throw new Error(`Unexpected read: ${table}`);
      };
      const builder = {
        select() { return builder; },
        order() { return builder; },
        limit() { return builder; },
        eq(key, value) { filters[key] = value; return builder; },
        update(value) { update = value; return builder; },
        insert(value) { update = value; return builder; },
        maybeSingle() { return Promise.resolve(result()); },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      return builder;
    },
  };
  return db;
}

function senderHarness() {
  const requests = [];
  const context = loadFunction('../supabase/functions/whatsapp-sender/index.ts', {
    Deno: { env: { get: () => 'test-key' } },
    serve() {},
    getNinaAutomationBlockReason,
    fetch: async (...args) => {
      requests.push(args);
      return { ok: true, json: async () => ({ data: { messageId: 'wa-1' } }) };
    },
  });
  return { send: context.sendMessage, requests };
}

function item(from = 'nina', type = 'text') {
  return {
    id: 'queue-1', conversation_id: 'conversation-1', contact_id: 'contact-1',
    from_type: from, message_type: type, content: 'Olá',
    media_url: type === 'audio' ? 'https://example.com/audio.mp3' : null,
  };
}

for (const settings of [{ active: false }, { automatic: false }, { missing: true }]) {
  test(`blocks automatic replies for ${JSON.stringify(settings)}`, async () => {
    const db = database(settings);
    const sender = senderHarness();
    assert.equal(await sender.send(db, { zernio_account_id: 'account-1' }, item()), false);
    assert.equal(sender.requests.length, 0);
    assert.ok(db.writes.some(w => w.table === 'send_queue' && w.update.status === 'failed'));
  });
}

test('blocks queued audio while Nina is paused', async () => {
  const sender = senderHarness();
  assert.equal(await sender.send(database({ automatic: false }), {}, item('nina', 'audio')), false);
  assert.equal(sender.requests.length, 0);
});

test('still sends human messages while Nina is disabled', async () => {
  const sender = senderHarness();
  const db = database({ active: false, automatic: false });
  assert.equal(await sender.send(db, { zernio_account_id: 'account-1' }, { ...item('human'), message_id: 'message-1' }), true);
  assert.equal(sender.requests.length, 1);
  assert.ok(!db.reads.includes('nina_settings'));
  assert.ok(db.writes.some(w => w.table === 'messages' && w.update.status === 'sent'));
});

test('sends Nina replies after reactivation', async () => {
  const sender = senderHarness();
  assert.equal(await sender.send(database(), { zernio_account_id: 'account-1' }, item()), true);
  assert.equal(sender.requests.length, 1);
});

for (const conversation of [{ paused: true }, { status: 'human' }, { status: 'paused' }, { archived: true }]) {
  test(`global reactivation preserves conversation restriction ${JSON.stringify(conversation)}`, async () => {
    const sender = senderHarness();
    assert.equal(await sender.send(database(conversation), {}, item()), false);
    assert.equal(sender.requests.length, 0);
  });
}

test('rereads the global switch for each queued chunk instead of caching it', async () => {
  const sender = senderHarness();
  assert.equal(await sender.send(database(), {}, item()), true);
  assert.equal(await sender.send(database({ automatic: false }), {}, item()), false);
  assert.equal(sender.requests.length, 1);
});

test('does not send if reading the switch fails', async () => {
  const sender = senderHarness();
  await assert.rejects(sender.send(database({ queryError: new Error('database unavailable') }), {}, item()), /database unavailable/);
  assert.equal(sender.requests.length, 0);
});

test('orchestrator consumes incoming work without generating a reply during the global pause', async () => {
  const db = database({ automatic: false });
  db.rpc = async () => ({ data: [{ id: 'processing-1', conversation_id: 'conversation-1' }], error: null });
  let handler;
  loadFunction('../supabase/functions/nina-orchestrator/index.ts', {
    Deno: { env: { get: () => 'test-key' } },
    serve(fn) { handler = fn; },
    createClient: () => db,
    getNinaAutomationBlockReason,
    Response,
  });
  const response = await handler({ method: 'POST' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).processed, 0);
  assert.deepEqual(db.reads, ['nina_settings']);
  assert.ok(db.writes.some(w => w.table === 'nina_processing_queue' && w.update.status === 'completed'));
});

for (const zernioConversationId of ['zernio-conversation-1', null]) {
  test(`sends a real Zernio template payload with ordered variables (conversation=${zernioConversationId})`, async () => {
    const sender = senderHarness();
    const queued = { ...item(), metadata: { template: { name: 'consulta', language: 'pt_BR', variables: { '2': 'Consulta', '1': 'Tutor' } } } };
    assert.equal(await sender.send(database({ zernioConversationId }), { zernio_account_id: 'account-1' }, queued), true);
    const body = JSON.parse(sender.requests[0][1].body);
    assert.equal(body.templateName, 'consulta');
    assert.equal(body.templateLanguage, 'pt_BR');
    assert.deepEqual(body.templateParams, ['Tutor', 'Consulta']);
    assert.equal(body.message, undefined, 'template must not be dispatched as plain text');
    if (!zernioConversationId) assert.equal(body.participantId, '5511999999999');
  });
}
