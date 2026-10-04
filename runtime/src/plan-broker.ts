import {BrokerCore,openToken,type ProtectedStore} from './credential-broker.js';
import {checkPlanContract,type PlanContract} from './plan-contract.js';
import {AppError,type Fetcher} from './types.js';
import {boundedText,exactKeys,json,object,sha256} from './util.js';
export interface PlanBrokerEnv extends PlanContract {TOKEN_ENCRYPTION_KEY:string; IMPORT_ENABLED?:string; IMPORT_EPOCH?:string; IMPORT_SHA256?:string; IMPORT_EXPIRES_MS?:string;}
export const brokerIdentity=(e:PlanContract)=>JSON.stringify([e.BROKER_HOST_ID,e.PLAN_CLIENT_ID,e.PLAN_OWNER_SUBJECT,...(e.PLAN_WORKSPACE_ID===undefined?[]:[e.PLAN_WORKSPACE_ID])]);
export const probeContext=(e:PlanContract)=>JSON.stringify([brokerIdentity(e),e.BROKER_SESSION_EPOCH]);
export class PlanCredentialBroker {
 private core:BrokerCore;
 private tail:Promise<unknown>=Promise.resolve();
 constructor(state:{storage:ProtectedStore},private env:PlanBrokerEnv,fetcher:Fetcher=fetch,private now:()=>number=Date.now){this.core=new BrokerCore(state.storage,env.TOKEN_ENCRYPTION_KEY,env.BROKER_HOST_ID,fetcher,now,['chatgpt.tokens.use.direct','resource.invoke','offline_access']);}
 fetch(r:Request):Promise<Response>{const task=this.tail.then(()=>this.handle(r));this.tail=task.catch(()=>{});return task;}
 private async handle(r:Request):Promise<Response>{try{
  checkPlanContract(this.env,this.now());
  if(r.method!=='POST')return json({error:'NOT_FOUND'},404);
  const path=new URL(r.url).pathname,identity=brokerIdentity(this.env);
  if(path==='/import'){
   const end=Number(this.env.IMPORT_EXPIRES_MS),epoch=Number(this.env.IMPORT_EPOCH);
   if(this.env.IMPORT_ENABLED!=='true'||!Number.isSafeInteger(end)||end<=this.now()||end>this.now()+600000||!/^\d+$/.test(this.env.IMPORT_EPOCH??'')||!Number.isSafeInteger(epoch)||!/^[a-f0-9]{64}$/.test(this.env.IMPORT_SHA256??''))throw new AppError('IMPORT_CLOSED',403);
   const raw=await boundedText(r.body,65536),digest=await sha256(raw);
   if(digest!==this.env.IMPORT_SHA256)throw new AppError('IMPORT_CONFLICT',409);
   const body=object(JSON.parse(raw));exactKeys(body,['schema','host_id','client_id','subject','epoch','sealed']);
   if(body.schema!=='trognet-plan-import/v1'||body.host_id!==this.env.BROKER_HOST_ID||body.client_id!==this.env.PLAN_CLIENT_ID||body.subject!==this.env.PLAN_OWNER_SUBJECT||body.epoch!==epoch||epoch!==Number(this.env.BROKER_SESSION_EPOCH))throw new AppError('BROKER_IDENTITY_CHANGED',409);
   const t=await openToken(body.sealed as Parameters<typeof openToken>[0],this.env.TOKEN_ENCRYPTION_KEY,this.env.BROKER_HOST_ID);
   if(t.client_id!==body.client_id||t.subject!==body.subject||(this.env.PLAN_WORKSPACE_ID!==undefined&&(!this.env.PLAN_WORKSPACE_ID||t.workspace_id!==this.env.PLAN_WORKSPACE_ID))||!t.scopes.includes('resource.invoke')||!t.scopes.includes('offline_access'))throw new AppError('BROKER_REAUTH',503);
   return json({status:await this.core.qualifiedImport(t,identity,epoch,digest),epoch,digest});
  }
  const status=await this.core.qualifiedStatus(identity);
  if(path==='/status')return json(status);
  if(path==='/token'){if(status.epoch!==Number(this.env.BROKER_SESSION_EPOCH))throw new AppError('BROKER_REAUTH',503);return json({access_token:await this.core.getToken(),broker_identity:identity,epoch:status.epoch});}
  return json({error:'NOT_FOUND'},404);
 }catch(e){return json({error:e instanceof AppError?e.code:'BROKER_UNAVAILABLE'},e instanceof AppError?e.httpStatus:503);}}
}
// Service has no HTTP credential aperture. DO methods require explicit service bindings.
export default {fetch:async()=>new Response(null,{status:404})};
