import test from 'node:test';
import assert from 'node:assert/strict';
import {outboundConversationContext} from '../lib/outboundConversationContext.js';
const input={orgId:'tenant',projectId:'alpha',to:'+61400000111'};
const profile:any={primaryPersonId:'ceo',allowedProjectIds:['alpha'],conversation:{voicePrompt:'Speak briefly'}};
test('outbound context does not fetch history for another recipient or denied project',async()=>{
  let reads=0;
  const client:any={listPeople:async()=>[{id:'other',phone:input.to}],listCommunications:async()=>{reads++;throw new Error('must not read')}};
  assert.equal((await outboundConversationContext(input,client,async()=>profile)).status,'unavailable');
  assert.equal(reads,0);
  client.listPeople=async()=>[{id:'ceo',phone:input.to}];
  assert.equal((await outboundConversationContext({...input,projectId:'beta'},client,async()=>profile)).status,'unavailable');
  assert.equal(reads,0);
});
test('outbound history opt-out and lookup failure explicitly forbid guessing',async()=>{
  const client:any={listPeople:async()=>{throw new Error('unavailable')}};
  const disabled=await outboundConversationContext(input,client,async()=>({...profile,conversation:{historyEnabled:false}}));
  assert.equal(disabled.status,'disabled');assert.deepEqual(disabled.sources,[]);assert.match(disabled.instructions,/Never invent or guess/);
  const missing=await outboundConversationContext(input,client,async()=>profile);
  assert.equal(missing.status,'unavailable');assert.match(missing.instructions,/cannot verify/);
});
test('duplicate phone identities never select a contact by array order',async()=>{
 const client:any={listPeople:async()=>[{id:'ceo',phone:input.to},{id:'other',phone:input.to}]};
 assert.deepEqual((await outboundConversationContext(input,client,async()=>profile)).sources,[]);
});
