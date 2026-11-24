import test from 'node:test';
import assert from 'node:assert/strict';
import { appendOlder, buildTimeline, composerState, createOutbox, dayLabel, displayName, firstUnreadId, listTimeLabel, mergeThread, richText } from '../src/native/chat-logic.ts';

const message = (id, from_type = 'user', sent_at = `2026-11-24T10:${String(id).padStart(2, '0')}:00.000Z`, extra = {}) =>
  ({ id: String(id).padStart(4, '0'), conversation_id: 'c', type: 'text', from_type, content: 'm' + id, status: 'sent', sent_at, created_at: sent_at, ...extra });
const page = (ids, next = null) => ({ conversation: { id: 'c' }, data: ids.map(id => message(id)), next });
const cursor = { at: 'x', id: 'y' };

test('chat: polling keeps older pages, replaces updated rows and restarts after a gap', () => {
  const first = mergeThread(null, page([30, 29, 28], cursor));
  const withOlder = appendOlder(first, page([28, 27, 26], null));
  assert.deepEqual(withOlder.messages.map(m => m.content), ['m30', 'm29', 'm28', 'm27', 'm26']);
  const refreshed = mergeThread(withOlder, page([31, 30, 29], cursor));
  assert.deepEqual(refreshed.messages.map(m => m.content), ['m31', 'm30', 'm29', 'm28', 'm27', 'm26']);
  assert.equal(refreshed.next, null);
  const gap = mergeThread(refreshed, page([59, 58, 57], cursor));
  assert.deepEqual(gap.messages.map(m => m.content), ['m59', 'm58', 'm57']);
  assert.equal(gap.next, cursor);
  assert.deepEqual(mergeThread(refreshed, page([2, 1])).messages.map(m => m.content), ['m2', 'm1']);
});

test('chat: timeline groups by day and author and marks the first unread message', () => {
  const now = new Date(2026, 10, 24, 12);
  const at = (day, hour, minute) => new Date(2026, 10, day, hour, minute).toISOString();
  const list = [message(5, 'user', at(24, 9, 2)), message(4, 'user', at(24, 9, 1)), message(3, 'human', at(24, 9, 0), { author: 'Ana' }), message(2, 'human', at(23, 18, 0), { author: 'Bia' }), message(1, 'user', at(10, 8, 0))];
  assert.equal(firstUnreadId(list, 2), '0004');
  assert.equal(firstUnreadId(list, 99), '0004');
  assert.equal(firstUnreadId(list, 0), null);
  const items = buildTimeline(list, '0004', now);
  assert.deepEqual(items.map(i => i.kind === 'day' ? i.label : i.kind === 'unread' ? '---' : i.message.content + (i.first ? '*' : '')),
    ['10/11/2026', 'm1*', 'Ontem', 'm2*', 'Hoje', 'm3*', '---', 'm4*', 'm5']);
  assert.equal(dayLabel(at(20, 8, 0), now), 'sexta-feira');
  assert.equal(dayLabel('invalid', now), '');
  assert.match(listTimeLabel(at(24, 9, 5), now), /^09:05$/);
});

test('chat: composer opens only for the owner or an unassigned conversation inside the window', () => {
  const now = Date.parse('2026-11-24T12:00:00Z');
  const base = { blocked: false, assignee: null, assigned_to_me: false, reply_until: '2026-11-24T13:00:00Z' };
  assert.equal(composerState(base, true, now), 'assume');
  assert.equal(composerState({ ...base, assignee: 'Eu', assigned_to_me: true }, true, now), 'ready');
  assert.equal(composerState({ ...base, assignee: 'Ana' }, true, now), 'other');
  assert.equal(composerState({ ...base, reply_until: '2026-11-24T11:59:59Z' }, true, now), 'closed');
  assert.equal(composerState({ ...base, reply_until: null }, true, now), 'closed');
  assert.equal(composerState({ ...base, blocked: true }, true, now), 'blocked');
  assert.equal(composerState(base, false, now), 'readonly');
});

test('chat: WhatsApp formatting produces plain tokens, safe links and no partial words', () => {
  assert.deepEqual(richText('Oi *Ana*, veja https://a.example/x?y=1. _ok_ ~não~'), [
    { kind: 'text', value: 'Oi ' }, { kind: 'bold', value: 'Ana' }, { kind: 'text', value: ', veja ' },
    { kind: 'link', value: 'https://a.example/x?y=1' }, { kind: 'text', value: '. ' }, { kind: 'italic', value: 'ok' },
    { kind: 'text', value: ' ' }, { kind: 'strike', value: 'não' }]);
  for (const plain of ['a_b_c', '2*3*4', '* solto *', 'javascript:alert(1)', '<b>x</b>', 'çã_x_é']) {
    assert.deepEqual(richText(plain), [{ kind: 'text', value: plain }]);
  }
  const heavy = '*'.repeat(20000) + '_'.repeat(12000), started = performance.now();
  assert.equal(richText(heavy).map(t => t.value).join('').length > 0, true);
  assert.ok(performance.now() - started < 1500);
  assert.equal(displayName('5551900000008'), '+55 51 90000-0008');
  assert.equal(displayName('Mariana'), 'Mariana');
});

