import { readConfig } from './config.mjs';
import { createDatabase, assertRuntimeRole } from './database.mjs';
import { readMigrations } from './migrations.mjs';
import { createApp } from './app.mjs';
import { createHttpServer } from './http.mjs';
import { createMailWorker } from './mail-worker.mjs';
import { createChannelWorker } from './channel-worker.mjs';
import { createMediaArchive } from './channel-media.mjs';

let db;
try {
  const config = readConfig();
  db = createDatabase(config.database);
  await assertRuntimeRole(db);
  const migrations = await readMigrations();
  const log = entry => console.log(JSON.stringify(entry));
  const emailWorker = createMailWorker({ db, config, log });
  const archive=config.media.enabled?createMediaArchive({...config.media,accountId:config.zernio.accountId,apiKey:config.zernio.apiKey}):null;
  if(archive)await archive.prepare();
  const channelWorker=createChannelWorker({db,config,archive,log});
  const server = createHttpServer(createApp({ db, config, migrations, log,mediaReady:()=>archive?.prepare() }), config);
  server.on('error', async error => {
    console.error(JSON.stringify({ event: 'server_failed', code: error.code ?? 'SERVER_ERROR' }));
    await emailWorker.stop();
    await channelWorker.stop();
    await db.close();
    process.exitCode = 1;
  });
  server.listen(config.port, '0.0.0.0', () => {
    log({ event: 'api_listening', port: config.port });
    emailWorker.start();
    channelWorker.start();
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => server.closeAllConnections(), 10000);
    timeout.unref();
    server.close(async () => {
      clearTimeout(timeout);
      await emailWorker.stop();
      await channelWorker.stop();
      await db.close();
    });
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
} catch (error) {
  console.error(JSON.stringify({ event: 'startup_failed', code: error.code ?? 'CONFIGURATION_ERROR' }));
  await db?.close();
  process.exitCode = 1;
}
