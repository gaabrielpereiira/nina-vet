import { readFile } from 'node:fs/promises';
import { readMigrations } from '../src/migrations.mjs';

const migrations = await readMigrations();
const pilot = migrations.at(-1);
if (migrations.length !== 8 || pilot.version !== '0008_whatsapp_pilot.sql') throw new Error('Unexpected migration history');
const prior = migrations.slice(0, -1).map(m => `('${m.version}','${m.checksum}')`).join(',\n');
const grants = await readFile(new URL('../sql/whatsapp-pilot-role.sql', import.meta.url), 'utf8');
process.stdout.write(`\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(7251030001);
LOCK TABLE nina_meta.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF current_database()<>'nina' OR current_user<>'nina_owner' THEN RAISE EXCEPTION 'PILOT_WRONG_TARGET'; END IF;
  IF (SELECT count(*) FROM nina_meta.schema_migrations)<>7 OR EXISTS (
    SELECT 1 FROM (VALUES ${prior}) expected(version,checksum)
    LEFT JOIN nina_meta.schema_migrations actual USING(version)
    WHERE actual.checksum IS DISTINCT FROM expected.checksum
  ) THEN RAISE EXCEPTION 'PILOT_SCHEMA_CHANGED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='nina_channel_processor'
    AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolbypassrls)
    OR pg_has_role('nina_app','nina_channel_processor','MEMBER')
    THEN RAISE EXCEPTION 'PILOT_UNSAFE_ROLE'; END IF;
END $guard$;
${pilot.sql}
${grants}
INSERT INTO nina_meta.schema_migrations(version,checksum) VALUES('${pilot.version}','${pilot.checksum}');
${process.argv.includes('--commit') ? 'COMMIT' : 'ROLLBACK'};
`);
