import {createApp} from './app.js';
import {authenticate,enforceOrigin} from './auth.js';
import {AppError} from './types.js';
import {checkPlanContract,type PlanEnv} from './plan-contract.js';
import {boundedText,json,object} from './util.js';
import {probeIdentity,type ProbeEnv} from './plan-probe-worker.js';
import {probeContext} from './plan-broker.js';
export type OwnerPlanEnv=PlanEnv & Pick<ProbeEnv,'PROBE_RUN'|'P0_PROBE_ID'|'P0_MODEL'>;
export async function requireQualification(e:OwnerPlanEnv):Promise<void>{
 if(!e.PROBE_RUN||!e.P0_PROBE_ID||e.P0_MODEL!==e.MODEL)throw new AppError('PLAN_NOT_QUALIFIED',503);
 const r=await e.PROBE_RUN.get(e.PROBE_RUN.idFromName('e05-one-shot')).fetch(new Request('https://probe.internal/qualification',{method:'POST'}));
 if(!r.ok)throw new AppError('PLAN_NOT_QUALIFIED',503);
 const q=object(JSON.parse(await boundedText(r.body,8192)));
 if(q.status!=='PASS'||q.models_verified!==true||q.response_completed!==true||q.expected_text!==true||q.identity_sha256!==await probeIdentity(e,probeContext(e)))throw new AppError('PLAN_NOT_QUALIFIED',503);
}
const app=createApp({allowFixtures:true,authenticate:async(request,env)=>{
 const p=await authenticate(request,env);
 if(p.email!==(env as PlanEnv).PLAN_OWNER_EMAIL)throw new AppError('FORBIDDEN',403);
 await requireQualification(env as OwnerPlanEnv);
 return p;
}});
export default {async fetch(request:Request,env:OwnerPlanEnv):Promise<Response>{
 try {
  checkPlanContract(env);
  if(!env.BROKER||!env.MODEL)throw new AppError('PLAN_CONTRACT_BLOCKED',503);
  enforceOrigin(request,env.PUBLIC_ORIGIN);
  // No credential routes are mounted in the serving entrypoint.
  if(new URL(request.url).pathname.startsWith('/owner-'))return json({error:'NOT_FOUND'},404);
  return app.fetch(request,env);
 }catch(e){return json({error:e instanceof AppError?e.code:'UNAVAILABLE'},e instanceof AppError?e.httpStatus:503);}
}};
