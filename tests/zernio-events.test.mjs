import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {normalizeZernioEvent} from '../server/src/zernio-events.mjs';
const scope={accountId:'a'.repeat(24),profileId:'b'.repeat(24)};
function event(){return {id:randomUUID(),event:'message.received',timestamp:'2026-11-04T12:00:00Z',profiles:[{id:scope.profileId}],
 account:{accountId:scope.accountId,profileId:scope.profileId,platform:'whatsapp'},conversation:{id:'conversation-fixture'},
 message:{platform:'whatsapp',platformMessageId:'wamid.fixture',conversationId:'conversation-fixture',direction:'incoming',sentAt:'2026-11-04T11:59:59Z',text:'Olá 🐾',attachments:[],sender:{id:'platform-fixture',businessScopedUserId:'bsuid-fixture',phoneNumber:'+5511999990000',name:'Tutor de teste'}}};}
test('channel events: preserve all stable peer anchors, prefer BSUID and normalize explicit E.164 only',()=>{
 const e=event(),n=normalizeZernioEvent(e,scope,{event_id:e.id,event_type:e.event});
 assert.equal(n.from_type,'user');assert.equal(n.peer.phone,'5511999990000');assert.deepEqual(n.peer.keys.map(k=>k.kind),['bsuid','platform','phone']);assert.equal(n.text,'Olá 🐾');
 delete e.message.sender.phoneNumber;e.message.sender.id='123456789012345';delete e.message.sender.businessScopedUserId;
 const anonymous=normalizeZernioEvent(e,scope);assert.equal(anonymous.peer.phone,null);assert.deepEqual(anonymous.peer.keys,[{kind:'platform',value:'123456789012345'}]);
});
test('channel events: outgoing echo identifies the participant, never the business sender or unknown attribution',()=>{
 const e=event();e.event='message.sent';e.message.direction='outgoing';e.message.sender={id:scope.accountId,name:'NOME_DA_EMPRESA'};e.conversation.participantId='peer-id';e.conversation.participantName='Tutor correto';
 for(const via of [null,undefined,'api','workflow','broadcast','unexpected']){e.message.sentVia=via;const n=normalizeZernioEvent(e,scope);assert.equal(n.from_type,'external');assert.equal(n.peer.name,'Tutor correto');assert.ok(!JSON.stringify(n).includes('NOME_DA_EMPRESA'));}
 e.message.sentVia='human';assert.equal(normalizeZernioEvent(e,scope).from_type,'human');delete e.conversation.participantId;assert.equal(normalizeZernioEvent(e,scope).peer,null);
});
test('channel events: status receipts retain platform identity, event time and safe failure codes without raw error text',()=>{
 for(const status of ['delivered','read','failed']){const e=event();e.event='message.'+status;e.statusAt='2026-11-04T12:00:01+00:00';e.error={code:131026,title:'PRIVATE_TITLE',message:'PRIVATE_CONTENT'};const n=normalizeZernioEvent(e,scope);assert.equal(n.kind,'status');assert.equal(n.status,status);assert.equal(n.status_at,'2026-11-04T12:00:01.000Z');assert.ok(!JSON.stringify(n).includes('PRIVATE'));}
});
test('channel events: preserve every attachment in order and keep links internal to the downloader contract',()=>{
 const e=event();e.message.text=null;e.message.attachments=[{type:'audio',url:'https://zernio.com/api/v1/whatsapp/media/123',payload:{voice:true}},{type:'file',url:'https://media.example.invalid/report',payload:{filename:'pasta/arquivo.pdf'}},{type:'sticker',url:'https://media.example.invalid/sticker'}];
 const n=normalizeZernioEvent(e,scope);assert.equal(n.attachments.length,3);assert.equal(n.attachments[0].voice,true);assert.equal(n.attachments[1].filename,'pasta_arquivo.pdf');assert.equal(n.attachments[2].type,'image');assert.equal(n.attachments[2].is_sticker,true);
});
test('channel events: fail closed on scope, receipt identity, message direction and conflicting conversation IDs',()=>{
 for(const mutate of [e=>e.account.accountId='c'.repeat(24),e=>e.account.profileId='c'.repeat(24),e=>e.account.id='c'.repeat(24),e=>e.message.platform='instagram',e=>e.message.direction='outgoing',e=>e.conversation.id='wrong']){const e=event();mutate(e);assert.throws(()=>normalizeZernioEvent(e,scope));}
 const e=event();assert.throws(()=>normalizeZernioEvent(e,scope,{event_id:randomUUID(),event_type:e.event}));assert.throws(()=>normalizeZernioEvent(e,scope,{event_id:e.id,event_type:'message.sent'}));
});
test('channel events: malformed, empty and oversized data never becomes a clinical write plan',()=>{
 for(const mutate of [e=>e.message.platformMessageId='bad\nid',e=>e.message.sentAt='yesterday',e=>e.message.text='x'.repeat(32769),e=>e.message.text='contains\u0000NUL',e=>e.message.text=null,e=>e.message.attachments=null,e=>e.message.attachments=Array(11).fill({}),e=>e.message.sender.phoneNumber='not-phone',e=>e.message.sender=null,e=>e.test=true]){const e=event();mutate(e);assert.throws(()=>normalizeZernioEvent(e,scope));}
});
test('channel events: reject credential-bearing, non-HTTPS, fragment and unknown-type attachments',()=>{
 for(const url of ['http://media.example.invalid/a','https://user:password@media.example.invalid/a','https://media.example.invalid/a#fragment','file:///tmp/a','https://media.example.invalid:444/a']){const e=event();e.message.attachments=[{type:'image',url}];assert.throws(()=>normalizeZernioEvent(e,scope));}
 const e=event();e.message.attachments=[{type:'invented',url:'https://media.example.invalid/a'}];assert.throws(()=>normalizeZernioEvent(e,scope));
});
test('channel events: standby remains explicit and display names cannot carry control characters',()=>{
 const e=event();e.metadata={standby:true};e.message.sender.name='  Tutor\n de teste\u0000  ';const n=normalizeZernioEvent(e,scope);assert.equal(n.standby,true);assert.equal(n.peer.name,'Tutor de teste');
});
test('channel events: documented legacy account alias and signed profile array work without weakening scope',()=>{
 const e=event();e.account={id:scope.accountId,platform:'whatsapp'};
 assert.equal(normalizeZernioEvent(e,scope).account_id,scope.accountId);
 delete e.profiles;assert.throws(()=>normalizeZernioEvent(e,scope),{code:'CHANNEL_SCOPE_MISMATCH'});
 e.profiles=[{id:scope.profileId}];e.account.accountId='c'.repeat(24);assert.throws(()=>normalizeZernioEvent(e,scope),{code:'CHANNEL_SCOPE_MISMATCH'});
});
