import { readFile } from 'node:fs/promises';
import { readMigrations } from '../src/migrations.mjs';

const migrations = await readMigrations();
const inbox = migrations.at(-1);
if (migrations.length !== 9 || inbox.version !== '0009_staff_inbox.sql') throw new Error('Unexpected migration history');
const apply = process.argv.includes('--commit');
const prior = migrations.slice(0,-1).map(m=>`('${m.version}','${m.checksum}')`).join(',\n');
const grants = await readFile(new URL('../sql/staff-inbox-role.sql',import.meta.url),'utf8');
process.stdout.write(`\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(7251030001);
LOCK TABLE nina_meta.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF current_database()<>'nina' OR current_user<>'nina_owner' THEN RAISE EXCEPTION 'INBOX_WRONG_TARGET'; END IF;
  IF (SELECT count(*) FROM nina_meta.schema_migrations)<>8 OR EXISTS (
    SELECT 1 FROM (VALUES ${prior}) expected(version,checksum)
    LEFT JOIN nina_meta.schema_migrations actual USING(version)
    WHERE actual.checksum IS DISTINCT FROM expected.checksum
  ) THEN RAISE EXCEPTION 'INBOX_SCHEMA_CHANGED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='nina_channel_processor'
    AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolbypassrls)
    OR pg_has_role('nina_app','nina_channel_processor','MEMBER')
    THEN RAISE EXCEPTION 'INBOX_UNSAFE_ROLE'; END IF;
END $guard$;
${inbox.sql}
${grants}
INSERT INTO nina_meta.schema_migrations(version,checksum) VALUES('${inbox.version}','${inbox.checksum}');
${apply?'COMMIT':'ROLLBACK'};
`);
