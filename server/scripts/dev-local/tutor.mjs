// Faz um tutor fictício mandar uma mensagem para a API local em execução.
// Uso: node --env-file=server/.env server/scripts/dev-local/tutor.mjs mariana "Oi, tudo bem?"
import { readConfig } from '../../src/config.mjs';
import { assertLocal, deliver, incoming, mediaUrl, tutors } from './simulator.mjs';

const config = readConfig();
assertLocal(config);
const [key, text, file] = process.argv.slice(2);
const tutor = tutors.find(item => item.key === key);
if (!tutor || (!text && !file)) {
  console.error('Uso: tutor.mjs <' + tutors.map(item => item.key).join('|') + '> "mensagem" [foto|audio|exame]');
  process.exit(1);
}
const kinds = { foto: ['image', 'foto.png'], audio: ['audio', 'audio.wav'], exame: ['file', 'exame.pdf'] };
const attachments = file ? [{ type: kinds[file][0], url: mediaUrl(kinds[file][1]), filename: kinds[file][1] }] : [];
await deliver(request => fetch(request), config, incoming(config, tutor, { text: text || null, attachments }));
console.log('Mensagem enviada por ' + (tutor.name ?? tutor.phone) + '.');
