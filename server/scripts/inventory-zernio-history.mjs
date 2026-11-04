// Operator-only, provider GET requests. No database writes, media downloads,
// read receipts, control changes or messages sent. Never log response bodies.
import {pathToFileURL} from 'node:url';
import {readConfig} from '../src/config.mjs';

export class HistoryInventoryError extends Error {
  constructor(code, httpStatus = null) { super(code); this.code = code; this.httpStatus = httpStatus; }
}
const fail = (code, status) => { throw new HistoryInventoryError(code, status); };
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);
export async function inventoryZernioHistory({scope, since, maxRequests = 30, fetcher = fetch,
  pause = () => new Promise(resolve => setTimeout(resolve, 250)), signal}) {
  if (!/^[a-f0-9]{24}$/.test(scope?.accountId ?? '') || !/^[a-f0-9]{24}$/.test(scope?.profileId ?? '') ||
      !/^[\x21-\x7e]{32,512}$/.test(scope?.apiKey ?? '')) fail('HISTORY_INVALID_CONFIG');
  if (typeof since !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(since) ||
      !Number.isFinite(Date.parse(since)) || !Number.isInteger(maxRequests) || maxRequests < 2 || maxRequests > 100) fail('HISTORY_INVALID_WINDOW');
  const canonical = new Date(since).toISOString();
  if (canonical !== since && canonical.replace('.000Z','Z') !== since) fail('HISTORY_INVALID_WINDOW');
  const startedAt = new Date().toISOString(), cutoff = Date.parse(since), conversations = new Map();
  const pages = {active:0, archived:0}, rows = {active:0, archived:0};
  let requests = 0, duplicates = 0;
  for (const status of ['active','archived']) {
    let cursor = null; const cursors = new Set();
    while (true) {
      if (requests >= maxRequests) fail('HISTORY_INVENTORY_INCOMPLETE');
      if (requests > 0) await pause();
      const url = new URL('https://zernio.com/api/v1/inbox/conversations');
      for (const [key,value] of Object.entries({accountId:scope.accountId,profileId:scope.profileId,
        platform:'whatsapp',status,sortOrder:'desc',limit:'100',...(cursor ? {cursor} : {})})) url.searchParams.set(key,value);
      requests++;
      let response, body;
      try {
        response = await fetcher(url, {method:'GET',headers:{authorization:'Bearer '+scope.apiKey,accept:'application/json'},
          redirect:'error',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(20000)])});
      } catch { fail('HISTORY_NETWORK_FAILED'); }
      if (!response.ok) { await response.body?.cancel().catch(()=>{}); fail('HISTORY_PROVIDER_FAILED',response.status); }
      try { body = await response.json(); } catch { fail('HISTORY_INVALID_RESPONSE'); }
      if (!Array.isArray(body?.data) || body.data.length > 100 || typeof body.pagination?.hasMore !== 'boolean') fail('HISTORY_INVALID_RESPONSE');
      if ((body.meta?.accountsFailed ?? 0) !== 0 || (body.meta?.failedAccounts?.length ?? 0) > 0 ||
          (body.meta?.accountsSkipped?.length ?? 0) > 0) fail('HISTORY_PARTIAL_RESPONSE');
      pages[status]++; rows[status] += body.data.length;
      for (const row of body.data) {
        if (!row || row.accountId !== scope.accountId || row.platform !== 'whatsapp' || !id(row.id)) fail('HISTORY_SCOPE_MISMATCH');
        const time = typeof row.updatedTime === 'string' ? Date.parse(row.updatedTime) : NaN;
        const updated = Number.isFinite(time) ? new Date(time).toISOString() : null;
        const previous = conversations.get(row.id);
        if (previous) duplicates++;
        conversations.set(row.id, {id:row.id,updated_at:previous?.updated_at && (!updated || previous.updated_at > updated) ? previous.updated_at : updated,
          candidate:(previous?.candidate ?? false) || !updated || time >= cutoff,
          unknown_time:(previous?.unknown_time ?? false) || !updated});
      }
      if (!body.pagination.hasMore) break;
      const next = body.pagination.nextCursor;
      if (typeof next !== 'string' || next.length < 1 || next.length > 4096 || cursors.has(next)) fail('HISTORY_INVALID_PAGINATION');
      cursors.add(next); cursor = next;
    }
  }
  const candidates = [...conversations.values()].filter(row => row.candidate);
  return {summary:{event:'zernio_history_inventory',complete:true,since:new Date(cutoff).toISOString(),started_at:startedAt,
    requests,pages,rows,unique_conversations:conversations.size,candidate_conversations:candidates.length,
    unknown_time_conversations:[...conversations.values()].filter(row=>row.unknown_time).length,
    duplicate_rows:duplicates,provider_writes:false,database_writes:false,media_downloads:false},
    candidates:candidates.map(({id,updated_at,unknown_time})=>({id,updated_at,unknown_time}))};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = readConfig();
    const {summary} = await inventoryZernioHistory({scope:config.zernio,since:process.env.NINA_HISTORY_SINCE});
    console.log(JSON.stringify(summary));
  } catch (error) {
    console.log(JSON.stringify({event:'zernio_history_inventory',complete:false,
      code:error instanceof HistoryInventoryError?error.code:'HISTORY_INVENTORY_FAILED',
      http_status:error instanceof HistoryInventoryError?error.httpStatus:null}));
    process.exitCode = 1;
  }
}
