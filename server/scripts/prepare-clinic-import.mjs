import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readMigrations } from '../src/migrations.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
const quote = name => '"' + name + '"';

// Extract only COPY data. Never execute or carry over SQL, jobs, secrets or tokens
// from the dump. Use PostgreSQL's own text COPY codec to preserve original values.
export async function prepareClinicImport({ dataPath, inventoryPath, outputDirectory }) {
  const manifest = JSON.parse(await readFile(new URL('../clinic-import-tables.json', import.meta.url), 'utf8'));
  const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
  if (!inventory.complete || !/^[a-f0-9]{64}$/.test(inventory.source_sql?.sha256 ?? '')) fail('INVALID_INVENTORY');
  const tables = new Map(Object.keys(manifest).map(name => [name, { rows: [], ids: new Set() }]));
  const userIds = new Set();
  const refs = [];
  const seen = new Set();
  const sourceHash = createHash('sha256');
  const stream = createReadStream(dataPath);
  stream.on('data', chunk => sourceHash.update(chunk));
  let current;
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    if (!current) {
      if (!line.startsWith('COPY ')) continue;
      const m = line.match(/^COPY ([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*) \(([^)]+)\) FROM stdin;$/);
      if (!m) fail('INVALID_COPY_HEADER');
      const columns = m[3].split(',').map(c => c.trim().replace(/^"([a-z_][a-z0-9_]*)"$/, '$1'));
      if (columns.some(c => !/^[a-z_][a-z0-9_]*$/.test(c))) fail('INVALID_COPY_COLUMN');
      current = { schema: m[1], name: m[2], columns };
      if (current.schema === 'public' && tables.has(current.name)) {
        if (seen.has(current.name) || JSON.stringify(columns) !== JSON.stringify(manifest[current.name])) fail('COPY_SCHEMA_MISMATCH');
        seen.add(current.name);
      }
      continue;
    }
    if (line === '\\.') { current = null; continue; }
    if (current.schema === 'auth' && current.name === 'users') {
      const id = line.split('\t')[current.columns.indexOf('id')];
      if (!uuid.test(id) || userIds.has(id)) fail('INVALID_SOURCE_IDENTITY');
      userIds.add(id);
    }
    if (current.schema !== 'public' || !tables.has(current.name)) continue;
    const fields = line.split('\t');
    if (fields.length !== current.columns.length || line.includes('\0')) fail('INVALID_COPY_ROW');
    const row = Object.fromEntries(current.columns.map((c, i) => [c, fields[i]]));
    const table = tables.get(current.name);
    if (!uuid.test(row.id) || table.ids.has(row.id)) fail('INVALID_RECORD_ID');
    table.ids.add(row.id);
    table.rows.push(line);
    const reference = (field, target) => {
      const id = row[field];
      if (id === '\\N') return;
      if (!uuid.test(id)) fail('INVALID_REFERENCE');
      refs.push({ id, target });
    };
    if (['contacts', 'appointments', 'conversations'].includes(current.name)) reference('user_id', 'users');
    if (['animals', 'appointments', 'conversations'].includes(current.name)) reference('contact_id', 'contacts');
    if (current.name === 'appointments') {
      reference('animal_id', 'animals'); reference('procedure_id', 'procedures');
      if (row.property_id !== '\\N') fail('PROPERTY_DATA_REQUIRES_MIGRATION');
    }
    if (current.name === 'messages') {
      reference('conversation_id', 'conversations'); reference('reply_to_id', 'messages');
    }
  }
  if (current || seen.size !== tables.size || userIds.size === 0) fail('INCOMPLETE_DUMP');
  const sourceSha = sourceHash.digest('hex');
  if (sourceSha !== inventory.source_sql.sha256) fail('SOURCE_CHECKSUM_MISMATCH');
  for (const ref of refs) {
    if (!(ref.target === 'users' ? userIds : tables.get(ref.target).ids).has(ref.id)) fail('ORPHAN_REFERENCE');
  }
  const counts = Object.fromEntries([...tables].map(([name, table]) => {
    const expected = inventory.tables.find(t => t.schema === 'public' && t.table === name);
    if (!expected || expected.rows !== table.rows.length || JSON.stringify(expected.columns) !== JSON.stringify(manifest[name])) fail('ROW_COUNT_MISMATCH');
    return [name, table.rows.length];
  }));
  const migrations = await readMigrations();
  const migrationPredicate = migrations.map(m => '(version = ' + literal(m.version) + ' AND checksum = ' + literal(m.checksum) + ')').join(' OR ');
  const names = [...tables.keys()].map(n => 'nina_clinic.' + n);
  const preamble = [
    '\\set ON_ERROR_STOP on', 'BEGIN;', 'SET LOCAL standard_conforming_strings = on;',
    'SELECT pg_advisory_xact_lock(7251030001);', 'LOCK TABLE ' + names.join(', ') + ' IN SHARE ROW EXCLUSIVE MODE;',
    'DO $nina_import$ BEGIN',
    "IF current_database() <> 'nina' THEN RAISE EXCEPTION 'WRONG_DATABASE'; END IF;",
    'IF NOT (SELECT count(*) = ' + migrations.length + ' AND bool_and(' + migrationPredicate + ") FROM nina_meta.schema_migrations) THEN RAISE EXCEPTION 'SCHEMA_MISMATCH'; END IF;",
    'IF ' + names.map(n => 'EXISTS (SELECT 1 FROM ' + n + ')').join(' OR ') + " THEN RAISE EXCEPTION 'CLINIC_NOT_EMPTY'; END IF;",
    'IF EXISTS (SELECT 1 FROM unnest(ARRAY[' + [...userIds].map(literal).join(',') + ']::uuid[]) AS ids(id) WHERE NOT EXISTS (SELECT 1 FROM nina_auth.users u WHERE u.id = ids.id)) THEN RAISE EXCEPTION \'MISSING_NATIVE_USERS\'; END IF;',
    'END $nina_import$;',
  ].join('\n') + '\n';
  const postamble = [
    'DO $nina_counts$ BEGIN',
    ...[...tables.keys()].map(n => 'IF (SELECT count(*) FROM nina_clinic.' + n + ') <> ' + counts[n] + " THEN RAISE EXCEPTION 'IMPORTED_COUNT_MISMATCH'; END IF;"),
    'END $nina_counts$;',
    'INSERT INTO nina_meta.data_imports (source_sha256, row_counts) VALUES (' + literal(sourceSha) + ', ' + literal(JSON.stringify(counts)) + '::jsonb);',
    'COMMIT;',
    ...[...tables.keys()].map(n => 'SELECT ' + literal(n) + ' AS tabela, count(*) AS registros FROM nina_clinic.' + n + ';'),
  ].join('\n') + '\n';
  const copyStatements = [...tables].map(([name, table]) => ({
    table: name, columns: manifest[name], data: table.rows.join('\n') + (table.rows.length ? '\n' : ''),
  }));
  const sql = preamble + copyStatements.map(s => 'COPY nina_clinic.' + s.table + ' (' + s.columns.map(quote).join(', ') + ') FROM stdin;\n' + s.data + '\\.\n').join('') + postamble;
  // A new private directory avoids overwriting a previous plan or its audit trail.
  await mkdir(outputDirectory, { mode: 0o700 });
  await chmod(outputDirectory, 0o700);
  const report = { prepared_at: new Date().toISOString(), source_sha256: sourceSha,
    sql_sha256: createHash('sha256').update(sql).digest('hex'), rows: counts,
    references_checked: refs.length, native_users_required: userIds.size,
    applied_to_vps: false, secrets_or_queues_included: false };
  await writeFile(resolve(outputDirectory, 'import.sql'), sql, { mode: 0o600, flag: 'wx' });
  await writeFile(resolve(outputDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return { report, preamble, postamble, copyStatements };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 3) {
    console.error('Usage: node server/scripts/prepare-clinic-import.mjs DATA_ONLY_SQL INVENTORY_JSON NEW_PRIVATE_DIRECTORY');
    process.exitCode = 1;
  } else {
    try {
      const { report } = await prepareClinicImport({ dataPath: resolve(args[0]), inventoryPath: resolve(args[1]), outputDirectory: resolve(args[2]) });
      console.log(JSON.stringify(report));
    } catch (error) {
      // Do not log file contents, row values, SQL, e-mails or patient records.
      console.error(JSON.stringify({ event: 'clinic_import_preparation_failed', code: error.code ?? 'PREPARATION_FAILED' }));
      process.exitCode = 1;
    }
  }
}
