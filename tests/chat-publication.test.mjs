import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { checkSchema, migrate, readMigrations } from '../server/src/migrations.mjs';

const adapter = pg => ({ query: async (sql, args = []) => (await pg.query(sql, args)).rows,
  exec: sql => pg.exec(sql), transaction: fn => pg.transaction(tx => fn(adapter(tx))) });
const script = new URL('../server/scripts/prepare-chat.mjs', import.meta.url).pathname.replaceAll('%20', ' ');

test('chat publication: rehearsal leaves no trace; apply, write, revoke and rollback are guarded and reversible', async () => {
  const pg = new PGlite(), db = adapter(pg);
  try {
    const all = await readMigrations(), previous = all.slice(0, 9);
    await migrate(db, previous);
    for (const name of ['runtime-role', 'clinic-runtime-role', 'clinic-write-role', 'zernio-inbox-role', 'channel-processing-role', 'staff-inbox-role']) {
      await db.exec((await readFile(new URL(`../server/sql/${name}.sql`, import.meta.url), 'utf8')).replace('ON DATABASE nina TO', 'ON DATABASE postgres TO'));
    }
    const [{ name, owner, version }] = await db.query("SELECT current_database() name,current_user owner,current_setting('server_version') version");
    assert.match(version, /^17\./);
    const generate = (...args) => execFileSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.match(generate(), /current_database\(\)<>'nina' OR current_user<>'nina_owner'/);
    const run = async (...args) => {
      try { await db.exec(generate(...args).replace('\\set ON_ERROR_STOP on\n', '').replace("current_database()<>'nina'", `current_database()<>'${name}'`).replace("current_user<>'nina_owner'", `current_user<>'${owner}'`)); return 'ok'; }
      catch (error) { await db.exec('ROLLBACK'); return error.message; }
    };
    const installed = async () => (await db.query("SELECT to_regclass('nina_channels.inbox_reads') IS NOT NULL AND to_regprocedure('nina_channels.staff_chat_list(text,text,text,text,integer)') IS NOT NULL AS yes"))[0].yes;
    const may = async (fn, role = 'nina_app') => (await db.query('SELECT coalesce(has_function_privilege($1,to_regprocedure($2),$3),false) AS yes', [role, 'nina_channels.' + fn, 'EXECUTE']))[0].yes;
    const read = 'staff_chat_list(text,text,text,text,integer)', finish = 'staff_chat_finish(text,text,uuid,uuid,text,text,text)', assign = 'staff_inbox_assign(text,text,uuid,boolean)';
    for (const mode of ['--write', '--revoke', '--rollback']) assert.equal(await run(mode, '--commit'), 'CHAT_SCHEMA_CHANGED');
    assert.equal(await run(), 'ok'); assert.equal(await installed(), false);
    assert.equal(await run('--commit'), 'ok'); assert.equal(await installed(), true);
    assert.equal(await checkSchema(db, all), true);
    assert.deepEqual([await may(read), await may(finish), await may(assign)], [true, false, false]);
    assert.equal((await db.query("SELECT has_table_privilege('nina_app','nina_channels.inbox_reads','SELECT') AS yes"))[0].yes, false);
    assert.equal((await db.query("SELECT has_schema_privilege('nina_channel_processor','nina_channels','CREATE') AS yes"))[0].yes, false);
    assert.equal(await run('--commit'), 'CHAT_SCHEMA_CHANGED');
    assert.equal(await run('--write'), 'ok'); assert.equal(await may(finish), false);
    assert.equal(await run('--write', '--commit'), 'ok');
    assert.deepEqual([await may(finish), await may(assign)], [true, true]);
    assert.equal(await run('--revoke', '--commit'), 'ok');
    assert.deepEqual([await may(read), await may(finish), await may(assign)], [true, false, false]);
    assert.equal(await run('--rollback'), 'ok'); assert.equal(await installed(), true);
    assert.equal(await checkSchema(db, previous), false);
    assert.equal(await run('--rollback', '--commit'), 'ok'); assert.equal(await installed(), false);
    assert.equal(await checkSchema(db, previous), true);
    assert.equal(await may('staff_inbox_list(text,text,text,text,integer)'), true);
    assert.equal(await run('--commit'), 'ok'); assert.equal(await checkSchema(db, all), true);
    assert.throws(() => generate('--drop', '--commit'));
  } finally { await pg.close(); }
});
