import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryContextPanel } from '../../components/MemoryContextPanel';
import { firebaseService } from '../../services/firebaseService';
firebaseService.authorizedFetch = async (_input, options = {}) => {
 const body=JSON.parse(String(options.body));
 document.getElementById('request-log')!.textContent=JSON.stringify(body,null,2);
 if(body.query==='outage') return new Response(JSON.stringify({error:'Unavailable'}),{status:503});
 return new Response(JSON.stringify({contract_version:'memory-context.v1',memory_status:{state:body.query==='stale'?'stale':'current',retrieved_at:new Date().toISOString(),evidence_only:true},data:body.query==='empty'?{}:{provenance:{sources:{comm_synthetic_email:{excerpt:'I will send the valuation Friday.'}}},commitments:[{id:'promise',original_wording:'I will send the valuation Friday.',source_communication_ids:['comm_synthetic_email'],due_at_candidate:'2026-09-11T07:00:00Z',due_date_status:'inferred'}],communications:[{communication_id:'comm_synthetic_email',channel:'email',body:'I will send the valuation Friday.'}]}}),{status:200});
};
createRoot(document.getElementById('root')!).render(<MemoryContextPanel orgId="synthetic" projects={[{id:'alpha',name:'Alpha settlement'}] as any} people={[{id:'alex',name:'Alex'}] as any}/>);
