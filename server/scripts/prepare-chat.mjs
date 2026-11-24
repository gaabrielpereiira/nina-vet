// Gera o SQL da etapa 0010 (chat). Sem --commit, termina em ROLLBACK (ensaio).
//   prepare-chat.mjs              instala leitura e posição de leitura
//   prepare-chat.mjs --write      libera o envio (assumir, devolver e responder)
//   prepare-chat.mjs --revoke     fecha o envio, sem apagar nada
//   prepare-chat.mjs --rollback   remove a 0010; só antes de voltar à API anterior
import { readFile } from 'node:fs/promises';
import { readMigrations } from '../src/migrations.mjs';

const migrations = (await readMigrations()).slice(0,10);
const chat = migrations.at(-1);
if (migrations.length !== 10 || chat.version !== '0010_chat.sql') throw new Error('Unexpected migration history');
const args = process.argv.slice(2);
const modes = args.filter(arg => arg !== '--commit');
if (modes.length > 1 || modes.some(mode => !['--write','--revoke','--rollback'].includes(mode))) throw new Error('Unknown option');
const [mode] = modes;
const apply = args.includes('--commit');
const role = name => readFile(new URL(`../sql/${name}.sql`,import.meta.url),'utf8');
const expected = mode ? migrations : migrations.slice(0,-1);
const write = ['staff_inbox_assign(text,text,uuid,boolean)','staff_inbox_reserve(text,text,uuid,uuid,text)','staff_inbox_finish(text,uuid,uuid,text,text)',
  'staff_chat_finish(text,text,uuid,uuid,text,text,text)'].map(name => 'nina_channels.' + name).join(',');
const steps = {
  undefined: async () => `${chat.sql}\n${await role('chat-role')}
INSERT INTO nina_meta.schema_migrations(version,checksum) VALUES('${chat.version}','${chat.checksum}');`,
  '--write': async () => `${await role('staff-inbox-write-role')}\n${await role('chat-write-role')}`,
  '--revoke': async () => `REVOKE EXECUTE ON FUNCTION ${write} FROM nina_app;`,
  '--rollback': async () => `DROP FUNCTION nina_channels.staff_chat_finish(text,text,uuid,uuid,text,text,text),nina_channels.staff_chat_read(text,text,uuid,uuid),
  nina_channels.staff_chat_thread(text,text,uuid,timestamptz,uuid,boolean),nina_channels.staff_chat_unread(text,text),
  nina_channels.staff_chat_list(text,text,text,text,integer),nina_channels.inbox_unread(uuid);
DROP TABLE nina_channels.inbox_reads;
DELETE FROM nina_meta.schema_migrations WHERE version='${chat.version}' AND checksum='${chat.checksum}';`,
};
process.stdout.write(`\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(7251030001);
LOCK TABLE nina_meta.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF current_database()<>'nina' OR current_user<>'nina_owner' THEN RAISE EXCEPTION 'CHAT_WRONG_TARGET'; END IF;
  IF (SELECT count(*) FROM nina_meta.schema_migrations)<>${expected.length} OR EXISTS (
    SELECT 1 FROM (VALUES ${expected.map(m=>`('${m.version}','${m.checksum}')`).join(',\n')}) expected(version,checksum)
    LEFT JOIN nina_meta.schema_migrations actual USING(version)
    WHERE actual.checksum IS DISTINCT FROM expected.checksum
  ) THEN RAISE EXCEPTION 'CHAT_SCHEMA_CHANGED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='nina_channel_processor'
    AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolbypassrls)
    OR pg_has_role('nina_app','nina_channel_processor','MEMBER')
    OR NOT has_table_privilege('nina_channel_processor','nina_channels.inbox_replies','SELECT')
    THEN RAISE EXCEPTION 'CHAT_UNSAFE_ROLE'; END IF;
END $guard$;
${await steps[mode]()}
${apply?'COMMIT':'ROLLBACK'};
`);
