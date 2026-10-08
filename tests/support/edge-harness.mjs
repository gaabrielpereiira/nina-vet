import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

export function loadEdge(path, globals = {}) {
  const source = readFileSync(new URL(`../../supabase/functions/${path}`, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\s*$/gm, '').replace(/^export /gm, '');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  let handler;
  const context = vm.createContext({
    console: { log() {}, error() {}, warn() {} }, Response, Request, Headers, URL,
    TextEncoder, TextDecoder, Uint8Array, crypto, btoa, atob, AbortController, setTimeout, clearTimeout,
    Deno: { env: { get: (name) => ({ SUPABASE_URL: 'https://test.example', SUPABASE_SERVICE_ROLE_KEY: 'service-key' })[name] }, serve(fn) { handler = fn; } },
    serve(fn) { handler = fn; },
    ...globals,
  });
  vm.runInContext(code, context);
  return { context, handler };
}

// Small PostgREST query adapter over actual PostgreSQL for integration tests.
// Values are always parameters, including in filters and JSON writes.
export function postgrest(db) {
  const id = value => {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error(`Invalid identifier: ${value}`);
    return `"${value}"`;
  };
  return {
    from(table) {
      let operation = 'select', rows, selected = '*', returning = false, conflict, single = false, rowLimit;
      const filters = [], orders = [], params = [];
      const param = value => { params.push(value); return `$${params.length}`; };
      const condition = (column, op, value) => value === null && op === 'IS'
        ? `${id(column)} IS NULL` : `${id(column)} ${op} ${param(value)}`;
      const builder = {
        select(columns = '*') { selected = columns; returning = operation !== 'select'; return builder; },
        insert(value) { operation = 'insert'; rows = Array.isArray(value) ? value : [value]; return builder; },
        upsert(value, options) { operation = 'upsert'; rows = Array.isArray(value) ? value : [value]; conflict = options?.onConflict; return builder; },
        update(value) { operation = 'update'; rows = value; return builder; },
        delete() { operation = 'delete'; return builder; },
        eq(column, value) { filters.push(condition(column, '=', value)); return builder; },
        is(column, value) { filters.push(condition(column, 'IS', value)); return builder; },
        not(column, operator, value) {
          if (operator !== 'is' || value !== null) throw new Error('Only not-is-null is supported');
          filters.push(`${id(column)} IS NOT NULL`); return builder;
        },
        lt(column, value) { filters.push(condition(column, '<', value)); return builder; },
        lte(column, value) { filters.push(condition(column, '<=', value)); return builder; },
        gte(column, value) { filters.push(condition(column, '>=', value)); return builder; },
        in(column, values) { filters.push(`${id(column)} IN (${values.map(param).join(',')})`); return builder; },
        or(expression) {
          filters.push('(' + expression.split(',').map(part => {
            const [, column, op, value] = part.match(/^([a-z_]+)\.(eq|is|lt|lte)\.(.*)$/);
            return condition(column, { eq: '=', is: 'IS', lt: '<', lte: '<=' }[op], value === 'null' ? null : value);
          }).join(' OR ') + ')');
          return builder;
        },
        order(column, options = {}) { orders.push(`${id(column)} ${options.ascending === false ? 'DESC' : 'ASC'}${options.nullsFirst === false ? ' NULLS LAST' : ''}`); return builder; },
        limit(value) { rowLimit = Number(value); return builder; },
        single() { single = true; return execute(); },
        maybeSingle() { single = true; return execute(); },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      async function execute() {
        const select = selected === '*' ? '*' : selected.split(',').map(x => id(x.trim())).join(',');
        let sql;
        if (operation === 'select') sql = `SELECT ${select} FROM ${id(table)}`;
        else if (operation === 'insert' || operation === 'upsert') {
          const columns = Object.keys(rows[0]);
          const values = rows.map(row => '(' + columns.map(c => param(typeof row[c] === 'object' && row[c] !== null ? JSON.stringify(row[c]) : row[c])).join(',') + ')');
          sql = `INSERT INTO ${id(table)} (${columns.map(id).join(',')}) VALUES ${values.join(',')}`;
          if (operation === 'upsert') sql += ` ON CONFLICT (${conflict.split(',').map(id).join(',')}) DO UPDATE SET ${columns.filter(c => !conflict.split(',').includes(c)).map(c => `${id(c)} = EXCLUDED.${id(c)}`).join(',')}`;
        } else if (operation === 'update') {
          sql = `UPDATE ${id(table)} SET ${Object.entries(rows).map(([key, value]) => `${id(key)} = ${param(typeof value === 'object' && value !== null ? JSON.stringify(value) : value)}`).join(',')}`;
        } else sql = `DELETE FROM ${id(table)}`;
        if (filters.length) sql += ` WHERE ${filters.join(' AND ')}`;
        if (orders.length) sql += ` ORDER BY ${orders.join(',')}`;
        if (rowLimit !== undefined) sql += ` LIMIT ${rowLimit}`;
        if (returning) sql += ` RETURNING ${select}`;
        try {
          const result = await db.query(sql, params);
          return { data: single ? (result.rows[0] || null) : result.rows, error: null };
        } catch (error) { return { data: null, error: { message: error.message, code: error.code } }; }
      }
      return builder;
    },
  };
}
