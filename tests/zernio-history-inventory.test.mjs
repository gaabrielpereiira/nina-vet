import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryZernioHistory} from '../server/scripts/inventory-zernio-history.mjs';
const scope={accountId:'a'.repeat(24),profileId:'b'.repeat(24),apiKey:'synthetic-private-key-'.repeat(3)};
const since='2026-10-22T03:00:00Z';
const row=(id,updatedTime='2026-10-23T00:00:00Z')=>({id,accountId:scope.accountId,platform:'whatsapp',updatedTime,lastMessage:'PRIVATE_MESSAGE_MUST_NOT_BE_RETAINED',participantName:'PRIVATE_NAME'});
const page=(data,hasMore=false,nextCursor=null,meta={accountsFailed:0})=>Response.json({data,pagination:{hasMore,nextCursor},meta});
const options=fetcher=>({scope,since,fetcher,pause:async()=>{}});
test('history inventory: paginate active and archived without changing read state; retain only IDs internally and counts publicly',async()=>{
 const calls=[];const cursor='opaque/+ cursor=&';const responses=[()=>page([row('new'),row('old','2026-10-21T23:00:00Z')],true,cursor),()=>page([row('new'),row('missing',null)]),()=>page([row('archived')])];
 const result=await inventoryZernioHistory(options(async(url,init)=>{calls.push({url:new URL(url),init});return responses.shift()();}));
 assert.equal(result.summary.requests,3);assert.deepEqual(result.summary.pages,{active:2,archived:1});assert.equal(result.summary.unique_conversations,4);assert.equal(result.summary.candidate_conversations,3);assert.equal(result.summary.unknown_time_conversations,1);assert.equal(result.summary.duplicate_rows,1);
 assert.equal(calls[1].url.searchParams.get('cursor'),cursor);assert.equal(calls[2].url.searchParams.get('status'),'archived');
 for(const {url,init} of calls){assert.equal(url.origin,'https://zernio.com');assert.equal(url.pathname,'/api/v1/inbox/conversations');assert.equal(url.searchParams.get('accountId'),scope.accountId);assert.equal(url.searchParams.get('profileId'),scope.profileId);assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.body,undefined);}
 assert.ok(!JSON.stringify(result).includes('PRIVATE_'));assert.equal(result.summary.database_writes,false);
});
test('history inventory: an inclusive window includes messages on backup day and unknown update times are never silently dropped',async()=>{
 let n=0;const result=await inventoryZernioHistory(options(async()=>n++===0?page([row('boundary',since),row('unknown','invalid'),row('old','2026-10-22T02:59:59Z')]):page([])));
 assert.deepEqual(result.candidates.map(r=>r.id),['boundary','unknown']);
});
test('history inventory: foreign account/platform and partial upstream results abort instead of claiming a complete inventory',async()=>{
 for(const response of [()=>page([{...row('foreign'),accountId:'c'.repeat(24)}]),()=>page([{...row('foreign'),platform:'instagram'}]),()=>page([],false,null,{accountsFailed:1}),()=>page([],false,null,{failedAccounts:[{error:'PRIVATE_ERROR'}]}),()=>page([],false,null,{accountsSkipped:[{}]})])await assert.rejects(inventoryZernioHistory(options(async()=>response())),e=>['HISTORY_SCOPE_MISMATCH','HISTORY_PARTIAL_RESPONSE'].includes(e.code)&&!e.message.includes('PRIVATE'));
});
test('history inventory: missing, repeated or oversized cursors and request caps fail closed',async()=>{
 for(const cursor of [null,'','x'.repeat(4097)])await assert.rejects(inventoryZernioHistory(options(async()=>page([],true,cursor))),{code:'HISTORY_INVALID_PAGINATION'});
 await assert.rejects(inventoryZernioHistory(options(async()=>page([],true,'repeated'))),{code:'HISTORY_INVALID_PAGINATION'});
 let n=0;await assert.rejects(inventoryZernioHistory({...options(async()=>page([],true,'cursor-'+n++)),maxRequests:2}),{code:'HISTORY_INVENTORY_INCOMPLETE'});
});
test('history inventory: malformed, rejected and failed responses reveal no provider bodies or credentials',async()=>{
 for(const data of [{},null,{data:[],pagination:{hasMore:'true'}},{data:new Array(101).fill(row('one')),pagination:{hasMore:false}}])await assert.rejects(inventoryZernioHistory(options(async()=>Response.json(data))),{code:'HISTORY_INVALID_RESPONSE'});
 for(const status of [401,403,429,500])await assert.rejects(inventoryZernioHistory(options(async()=>new Response('PRIVATE_PROVIDER_BODY',{status}))),{code:'HISTORY_PROVIDER_FAILED',httpStatus:status});
 await assert.rejects(inventoryZernioHistory(options(async()=>{throw Error('PRIVATE_NETWORK_DETAILS');})),{code:'HISTORY_NETWORK_FAILED'});
});
test('history inventory: invalid config/window aborts before any request',async()=>{
 const base=options(async()=>assert.fail());
 await assert.rejects(inventoryZernioHistory({...base,scope:{...scope,accountId:'invalid'}}),{code:'HISTORY_INVALID_CONFIG'});
 for(const since of ['',undefined,'not-a-date','2026-10-22','2026-02-30T00:00:00Z'])await assert.rejects(inventoryZernioHistory({...base,since}),{code:'HISTORY_INVALID_WINDOW'});
});
