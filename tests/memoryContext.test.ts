import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMemoryContextRequest } from '../lib/communications/memoryContext';
import { HttpCommunicationsClient } from '../lib/communications/client';
import { memoryEvidence, type MemoryEnvelope } from '../lib/communications/memoryTypes';
const envelope: MemoryEnvelope = { contract_version:'memory-context.v1',data:{communications:[]},memory_status:{state:'current',retrieved_at:'2026-09-08T00:00:00Z',evidence_only:true} };
test('memory proxy derives tenant and project scope and rejects caller private grants', async () => {
 let tenant: string | undefined, input: any;
 const dependencies={listProjects:async()=>[{id:'alpha'}],client:{getMemoryContext:async(t:string,b:any)=>{tenant=t;input=b;return envelope;}}};
 await handleMemoryContextRequest({method:'POST',body:{kind:'project',id:'alpha',tenant_id:'forged',include_private:true,allowed_project_ids:['secret']}},{orgId:'verified',uid:'ceo'},dependencies);
 assert.equal(tenant,'verified');assert.equal(input.kind,'search');assert.deepEqual(input.allowed_project_ids,['alpha']);assert.equal(input.external_project_id,'alpha');assert.equal(input.include_private,false);
 await assert.rejects(handleMemoryContextRequest({method:'POST',body:{kind:'project',id:'secret'}},{orgId:'verified',uid:'ceo'},dependencies),/not accessible/);
 await handleMemoryContextRequest({method:'POST',body:{kind:'person',id:'alex'}},{orgId:'verified',uid:'ceo'},dependencies);
 assert.equal(input.id,'alex');assert.deepEqual(input.allowed_project_ids,['alpha']);
});
test('empty project grants stay empty and unavailable service never becomes empty history',async()=>{
 let input: any;
 const dependencies={listProjects:async()=>[],client:{getMemoryContext:async(_t:string,b:any)=>{input=b;throw new Error('outage');}}};
 await assert.rejects(handleMemoryContextRequest({method:'POST',body:{kind:'search'}},{orgId:'verified',uid:'ceo'},dependencies),/outage/);
 assert.deepEqual(input.allowed_project_ids,[]);
 await assert.rejects(handleMemoryContextRequest({method:'GET'},{orgId:'verified',uid:'ceo'},dependencies),/Method not allowed/);
});
test('HTTP memory client requires versioned availability and tenant header',async()=>{
 let response: unknown=envelope;
 const client=new HttpCommunicationsClient({baseUrl:'http://localhost:1',apiKey:'local',fetchImpl:async(url,init)=>{
 assert.equal(String(url),'http://localhost:1/v1/context/memory');assert.equal(init?.method,'POST');assert.equal(new Headers(init?.headers).get('x-tenant-id'),'verified');
 return new Response(JSON.stringify(response),{status:200});
 }});
 assert.deepEqual(await client.getMemoryContext('verified',{kind:'search'}),envelope);
 response={data:[]};await assert.rejects(client.getMemoryContext('verified',{kind:'search'}),/unavailable/);
});
test('presentation preserves original promise and explicitly labels inferred dates',()=>{
 const rows=memoryEvidence({commitments:[{id:'promise',description:'invented paraphrase',original_wording:'I will deliver Friday.',source_communication_ids:['comm1'],due_date_status:'inferred',due_at_candidate:'2026-09-11'}]});
 assert.equal(rows[0].text,'I will deliver Friday.');assert.match(rows[0].dateNote!,/Needs confirmation/);assert.deepEqual(rows[0].sources,['comm1']);
});
