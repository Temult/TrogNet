/** Synthetic-only provider; never forwards a request. Fixed values are not usable credentials. */
import {bootstrapSession,protectLoginHint} from './oss-bootstrap.mjs';
import {registration} from '../dist/oss-oauth.js';
import {sealToken} from '../dist/credential-broker.js';
import {PlanCredentialBroker} from '../dist/plan-broker.js';
import {sha256} from '../dist/util.js';
export const NOW=1800000000000,HOST='urn:uuid:00000000-0000-4000-8000-000000000001',CLIENT='oaiapp_fixture_only';
export const KEY=Buffer.alloc(32,7).toString('base64');
export const identity=()=>registration(HOST);
export const planConfig=()=>({BROKER_HOST_ID:HOST,PLAN_CLIENT_ID:CLIENT,PLAN_OWNER_SUBJECT:'fixture-subject',PLAN_OWNER_EMAIL:['owner','example.invalid'].join('@'),BROKER_SESSION_EPOCH:'0',INFERENCE_MODE:'plan',INFERENCE_ENABLED:'true',PLAN_TIER:'pro',CREDITS_FALLBACK:'false',PLAN_REMOTE_ELIGIBILITY_REF:'fixture-eligibility',PLAN_VISIBILITY_DECISION_REF:'fixture-visibility',PLAN_PRO_VERIFICATION_REF:'fixture-pro',PLAN_CREDITS_DISABLED_REF:'fixture-disabled',PLAN_POLICY_EXPIRES_MS:String(NOW+3600000),TOKEN_ENCRYPTION_KEY:KEY});
export class MemoryStore {data=new Map();async get(k){return structuredClone(this.data.get(k));}async put(k,v){this.data.set(k,structuredClone(v));}}
export async function fakeOAuth(change={}) {
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'fixture-key',alg:'RS256'};
 let prepared,calls=0;
 const callback=async p=>{prepared=p;const u=new URL(p.attempt.redirect_uri);u.search=new URLSearchParams({state:p.attempt.state,code:'fixture-code',client_id:CLIENT,...change.callback});if(change.verifier)p.attempt.verifier='invalid-verifier';return u.href;};
 const fetcher=async(url,init)=>{
  calls++;
  if(String(url).endsWith('/oauth/token')){
   const a=prepared.attempt,challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(init.body.get('code_verifier')))).toString('base64url');
   if(challenge!==new URL(prepared.authorization_url).searchParams.get('code_challenge')||init.body.get('client_id')!==CLIENT||init.body.get('code')!=='fixture-code')return Response.json({error:'invalid_grant'},{status:400});
   const claims={iss:'https://auth.openai.com',aud:CLIENT,sub:'fixture-subject',nonce:a.nonce,exp:Math.floor(NOW/1000)+3600,...change.claims};
   const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),signed=enc({alg:'RS256',kid:jwk.kid})+'.'+enc(claims);
   const id_token=signed+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(signed))).toString('base64url');
   return Response.json({id_token,token_type:'Bearer',access_token:'PLACEHOLDER_ACCESS_ONLY',refresh_token:'PLACEHOLDER_REFRESH_ONLY',expires_in:3600,scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',...change.grant});
  }
  if(String(url).endsWith('/.well-known/openid-configuration'))return Response.json({issuer:'https://auth.openai.com',jwks_uri:'https://auth.openai.com/fixture-jwks'});
  if(String(url)==='https://auth.openai.com/fixture-jwks')return Response.json({keys:[jwk]});
  throw Error('FIXTURE_ROUTE_ONLY');
 };
 return {callback,fetcher,calls:()=>calls};
}
export async function dryRun(){
 const f=await fakeOAuth(),store=new MemoryStore();let saved;
 const result=await bootstrapSession({identity:identity(),callback:f.callback,fetcher:f.fetcher,now:NOW,savePending:async r=>{await store.put('pending',r);},confirmIdentity:async()=>true,commitActive:async r=>{saved=structuredClone(r.identity);await store.put('active',r);},protectHint:(v,r)=>protectLoginHint(v,KEY,r),seal:async t=>({schema:'trognet-plan-import/v1',host_id:HOST,client_id:t.client_id,subject:t.subject,epoch:0,sealed:await sealToken(t,KEY,HOST)})});
 const raw=JSON.stringify(result.bundle),env={...planConfig(),IMPORT_ENABLED:'true',IMPORT_EPOCH:'0',IMPORT_SHA256:await sha256(raw),IMPORT_EXPIRES_MS:String(NOW+300000)};
 const broker=new PlanCredentialBroker({storage:store},env,async()=>{throw Error('NO_NETWORK');},()=>NOW);
 const imported=await broker.fetch(new Request('https://fixture.internal/import',{method:'POST',body:raw}));
 if(!imported.ok)throw Error('FIXTURE_IMPORT_FAILED');
 env.IMPORT_ENABLED='false';
 const closed=await broker.fetch(new Request('https://fixture.internal/import',{method:'POST',body:raw}));
 if(closed.status!==403)throw Error('APERTURE_NOT_CLOSED');
 return {mode:'DRY_RUN',status:'PASS',registration:saved.client_id===CLIENT,protected_import:(await imported.json()).status,aperture_closed:true,network_calls:0,provider_calls:'INJECTED_FIXTURES_ONLY',real_oauth:'NOT_RUN'};
}
