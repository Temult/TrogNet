/** Explicit owner enrollment; fixtures by default. Pending registration is not active authorization. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {registration,prepareOSS,consumeOSS,validateOSS} from '../dist/oss-oauth.js';
import {TOKEN_ENDPOINT} from '../dist/oauth-protocol.js';
import {sealToken} from '../dist/credential-broker.js';
import {boundedText,sha256} from '../dist/util.js';
import {checkPlanContract} from '../dist/plan-contract.js';
import {privateDirectory,writeOnce,writeAtomic} from './protected-files.mjs';
export function requirePublication(receipt,sourceDigest) {
 if(!receipt||receipt.schema!=='trognet-oss-publication-receipt/v1'||receipt.published!==true||receipt.owner_reviewed!==true||receipt.source_sha256!==sourceDigest||!/^[a-f0-9]{64}$/.test(sourceDigest??'')||!['MIT','Apache-2.0','BSD-3-Clause'].includes(receipt.license)||typeof receipt.public_source_url!=='string'||!/^https:\/\//.test(receipt.public_source_url)||!receipt.published_at||!Number.isFinite(Date.parse(receipt.published_at))||Date.parse(receipt.published_at)>Date.now())throw Error('OSS_PUBLICATION_REQUIRED');
 // An owner attestation, not a remote eligibility verifier. No receipt is distributed with this software.
}
export async function exchangeOSS(grant,attempt,r,fetcher,now=Date.now()) {
 const response=await fetcher(TOKEN_ENDPOINT,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:grant.form});
 if(!response.ok)throw Error('OAUTH_EXCHANGE_REJECTED_OR_UNCERTAIN');
 const raw=JSON.parse(await boundedText(response.body,65536));
 const discovery=await fetcher('https://auth.openai.com/.well-known/openid-configuration',{redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!discovery.ok)throw Error('JWKS_UNAVAILABLE');
 const metadata=JSON.parse(await boundedText(discovery.body,65536)),url=new URL(metadata.jwks_uri);
 if(metadata.issuer!=='https://auth.openai.com'||url.origin!==metadata.issuer||url.username||url.password||url.hash)throw Error('JWKS_UNAVAILABLE');
 const responseKeys=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!responseKeys.ok)throw Error('JWKS_UNAVAILABLE');
 const jwks=JSON.parse(await boundedText(responseKeys.body,65536));
 if(!Array.isArray(jwks.keys)||jwks.keys.length>20)throw Error('JWKS_UNAVAILABLE');
 return validateOSS(raw,attempt,r,grant.client_id,jwks.keys,typeof now==='function'?now():now);
}
const hintBinding=r=>new TextEncoder().encode(JSON.stringify(['trognet-hint/v2',r.host_id,r.client_id,r.issuer,r.subject]));
async function hintKey(key){if(!/^[A-Za-z0-9+/]{43}=$/.test(key??'')||Buffer.from(key,'base64').length!==32)throw Error('PROTECTED_HINT_KEY');return crypto.subtle.importKey('raw',Buffer.from(key,'base64'),'AES-GCM',false,['encrypt','decrypt']);}
export async function protectLoginHint(value,key,r){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:hintBinding(r)},await hintKey(key),new TextEncoder().encode(value));
 return {schema:'trognet-protected-hint/v2',iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(ciphertext).toString('base64')};
}
export async function openLoginHint(envelope,key,r){try{
 if(envelope.schema!=='trognet-protected-hint/v2')throw Error('schema');
 const value=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(envelope.iv,'base64'),additionalData:hintBinding(r)},await hintKey(key),Buffer.from(envelope.ciphertext,'base64'));
 return new TextDecoder('utf-8',{fatal:true}).decode(value);
}catch{throw Error('PROTECTED_HINT_UNAVAILABLE');}}
export async function bootstrapSession({identity,port=1455,callback,fetcher,savePending,confirmIdentity,commitActive,seal,protectHint,idTokenHint,now=Date.now}) {
 if([savePending,confirmIdentity,commitActive,seal,protectHint].some(f=>typeof f!=='function'))throw Error('ENROLLMENT_CALLBACKS_REQUIRED');
 const time=()=>typeof now==='function'?now():now;
 const prepared=await prepareOSS(identity,port,time(),idTokenHint);
 const grant=consumeOSS(await callback(prepared),prepared.attempt,identity,time());
 const pending={schema:'trognet-oss-pending/v2',host_id:identity.host_id,client_id:grant.client_id};
 // Durable minimal state BEFORE exchange. No code, PKCE, token or unverified account fields.
 await savePending(pending);
 const tokens=await exchangeOSS(grant,prepared.attempt,identity,fetcher,now);
 const verified={schema:'trognet-oss-registration/v2',host_id:identity.host_id,client_id:tokens.client_id,issuer:tokens.issuer,subject:tokens.subject,workspace_binding:'ISSUED_CLIENT_PROVIDER_BOUND'};
 if(await confirmIdentity(Object.freeze({...verified}))!==true)throw Error('OWNER_CONFIRMATION_REQUIRED');
 const bundle=await seal(tokens),protected_hint=await protectHint(tokens.id_token,verified);
 // Adapter commits one complete protected record atomically. Failure leaves prior active record intact.
 await commitActive({schema:'trognet-owner-enrollment/v2',identity:verified,protected_hint,bundle});
 return {identity:verified,bundle};
}
export function enrollmentStore(dir){
 privateDirectory(dir);
 const read=name=>{const file=path.join(dir,name);if(!fs.existsSync(file))return undefined;const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>131072)throw Error('ENROLLMENT_STORE_INVALID');return JSON.parse(fs.readFileSync(file,'utf8'));};
 return {load:()=>({active:read('active.json'),pending:read('pending.json')}),
  savePending:async pending=>{const old=read('pending.json');if(old){if(JSON.stringify(old)!==JSON.stringify(pending))throw Error('PENDING_REGISTRATION_CHANGED');}else writeOnce(path.join(dir,'pending.json'),JSON.stringify(pending));},
  commitActive:async value=>writeAtomic(path.join(dir,'active.json'),JSON.stringify(value)),
  forgetTransfer:()=>{const value=read('active.json');if(!value)throw Error('NO_ACTIVE_ENROLLMENT');delete value.bundle;writeAtomic(path.join(dir,'active.json'),JSON.stringify(value));}
 };
}
async function confirmOwner(identity){
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('LOCAL_OWNER_CONFIRMATION_REQUIRED');
 const terminal=createInterface({input:process.stdin,output:process.stdout});
 try{return await terminal.question('Verified identity: '+JSON.stringify(identity)+'\nType CONFIRM to bind this registration and produce protected credentials: ')==='CONFIRM';}finally{terminal.close();}
}
export function loopback(port,openBrowser,url,timeout=600000) {
 return new Promise((resolve,reject)=>{
  const expected=new URL(url).searchParams.get('state');let used=false;
  const server=createServer((req,res)=>{
   res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/plain');
   if(used||req.method!=='GET'||req.headers.host!==`127.0.0.1:${port}`||!req.url?.startsWith('/auth/callback?')||req.url.length>20000){res.writeHead(400);res.end('Rejected.');return;}
   const callback=`http://127.0.0.1:${port}${req.url}`,u=new URL(callback);
   if(u.searchParams.getAll('state').length!==1||u.searchParams.get('state')!==expected){res.writeHead(400);res.end('Rejected.');return;}
   used=true;res.end('Return to the owner terminal.');clearTimeout(timer);server.close();server.closeAllConnections();resolve(callback);
  });
  const stop=e=>{clearTimeout(timer);server.close();server.closeAllConnections();reject(e);};
  const timer=setTimeout(()=>stop(Error('OAUTH_TIMEOUT')),timeout);
  server.on('error',stop);server.listen(port,'127.0.0.1',()=>Promise.resolve().then(()=>openBrowser(url)).catch(stop));
 });
}
function browser(url) {
 const command=process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open';
 const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];
 return new Promise((resolve,reject)=>{const child=spawn(command,args,{stdio:'ignore',windowsHide:true});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('BROWSER_UNAVAILABLE')));});
}
export async function liveBootstrap(config,receipt,dir){
 requirePublication(receipt,config.OSS_SOURCE_SHA256);
 if(config.PLAN_WORKSPACE_ID!==undefined)throw Error('REMOVE_UNSUPPORTED_WORKSPACE_PREREQUISITE');
 checkPlanContract({...config,PLAN_CLIENT_ID:config.PLAN_CLIENT_ID??'oaiapp_pending_registration',PLAN_OWNER_SUBJECT:config.PLAN_OWNER_SUBJECT??'OWNER_ENROLLMENT_NOT_YET_VERIFIED'});
 if(!Number.isSafeInteger(config.port)||config.port<1024||config.port>65535||!Number.isSafeInteger(config.epoch)||config.epoch<0||String(config.epoch)!==config.BROKER_SESSION_EPOCH)throw Error('OPERATOR_CONFIGURATION');
 const store=enrollmentStore(dir),hostFile=path.join(dir,'host.json'),lockFile=path.join(dir,'enrollment.lock');
 const key=process.env.TROGNET_TOKEN_ENCRYPTION_KEY;await hintKey(key);
 const host={schema:'trognet-host/v2',host_id:config.BROKER_HOST_ID};registration(host.host_id);
 if(fs.existsSync(hostFile)){const st=fs.lstatSync(hostFile);if(st.isSymbolicLink()||!st.isFile()||st.size>1024||JSON.stringify(JSON.parse(fs.readFileSync(hostFile,'utf8')))!==JSON.stringify(host))throw Error('HOST_IDENTITY_CHANGED');}
 else writeOnce(hostFile,JSON.stringify(host));
 // Crash leaves a lock for explicit operator reconciliation, never automatic replay.
 const lock=fs.openSync(lockFile,'wx',0o600);fs.closeSync(lock);
 try{
  const {active,pending}=store.load();
  if(active&&active.schema!=='trognet-owner-enrollment/v2')throw Error('ACTIVE_ENROLLMENT_INVALID');
  const identity=registration(host.host_id,active?.identity,pending);
  if((config.PLAN_CLIENT_ID&&config.PLAN_CLIENT_ID!==identity.client_id)||(config.PLAN_OWNER_SUBJECT&&config.PLAN_OWNER_SUBJECT!==identity.subject))throw Error('REGISTRATION_IDENTITY_CHANGED');
  if(active?.bundle)throw Error('PREVIOUS_TRANSFER_REQUIRES_RECONCILIATION');
  const hint=active?.protected_hint?await openLoginHint(active.protected_hint,key,identity):undefined;
  const result=await bootstrapSession({identity,port:config.port,idTokenHint:hint,callback:p=>loopback(config.port,browser,p.authorization_url),fetcher:fetch,savePending:store.savePending,confirmIdentity:confirmOwner,commitActive:store.commitActive,protectHint:(v,r)=>protectLoginHint(v,key,r),seal:async tokens=>({schema:'trognet-plan-import/v1',host_id:host.host_id,client_id:tokens.client_id,subject:tokens.subject,epoch:config.epoch,sealed:await sealToken(tokens,key,host.host_id)})});
  return {status:'CONFIRMED_SEALED_FOR_IMPORT',client_id:result.identity.client_id,subject:result.identity.subject,epoch:config.epoch,sha256:await sha256(JSON.stringify(result.bundle))};
 }finally{fs.unlinkSync(lockFile);}
}
async function main(){
 const [mode='--dry-run',configFile,receiptFile,privateDir]=process.argv.slice(2);
 if(mode==='--dry-run'){const {dryRun}=await import('./oss-fixtures.mjs');console.log(JSON.stringify(await dryRun()));return;}
 if(mode==='--forget-transfer'){if(!process.stdin.isTTY)throw Error('LOCAL_OWNER_CONFIRMATION_REQUIRED');const terminal=createInterface({input:process.stdin,output:process.stdout});try{if(await terminal.question('Type IMPORT_CONFIRMED only after matching broker receipt and aperture closure: ')!=='IMPORT_CONFIRMED')throw Error('OWNER_CONFIRMATION_REQUIRED');enrollmentStore(configFile).forgetTransfer();}finally{terminal.close();}return;}
 if(mode!=='--live'||!receiptFile)throw Error('OSS_PUBLICATION_REQUIRED');
 const receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8')),config=JSON.parse(fs.readFileSync(configFile,'utf8'));
 console.log(JSON.stringify(await liveBootstrap(config,receipt,privateDir)));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.error('BOOTSTRAP_STOPPED: pending registration retained; no automatic retry. Review the runbook.');process.exitCode=1;});
