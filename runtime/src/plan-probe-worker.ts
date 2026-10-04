/** Standalone, owner-only P0 Worker. Not imported by the Librarian production entry. */
import {authenticate,enforceOrigin} from './auth.js';import {AppError,type Env,type Fetcher} from './types.js';
import {boundedText,exactKeys,json,object,sha256} from './util.js';import {consumeResponse} from './sse.js';
import {safeProviderDiagnostic} from './inference.js';import {type ProtectedStore} from './credential-broker.js';
export interface ProbeEnv {PUBLIC_ORIGIN:string;ACCESS_ISSUER:string;ACCESS_AUDIENCE:string;PRINCIPAL_HMAC_KEY:string;
 P0_ENABLED:string;P0_OWNER_EMAIL:string;P0_PROBE_ID:string;P0_MODEL:string;P0_ACCESS_TOKEN:string;
 PLAN_REMOTE_ELIGIBILITY_REF:string;PLAN_VISIBILITY_DECISION_REF:string;
 PROBE_RUN:{idFromName(name:string):unknown;get(id:unknown):{fetch(r:Request):Promise<Response>}};}
interface Receipt {schema:'librarian-cloud-probe/v1';identity_sha256:string;status:'STARTED'|'PASS'|'BLOCKED'|'UNKNOWN';models_verified:boolean;response_completed:boolean;expected_text:boolean;diagnostic?:unknown;}
export const probeIdentity=(env:Pick<ProbeEnv,'P0_PROBE_ID'|'P0_MODEL'|'PLAN_REMOTE_ELIGIBILITY_REF'|'PLAN_VISIBILITY_DECISION_REF'>,context?:string)=>sha256(JSON.stringify({probe_id:env.P0_PROBE_ID,model:env.P0_MODEL,eligibility:env.PLAN_REMOTE_ELIGIBILITY_REF,visibility:env.PLAN_VISIBILITY_DECISION_REF,...(context?{context}:{})}));
export class ProbeCore {
 private tail:Promise<unknown>=Promise.resolve();
 constructor(private store:ProtectedStore,private env:ProbeEnv,private fetcher:Fetcher=fetch,private tokenSource?:()=>Promise<string>,private identityContext?:string){}
 async run():Promise<Receipt>{const task=this.tail.then(()=>this.once(),()=>this.once());this.tail=task.catch(()=>{});return task;}
 async inspect():Promise<Receipt|undefined>{const r=await this.store.get<Receipt>('receipt');if(r&&r.identity_sha256!==await probeIdentity(this.env,this.identityContext))throw new AppError('PROBE_IDENTITY_CHANGED',409);return r?.status==='STARTED'?{...r,status:'UNKNOWN'}:r;}
 private async once():Promise<Receipt>{
  const env=this.env;
  if(env.P0_ENABLED!=='true'||!env.PLAN_REMOTE_ELIGIBILITY_REF||!env.PLAN_VISIBILITY_DECISION_REF||(!env.P0_ACCESS_TOKEN&&!this.tokenSource)||!env.P0_MODEL||!env.P0_PROBE_ID)throw new AppError('PROBE_NOT_AUTHORIZED',403);
  const identity_sha256=await probeIdentity(env,this.identityContext);
  const existing=await this.store.get<Receipt>('receipt');
  if(existing){if(existing.identity_sha256!==identity_sha256)throw new AppError('PROBE_IDENTITY_CHANGED',409);return existing.status==='STARTED'?{...existing,status:'UNKNOWN'}:existing;}
  const receipt:Receipt={schema:'librarian-cloud-probe/v1',identity_sha256,status:'STARTED',models_verified:false,response_completed:false,expected_text:false};
  // Mark before external effects. A crash or lost response never causes a transparent retry.
  await this.store.put('receipt',receipt);
  try{
   const token=this.tokenSource?await this.tokenSource():env.P0_ACCESS_TOKEN;
   const headers={Authorization:'Bearer '+token,'Content-Type':'application/json','Accept':'text/event-stream'};
   const m=await this.fetcher('https://api.openai.com/v1/models',{headers,redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!m.ok){receipt.status='BLOCKED';receipt.diagnostic=await safeProviderDiagnostic(m);}
   else{
    const catalog=object(JSON.parse(await boundedText(m.body,1048576)));
    if(!Array.isArray(catalog.models)||!catalog.models.some(raw=>{const x=raw as {slug?:string;visibility?:string};return x.slug===env.P0_MODEL&&x.visibility==='list';}))throw new AppError('MODEL_UNAVAILABLE');
    receipt.models_verified=true;
    const r=await this.fetcher('https://api.openai.com/v1/responses',{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(30000),body:JSON.stringify({model:env.P0_MODEL,store:false,stream:true,instructions:'Reply with exactly LIBRARIAN_PROBE_OK. No tools.',input:[{role:'user',content:'Connectivity verification.'}]})});
    if(!r.ok){receipt.status=r.status>=500?'UNKNOWN':'BLOCKED';receipt.diagnostic=await safeProviderDiagnostic(r);}
    else{
     if(!r.body)throw new Error('protocol');
     const result=await consumeResponse(r.body,4096);receipt.response_completed=true;receipt.expected_text=result.text.trim()==='LIBRARIAN_PROBE_OK';receipt.status=receipt.expected_text?'PASS':'BLOCKED';
    }
   }
  }catch(e){receipt.status=e instanceof AppError&&e.code==='MODEL_UNAVAILABLE'?'BLOCKED':'UNKNOWN';}
  await this.store.put('receipt',receipt);return receipt;
 }
}
export class PlanProbeRun {
 private core:ProbeCore;
 constructor(state:{storage:ProtectedStore},env:ProbeEnv){this.core=new ProbeCore(state.storage,env);}
 async fetch(request:Request):Promise<Response>{if(request.method!=='POST'||new URL(request.url).pathname!=='/run')return new Response(null,{status:404});try{return json(await this.core.run());}catch(e){return json({status:'BLOCKED'},e instanceof AppError?e.httpStatus:503);}}
}
export default {async fetch(request:Request,env:ProbeEnv):Promise<Response>{
 try{
  enforceOrigin(request,env.PUBLIC_ORIGIN);
  if(env.P0_ENABLED!=='true'||new URL(request.url).pathname!=='/owner-probe'||request.method!=='POST')throw new AppError('NOT_FOUND',404);
  const p=await authenticate(request,env as unknown as Env);if(p.email!==env.P0_OWNER_EMAIL.toLowerCase())throw new AppError('FORBIDDEN',403);
  const body=object(JSON.parse(await boundedText(request.body,1024)));exactKeys(body,['operation']);if(body.operation!=='run_once')throw new AppError('INVALID_INPUT');
  const stub=env.PROBE_RUN.get(env.PROBE_RUN.idFromName(env.P0_PROBE_ID));return await stub.fetch(new Request('https://probe.internal/run',{method:'POST'}));
 }catch(e){return json({status:'BLOCKED'},e instanceof AppError?e.httpStatus:503);}
}};
