import {AppError,type Fetcher} from './types.js';
import {boundedText,object,utf8} from './util.js';
import {normalizeRefreshSchedule} from './refresh-schedule.js';
export interface TokenSet {client_id:string;subject:string;issuer:string;ext_agent_host_id:string;workspace_id?:string;id_token?:string;access_token:string;refresh_token:string;scopes:string[];expires_at_ms:number;refresh_expires_at_ms:number;earliest_refresh_at_ms?:number;unqualified_refresh_schedule?:unknown;}
export interface ProtectedStore {get<T>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<void>;}
interface Envelope {schema:'librarian-token-envelope/v1';iv:string;ciphertext:string;}
interface RecordState {phase:'ready'|'refreshing'|'replacement_staged'|'reauth_required'|'disabled'|'configuration_error';generation:number;sealed?:Envelope;retry_not_before_ms?:number;qualification?:{identity:string;epoch:number;digest:string};}
function b64(b:Uint8Array):string{return btoa(String.fromCharCode(...b));}function unb64(s:string):Uint8Array{return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
async function keyFrom(secret:string):Promise<CryptoKey>{let raw:Uint8Array;try{raw=unb64(secret);}catch{throw new AppError('BROKER_CONFIG',503);}if(raw.byteLength!==32)throw new AppError('BROKER_CONFIG',503);return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);}
export async function sealToken(tokens:TokenSet,key:string,host:string):Promise<Envelope>{const iv=crypto.getRandomValues(new Uint8Array(12));const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:utf8.encode('librarian-v1|'+host)},await keyFrom(key),utf8.encode(JSON.stringify(tokens)));return {schema:'librarian-token-envelope/v1',iv:b64(iv),ciphertext:b64(new Uint8Array(ciphertext))};}
export async function openToken(e:Envelope,key:string,host:string):Promise<TokenSet>{try{if(e.schema!=='librarian-token-envelope/v1')throw new Error('schema');const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(e.iv),additionalData:utf8.encode('librarian-v1|'+host)},await keyFrom(key),unb64(e.ciphertext));const t=JSON.parse(new TextDecoder().decode(plaintext)) as TokenSet;validateTokens(t,host);return t;}catch{throw new AppError('BROKER_REAUTH',503);}}
export function validateTokens(t:TokenSet,host:string):void {if(!t||t.issuer!=='https://auth.openai.com'||typeof t.client_id!=='string'||!t.client_id||t.client_id==='dynamic_agent_client'||typeof t.subject!=='string'||!t.subject||t.ext_agent_host_id!==host||!Array.isArray(t.scopes)||!t.scopes.includes('chatgpt.tokens.use.direct')||typeof t.access_token!=='string'||!t.access_token||t.access_token.length>16384||typeof t.refresh_token!=='string'||!t.refresh_token||t.refresh_token.length>16384||!Number.isFinite(t.expires_at_ms)||!Number.isFinite(t.refresh_expires_at_ms)||(t.earliest_refresh_at_ms!==undefined&&!Number.isFinite(t.earliest_refresh_at_ms)))throw new AppError('BROKER_REAUTH',503);}
/** One authoritative writer for one dedicated rotating session. */
export class BrokerCore {
 private tail:Promise<unknown>=Promise.resolve();
 constructor(private store:ProtectedStore,private key:string,private host:string,private fetcher:Fetcher=fetch,private now:()=>number=Date.now,private requiredScopes:string[]=['chatgpt.tokens.use.direct']){}
 private exclusive<T>(fn:()=>Promise<T>):Promise<T>{const p=this.tail.then(fn,fn);this.tail=p.catch(()=>{});return p;}
 async initialize(tokens:TokenSet):Promise<void>{return this.exclusive(async()=>{validateTokens(tokens,this.host);if(await this.store.get('session'))throw new AppError('BROKER_ALREADY_INITIALIZED',409);await this.store.put('session',{phase:'ready',generation:0,sealed:await sealToken(tokens,this.key,this.host)} satisfies RecordState);});}
 async disable():Promise<void>{return this.exclusive(async()=>{const r=await this.store.get<RecordState>('session');if(r)await this.store.put('session',{...r,phase:'disabled'});});}
 async qualifiedImport(tokens:TokenSet,identity:string,epoch:number,digest:string):Promise<'IMPORTED'|'ALREADY_IMPORTED'>{return this.exclusive(async()=>{
  validateTokens(tokens,this.host);
  const old=await this.store.get<RecordState>('session');
  if(old?.qualification?.identity!==undefined&&old.qualification.identity!==identity)throw new AppError('BROKER_IDENTITY_CHANGED',409);
  if(old?.qualification?.epoch===epoch){if(old.qualification.digest!==digest)throw new AppError('IMPORT_CONFLICT',409);return 'ALREADY_IMPORTED';}
  if(!Number.isSafeInteger(epoch)||epoch!==(old?((old.qualification?.epoch??-2)+1):0)||old&&!['reauth_required','refreshing','disabled','configuration_error'].includes(old.phase))throw new AppError('IMPORT_CONFLICT',409);
  if(tokens.expires_at_ms<=this.now()+120000||tokens.refresh_expires_at_ms<=this.now())throw new AppError('BROKER_REAUTH',503);
  // Session and consumed import identity are a single durable write, including on reauthorization.
  await this.store.put('session',{phase:'ready',generation:(old?.generation??-1)+1,sealed:await sealToken(tokens,this.key,this.host),qualification:{identity,epoch,digest}} satisfies RecordState);
  return 'IMPORTED';
 });}
 async qualifiedStatus(identity:string):Promise<{phase:string;epoch:number;digest:string}>{return this.exclusive(async()=>{
  const r=await this.store.get<RecordState>('session');
  if(!r?.qualification)throw new AppError('BROKER_REAUTH',503);
  if(r.qualification.identity!==identity)throw new AppError('BROKER_IDENTITY_CHANGED',409);
  return {phase:r.phase,epoch:r.qualification.epoch,digest:r.qualification.digest};
 });}
 async getToken():Promise<string>{return this.exclusive(async()=>{
   let record=await this.store.get<RecordState>('session');if(!record)throw new AppError('BROKER_REAUTH',503);
   if(record.phase==='replacement_staged'){await this.store.put('session',{...record,phase:'ready'});record={...record,phase:'ready'};}
   if(record.phase==='configuration_error')throw new AppError('BROKER_CONFIG',503);
   if(record.phase==='refreshing')throw new AppError('BROKER_REFRESH_RECONCILIATION_REQUIRED',503);
   if(record.phase!=='ready'||!record.sealed)throw new AppError('BROKER_REAUTH',503);
   const tokens=await openToken(record.sealed,this.key,this.host),now=this.now();
   if(this.requiredScopes.some(s=>!tokens.scopes.includes(s)))throw new AppError('BROKER_REAUTH',503);
   if(tokens.expires_at_ms>now+120000)return tokens.access_token;
   if(tokens.unqualified_refresh_schedule!==undefined)throw new AppError('BROKER_REFRESH_SCHEDULE_UNQUALIFIED',503);
   if(tokens.earliest_refresh_at_ms!==undefined&&tokens.earliest_refresh_at_ms>now)throw new AppError('BROKER_REFRESH_DEFERRED',503);
   if(tokens.refresh_expires_at_ms<=now){const {sealed,...metadata}=record;await this.store.put('session',{...metadata,phase:'reauth_required'});throw new AppError('BROKER_REAUTH',503);}
   if((record.retry_not_before_ms??0)>now)throw new AppError('BROKER_REFRESH_BACKOFF',503);
   // Durable before dispatch: restart cannot replay a possibly consumed token.
   await this.store.put('session',{...record,phase:'refreshing'});
   const retry=async():Promise<never>=>{
     await this.store.put('session',{...record,phase:'ready',retry_not_before_ms:this.now()+30000});
     throw new AppError('BROKER_REFRESH_BACKOFF',503);
   };
   let r:Response;
   try{
     r=await this.fetcher('https://auth.openai.com/api/accounts/oauth/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:tokens.client_id,refresh_token:(tokens.refresh_token),resource:'https://api.openai.com/v1'})});
   }catch(error){
     // Only DNS/connect refusal proves no HTTP request reached the provider.
     // Timeouts, resets and generic network failures have ambiguous outcomes.
     const cause=error instanceof TypeError?error.cause:undefined;
     if(cause&&typeof cause==='object'&&'code'in cause&&['ENOTFOUND','EAI_AGAIN','ECONNREFUSED'].includes(String(cause.code)))return retry();
     throw new AppError('BROKER_REFRESH_RECONCILIATION_REQUIRED',503);
   }
   if(!r.ok){
     let code:unknown;
     try{const body=object(JSON.parse(await boundedText(r.body,49152)));code=typeof body.error==='string'?body.error:object(body.error).code;}catch{/* Unstructured errors cannot prove non-consumption. */}
     if(['invalid_grant','invalid_refresh_token','token_expired','refresh_token_expired','refresh_token_invalidated','refresh_token_reused'].includes(String(code))){
       const {sealed,...metadata}=record;await this.store.put('session',{...metadata,phase:'reauth_required'});throw new AppError('BROKER_REAUTH',503);
     }
     if(code==='invalid_client'){await this.store.put('session',{...record,phase:'configuration_error'});throw new AppError('BROKER_CONFIG',503);}
     // Even a temporary HTTP failure does not document safe replay of a rotating
     // grant. Preserve sealed credentials in refreshing for owner reconciliation.
     throw new AppError('BROKER_REFRESH_RECONCILIATION_REQUIRED',503);
   }
   try{
     const body=object(JSON.parse(await boundedText(r.body,49152)));
     if(typeof body.access_token!=='string'||!body.access_token.trim()||typeof body.refresh_token!=='string'||!body.refresh_token.trim()||body.refresh_token===(tokens.refresh_token)||body.expires_in!==3600||String(body.token_type).toLowerCase()!=='bearer')throw new Error('token');
     const scopes=body.scope===undefined?tokens.scopes:typeof body.scope==='string'?body.scope.split(/\s+/):[];
     const replacement:TokenSet={...tokens,access_token:(body.access_token),refresh_token:(body.refresh_token),scopes,expires_at_ms:now+body.expires_in*1000,refresh_expires_at_ms:now+30*86400000};
     delete replacement.earliest_refresh_at_ms;delete replacement.unqualified_refresh_schedule;
     const schedule=normalizeRefreshSchedule(body,replacement.expires_at_ms);
     if(schedule!==undefined)replacement.earliest_refresh_at_ms=schedule;
     validateTokens(replacement,this.host);
     if(this.requiredScopes.some(s=>!replacement.scopes.includes(s)))throw new Error('scope');
     const {retry_not_before_ms,...metadata}=record;
     const stagedRecord:RecordState={...metadata,phase:'replacement_staged',generation:record.generation+1,sealed:await sealToken(replacement,this.key,this.host)};
     await this.store.put('session',stagedRecord);
     await this.store.put('session',{...stagedRecord,phase:'ready'});
     return replacement.access_token;
   }catch{
     // Never overwrite a replacement: put may have committed before rejecting.
     // The durable state is either refreshing (frozen) or the latest replacement.
     throw new AppError('BROKER_REFRESH_RECONCILIATION_REQUIRED',503);
   }
 });}
}
interface BrokerEnv {TOKEN_ENCRYPTION_KEY:string;BROKER_HOST_ID:string;BROKER_BOOTSTRAP_SECRET?:string;PLAN_REMOTE_ELIGIBILITY_REF?:string;PLAN_VISIBILITY_DECISION_REF?:string;}
async function secretMatches(a:string|undefined,b:string|null):Promise<boolean>{if(!a||!b||a.length<24||b.length>512)return false;const [x,y]=await Promise.all([crypto.subtle.digest('SHA-256',utf8.encode(a)),crypto.subtle.digest('SHA-256',utf8.encode(b))]);const A=new Uint8Array(x),B=new Uint8Array(y);let d=0;for(let i=0;i<A.length;i++)d|=A[i]!^B[i]!;return d===0;}
export class CredentialBroker {
 private core:BrokerCore;
 constructor(private state:{storage:ProtectedStore},private env:BrokerEnv){this.core=new BrokerCore(state.storage,env.TOKEN_ENCRYPTION_KEY,env.BROKER_HOST_ID);}
 async fetch(request:Request):Promise<Response>{
  try{if(!this.env.PLAN_REMOTE_ELIGIBILITY_REF||!this.env.PLAN_VISIBILITY_DECISION_REF)throw new Error('not qualified');const path=new URL(request.url).pathname;
   if(request.method==='POST'&&path==='/bootstrap'){
     // Authenticate the import aperture before reading or parsing any bearer material.
     if(!await secretMatches(this.env.BROKER_BOOTSTRAP_SECRET,request.headers.get('X-Librarian-Bootstrap')))return new Response(null,{status:403,headers:{'Cache-Control':'no-store'}});
     const raw=await boundedText(request.body,5000);const tokens=JSON.parse(raw) as TokenSet;await this.core.initialize(tokens);return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
   }
   if(request.method!=='POST'||path!=='/token')return new Response(null,{status:404});const access_token=await this.core.getToken();return new Response(JSON.stringify({access_token}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }catch{return new Response(null,{status:503,headers:{'Cache-Control':'no-store'}});}
 }
}
