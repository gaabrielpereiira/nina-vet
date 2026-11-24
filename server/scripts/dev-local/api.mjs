// API LOCAL com o WhatsApp simulado. Em produção quem roda é server/src/index.mjs.
import { readConfig } from '../../src/config.mjs';
import { createDatabase, assertRuntimeRole } from '../../src/database.mjs';
import { readMigrations } from '../../src/migrations.mjs';
import { createApp } from '../../src/app.mjs';
import { createHttpServer } from '../../src/http.mjs';
import { createChannelWorker } from '../../src/channel-worker.mjs';
import { assertLocal, deliver, simulatedArchive, simulatedProvider } from './simulator.mjs';

const config = readConfig();
assertLocal(config);
const log = entry => console.log(JSON.stringify(entry));
const blocked = async () => { throw new Error('Rede externa bloqueada no ambiente local.'); };
const db = createDatabase(config.database);
await assertRuntimeRole(db);
const migrations = await readMigrations();
const archive = simulatedArchive(config, process.env.ZERNIO_API_KEY);
await archive.prepare();
const app = createApp({ db, config, migrations, log, aiFetch: blocked, vetsoftFetch: blocked,
  whatsappFetch: simulatedProvider(config, event => deliver(app, config, event), log), mediaReady: () => archive.prepare() });
const worker = createChannelWorker({ db, archive, log, config: { ...config, channelProcessing: { ...config.channelProcessing, pollMilliseconds: 500 } } });
// Somente esta máquina: a porta não fica visível na rede local.
const server = createHttpServer(app, config);
server.listen(config.port, 'localhost', () => { log({ event: 'api_listening', port: config.port, whatsapp: 'simulado' }); worker.start(); });
const stop = () => server.close(async () => { await worker.stop(); await db.close(); });
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
