import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { ref, get, set } from 'firebase/database';

test('Phase 04: actual Firebase round-trip, simultaneous Ask replies and direct-client isolation', async()=>{
  assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,'127.0.0.1:9010','Only run against the local emulator');
  const { privateKey }=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
  process.env.FIREBASE_SERVICE_ACCOUNT=JSON.stringify({project_id:'demo-hyperflow',client_email:'fixture@demo-hyperflow.iam.gserviceaccount.com',private_key:privateKey});
  process.env.FIREBASE_DATABASE_URL='https://demo-hyperflow-default-rtdb.firebaseio.com';
  const { handleCommitments }=await import('../../lib/commitments/api');
  const { readOperationalCommitment }=await import('../../lib/serverStore');
  const { getApps,deleteApp }=await import('firebase-admin/app');
  const testEnv=await initializeTestEnvironment({projectId:'demo-hyperflow',database:{host:'127.0.0.1',port:9010,rules:readFileSync('database.rules.json','utf8')}});
  const member={orgId:'phase04_fixture',uid:'ceo'};
  const deps={projects:async()=>[{id:'alpha'}] as any,people:async()=>[{id:'alex',name:'Alex'}]};
  try {
    await testEnv.withSecurityRulesDisabled(async context => { await set(ref(context.database(), `organizations/${member.orgId}/members/ceo`), { role: 'owner' }); });
    const created:any=await handleCommitments({method:'POST',body:{projectId:'alpha',terms:{owner:'user:ceo',beneficiary:'contact:alex',deliverable:'Send report',criteria:'Receipt accepted',dueAt:'2026-09-11T17:00:00+10:00',timezone:'Australia/Brisbane'}}},member,deps);
    const roundtrip=await readOperationalCommitment(member.orgId,created.item.id);
    assert.deepEqual(roundtrip?.asks,[]); assert.deepEqual(roundtrip?.review?.ask.responses,[]);
    const command={method:'PATCH',body:{id:created.item.id,action:'respond',expectedVersion:1,askId:created.item.review.ask.id,decision:'approved',note:'Owner and beneficiary agreed'}};
    const replies=await Promise.allSettled([handleCommitments(command,member,deps),handleCommitments(command,member,deps)]);
    assert.equal(replies.filter(r=>r.status==='fulfilled').length,1,JSON.stringify(replies));
    const saved=await readOperationalCommitment(member.orgId,created.item.id);
    assert.equal(saved?.version,2); assert.equal(saved?.state,'accepted'); assert.equal(saved?.history.length,2);
    const client=testEnv.authenticatedContext('ceo').database();
    const path=`operational_commitments/${member.orgId}/${created.item.id}`;
    await assertFails(get(ref(client,path)));
    await assertFails(set(ref(client,path),{state:'fulfilled'}));
    assert.equal(await readOperationalCommitment('other_tenant',created.item.id),null);
  } finally { await testEnv.cleanup(); await Promise.all(getApps().map(deleteApp)); }
});
