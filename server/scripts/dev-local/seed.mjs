// Conversas, animais e agenda FICTÍCIOS para o ambiente local (chamado pelo reset).
import { readConfig, databaseConfig } from '../../src/config.mjs';
import { createDatabase } from '../../src/database.mjs';
import { readMigrations } from '../../src/migrations.mjs';
import { createApp } from '../../src/app.mjs';
import { createChannelWorker } from '../../src/channel-worker.mjs';
import { assertLocal, conversationId, deliver, incoming, mediaUrl, outgoing, receipt, simulatedArchive, tutors } from './simulator.mjs';

const config = readConfig();
assertLocal(config);
const ownerConfig = databaseConfig(process.env, 'MIGRATION_DATABASE_URL');
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(ownerConfig.url).hostname)) throw new Error('Somente banco local.');
const tutor = key => tutors.find(item => item.key === key);
const ago = minutes => new Date(Date.now() - minutes * 60000);
const DAY = 1440;
const foto = { type: 'image', url: mediaUrl('foto.png'), filename: 'foto.png' };
const audio = { type: 'audio', url: mediaUrl('audio.wav'), filename: 'audio.wav', payload: { voice: true } };
const exame = { type: 'file', url: mediaUrl('exame.pdf'), filename: 'exame-thor.pdf' };
// [tutor, minutos atrás, 'in' | 'out', texto, anexos]
const script = [];
const topics = ['Bom dia! O Thor pode tomar banho depois da vacina?', 'Bom dia, Mariana! Pode sim, só aguarde 48 horas.', 'Perfeito, obrigada!',
  'Ele está comendo a ração nova?', 'Está adorando 😄', 'Que ótimo! Qualquer coisa nos chame.'];
for (let i = 0; i < 54; i++) script.push(['mariana', 6 * DAY - i * 95, i % 2 ? 'out' : 'in', topics[i % topics.length]]);
script.push(
  ['mariana', 190, 'in', 'Oi! Queria remarcar o retorno do Thor'], ['mariana', 186, 'out', 'Oi, Mariana! Claro. Você prefere *quinta* ou *sexta*?'],
  ['mariana', 9, 'in', 'Pode ser sexta às 10h?'], ['mariana', 8, 'in', 'E ele precisa estar em jejum?'],
  ['rafael', 35, 'in', 'Boa tarde, a Mel está com o olho vermelho desde ontem'], ['rafael', 34, 'in', 'Mandei uma foto pra vocês verem', [foto]],
  ['beatriz', 300, 'in', 'Olá! Qual o valor da consulta?'], ['beatriz', 280, 'out', 'Olá, Beatriz! Já te passo as informações. É para cão ou gato?'],
  ['beatriz', 262, 'in', 'Para a Luna, uma shih-tzu de 4 anos'], ['beatriz', 70, 'out', 'Obrigada! Separei dois horários para amanhã: 9h30 ou 15h.'],
  ['carlos', 130, 'in', 'O Bob vomitou duas vezes hoje'], ['carlos', 121, 'out', 'Carlos, ele está bebendo água? Notou algo diferente na alimentação?'],
  ['carlos', 22, 'in', 'Bebe pouco. Comeu um pedaço de osso ontem'],
  ['juliana', 55, 'in', null, [audio]],
  ['pedro', 2 * DAY + 60, 'in', 'Vocês atendem aos domingos?'], ['pedro', 2 * DAY + 30, 'out', 'Oi, Pedro! Aos domingos só por agendamento.'],
  ['sofia', 420, 'in', 'Segue o exame que fizemos em outra clínica', [exame]], ['sofia', 400, 'out', 'Recebido, Sofia! Vou encaminhar para avaliação.'],
  ['semnome', 15, 'in', 'Oi, vi vocês no Google. Fazem castração? Mais infos: https://example.com/duvida'],
);
script.sort((a, b) => b[1] - a[1]);

const db = createDatabase(config.database), owner = createDatabase(ownerConfig);
const archive = simulatedArchive(config, process.env.ZERNIO_API_KEY);
const app = createApp({ db, config, migrations: await readMigrations(), log: () => {} });
const problems = [];
const worker = createChannelWorker({ db, config, archive, log: entry => { if (entry.code) problems.push(entry.code); } });
try {
  for (const [key, minutes, direction, text, attachments = []] of script) {
    const person = tutor(key), at = ago(minutes);
    const event = direction === 'in' ? incoming(config, person, { text, attachments, at }) : outgoing(config, conversationId(person.phone), { text, at });
    await deliver(app, config, event);
    if (direction === 'out') await deliver(app, config, receipt(config, minutes > 60 ? 'read' : 'delivered', event.message.platformMessageId, at));
    while (await worker.runOnce());
  }
  if (problems.length) throw new Error('Eventos não processados: ' + problems.join(', '));
  await owner.transaction(async tx => {
    // A ordem de chegada simulada acompanha o horário de cada mensagem.
    await tx.query('UPDATE nina_clinic.messages SET created_at=sent_at');
    const contact = async key => (await tx.query('SELECT id FROM nina_clinic.contacts WHERE phone_number=$1', [tutor(key).phone]))[0].id;
    for (const [key, name, species, breed, sex, birth] of [['mariana', 'Thor', 'Canina', 'Golden Retriever', 'Macho', '2021-03-12'],
      ['mariana', 'Nala', 'Felina', 'SRD', 'Fêmea', '2023-08-02'], ['rafael', 'Mel', 'Felina', 'Siamês', 'Fêmea', '2020-11-20'],
      ['beatriz', 'Luna', 'Canina', 'Shih-tzu', 'Fêmea', '2022-05-01'], ['carlos', 'Bob', 'Canina', 'Beagle', 'Macho', '2018-01-15']]) {
      await tx.query('INSERT INTO nina_clinic.animals(contact_id,name,species,breed,sex,birth_date) VALUES($1,$2,$3,$4,$5,$6)', [await contact(key), name, species, breed, sex, birth]);
    }
    await tx.query("INSERT INTO nina_clinic.procedures(name,category,price_type,price,duration_minutes) VALUES('Consulta clínica (fictícia)','Consulta','fixed',180,30),('Vacina V10 (fictícia)','Vacinação','fixed',95,15)");
    for (const [key, title, days, time, status] of [['mariana', 'Retorno do Thor', 3, '10:00', 'scheduled'], ['mariana', 'Vacina do Thor', -20, '09:30', 'completed'], ['carlos', 'Avaliação do Bob', 1, '16:00', 'confirmed']]) {
      await tx.query("INSERT INTO nina_clinic.appointments(title,date,time,status,contact_id,animal_id) VALUES($1,current_date+$2::int,$3,$4,$5,(SELECT id FROM nina_clinic.animals WHERE contact_id=$5 ORDER BY name DESC LIMIT 1))", [title, days, time, status, await contact(key)]);
    }
    for (const [key, email] of [['beatriz', 'admin@nina-dev.test'], ['carlos', 'equipe@nina-dev.test']]) {
      await tx.query("UPDATE nina_clinic.conversations SET assigned_user_id=(SELECT id FROM nina_auth.users WHERE email=$1) WHERE contact_id=$2", [email, await contact(key)]);
    }
  });
  const [{ conversations, messages }] = await owner.query('SELECT (SELECT count(*)::int FROM nina_clinic.conversations) conversations,(SELECT count(*)::int FROM nina_clinic.messages) messages');
  console.log(JSON.stringify({ event: 'dev_seed_complete', conversations, messages }));
} finally { await db.close(); await owner.close(); }
