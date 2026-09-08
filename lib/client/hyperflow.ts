/** HyperFlow API client. No Communications writes, automatic retries, or credential persistence. */
export class HyperFlowApiError extends Error {
  constructor(public status:number,message:string){super(message);}
}
export class HyperFlowClient {
  private base:URL;
  #credential:string;
  constructor(baseUrl:string,credential:string,private fetcher:typeof fetch=fetch){
    this.#credential=credential;
    this.base=new URL(baseUrl);
    if(!(this.base.protocol==='https:'||(this.base.protocol==='http:'&&['localhost','127.0.0.1'].includes(this.base.hostname)))||this.base.username||this.base.password||this.base.search||this.base.hash)throw new Error('Use an HTTPS HyperFlow origin without embedded credentials');
  }
  async request<T=any>(method:'GET'|'POST'|'PUT'|'PATCH'|'DELETE',path:string,options:{query?:Record<string,string|number|boolean>;body?:unknown;signal?:AbortSignal}={}):Promise<T>{
    if(!/^\/api\//.test(path)||/[?#]/.test(path))throw new Error('Use a relative HyperFlow API resource');
    const url=new URL(path,this.base);if(url.origin!==this.base.origin||!url.pathname.startsWith('/api/'))throw new Error('Use a relative HyperFlow API resource');for(const[k,v]of Object.entries(options.query||{}))url.searchParams.set(k,String(v));
    const response=await this.fetcher(url,{method,headers:{Authorization:'Bearer '+this.#credential,...(options.body!==undefined?{'Content-Type':'application/json'}:{})},body:options.body!==undefined?JSON.stringify(options.body):undefined,signal:options.signal,redirect:'error'});
    const body=await response.json();if(!response.ok)throw new HyperFlowApiError(response.status,body.error||'HyperFlow request failed');return body;
  }
  workspace(){return this.request('GET','/api/workspace');}
  replaceWorkspace(expectedRevision:number,data:unknown){return this.request('PUT','/api/workspace',{body:{expectedRevision,data}});}
  tenant(){return this.request('GET','/api/tenant');}
  tenantOperation(body:unknown){return this.request('POST','/api/tenant',{body});}
  flowPage(after='',limit=50){return this.request('GET','/api/flows',{query:{shape:'summary',after,limit}});}
  flow(id:string){return this.request('GET','/api/flows',{query:{id}});}
  flowOperation(body:unknown){return this.request('POST','/api/flows',{body});}
  artifactPage(projectId:string,after='',limit=50){return this.request('GET','/api/artifacts',{query:{shape:'summary',projectId,after,limit}});}
}
