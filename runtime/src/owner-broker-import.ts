import {authenticate,enforceOrigin} from './auth.js';
import {checkPlanContract,BROKER_OBJECT,type PlanEnv} from './plan-contract.js';
import {AppError} from './types.js';
import {boundedText,json,sha256} from './util.js';
export interface ImportEnv extends PlanEnv {IMPORT_ENABLED:string;IMPORT_EXPIRES_MS:string;IMPORT_SECRET:string;}
export function createImportWorker(auth=authenticate){return {async fetch(r:Request,e:ImportEnv):Promise<Response>{try{
 checkPlanContract(e);
 const expiry=Number(e.IMPORT_EXPIRES_MS);
 if(e.IMPORT_ENABLED!=='true'||!Number.isSafeInteger(expiry)||expiry<=Date.now()||expiry>Date.now()+600000)throw new AppError('IMPORT_CLOSED',403);
 enforceOrigin(r,e.PUBLIC_ORIGIN);
 const path=new URL(r.url).pathname;
 if(r.method!=='POST'||!['/owner-import','/owner-import-status'].includes(path))throw new AppError('NOT_FOUND',404);
 const p=await auth(r,e);if(p.email!==e.PLAN_OWNER_EMAIL)throw new AppError('FORBIDDEN',403);
 const secret=r.headers.get('X-TrogNet-Import');
 if(!e.IMPORT_SECRET||e.IMPORT_SECRET.length<32||!secret||secret.length>512||await sha256(secret)!==await sha256(e.IMPORT_SECRET))throw new AppError('FORBIDDEN',403);
 if(!e.BROKER)throw new AppError('IMPORT_CLOSED',503);
 const raw=path==='/owner-import'?await boundedText(r.body,65536):'';
 return e.BROKER.get(e.BROKER.idFromName(BROKER_OBJECT)).fetch(new Request('https://broker.internal/'+(path==='/owner-import'?'import':'status'),{method:'POST',body:raw}));
 }catch(err){return json({error:err instanceof AppError?err.code:'IMPORT_UNAVAILABLE'},err instanceof AppError?err.httpStatus:503);}}};}
export default createImportWorker();
