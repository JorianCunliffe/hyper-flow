import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {cloudFileProvider,cancelUploadSession} from '../lib/files/provider';
import type {ManagedFile} from '../lib/files/model';

test('real fetch accepts GCS 308 progress without following redirects', async () => {
  let accepted=0,redirectRequests=0;
  const server=createServer((req,res)=>{
    if(req.url==='/redirect'){redirectRequests++;res.writeHead(500).end();return;}
    let count=0;
    req.on('data',c=>count+=c.length);
    req.on('end',()=>{accepted+=count;res.statusCode=308;res.setHeader('Location','/redirect');if(accepted)res.setHeader('Range',`bytes=0-${accepted-1}`);res.end();});
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const realFetch=globalThis.fetch;
  const port=(server.address() as any).port;
  globalThis.fetch=((_url:any,init:any)=>realFetch(`http://127.0.0.1:${port}/upload`,init)) as typeof fetch;
  const file={sessionSecret:'https://storage.googleapis.com/upload/storage/v1/test',bytes:10,mime:'application/octet-stream'} as ManagedFile;
  try {
    assert.deepEqual(await cloudFileProvider.progress(file),{offset:0});
    await cloudFileProvider.put(file,0,Buffer.from('abc'));
    assert.deepEqual(await cloudFileProvider.progress(file),{offset:3});
    assert.equal(redirectRequests,0);
  } finally {globalThis.fetch=realFetch;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

test('completed cancellation requires the exact terminal object receipt', async()=>{
  const file={sessionSecret:'https://storage.googleapis.com/upload/storage/v1/test',bucket:'private-bucket',path:'managed/org/file',bytes:3,crc32c:'Nks/tw==',generation:'123'} as ManagedFile;
  const realFetch=globalThis.fetch;
  let status=200;
  let metadata:any={bucket:file.bucket,name:file.path,size:'3',crc32c:file.crc32c,generation:'123'};
  globalThis.fetch=(async (_url:any,init:any)=>{assert.equal(init.redirect,'manual');assert.equal(init.method,'DELETE');return new Response(JSON.stringify(metadata),{status});}) as typeof fetch;
  try{
    await cancelUploadSession(file);
    for(const [key,value] of [['name','wrong'],['bucket','wrong'],['size','4'],['crc32c','AAAAAA=='],['generation','124']]){
      const before=metadata[key];metadata[key]=value;await assert.rejects(cancelUploadSession(file),/unresolved/);metadata[key]=before;
    }
    for(status of [499,404,410])await cancelUploadSession(file);
    status=503;await assert.rejects(cancelUploadSession(file),/unresolved/);
  }finally{globalThis.fetch=realFetch;}
});
