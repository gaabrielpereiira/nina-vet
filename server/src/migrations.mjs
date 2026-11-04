import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

export async function readMigrations(directory = new URL('../migrations/', import.meta.url)) {
  const names = (await readdir(directory)).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (!names.length) throw new Error('No API migrations found');
  return Promise.all(names.map(async version => {
    const sql = await readFile(new URL(version, directory), 'utf8');
    return { version, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}

export async function migrate(db, migrations) {
  return db.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(7251030001)');
    await tx.exec(`
      CREATE SCHEMA IF NOT EXISTS nina_meta;
      REVOKE ALL ON SCHEMA nina_meta FROM PUBLIC;
      CREATE TABLE IF NOT EXISTS nina_meta.schema_migrations (
        version text PRIMARY KEY,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
      REVOKE ALL ON nina_meta.schema_migrations FROM PUBLIC;
    `);
    const existing = await tx.query('SELECT version, checksum FROM nina_meta.schema_migrations ORDER BY version');
    for (const [i, entry] of existing.entries()) {
      if (migrations[i]?.version !== entry.version || migrations[i]?.checksum !== entry.checksum) {
        throw new Error('Migration history differs from the API source; aborting');
      }
    }
    const applied = [];
    for (const migration of migrations) {
      if (existing.some(m => m.version === migration.version)) continue;
      await tx.exec(migration.sql);
      await tx.query('INSERT INTO nina_meta.schema_migrations (version, checksum) VALUES ($1, $2)',
        [migration.version, migration.checksum]);
      applied.push(migration.version);
    }
    return applied;
  });
}

export async function checkSchema(db, migrations, optionalVersions = []) {
  const existing = await db.query('SELECT version, checksum FROM nina_meta.schema_migrations ORDER BY version');
  return existing.length <= migrations.length && existing.every((m, i) =>
    m.version === migrations[i].version && m.checksum === migrations[i].checksum) &&
    migrations.slice(existing.length).every(m => optionalVersions.includes(m.version));
}
