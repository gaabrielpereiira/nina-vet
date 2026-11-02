import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareClinicImport } from '../server/scripts/prepare-clinic-import.mjs';

const user = '11111111-1111-4111-8111-111111111111';
const contact = '22222222-2222-4222-8222-222222222222';
const animal = '33333333-3333-4333-8333-333333333333';
async function fixture({ orphan = false, tamper = false, missingTable = false, changedColumn = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'nina-clinic-test-'));
  const manifest = JSON.parse(await readFile(new URL('../server/clinic-import-tables.json', import.meta.url), 'utf8'));
  const tables = [];
  let dump = '-- A statement from a source dump must never become executable output.\nDROP SCHEMA dangerous_marker CASCADE;\n';
  dump += `COPY auth.users (id, encrypted_password) FROM stdin;\n${user}\tSECRET_HASH_NEVER_COPY\n\\.\n`;
  dump += 'COPY public.nina_settings (id, whatsapp_access_token) FROM stdin;\n0\tSECRET_TOKEN_NEVER_COPY\n\\.\n';
  for (const [name, columns] of Object.entries(manifest)) {
    if (missingTable && name === 'procedures') continue;
    const row = Object.fromEntries(columns.map(c => [c, '\\N']));
    if (name === 'contacts') Object.assign(row, { id: contact, user_id: user, phone_number: '55000000000', name: "O'Reilly" });
    if (name === 'animals') Object.assign(row, { id: animal, contact_id: orphan ? animal : contact, name: 'Pet de teste' });
    const rows = ['contacts', 'animals'].includes(name) ? [columns.map(c => row[c]).join('\t')] : [];
    const header = changedColumn && name === 'contacts' ? columns.map(c => c === 'name' ? 'unknown_name' : c) : columns;
    dump += 'COPY public.' + name + ' (' + header.join(', ') + ') FROM stdin;\n' + rows.map(r => r + '\n').join('') + '\\.\n';
    tables.push({ schema: 'public', table: name, columns, rows: rows.length });
  }
  const inventory = { complete: true, source_sql: { sha256: createHash('sha256').update(dump).digest('hex') }, tables };
  const dataPath = join(directory, 'data.sql'), inventoryPath = join(directory, 'inventory.json');
  await writeFile(dataPath, dump + (tamper ? '\n-- unexpected change' : ''));
  await writeFile(inventoryPath, JSON.stringify(inventory));
  return { directory, dataPath, inventoryPath, outputDirectory: join(directory, 'prepared') };
}

test('clinic import: only allowlisted COPY data is carried over, with guards and private files', async () => {
  const paths = await fixture();
  try {
    const { report } = await prepareClinicImport(paths);
    assert.equal(report.rows.contacts, 1); assert.equal(report.rows.animals, 1);
    assert.equal(report.applied_to_vps, false);
    const sql = await readFile(join(paths.outputDirectory, 'import.sql'), 'utf8');
    for (const blocked of ['SECRET_HASH_NEVER_COPY', 'SECRET_TOKEN_NEVER_COPY', 'dangerous_marker', 'COPY auth.', 'COPY public.']) assert.ok(!sql.includes(blocked));
    for (const guard of ['ON_ERROR_STOP', 'WRONG_DATABASE', 'SCHEMA_MISMATCH', 'CLINIC_NOT_EMPTY', 'MISSING_NATIVE_USERS', 'IMPORTED_COUNT_MISMATCH']) assert.ok(sql.includes(guard));
    assert.ok(sql.includes("O'Reilly"), 'COPY data is retained without SQL string interpolation');
    assert.equal((await stat(paths.outputDirectory)).mode & 0o777, 0o700);
    assert.equal((await stat(join(paths.outputDirectory, 'import.sql'))).mode & 0o777, 0o600);
    await assert.rejects(prepareClinicImport(paths), { code: 'EEXIST' });
  } finally { await rm(paths.directory, { recursive: true, force: true }); }
});

for (const [option, code] of [['orphan', 'ORPHAN_REFERENCE'], ['tamper', 'SOURCE_CHECKSUM_MISMATCH'],
  ['missingTable', 'INCOMPLETE_DUMP'], ['changedColumn', 'COPY_SCHEMA_MISMATCH']]) {
  test('clinic import: aborts before writing a plan for ' + option, async () => {
    const paths = await fixture({ [option]: true });
    try {
      await assert.rejects(prepareClinicImport(paths), { code });
      await assert.rejects(stat(paths.outputDirectory), { code: 'ENOENT' });
    } finally { await rm(paths.directory, { recursive: true, force: true }); }
  });
}
