import React from 'react';import {createRoot} from 'react-dom/client';
import {TenantLifecyclePanel} from '../../components/TenantLifecyclePanel';import {firebaseService} from '../../services/firebaseService';
let cs:any={owner:'communications-service',tenant:{status:'active',lifecycle_revision:1}};
const data:any={owner:'hyperflow',databaseGuardsEnabled:true,lifecycle:{state:'active',revision:0,receipts:{}},datasets:['projects']};let lost=true;
let failRead = new URLSearchParams(location.search).get('failRead') === '1';
if (new URLSearchParams(location.search).get('erase') === '1') {
 data.lifecycle.state='suspended';data.lifecycle.revision=2;
 cs.tenant.status='closed';cs.tenant.lifecycle_revision=3;
}
firebaseService.authorizedFetch=async(input,options={})=>{
 document.getElementById('fixture-requests')!.textContent=String(input);
 const url=new URL(String(input),location.origin),body=options.body?JSON.parse(String(options.body)):null;
 if(!body){
  if(url.searchParams.get('service')==='communications'&&failRead){failRead=false;return Response.json({error:'Controlled recovery read failure'},{status:403});}
  return Response.json(url.searchParams.get('service')==='communications'?cs:data);
 }
 if(body.service==='communications'){cs.tenant.status=body.operation==='suspend'?'suspended':'active';cs.tenant.lifecycle_revision++;return Response.json(cs);}
 if(body.operation==='suspend'&&cs.tenant.status!=='suspended')return Response.json({error:'Suspend Communications and review its receipt first'},{status:409});
 if(body.operation==='erase_database'&&(body.confirmation!=='Erase HyperFlow database records'||body.backupReviewed!==true||cs.tenant.status!=='closed'))return Response.json({error:'Erasure prerequisites not met'},{status:409});
 if(!data.lifecycle.receipts[body.requestId]){data.lifecycle.state=body.operation==='erase_database'?'erased':body.operation==='suspend'?'suspended':'active';data.lifecycle.revision++;data.lifecycle.receipts[body.requestId]={id:body.requestId,operation:body.operation,status:'completed',at:Date.now()};}
 if(lost){lost=false;return Response.json({error:'Controlled response loss after command. Reconcile the original operation.'},{status:503});}
 return Response.json(data);
};
createRoot(document.getElementById('root')!).render(<TenantLifecyclePanel/>);
