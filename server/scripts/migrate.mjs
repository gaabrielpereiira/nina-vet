import { databaseConfig } from '../src/config.mjs';
import { createDatabase } from '../src/database.mjs';
import { migrate, readMigrations } from '../src/migrations.mjs';

let db;
try {
  db = createDatabase(databaseConfig(process.env, 'MIGRATION_DATABASE_URL'));
  const applied = await migrate(db, await readMigrations());
  console.log(JSON.stringify({ event: 'migrations_complete', applied }));
} catch (error) {
  // Database error messages may contain connection details; never print them.
  console.error(JSON.stringify({ event: 'migration_failed', code: error.code ?? 'MIGRATION_ERROR' }));
  process.exitCode = 1;
} finally {
  await db?.close();
}
