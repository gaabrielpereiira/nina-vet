import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeClient, ClientError, consumeRecoveryToken } from '../src/native/api-client.ts';

test('native client: rehearsal keeps a fixed scenario ID and rejects executed or malformed results', async () => {
  const result = { case_id: 'humano', reply: 'Proposta de encaminhamento.', model: 'test', elapsed_ms: 10,
    simulated: true, clinical_writes: 0, outbound_messages: 0, provider_called: true, blocked_reason: null,
    proposed_action: { name: 'request_human_handoff', args: { reason: 'Pedido fictício', urgent: false } } };
  const calls = [], signal = new AbortController().signal;
  const client = createNativeClient('https://api.nina.example.com', async (url, options) => { calls.push({ url, options }); return Response.json(result); });
  assert.equal((await client.aiRehearsal('humano', signal)).proposed_action.name, 'request_human_handoff');
  assert.equal(calls[0].url, 'https://api.nina.example.com/v1/ai/rehearsals');
  assert.deepEqual(JSON.parse(calls[0].options.body), { case_id: 'humano' }); assert.equal(calls[0].options.credentials, 'include'); assert.equal(calls[0].options.signal, signal);
  for (const patch of [{ simulated: false }, { clinical_writes: 1 }, { outbound_messages: 1 }, { case_id: 'other' },
    { proposed_action: { name: 'send_message', args: {} } }, { proposed_action: { name: 'request_human_handoff', args: { url: 'https://evil.example' } } },
    { proposed_action: { name: 'request_human_handoff', args: { reason: {} } } }, { blocked_reason: 'unknown' }]) {
    await assert.rejects(createNativeClient('https://api.nina.example.com', async () => Response.json({ ...result, ...patch })).aiRehearsal('humano'), { code: 'INVALID_RESPONSE' });
  }
});

test('native client: AI tests send only a scenario ID using native cookie authentication',async()=>{
  const calls=[],signal=new AbortController().signal;
  const client=createNativeClient('https://api.nina.example.com',async(url,options)=>{
    calls.push({url,options});return Response.json(options.body ? {case_id:'preco',reply:'Resposta fictícia.',model:'test-model',elapsed_ms:10} :
      {enabled:true,cases:[{id:'preco',title:'Valor',message:'Exemplo fictício',expectation:'Conferir com a equipe'}]});
  });
  assert.equal((await client.aiTestCases(signal)).cases.length,1); assert.equal((await client.aiTest('preco',signal)).reply,'Resposta fictícia.');
  assert.deepEqual(JSON.parse(calls[1].options.body),{case_id:'preco'});
  for(const {url,options} of calls){assert.equal(url,'https://api.nina.example.com/v1/ai/tests');assert.equal(options.credentials,'include');assert.equal(options.signal,signal);}
});
test('native client: malformed and mismatched AI responses are rejected',async()=>{
  for(const body of [null,{}, {case_id:'other',reply:'Answer',model:'test',elapsed_ms:1}, {case_id:'preco',reply:'',model:'test',elapsed_ms:1}, {case_id:'preco',reply:'Answer',model:'test',elapsed_ms:-1}]) {
    await assert.rejects(createNativeClient('https://api.example.com',async()=>Response.json(body)).aiTest('preco'),{code:'INVALID_RESPONSE'});
  }
  for(const body of [null,{}, {enabled:'true',cases:[]}, {enabled:true,cases:[{}]}]) {
    await assert.rejects(createNativeClient('https://api.example.com',async()=>Response.json(body)).aiTestCases(),{code:'INVALID_RESPONSE'});
  }
});

test('native client: cookie requests use only the configured API origin and never bearer tokens', async () => {
  const calls = [];
  const client = createNativeClient('https://api.nina.example.com', async (url, options) => {
    calls.push({ url, options });
    return Response.json({ user: { id: 'synthetic', roles: ['user'] }, expires_at: '2027-01-01' });
  });
  await client.login(' staff@example.com ', 'Existing-synthetic-password');
  await client.session(); await client.logout();
  assert.equal(calls[0].url, 'https://api.nina.example.com/v1/auth/login');
  assert.deepEqual(JSON.parse(calls[0].options.body), { email: 'staff@example.com', password: 'Existing-synthetic-password' });
  for (const { url, options } of calls) {
    assert.equal(options.credentials, 'include'); assert.equal(options.cache, 'no-store');
    assert.ok(!JSON.stringify(options.headers).toLowerCase().includes('authorization'));
    assert.ok(!url.includes('Existing-synthetic-password'));
  }
  assert.equal(calls[1].options.method, 'GET'); assert.equal(calls[2].options.method, 'POST');
});

test('native client: rejects insecure remote origins and URLs embedding credentials or parameters', () => {
  for (const url of ['http://api.example.com', 'https://user:secret@api.example.com',
    'https://api.example.com/path', 'https://api.example.com?token=secret', 'https://api.example.com#secret']) {
    assert.throws(() => createNativeClient(url));
  }
  assert.doesNotThrow(() => createNativeClient('http://localhost:3000'));
});

