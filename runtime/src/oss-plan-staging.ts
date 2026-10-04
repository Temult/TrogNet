/** Published OSS successor uses the unchanged Access, persistence and dispatch machinery. */
import {requireQualification,type OwnerPlanEnv} from './owner-plan-staging.js';
import {createApp} from './app.js';
import {authenticate,enforceOrigin} from './auth.js';
import {checkPlanContract} from './plan-contract.js';
import {brokerIdentity} from './plan-broker.js';
import {boundedText,json,object} from './util.js';
import {AppError,type Fetcher} from './types.js';
export async function discoverPlanModel(env:OwnerPlanEnv,fetcher:Fetcher=fetch):Promise<string> {
 checkPlanContract(env);
 if(!env.BROKER||!/^oaiapp_[A-Za-z0-9_-]+$/.test(env.PLAN_CLIENT_ID))throw new AppError('PLAN_CONTRACT_BLOCKED',503);
 const r=await env.BROKER.get(env.BROKER.idFromName('librarian-owner-v1')).fetch(new Request('https://broker.internal/token',{method:'POST'}));
 if(!r.ok)throw new AppError('INFERENCE_UNAVAILABLE',503);
 const t=object(JSON.parse(await boundedText(r.body,32768)));
 if(t.broker_identity!==brokerIdentity(env)||t.epoch!==Number(env.BROKER_SESSION_EPOCH)||typeof t.access_token!=='string'||!t.access_token)throw new AppError('INFERENCE_UNAVAILABLE',503);
 const response=await fetcher('https://api.openai.com/v1/models',{headers:{Authorization:'Bearer '+t.access_token},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new AppError('MODEL_UNAVAILABLE',503);
 const catalog=object(JSON.parse(await boundedText(response.body,1048576)));
 if(!Array.isArray(catalog.models))throw new AppError('MODEL_UNAVAILABLE',503);
 const found=catalog.models.filter(x=>x&&typeof x==='object'&&(x as Record<string,unknown>).visibility==='list'&&(x as Record<string,unknown>).slug===env.P0_MODEL);
 if(found.length!==1||typeof found[0].slug!=='string')throw new AppError('MODEL_UNAVAILABLE',503);
 return found[0].slug as string;
}
// Catalog is checked only after Access admission by the inherited app's authentication hook.
// The probe's account-discovered identity remains a prerequisite; no slug here is authority.
const app=createApp({allowFixtures:true,authenticate:async(request,env)=>{
 const p=await authenticate(request,env),e=env as OwnerPlanEnv;
 if(p.email!==e.PLAN_OWNER_EMAIL)throw new AppError('FORBIDDEN',403);
 await requireQualification(e);
 if(request.method==='POST'&&new URL(request.url).pathname==='/api/ask'&&await discoverPlanModel(e)!==e.MODEL)throw new AppError('MODEL_UNAVAILABLE',503);
 return p;
}});
export default {async fetch(request:Request,env:OwnerPlanEnv):Promise<Response>{try{
 checkPlanContract(env);
 if(!/^oaiapp_[A-Za-z0-9_-]+$/.test(env.PLAN_CLIENT_ID??''))throw new AppError('PLAN_CONTRACT_BLOCKED',503);
 enforceOrigin(request,env.PUBLIC_ORIGIN);
 if(new URL(request.url).pathname.startsWith('/owner-'))return json({error:'NOT_FOUND'},404);
 return app.fetch(request,env);
}catch(e){return json({error:e instanceof AppError?e.code:'UNAVAILABLE'},503);}}};
