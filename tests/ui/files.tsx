import React from 'react';import{createRoot}from'react-dom/client';
import{ManagedFilesPanel}from'../../components/ManagedFilesPanel';import{firebaseService}from'../../services/firebaseService';
const pending={id:'fixture_upload_01',name:'Meeting recording.webm',visibility:'private',state:'uploading',offset:1048576,bytes:2097152};
const ready={id:'fixture_ready_02',name:'Weekly report.txt',visibility:'organization',state:'ready',offset:30,bytes:30};
firebaseService.authorizedFetch=async(input,options={})=>{
 const q=new URL(String(input),location.origin).searchParams,body=options.body?JSON.parse(String(options.body)):null;
 if(body?.operation==='reconcile'){pending.state='ready';pending.offset=pending.bytes;return Response.json({file:pending});}
 if(q.get('download')==='1')return Response.json({url:'data:text/plain,Controlled%20report',expiresAt:Date.now()+60000});
 return Response.json({owner:'hyperflow',items:[pending,ready],next:null});
};
createRoot(document.getElementById('root')!).render(<ManagedFilesPanel/>);
