import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { loadEdge, postgrest } from './support/edge-harness.mjs';

const { context: vetsoft } = loadEdge('_shared/vetsoft.ts');
const displaySource = readFileSync(new URL('../src/lib/appointment-display.ts', import.meta.url), 'utf8').replace(/^import.*;$/gm, '').replace(/^export /gm, '');
const display = vm.createContext({});
vm.runInContext(ts.transpileModule(displaySource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, display);
const base = { cod_evento: 10, dat_evento: '2026-10-08T12:00:00-03:00' };

test('VetSoft agenda preserves flattened patient, tutor and procedure names independently of the event title', () => {
  const event = vetsoft.normalizeAgendaItem({ ...base, des_evento: 'Atendimento', nom_animal: 'Mel', nom_cliente: 'Ana Souza', nom_servico: 'Ultrassonografia abdominal' });
  assert.equal(event.patient_name, 'Mel');
  assert.equal(event.tutor_name, 'Ana Souza');
  assert.equal(event.procedure_name, 'Ultrassonografia abdominal');
  assert.equal(event.title, 'Atendimento');
});

test('VetSoft agenda reads embedded records and multiple procedures without displaying objects', () => {
  const event = vetsoft.normalizeAgendaItem({ ...base, animal: { cod_animal: 12, nom_animal: 'Thor' }, tutor: { cod_cliente: 4, nom_pessoa: 'João Lima' }, servicos: [{ nom_servico: 'Consulta' }, { servico: { nome: 'Vacinação' } }] });
  assert.equal(event.patient_name, 'Thor');
  assert.equal(event.tutor_name, 'João Lima');
  assert.equal(event.procedure_name, 'Consulta, Vacinação');
  assert.equal(event.animal_external_id, 12);
  assert.equal(event.client_external_id, 4);
  assert.equal(vetsoft.normalizeAgendaItem({ ...base, des_evento: {}, animal: 12 }).patient_name, null);
  assert.equal(vetsoft.normalizeAgendaItem({ ...base, des_evento: {} }).title, 'Agendamento VetSoft');
});

test('calendar prefers VetSoft names, falls back to linked records and keeps manual titles', () => {
  const appointment = { title: 'Atendimento', vetsoft_event_id: 10, metadata: { source: 'vetsoft', vetsoft: { patient_name: 'Mel', tutor_name: 'Ana Souza', procedure_name: 'Ultrassom' } }, animal: { name: 'Nome local' }, contact: { name: 'Apelido local' } };
  assert.equal(display.getAppointmentDetails(appointment).title, 'Mel • Ana Souza');
  assert.equal(display.getAppointmentDetails(appointment).procedure, 'Ultrassom');
  assert.equal(display.getAppointmentDetails({ ...appointment, metadata: null }).title, 'Nome local • Apelido local');
  assert.equal(display.getAppointmentDetails({ title: 'Reunião da equipe', contact: { name: 'Ana' } }).title, 'Reunião da equipe');
  assert.equal(display.getAppointmentDetails({ title: 'Agendamento VetSoft', vetsoft_event_id: 11 }).procedure, null);
});

test('agenda sync persists names without local links, updates imported records and preserves existing metadata and manual appointments', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE nina_settings(timezone text); INSERT INTO nina_settings VALUES ('America/Sao_Paulo');
      CREATE TABLE contacts(id text, name text, vetsoft_client_id int);
      CREATE TABLE animals(id text, name text, vetsoft_animal_id int);
      CREATE TABLE appointments(id text PRIMARY KEY DEFAULT gen_random_uuid()::text, title text, description text, date date, time time, duration int, type text, status text, contact_id text, animal_id text, vetsoft_event_id int, vetsoft_synced_at timestamptz, vetsoft_sync_error text, user_id text, metadata jsonb);
      INSERT INTO contacts VALUES ('tutor','Nome local',4);
      INSERT INTO animals VALUES ('pet','Nome local',12);
      INSERT INTO appointments(id,title,vetsoft_event_id,metadata) VALUES ('known','Antes',10,'{"conversation_id":"preserved"}'),('manual','Manual',NULL,'{"source":"manual"}');
    `);
    const client = postgrest(db);
    let failLookups = false;
    const events = [
      vetsoft.normalizeAgendaItem({ ...base, cod_cliente: 4, cod_animal: 12, nom_cliente: 'Ana Souza', nom_animal: 'Mel', nom_servico: 'Ultrassom' }),
      vetsoft.normalizeAgendaItem({ ...base, cod_evento: 11, cod_cliente: 40, cod_animal: 120, cod_tipo_atendimento: 7 }),
    ];
    const { handler } = loadEdge('vetsoft-import-agenda/index.ts', {
      createClient: () => client, isInternalCall: () => true,
      getVetsoftAccessToken: async () => 'test-token', listAgendaEvents: async () => ({ events }),
      listPets: async () => { if (failLookups) throw new Error('unavailable'); return { pets: [{ external_id: 120, name: 'Nina' }] }; },
      listTutors: async () => { if (failLookups) throw new Error('unavailable'); return { tutors: [{ external_id: 40, name: 'Carlos Santos' }] }; },
      listServiceTypes: async () => [{ id: 7, name: 'Retorno clínico' }],
      startSyncRun: async () => null, finishSyncRun: async () => {},
    });
    const response = await handler(new Request('https://test.example', { method: 'POST', body: JSON.stringify({ user_id: 'admin' }) }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.errors, []);
    assert.equal(result.updated, 1);
    assert.equal(result.created, 1);
    const { rows } = await db.query('SELECT * FROM appointments ORDER BY vetsoft_event_id NULLS LAST');
    assert.equal(rows[0].metadata.vetsoft.patient_name, 'Mel');
    assert.equal(rows[0].metadata.vetsoft.tutor_name, 'Ana Souza');
    assert.equal(rows[0].metadata.vetsoft.procedure_name, 'Ultrassom');
    assert.equal(rows[0].metadata.conversation_id, 'preserved');
    assert.equal(rows[0].contact_id, 'tutor');
    assert.equal(rows[0].animal_id, 'pet');
    assert.equal(rows[1].metadata.vetsoft.patient_name, 'Nina');
    assert.equal(rows[1].metadata.vetsoft.tutor_name, 'Carlos Santos');
    assert.equal(rows[1].metadata.vetsoft.procedure_name, 'Retorno clínico');
    assert.equal(rows[1].contact_id, null);
    assert.equal(rows[2].title, 'Manual');
    assert.deepEqual(rows[2].metadata, { source: 'manual' });
    failLookups = true;
    events[0].patient_name = events[0].tutor_name = events[0].procedure_name = null;
    await db.exec('DELETE FROM contacts; DELETE FROM animals;');
    const retry = await handler(new Request('https://test.example', { method: 'POST', body: '{}' }));
    const retryResult = await retry.json();
    assert.equal(retryResult.warnings.length, 2);
    const preserved = (await db.query("SELECT metadata FROM appointments WHERE id='known'")).rows[0].metadata;
    assert.equal(preserved.vetsoft.patient_name, 'Mel');
    assert.equal(preserved.vetsoft.tutor_name, 'Ana Souza');
    assert.equal(preserved.vetsoft.procedure_name, 'Ultrassom');
  } finally { await db.close(); }
});
