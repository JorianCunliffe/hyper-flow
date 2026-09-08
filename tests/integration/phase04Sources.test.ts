import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { HttpCommunicationsClient } from '../../lib/communications/client';
import { handleMemoryContextRequest } from '../../lib/communications/memoryContext';
import { handleCommitments } from '../../lib/commitments/api';
import type { Commitment } from '../../lib/commitments/model';

test('Phase 04: SQL source evidence imports over HTTP without granting business acceptance', async()=>{
  const checkout=process.env.PHASE02_COMMUNICATIONS_CHECKOUT; assert.ok(checkout);
  const {createPhase02Database}=await import(pathToFileURL(resolve(checkout,'test/fixtures/phase02Database.js')).href);
  const tenant='phase04_sources',key='local-phase04-evidence'; const {app,sql,close}=await createPhase02Database(tenant,key);
  try {
    const address=await app.listen({host:'127.0.0.1',port:0}); const client=new HttpCommunicationsClient({baseUrl:address,apiKey:key});
    const seed=await app.inject({method:'POST',url:'/v1/communications',headers:{'x-api-key':key,'x-tenant-id':tenant},payload:{channel:'email',direction:'inbound',identity:'alex@example.com',content:'I will deliver Friday.',correlation:{external_project_id:'alpha'}}});
    assert.equal(seed.statusCode,201); const source=seed.json();
    await sql.query("insert into communication_commitments(tenant_id,communication_id,thread_id,description,source_excerpt,due_at,status) values($1,$2,$3,'Delivery','I will deliver Friday.','2026-09-11T07:00:00Z','completed')",[tenant,source.communication_id,source.thread_id]);
    const projects=async()=>[{id:'alpha'}] as any; const member={orgId:tenant,uid:'ceo'}; const rows=new Map<string,Commitment>();
    const deps={projects,people:async()=>[],memory:(request:any,actor:any)=>handleMemoryContextRequest(request,actor,{client,listProjects:projects}),
      read:async(_:string,id:string)=>rows.get(id)||null, list:async()=>({rows:[...rows.values()],next:null}),
      transact:async(_:string,id:string,update:(row:Commitment|null)=>Commitment)=>{const row=update(rows.get(id)||null);rows.set(id,row);return row;}};
    const candidates:any=await handleCommitments({method:'GET',query:{view:'candidates',projectId:'alpha',threadId:source.thread_id}},member,deps);
    assert.equal(candidates.data.length,1); assert.deepEqual(candidates.data[0].communicationIds,[source.communication_id]);
    const importSource=()=>handleCommitments({method:'POST',body:{projectId:'alpha',threadId:source.thread_id,sourceId:candidates.data[0].id}},member,deps) as Promise<any>;
    const first=await importSource(); const duplicate=await importSource();
    assert.equal(first.item.id,duplicate.item.id); assert.equal(rows.size,1); assert.equal(first.item.state,'candidate');
    assert.equal(first.item.review.kind,'clarify'); assert.equal(first.item.acceptedEvidence,undefined);
    assert.equal(first.item.source.wording,'','Raw source excerpts are read through the current scoped evidence endpoint');
    await sql.query("update communications set body='Corrected: no delivery commitment',updated_at=now()+interval '1 second' where communication_id=$1",[source.communication_id]);
    await assert.rejects(handleCommitments({method:'PATCH',body:{id:first.item.id,expectedVersion:1,action:'respond',askId:first.item.review.ask.id,note:'Cannot accept stale extraction'}},member,deps),/changed or is inaccessible/);
    assert.equal((await handleCommitments({method:'GET'},member,deps) as any).data.length,0);
    assert.equal((await sql.query('select count(*)::int as count from outbound_operations')).rows[0].count,0);
    assert.equal((await sql.query('select status from communication_commitments')).rows[0].status,'completed');
  } finally { await close(); }
});