test('native client: anonymous session is distinct from network/server failure', async () => {
  assert.equal(await createNativeClient('https://api.example.com', async () => Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 })).session(), null);
  await assert.rejects(createNativeClient('https://api.example.com', async () => { throw new Error('private connection data'); }).session(), error =>
    error instanceof ClientError && error.status === 0 && !error.message.includes('private'));
  await assert.rejects(createNativeClient('https://api.example.com', async () => new Response('private proxy details', { status: 502 })).session(), error =>
    error instanceof ClientError && error.code === 'INVALID_RESPONSE' && !error.message.includes('private'));
});

test('native client: expired protected reads invalidate the UI; invalid login and aborted requests do not', async () => {
  const fetcher = async () => Response.json({ error: { code: 'UNAUTHENTICATED', message: 'secret diagnostic' } }, { status: 401 });
  const client = createNativeClient('https://api.example.com', fetcher); let expired = 0;
  client.onSessionExpired(() => expired++);
  await assert.rejects(client.contacts(), error => error.status === 401 && !error.message.includes('secret'));
  assert.equal(expired, 1);
  await assert.rejects(client.login('a@example.com', 'wrong'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.contacts('', 0, controller.signal));
  assert.equal(expired, 1);
});

test('native client: search/pagination and contact paths keep literal values and abort signals', async () => {
  const calls = []; const signal = new AbortController().signal;
  const client = createNativeClient('https://api.example.com', async (url, options) => {
    calls.push({ url: new URL(url), options }); return Response.json({ data: [], next_offset: null });
  });
  await client.contacts("O'Reilly & filhos", 50, signal); await client.animals('../private/path', 0, signal);
  assert.equal(calls[0].url.searchParams.get('q'), "O'Reilly & filhos");
  assert.equal(calls[0].url.searchParams.get('offset'), '50'); assert.equal(calls[0].url.searchParams.get('limit'), '50');
  assert.equal(calls[0].options.signal, signal); assert.ok(calls[1].url.pathname.includes('..%2Fprivate%2Fpath'));
  assert.equal(calls[1].options.signal, signal);
});

test('native client: invalid pages cannot become a silent empty result or an infinite cursor', async () => {
  for (const body of [{ data: null, next_offset: null }, { data: [], next_offset: -1 }, { data: [], next_offset: 'secret' }]) {
    const client = createNativeClient('https://api.example.com', async () => Response.json(body));
    await assert.rejects(client.contacts(), { code: 'INVALID_RESPONSE' });
  }
});

test('native client: reset bearer is consumed only from the expected fragment before requests', () => {
  const token = 'x'.repeat(43); const replacements = [];
  assert.equal(consumeRecoveryToken({ pathname: '/auth/set-password', hash: '#token=' + token, search: '' }, path => replacements.push(path)), token);
  assert.deepEqual(replacements, ['/auth/set-password']);
  assert.equal(consumeRecoveryToken({ pathname: '/auth', hash: '#token=' + token, search: '' }, () => assert.fail()), '');
  assert.equal(consumeRecoveryToken({ pathname: '/auth/set-password', hash: '', search: '?token=' + token }, () => assert.fail()), '');
  assert.equal(consumeRecoveryToken({ pathname: '/auth/set-password', hash: '#token=invalid', search: '' }, () => {}), '');
});

test('native client: record writes carry operation/version in JSON and keep cookie authentication', async () => {
  const calls=[]; const client=createNativeClient('https://api.example.com',async(url,options)=>{calls.push({url,options});return Response.json({data:{id:'saved',revision:2}});});
  const operation='11111111-1111-4111-8111-111111111111';
  await client.save('contacts/22222222-2222-4222-8222-222222222222',{name:'Edited'},operation,1);
  assert.equal(calls[0].options.method,'POST');assert.equal(calls[0].options.credentials,'include');
  assert.deepEqual(JSON.parse(calls[0].options.body),{data:{name:'Edited'},operation_id:operation,version:1});
  assert.ok(!calls[0].url.includes(operation));
});

test('native client: private attachment links stay on the configured API and reject paths, URLs or query injection',async()=>{
 const calls=[];const client=createNativeClient('https://api.example.com',async(url,options)=>{calls.push({url,options});return Response.json({receiving_enabled:false,processing_enabled:false,media_enabled:false,status:null});});
 const id='ABCDEFAB-1234-4234-8234-ABCDEFABCDEF';
 assert.equal(client.fileUrl(id),'https://api.example.com/v1/files/'+id.toLowerCase());assert.equal(client.fileUrl(id,true),'https://api.example.com/v1/files/'+id.toLowerCase()+'?download=1');
 for(const bad of ['https://attacker.invalid/image','../private','x?token=private','11111111-1111-1111-8111-111111111111'])assert.throws(()=>client.fileUrl(bad));
 const controller=new AbortController();await client.channelStatus(controller.signal);assert.equal(calls[0].url,'https://api.example.com/v1/channels/status');assert.equal(calls[0].options.credentials,'include');assert.equal(calls[0].options.signal,controller.signal);
});
