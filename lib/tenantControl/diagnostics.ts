import {randomUUID} from 'node:crypto';
import {readDiagnosticSample,readSchedulerHealth,readTenantControl,transactTenantControl} from '../serverStore.js';
import {readLifecycle} from '../tenantLifecycle/store.js';
import {createCommunicationsClient} from '../communications/client.js';
import {normalizeControl,TenantControlError} from './model.js';
import type {ControlMember} from './clients.js';
const roots=['agent_inbox_jobs','external_action_receipts','schedules','tenant_files'] as const;
const knownStates=new Set(['pending','running','processing','reserved','creating','committed','uncertain','failed','needs_review','completed','cancelled','initializing','uploading','ready','deleting','deleted']);
const attention=new Set(['uncertain','failed','needs_review','initializing','deleting']);
export const diagnosticDependencies={sample:readDiagnosticSample,scheduler:readSchedulerHealth,lifecycle:readLifecycle,control:readTenantControl,audit:transactTenantControl,communications:createCommunicationsClient};
export async function readDiagnostics(member:ControlMember,reason:unknown,deps=diagnosticDependencies){
  if(!['owner','admin'].includes(member.role))throw new TenantControlError(403,'Administrator membership required');
  if(typeof reason!=='string'||!['routine_check','support_review','incident_review'].includes(reason))throw new TenantControlError(422,'Choose a diagnostic review reason');
  const auditId=randomUUID(),observedAt=Date.now(),org=member.orgId;
  // Commit access audit before exposing any diagnostic result. No impersonation.
  try { await deps.audit(org,current=>{
    const r=normalizeControl(current);r.audit.push({id:auditId,at:observedAt,actor:member.uid,operation:'diagnostics.read',resource:String(reason)+(member.apiClientId?':'+member.apiClientId:':human')});r.audit=r.audit.slice(-1000);r.revision++;return r;
  }); } catch { throw new TenantControlError(503,'Diagnostic access could not be recorded; no results were read'); }
  const checks=await Promise.allSettled([
    ...roots.map(root=>deps.sample(org,root)),deps.scheduler(),deps.lifecycle(org),deps.control(org),
    Promise.resolve().then(()=>deps.communications().listMailboxes(org)),
  ]);
  const datasets=roots.map((root,index)=>{
    const result=checks[index];if(result.status==='rejected')return {name:root,status:'unavailable' as const};
    const all=result.value as any[],rows=all.slice(0,100),states:Record<string,number>={};
    for(const row of rows){const raw=root==='schedules'?(row.enabled?'enabled':'disabled'):row.state||row.status;const state=['enabled','disabled'].includes(raw)||knownStates.has(raw)?raw:'unknown';states[state]=(states[state]||0)+1;}
    return {name:root,status:all.length>100?'partial' as const:'available' as const,inspected:rows.length,states,needsAttention:Object.entries(states).filter(([s])=>attention.has(s)).reduce((n,[,count])=>n+count,0),...(root==='tenant_files'?{readyBytesInSample:rows.filter(r=>r.state==='ready').reduce((n,r)=>n+(Number.isSafeInteger(r.bytes)&&r.bytes>=0?r.bytes:0),0)}:{})};
  });
  const scheduler=checks[4],lifecycle=checks[5],control=checks[6],mailboxes=checks[7];
  const rawTick=scheduler.status==='fulfilled'?Number((scheduler.value as any).lastSuccessfulTickAt||0):0;
  const lastSuccessfulTickAt=Number.isSafeInteger(rawTick)&&rawTick>0&&rawTick<=observedAt?rawTick:0;
  const currentDay=new Date(observedAt).toISOString().slice(0,10);
  const days=control.status==='fulfilled'?(control.value as any)?.days||{}:{};
  return {owner:'hyperflow',auditId,observedAt,reason,organizationId:org,datasets,
    scheduler:{status:scheduler.status==='rejected'?'unavailable':lastSuccessfulTickAt===0?'unknown':observedAt-lastSuccessfulTickAt>26*3600000?'stale':'recent',lastSuccessfulTickAt:lastSuccessfulTickAt||null,expectedMaximumAgeHours:26,guarantee:'Observation of the configured daily ticker, not a delivery SLA'},
    lifecycle:lifecycle.status==='fulfilled'?{state:(lifecycle.value as any).state,revision:(lifecycle.value as any).revision,pendingFileOperations:Object.keys((lifecycle.value as any).storageLeases||{}).length}:{state:'unavailable'},
    communications:mailboxes.status==='fulfilled'?{owner:'communications-service',status:'available',mailboxes:(mailboxes.value as any[]).length,attention:(mailboxes.value as any[]).filter(m=>!['healthy','syncing'].includes(m.state)).length,verified:'Authenticated mailbox-registry access; not live delivery'}:{owner:'communications-service',status:'unavailable',verified:'Not verified'},
    usage:{status:control.status==='fulfilled'?'available':'unavailable',utcDay:currentDay,apiClientRequests:Number(days[currentDay]?.requests||0),scope:'Admitted HyperFlow API-client requests only; excludes browser sessions and provider charges',providerCharges:'not measured'},
    sampling:'Up to100 records per dataset in ID order. Partial or unavailable samples cannot establish whole-tenant health. No message bodies, files, private meeting context or credentials are included.',
  };
}
