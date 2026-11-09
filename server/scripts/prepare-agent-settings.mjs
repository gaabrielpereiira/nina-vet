// Generate reviewable owner-only SQL. No database connection or provider calls.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readMigrations } from '../src/migrations.mjs';
import { validateAgentSettings } from '../src/agent-settings.mjs';

export async function prepareAgentSettingsImport(candidate, expectedSnapshot, { commit = false } = {}) {
  if (!/^[a-f0-9]{64}$/.test(expectedSnapshot ?? '') || !candidate || Object.keys(candidate).length !== 2 ||
      candidate.snapshot_sha256 !== expectedSnapshot || !Object.hasOwn(candidate, 'settings')) throw Error('INVALID_SETTINGS_SOURCE');
  const settings = validateAgentSettings(candidate.settings), data = JSON.stringify(settings);
  const sourceHash = createHash('sha256').update(data).digest('hex');
  let tag = 'nina_settings_' + sourceHash.slice(0, 16); while (data.includes('$' + tag + '$')) tag += 'x';
  const migrations = (await readMigrations()).slice(0, 7);
  if (migrations.length !== 7 || migrations[6].version !== '0007_agent_settings.sql') throw Error('UNEXPECTED_SETTINGS_MIGRATIONS');
  const expected = migrations.slice(0, 6).map(m => "('" + m.version + "','" + m.checksum + "')").join(',');
  const grants = await readFile(new URL('../sql/agent-settings-role.sql', import.meta.url), 'utf8');
  return `\\set ON_ERROR_STOP on
-- Business settings only; no secrets, clinical changes or automated replies.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='90s';
SELECT pg_advisory_xact_lock(7251030001);
LOCK TABLE nina_meta.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF current_database()<>'nina' OR current_user<>'nina_owner' THEN RAISE EXCEPTION 'SETTINGS_WRONG_TARGET'; END IF;
 IF (SELECT count(*) FROM nina_meta.schema_migrations)<>6 OR EXISTS(
  SELECT 1 FROM (VALUES ${expected}) expected(version,checksum) LEFT JOIN nina_meta.schema_migrations actual USING(version)
  WHERE actual.checksum IS DISTINCT FROM expected.checksum) THEN RAISE EXCEPTION 'SETTINGS_SCHEMA_CHANGED'; END IF;
 IF to_regnamespace('nina_agent') IS NOT NULL THEN RAISE EXCEPTION 'SETTINGS_ALREADY_INSTALLED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='nina_app' AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls)
 THEN RAISE EXCEPTION 'SETTINGS_UNSAFE_RUNTIME'; END IF;
END $guard$;
${migrations[6].sql}
${grants}
INSERT INTO nina_meta.schema_migrations(version,checksum) VALUES('${migrations[6].version}','${migrations[6].checksum}');
INSERT INTO nina_agent.settings(payload,source_snapshot_sha256,source_payload_sha256,payload_sha256)
SELECT payload,'${expectedSnapshot}','${sourceHash}',encode(sha256(convert_to(payload::text,'UTF8')),'hex')
FROM(SELECT $${tag}$${data}$${tag}$::jsonb AS payload) AS input;
DO $identity$ DECLARE admin_id uuid; BEGIN
 SELECT u.id INTO admin_id FROM nina_auth.users u JOIN nina_auth.user_roles r ON r.user_id=u.id
 WHERE u.disabled_at IS NULL AND r.role='admin' ORDER BY u.id LIMIT 1;
 IF admin_id IS NULL THEN RAISE EXCEPTION 'SETTINGS_ADMIN_MISSING'; END IF;
 PERFORM set_config('nina.user_id',admin_id::text,true);
END $identity$;
SET LOCAL ROLE nina_app;
DO $limited$ BEGIN
 IF (SELECT count(*) FROM nina_agent.settings)<>1
 OR has_table_privilege(current_user,'nina_agent.settings','INSERT,UPDATE,DELETE')
 OR has_schema_privilege(current_user,'nina_agent','CREATE') THEN RAISE EXCEPTION 'SETTINGS_ACCESS_MISMATCH'; END IF;
 PERFORM set_config('nina.user_id','',true);
 IF (SELECT count(*) FROM nina_agent.settings)<>0 THEN RAISE EXCEPTION 'SETTINGS_ANONYMOUS_ACCESS'; END IF;
END $limited$;
RESET ROLE;
SELECT json_build_object('event','agent_settings_validated','configured',count(*)=1,
 'prompt_bytes',max(octet_length(payload->>'system_prompt')),'end_time',max(payload->>'business_hours_end'),
 'scheduling_policy',max(payload->>'scheduling_policy'),'automatic_replies',false,
 'payload_sha256',max(payload_sha256)) FROM nina_agent.settings;
${commit ? 'COMMIT;' : 'ROLLBACK;'}
`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const source = await readFile(process.argv[2]);
    if (source.length > 131072 || !['rehearse', 'apply'].includes(process.argv[3])) throw Error('INVALID_SETTINGS_INPUT');
    process.stdout.write(await prepareAgentSettingsImport(JSON.parse(source), process.env.EXPECTED_SNAPSHOT_SHA256, { commit: process.argv[3] === 'apply' }));
  } catch { console.error('Não foi possível preparar a configuração. Confira a origem e a versão.'); process.exitCode = 1; }
}
