import test from 'node:test';import assert from 'node:assert/strict';
import{HyperFlowClient,HyperFlowApiError}from'../lib/client/hyperflow.js';
test('standalone client pins its origin, sends revision and never retries uncertain writes',async()=>{
 let calls=0;const requests:any[]=[];
 const client=new HyperFlowClient('https://example.com','fixture-secret',async(url,init)=>{calls++;requests.push({url:String(url),init});return calls===1?Response.json({owner:'hyperflow',items:[],next:'next'}):Response.json({error:'Held for reconciliation'},{status:409});});
 assert.equal((await client.flowPage('cursor',2)).owner,'hyperflow');
 assert.equal(JSON.stringify(client).includes('fixture-secret'),false);
 assert.equal(new URL(requests[0].url).searchParams.get('after'),'cursor');
 await assert.rejects(client.replaceWorkspace(4,{projects:[]}),e=>e instanceof HyperFlowApiError&&e.status===409);
 assert.equal(calls,2);assert.equal(JSON.parse(requests[1].init.body).expectedRevision,4);
 assert.equal(requests[1].init.redirect,'error');
 await assert.rejects(client.request('GET','https://other.example/api/tenant'),/relative/);
 assert.throws(()=>new HyperFlowClient('http://example.com','fixture'),/HTTPS/);
});
