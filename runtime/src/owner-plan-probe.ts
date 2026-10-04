import {ProbeCore,type ProbeEnv} from './plan-probe-worker.js';
import {type ProtectedStore} from './credential-broker.js';
import {brokerIdentity,probeContext} from './plan-broker.js';
import {checkPlanContract,BROKER_OBJECT,type PlanEnv} from './plan-contract.js';
import {authenticate,enforceOrigin} from './auth.js';
import {AppError,type Fetcher} from './types.js';
import {boundedText,exactKeys,json,object} from './util.js';
export type OwnerProbeEnv=PlanEnv & ProbeEnv;
export class OwnerPlanProbeRun {
 private core:ProbeCore;
 constructor(state:{storage:ProtectedStore},private env:OwnerProbeEnv,fetcher:Fetcher=fetch){
  this.core=new ProbeCore(state.storage,env,fetcher,async()=>{
   if(!env.BROKER)throw new AppError('BROKER_REAUTH',503);
   const r=await env.BROKER.get(env.BROKER.idFromName(BROKER_OBJECT)).fetch(new Request('https://broker.internal/token',{method:'POST'}));
   if(!r.ok)throw new AppError('BROKER_REAUTH',503);
   const t=object(JSON.parse(await boundedText(r.body,32768)));
   if(typeof t.access_token!=='string'||!t.access_token||t.broker_identity!==brokerIdentity(env)||t.epoch!==Number(env.BROKER_SESSION_EPOCH))throw new AppError('BROKER_REAUTH',503);
   return t.access_token;
  },probeContext(env));
 }
 async fetch(r:Request):Promise<Response>{try{
  checkPlanContract(this.env);
  if(this.env.P0_ACCESS_TOKEN!==undefined||!this.env.BROKER||this.env.P0_MODEL!==this.env.MODEL)throw new AppError('PLAN_CONTRACT_BLOCKED',503);
  if(r.method==='POST'&&new URL(r.url).pathname==='/qualification')return json(await this.core.inspect()??{status:'NOT_RUN'});
  if(r.method!=='POST'||new URL(r.url).pathname!=='/run')return json({error:'NOT_FOUND'},404);
  return json(await this.core.run());
 }catch(e){return json({status:'BLOCKED',error:e instanceof AppError?e.code:'UNAVAILABLE'},e instanceof AppError?e.httpStatus:503);}}
}
export default {async fetch(r:Request,e:OwnerProbeEnv):Promise<Response>{try{
 checkPlanContract(e);enforceOrigin(r,e.PUBLIC_ORIGIN);
 if(r.method!=='POST'||new URL(r.url).pathname!=='/owner-probe'||e.P0_ENABLED!=='true')throw new AppError('NOT_FOUND',404);
 const p=await authenticate(r,e);if(p.email!==e.PLAN_OWNER_EMAIL)throw new AppError('FORBIDDEN',403);
 const b=object(JSON.parse(await boundedText(r.body,1024)));exactKeys(b,['operation']);if(b.operation!=='run_once')throw new AppError('INVALID_INPUT');
 return e.PROBE_RUN.get(e.PROBE_RUN.idFromName('e05-one-shot')).fetch(new Request('https://probe.internal/run',{method:'POST'}));
 }catch(err){return json({status:'BLOCKED',error:err instanceof AppError?err.code:'UNAVAILABLE'},err instanceof AppError?err.httpStatus:503);}}};
