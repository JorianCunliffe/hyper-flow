import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createCommitment, transitionCommitment, commitmentTiming, normalizeCommitment, type Commitment, type CommitmentCommand } from '../lib/commitments/model';
import { handleCommitments, type CommitmentDependencies } from '../lib/commitments/api';
import { promiseCandidates } from '../lib/commitments/sources';
import type { MemoryEnvelope } from '../lib/communications/memoryTypes';

const now = Date.parse('2026-09-08T10:00:00Z');
const terms = { owner: 'user:ceo', beneficiary: 'contact:alex', deliverable: 'Send the approved report', criteria: 'Sent receipt and beneficiary acceptance', dueAt: '2026-09-11T17:00:00+10:00', timezone: 'Australia/Brisbane' };
const create = (overrides = {}) => createCommitment({ id: 'ob_test', orgId: 'tenant', projectId: 'alpha', actor: 'ceo', now, askId: 'ask_first', terms, ...overrides });
let sequence = 0;
const act = (row: Commitment, command: Partial<CommitmentCommand> & Pick<CommitmentCommand,'action'>, actor = 'ceo') => transitionCommitment(row,
  { expectedVersion: row.version, askId: row.review?.ask.id, note: 'Explicit evidence from the agreed terms', ...command }, actor, now + ++sequence, `ask_${sequence}`);
const accept = () => act(create(), { action: 'respond', decision: 'approved' });
const envelope = (): MemoryEnvelope => ({ contract_version: 'memory-context.v1', memory_status: { state: 'current', retrieved_at: new Date(now).toISOString(), evidence_only: true },
  data: { commitments: [{ id: 'legacy_1', status: 'completed', evidence_only: true, original_wording: 'I will send the report Friday.', communication_id: 'comm_1', source_communication_ids: ['comm_1'] }],
    provenance: { sources: { comm_1: { updated_at: '2026-09-08T10:00:00Z' } } } } });
