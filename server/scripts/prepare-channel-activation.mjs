// Generate reviewable SQL only. Never connect to or mutate the database here.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {readMigrations} from '../src/migrations.mjs';

export async function prepareChannelActivation(accountId,profileId) {
 if(!/^[a-f0-9]{24}$/.test(accountId??'')||!/^[a-f0-9]{24}$/.test(profileId??''))throw Error('INVALID_CHANNEL_SCOPE');
 const source=await readMigrations();
 if(source.length>8||(source.length>=7&&source[6].version!=='0007_agent_settings.sql')||(source.length===8&&source[7].version!=='0008_whatsapp_pilot.sql'))throw Error('UNEXPECTED_MIGRATION_SOURCE');
 const migrations=source.slice(0,6);
 if(migrations.length!==6||migrations[5].version!=='0006_channel_processing.sql')throw Error('UNEXPECTED_MIGRATION_SOURCE');
 const roleSql=await readFile(new URL('../sql/channel-processing-role.sql',import.meta.url),'utf8');
 const expected=migrations.slice(0,5).map(m=>"('"+m.version+"','"+m.checksum+"')").join(',\n');
 return `\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
SELECT pg_advisory_xact_lock(7251030001);
LOCK TABLE nina_meta.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $guard$
BEGIN
 IF current_database()<>'nina' THEN RAISE EXCEPTION 'WRONG_DATABASE'; END IF;
 IF (SELECT count(*) FROM nina_meta.schema_migrations)<>5 OR EXISTS(
  SELECT 1 FROM (VALUES ${expected}) expected(version,checksum)
  LEFT JOIN nina_meta.schema_migrations actual USING(version)
  WHERE actual.checksum IS DISTINCT FROM expected.checksum
 ) THEN RAISE EXCEPTION 'UNEXPECTED_MIGRATION_HISTORY'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='nina_channel_processor') THEN RAISE EXCEPTION 'PROCESSOR_ROLE_ALREADY_EXISTS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='nina_app' AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls)
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('nina_auth','nina_clinic','nina_channels') AND nspowner='nina_app'::regrole)
 THEN RAISE EXCEPTION 'UNSAFE_RUNTIME_ROLE'; END IF;
END $guard$;
${migrations[5].sql}
${roleSql}
INSERT INTO nina_channels.processor_scope(account_id,profile_id) VALUES('${accountId}','${profileId}');
INSERT INTO nina_meta.schema_migrations(version,checksum) VALUES('${migrations[5].version}','${migrations[5].checksum}');
COMMIT;
`;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{process.stdout.write(await prepareChannelActivation(process.env.ZERNIO_ACCOUNT_ID,process.env.ZERNIO_PROFILE_ID));}
 catch{console.error('Não foi possível preparar a ativação. Confira os IDs e a versão do código.');process.exitCode=1;}
}
