import test from 'node:test';
import assert from 'node:assert/strict';
import {readDiagnostics} from '../lib/tenantControl/diagnostics';
const owner={uid:'owner',orgId:'tenant_a',role:'owner'};
function fixture(){
 let audited=false,state:any=null;
 const deps:any={
 audit:async(org:string,fn:any)=>{assert.equal(org,owner.orgId);audited=true;state=fn(state);return state;},
 sample:async(org:string,root:string)=>{assert.ok(audited);assert.equal(org,owner.orgId);return Array.from({length:root==='tenant_files'?101:1},()=>({state:'ready',bytes:3,body:'PRIVATE_BODY',sessionSecret:'SECRET_UPLOAD',name:'PRIVATE_NAME'}));},
 scheduler:async()=>({lastSuccessfulTickAt:Date.now()-27*3600000,private:'PRIVATE_SCHEDULER'}),
 lifecycle:async()=>({state:'active',revision:1,storageLeases:{a:{path:'PRIVATE_PATH'}}}),
 control:async()=>({days:{[new Date().toISOString().slice(0,10)]:{requests:4}},secret:'SECRET_CREDENTIAL'}),
 communications:()=>({listMailboxes:async(org:string)=>{assert.equal(org,owner.orgId);return [{state:'healthy',email:'PRIVATE_EMAIL'}];}}),
 };
 return {deps,audit:()=>state};
}
test('diagnostics are tenant scoped, audited first, bounded and explicitly redact private content',async()=>{
 const f=fixture(),r=await readDiagnostics(owner,'support_review',f.deps);
 assert.equal(f.audit().audit[0].actor,'owner');assert.equal(f.audit().audit[0].operation,'diagnostics.read');
 assert.equal(r.datasets[3].status,'partial');assert.equal(r.datasets[3].inspected,100);assert.equal(r.datasets[3].readyBytesInSample,300);
 assert.equal(r.scheduler.status,'stale');assert.equal(r.usage.apiClientRequests,4);assert.equal(r.lifecycle.pendingFileOperations,1);assert.equal(r.communications.owner,'communications-service');
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE_|SECRET_/);
});
test('unauthorized and unauditable diagnostics disclose no records',async()=>{
 const f=fixture();await assert.rejects(readDiagnostics({...owner,role:'member'},'support_review',f.deps),{status:403});assert.equal(f.audit(),null);
 await assert.rejects(readDiagnostics(owner,'arbitrary',f.deps),{status:422});assert.equal(f.audit(),null);
 f.deps.audit=async()=>{throw Error('SECRET_FAILURE');};f.deps.sample=async()=>{assert.fail('must not read');};
 await assert.rejects(readDiagnostics(owner,'support_review',f.deps),e=>(e as any).status===503&&!String(e).includes('SECRET_FAILURE'));
});
test('individual outages and unknown timestamps remain explicit without leaking provider errors',async()=>{
 const f=fixture();f.deps.sample=async()=>{throw Error('SECRET_PROVIDER');};f.deps.scheduler=async()=>({lastSuccessfulTickAt:'invalid'});f.deps.communications=()=>{throw Error('SECRET_PROVIDER');};
 const r=await readDiagnostics({...owner,apiClientId:'client_fixture'},'incident_review',f.deps);
 assert.ok(r.datasets.every(d=>d.status==='unavailable'));assert.equal(r.communications.status,'unavailable');assert.equal(r.scheduler.status,'unknown');assert.match(f.audit().audit[0].resource,/client_fixture/);assert.doesNotMatch(JSON.stringify(r),/SECRET_PROVIDER/);
});