function fixture() {
  const records = new Map<string,Commitment>(); let memory = envelope();
  const deps: Partial<CommitmentDependencies> = { projects: async()=>[{ id:'alpha' }] as any,
    memory: async()=>memory, people: async()=>[{id:'alex',name:'Alex'}], member: async(uid,orgId)=>({uid,orgId:orgId!,role:'member'}),
    read: async(_,id)=>records.get(id) || null,
    list: async()=>({ rows:[...records.values()], next:null }),
    transact: async(_,id,update)=>{ const result=update(records.get(id) || null); records.set(id,result); return result; } };
  const request = (method: string, body: any = {}, query = {}, uid = 'ceo') => handleCommitments({method,body,query},{orgId:'tenant',uid},deps);
  return { records, deps, request, setMemory(value: MemoryEnvelope){memory=value;} };
}
describe('operational commitment lifecycle',()=>{
  test('extracted or manually entered promise always begins as a candidate',()=>{
    const row=create(); assert.equal(row.state,'candidate'); assert.equal(row.review?.kind,'accept'); assert.equal(row.acceptedEvidence,undefined);
    assert.throws(()=>act(row,{action:'submit'}),/Accept the obligation first/);
  });
  test('ambiguous owner and deadline create clarification then a separate approval Ask',()=>{
    const row=create({terms:{deliverable:'Report'}}); assert.equal(row.review?.ask.kind,'question');
    assert.throws(()=>act(row,{action:'respond',decision:'approved'}),/Clarification is not approval/);
    const clarified=act(row,{action:'respond',terms}); assert.equal(clarified.state,'candidate'); assert.equal(clarified.review?.kind,'accept');
    assert.notEqual(clarified.review?.ask.id,row.review?.ask.id);
    assert.equal(act(clarified,{action:'respond',decision:'approved'}).state,'accepted');
  });
  test('a report draft and delivery evidence do not themselves fulfill the obligation',()=>{
    const progressed=act(accept(),{action:'progress',note:'Report draft prepared'});
    const submitted=act(progressed,{action:'submit',note:'Draft document link for review'});
    assert.equal(submitted.state,'submitted'); assert.equal(submitted.review?.kind,'fulfill');
    const revised=act(submitted,{action:'respond',decision:'revise',note:'Must send the report first'});
    assert.equal(revised.state,'in_progress');
    const final=act(act(revised,{action:'submit',note:'Sent receipt and beneficiary confirmation'}),{action:'respond',decision:'approved'});
    assert.equal(final.state,'fulfilled'); assert.throws(()=>act(final,{action:'progress'}),/closed/);
  });
  test('accepted terms remain authoritative while a change is proposed or rejected',()=>{
    const accepted=accept(); const changed={...terms,dueAt:'2026-09-18T17:00:00+10:00'};
    const proposed=act(accepted,{action:'terms',terms:changed}); assert.deepEqual(proposed.terms,terms); assert.deepEqual(proposed.proposedTerms,changed);
    const rejected=act(proposed,{action:'respond',decision:'rejected'}); assert.deepEqual(rejected.terms,terms); assert.equal(rejected.proposedTerms,undefined);
    assert.deepEqual(rejected.history.find(h=>h.action==='terms')?.terms,changed);
    const approved=act(act(rejected,{action:'terms',terms:changed}),{action:'respond',decision:'approved'});
    assert.deepEqual(approved.terms,changed); assert.ok(approved.history.some(h=>h.terms?.dueAt===terms.dueAt));
  });
  test('stale, replayed and unauthorized Ask replies never change the aggregate',()=>{
    const row=create(); const accepted=act(row,{action:'respond',decision:'approved'});
    assert.throws(()=>act(accepted,{action:'respond',expectedVersion:row.version,askId:row.review!.ask.id,decision:'approved'}),/changed/);
    assert.throws(()=>act(row,{action:'respond',askId:'wrong',decision:'approved'}),/current Ask/);
    assert.throws(()=>act(row,{action:'respond',decision:'approved'},'stranger'),/assigned parties/);
    const owner=create({terms:{...terms,owner:'user:other'}});
    assert.throws(()=>act(owner,{action:'respond',decision:'approved'},'other'),/different reviewer/);
    assert.throws(()=>act(row,{action:'respond',decision:'approved',terms:{...terms,deliverable:'Unsaved change'}}),/Save changed terms/);
  });
  test('disputes and cancellation retain terms and require a cancellation decision',()=>{
    const disputed=act(accept(),{action:'dispute',note:'Scope is disputed'}); assert.equal(disputed.state,'disputed');
    const cancel=act(disputed,{action:'cancel'}); assert.equal(cancel.state,'disputed');
    assert.equal(act(cancel,{action:'respond',decision:'approved'}).state,'cancelled');
    assert.equal(act(create(),{action:'dismiss'}).state,'dismissed');
  });
  test('date and timezone uncertainty cannot enter accepted terms',()=>{
    for (const invalid of [{dueAt:'Friday'},{dueAt:'2026-09-11T17:00:00'},{dueAt:'2026-02-30T17:00:00+10:00'},{dueAt:'2026-09-11T24:00:00Z'},{timezone:'Not/AZone'}]) {
      const row=create({terms:{...terms,...invalid}}); assert.equal(row.review?.kind,'clarify');
    }
  });
  test('overdue and risk are calculated without replacing lifecycle or sending follow-up',()=>{
    const row=accept(); const due=Date.parse(terms.dueAt);
    assert.deepEqual(commitmentTiming(row,due+1),{overdue:true,atRisk:true}); assert.equal(row.state,'accepted');
    const configured=act(row,{action:'follow_up',enabled:true,leadHours:12}); assert.deepEqual(configured.followUp,{enabled:true,leadHours:12,channel:'web'});
  });
  test('Firebase empty and index-keyed arrays retain Ask response semantics',()=>{
    const row=create(); const stored=JSON.parse(JSON.stringify(row)); delete stored.asks; delete stored.review.ask.responses;
    stored.history={'0':row.history[0]}; stored.review.ask.assignees={'0':'ceo'};
    const hydrated=normalizeCommitment(stored); assert.equal(act(hydrated,{action:'respond',decision:'approved'}).state,'accepted');
  });
});
describe('operational commitment REST boundary',()=>{
  test('legacy completed evidence imports once as a candidate and never reveals Ask tokens',async()=>{
    const f=fixture(); const first:any=await f.request('POST',{projectId:'alpha',sourceId:'legacy_1'});
    const duplicate:any=await f.request('POST',{projectId:'alpha',sourceId:'legacy_1'});
    assert.equal(first.item.state,'candidate'); assert.equal(first.item.id,duplicate.item.id); assert.equal(f.records.size,1);
    assert.equal(JSON.stringify(first).includes('"token"'),false);
  });
  test('simultaneous replies apply only once with expected version',async()=>{
    const f=fixture(); const created:any=await f.request('POST',{projectId:'alpha',terms});
    const payload={id:created.item.id,action:'respond',expectedVersion:1,askId:created.item.review.ask.id,decision:'approved',note:'Owner and beneficiary agreed to these terms'};
    const replies=await Promise.allSettled([f.request('PATCH',payload),f.request('PATCH',payload)]);
    assert.equal(replies.filter(r=>r.status==='fulfilled').length,1); assert.equal(f.records.get(created.item.id)?.version,2);
  });
  test('inaccessible projects and forged party identities are rejected',async()=>{
    const f=fixture(); await assert.rejects(f.request('POST',{projectId:'other',terms}),/not accessible/);
    await assert.rejects(f.request('POST',{projectId:'alpha',terms:{...terms,beneficiary:'contact:foreign'}}),/Contact is not available/);
    const foreign=create({orgId:'other'}); f.records.set(foreign.id,foreign);
    await assert.rejects(f.request('GET',{}, {id:foreign.id}),/not found/);
  });
  test('changed or revoked source evidence blocks candidate acceptance without mutating it',async()=>{
    const f=fixture(); const created:any=await f.request('POST',{projectId:'alpha',sourceId:'legacy_1'});
    f.setMemory({...envelope(),data:{}});
    await assert.rejects(f.request('PATCH',{id:created.item.id,expectedVersion:1,action:'respond',terms,note:'Clarified'}),/changed or is inaccessible/);
    assert.equal(f.records.get(created.item.id)?.version,1);
    await assert.rejects(f.request('GET',{}, {id:created.item.id}),/source changed or is inaccessible/);
    assert.equal((await f.request('GET') as any).data.length,0);
  });
  test('source versions ignore legacy status but change when source content changes',()=>{
    const original=envelope(); const first=promiseCandidates(original)[0];
    const changed=structuredClone(original); (changed.data as any).commitments[0].status='open';
    assert.equal(promiseCandidates(changed)[0].version,first.version);
    (changed.data as any).commitments[0].original_wording='Different promise';
    assert.notEqual(promiseCandidates(changed)[0].version,first.version);
  });
  test('accepted source changes are flagged once and never rewrite accepted terms',async()=>{
    const f=fixture(); const created:any=await f.request('POST',{projectId:'alpha',sourceId:'legacy_1'});
    const clarified:any=await f.request('PATCH',{id:created.item.id,expectedVersion:1,action:'respond',askId:created.item.review.ask.id,terms,note:'Confirmed the ambiguous terms'});
    const accepted:any=await f.request('PATCH',{id:created.item.id,expectedVersion:2,action:'respond',askId:clarified.item.review.ask.id,decision:'approved',note:'Agreed'});
    const changed=envelope(); (changed.data as any).commitments[0].original_wording='New suggested deadline'; f.setMemory(changed);
    const refreshed:any=await f.request('POST',{projectId:'alpha',sourceId:'legacy_1'});
    const repeated:any=await f.request('POST',{projectId:'alpha',sourceId:'legacy_1'});
    assert.equal(refreshed.item.version,accepted.item.version+1); assert.equal(repeated.item.version,refreshed.item.version);
    assert.equal(refreshed.item.sourceChanged,true); assert.deepEqual(refreshed.item.terms,terms); assert.equal(refreshed.item.state,'accepted');
  });
  test('owing and owed views use authenticated identity rather than caller-supplied identity',async()=>{
    const f=fixture(); await f.request('POST',{projectId:'alpha',terms});
    const owing:any=await f.request('GET',{}, {view:'owing',uid:'stranger'}); assert.equal(owing.data.length,1);
    const owed:any=await f.request('GET',{}, {view:'owed'}); assert.equal(owed.data.length,0);
  });
});
