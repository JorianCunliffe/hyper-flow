import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { HttpCommunicationsClient } from '../../lib/communications/client';
import { handleMemoryContextRequest } from '../../lib/communications/memoryContext';
import { memoryEvidence } from '../../lib/communications/memoryTypes';

test('Phase 03: HyperFlow reads scoped SQL evidence and reports source changes and outages',async()=>{
 const checkout=process.env.PHASE02_COMMUNICATIONS_CHECKOUT;assert.ok(checkout);
 const {createPhase02Database}=await import(pathToFileURL(resolve(checkout,'test/fixtures/phase02Database.js')).href);
 const tenant='phase03_hyperflow',key='phase03-local-fixture';const {app,sql,close}=await createPhase02Database(tenant,key);
 try {
  const address=await app.listen({host:'127.0.0.1',port:0});const client=new HttpCommunicationsClient({baseUrl:address,apiKey:key});
  const seed=await app.inject({method:'POST',url:'/v1/communications',headers:{'x-api-key':key,'x-tenant-id':tenant},payload:{channel:'email',direction:'inbound',identity:'alex@example.com',content:'I will deliver Friday.',correlation:{external_project_id:'alpha'}}});
  assert.equal(seed.statusCode,201);const source=seed.json();
  await sql.query("insert into communication_commitments(tenant_id,communication_id,thread_id,description,source_excerpt,due_at) values($1,$2,$3,'Delivery','I will deliver Friday.','2026-09-11T07:00:00Z')",[tenant,source.communication_id,source.thread_id]);
  const deps={client,listProjects:async()=>[{id:'alpha'}]};const member={orgId:tenant,uid:'fixture_ceo'};
  const read=()=>handleMemoryContextRequest({method:'POST',body:{kind:'thread',id:source.thread_id}},member,deps);
  const first=await read();assert.equal(first.contract_version,'memory-context.v1');
  assert.ok(memoryEvidence(first.data).some(row=>row.label==='Promise evidence' && row.dateNote?.includes('Needs confirmation')));
  await sql.query("update communications set body='Corrected: no delivery commitment',updated_at=now()+interval '1 second' where communication_id=$1",[source.communication_id]);
  const corrected=await read();assert.equal(corrected.memory_status.state,'stale');assert.ok(!memoryEvidence(corrected.data).some(row=>row.label==='Promise evidence'));
  await sql.exec('alter table communication_facts rename to unavailable_facts');
  await assert.rejects(read(),/unavailable/i);
  assert.equal((await sql.query('select count(*)::int as count from outbound_operations')).rows[0].count,0);
 } finally { await close(); }
});