function harness(reply) {
  let next = 0;
  const calls = [], waits = [];
  const outbox = createOutbox({ reply: async (conversation, id, text) => { calls.push([conversation, id, text]); return reply(calls.length, id, text); },
    wait: async ms => { waits.push(ms); }, changed() {}, accepted() {}, newId: () => 'op' + ++next });
  return { outbox, calls, waits, state: () => outbox.items('c').map(i => [i.text, i.status]) };
}
const failure = (status, code) => Object.assign(new Error('falhou'), { status, code });

test('chat outbox: sends one at a time, in order, and waits while the conversation is busy', async () => {
  let busy = true;
  const { outbox, calls, waits, state } = harness(n => { if (n === 2 && busy) { busy = false; throw failure(409, 'INBOX_BUSY'); } return { status: 'accepted' }; });
  await Promise.all([outbox.send('c', 'um'), outbox.send('c', 'dois')]);
  assert.deepEqual(calls.map(c => c[2]), ['um', 'dois', 'dois']);
  assert.equal(calls[1][1], calls[2][1]);
  assert.deepEqual(waits, [3200]);
  assert.deepEqual(state(), [['um', 'accepted'], ['dois', 'accepted']]);
  assert.equal(outbox.pending(), false);
  outbox.confirm('c', [{ operation_id: 'op1' }]);
  assert.deepEqual(state(), [['dois', 'accepted']]);
  outbox.confirm('c', [], Date.now() + 121000);
  assert.deepEqual(state(), []);
});

test('chat outbox: connection loss repeats the same operation; only a definite refusal gets a new one', async () => {
  let offline = true;
  const { outbox, calls, state } = harness(() => { if (offline) throw failure(0, 'NETWORK_ERROR'); return { status: 'accepted' }; });
  await outbox.send('c', 'oi');
  assert.equal(calls.length, 3);
  assert.deepEqual(state(), [['oi', 'failed']]);
  offline = false;
  await outbox.retry('c', 'op1');
  assert.deepEqual([...new Set(calls.map(c => c[1]))], ['op1']);
  assert.deepEqual(state(), [['oi', 'accepted']]);

  const refused = harness(n => ({ status: n === 1 ? 'rejected' : 'accepted' }));
  await refused.outbox.send('c', 'oi');
  assert.deepEqual(refused.state(), [['oi', 'rejected']]);
  await refused.outbox.retry('c', 'op1');
  assert.deepEqual(refused.calls.map(c => c[1]), ['op1', 'op2']);
});

test('chat outbox: an ambiguous send is never repeated and can only be discarded', async () => {
  const { outbox, calls, state } = harness(() => ({ status: 'uncertain' }));
  await outbox.send('c', 'oi');
  await outbox.retry('c', 'op1');
  assert.equal(calls.length, 1);
  assert.deepEqual(state(), [['oi', 'uncertain']]);
  outbox.discard('c', 'op1');
  assert.deepEqual(state(), []);
  const stuck = harness(() => ({ status: 'sending' }));
  await stuck.outbox.send('c', 'oi');
  assert.deepEqual(stuck.state(), [['oi', 'uncertain']]);
  assert.equal(new Set(stuck.calls.map(c => c[1])).size, 1);
});

test('chat outbox: business refusals stop at once and one conversation never blocks another', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { outbox, state } = harness((n, id, text) => { if (text === 'janela') throw failure(409, 'INBOX_WINDOW'); return text === 'lenta' ? gate : { status: 'accepted' }; });
  await outbox.send('c', 'janela');
  assert.deepEqual(state(), [['janela', 'failed']]);
  const slow = outbox.send('c', 'lenta');
  await outbox.send('d', 'rapida');
  assert.deepEqual(outbox.items('d').map(i => i.status), ['accepted']);
  assert.equal(outbox.pending(), true);
  outbox.discard('c', 'op2');
  assert.equal(outbox.items('c').length, 2);
  release({ status: 'accepted' }); await slow;
  assert.equal(outbox.pending(), false);
});
