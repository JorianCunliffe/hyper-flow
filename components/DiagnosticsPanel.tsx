import React,{useState} from 'react';
import {firebaseService} from '../services/firebaseService';
export function DiagnosticsPanel({onRead}:{onRead:()=>Promise<void>}){
  const [reason,setReason]=useState('routine_check'),[data,setData]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function inspect(){setBusy(true);setError('');setData(null);try{
    const response=await firebaseService.authorizedFetch('/api/operations?view=diagnostics&reason='+reason);
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Diagnostics unavailable');setData(result);await onRead();
  }catch(e:any){setError(e.message);}finally{setBusy(false);}}
  return <section className="border rounded p-4 space-y-3"><h2 className="text-xl font-semibold">Operational checks</h2>
    <p>Inspect bounded status summaries without opening communications or private file contents. Every inspection is recorded against your current account.</p>
    <label>Reason <select value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}><option value="routine_check">Routine check</option><option value="support_review">Support review</option><option value="incident_review">Incident review</option></select></label>
    <button className="border rounded px-3 py-2 disabled:opacity-40" disabled={busy} onClick={()=>void inspect()}>{busy?'Checking…':'Run operational checks'}</button>
    {error&&<p role="alert">{error}</p>}
    {data&&<>
      <p>Observed {new Date(data.observedAt).toLocaleString()} · Audit {data.auditId}</p>
      <p>Scheduler: {data.scheduler.status}{data.scheduler.lastSuccessfulTickAt?' · last successful tick '+new Date(data.scheduler.lastSuccessfulTickAt).toLocaleString():''}</p>
      <p>HyperFlow account: {data.lifecycle.state} · unfinished file operations: {data.lifecycle.pendingFileOperations??'unknown'}</p>
      <p>Communications Service: {data.communications.status} · {data.communications.verified}</p>
      <table className="w-full text-left"><caption>Inspected records</caption><thead><tr><th>Area</th><th>Coverage</th><th>Records</th><th>Need review</th></tr></thead><tbody>{data.datasets.map((d:any)=><tr key={d.name}><td>{{agent_inbox_jobs:'Agent jobs',external_action_receipts:'External actions',schedules:'Schedules',tenant_files:'Files'}[d.name]||d.name}</td><td>{d.status}</td><td>{d.inspected??'unknown'}</td><td>{d.needsAttention??'unknown'}</td></tr>)}</tbody></table>
      <p>{data.sampling}</p><p>API-client requests today: {data.usage.status==='available'?data.usage.apiClientRequests:'unknown'}. Provider charges have not been measured.</p>
      <p>The scheduler check uses a 26-hour threshold for the daily ticker. These observations do not establish a service guarantee or prove message delivery.</p>
    </>}
  </section>;
}
