import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {frontDoor,RequestCoordinator,digest,sequenceId,json} from '../e06/front-door.mjs';
import {FileProtectedStore} from '../self-hosted/protected-store.mjs';
import {archiveAndFence} from '../e06/archive-ledger.mjs';
import {GatewayService,createGatewayServer,listenLoopback} from '../self-hosted/gateway.mjs';
import {BrokerCore} from '../dist/credential-broker.js';
import {KEY,HOST,CLIENT,NOW} from '../scripts/oss-fixtures.mjs';
import {REQUIRED_SCOPES} from '../self-hosted/migrate.mjs';

const p=()=>({model:'fixture-model',instructions:'Answer briefly.',input:[{role:'user',content:'Fixture question'}],store:false,stream:true});
const rid=n=>'fixture-request-'+String(n).padStart(4,'0');
const envBase={ENABLED:'true',APP_ORIGIN:'https://app.example.com',ACCESS_ISSUER:'https://fixture.cloudflareaccess.com',ACCESS_AUDIENCE:'fixture-audience',OWNER_SUBJECT:'fixture-owner',ORIGIN_ADMISSION:'PLACEHOLDER_ORIGIN_ADMISSION_ONLY_12345'};
const b64=b=>Buffer.from(b).toString('base64url');
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'fixture-key',alg:'RS256'};
const env={...envBase,ACCESS_PUBLIC_KEYS:JSON.stringify([jwk])};
async function jwt(changes={},head={}) {
  const h=b64(JSON.stringify({alg:'RS256',kid:'fixture-key',...head})),c=b64(JSON.stringify({iss:env.ACCESS_ISSUER,aud:[env.ACCESS_AUDIENCE],sub:env.OWNER_SUBJECT,type:'app',exp:Math.floor(Date.now()/1000)+300,...changes}));
  return h+'.'+c+'.'+b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(h+'.'+c)));
}
const goodJWT=await jwt();
class Storage {
  constructor(map=new Map()){this.map=map;this.tail=Promise.resolve();}
  async get(k){return structuredClone(this.map.get(k));}
  async put(k,v){this.map.set(k,structuredClone(v));}
  transaction(fn){const task=this.tail.then(async()=>{const copy=new Storage(structuredClone(this.map));const result=await fn(copy);this.map=copy.map;return result;});this.tail=task.catch(()=>{});return task;}
}
function fixture(provider,options={}) {
  const storage=new Storage(),calls=[];
  const fetcher=async(u,i)=>{calls.push({u,i});return provider?provider(u,i):u.endsWith('/models')?json({models:[{slug:'fixture-model',display_name:'Fixture'}]}):json({schema:'trognet-gateway-response/v1',status:'completed',text:'OK',request_sha256:await digest(i.headers['X-TrogNet-Request-Id'])});};
  const bound={...env,PRIVATE_GATEWAY:{fetch:fetcher},REQUESTS:{idFromName:n=>n,get:()=>({fetch:r=>coordinator.fetch(r)})}};
  let coordinator=new RequestCoordinator({storage},bound,options);
  return {storage,calls,bound,restart(){coordinator=new RequestCoordinator({storage},bound,options);},coordinator:()=>coordinator};
}
function req({route='/e06/responses',method='POST',headers={},body={request_id:rid(1),payload:p()},signal}={}) {
  return new Request(env.APP_ORIGIN+route,{method,headers:{'Cf-Access-Jwt-Assertion':goodJWT,...(method==='POST'?{'Origin':env.APP_ORIGIN,'Content-Type':'application/json','X-TrogNet-CSRF':'1'}:{}),...headers},body:method==='POST'?typeof body==='string'?body:JSON.stringify(body):undefined,signal});
}
const run=async(f,options)=>frontDoor(req(options),f.bound);
test('E06 VPC models receives only fixed URL and reviewed headers with binding receiver',async()=>{
 const f=fixture();const original=f.bound.PRIVATE_GATEWAY.fetch;
 f.bound.PRIVATE_GATEWAY.fetch=function(u,i){assert.equal(this,f.bound.PRIVATE_GATEWAY);return original(u,i);};
 const r=await run(f,{method:'GET',route:'/e06/models',headers:{Cookie:'CF_Authorization=fixture',Host:'evil.example.com','X-Forwarded-Host':'evil.example.com','X-Arbitrary':'private'}});
 assert.equal(r.status,200);assert.equal(f.calls.length,1);const c=f.calls[0];
 assert.equal(c.u,'http://private-gateway.invalid/models');assert.equal(c.i.method,'GET');assert.equal(c.i.body,undefined);assert.equal(c.i.redirect,'error');
 assert.deepEqual(c.i.headers,{'Accept':'application/json','X-TrogNet-Admission':env.ORIGIN_ADMISSION});
});
test('E06 VPC absent malformed legacy and throwing bindings never use global or injected fetch',async()=>{
 const original=globalThis.fetch;let globalCalls=0,injectedCalls=0;
 globalThis.fetch=()=>{globalCalls++;throw Error('unexpected global fetch');};
 try {
  for(const value of [undefined,null,{}, {fetch:1}]) {
   const f=fixture(undefined,{fetcher:()=>{injectedCalls++;}});f.bound.PRIVATE_GATEWAY=value;
   for(const kind of ['models','response']) {
    assert.equal((await run(f,kind==='models'?{method:'GET',route:'/e06/models'}:{})).status,503);
    assert.equal((await f.coordinator().fetch(new Request('https://internal.invalid/action',{method:'POST',body:JSON.stringify({kind,request_id:rid(1),payload:p()})}))).status,503);
   }
   assert.equal(f.calls.length,0);assert.equal(f.storage.map.size,0);
  }
  for(const value of ['',undefined,'https://origin.example.com']) {
   const f=fixture();f.bound.ORIGIN_URL=value;assert.equal((await run(f)).status,503);
   await assert.rejects(f.coordinator().origin('/models'));assert.equal(f.calls.length,0);
  }
  const f=fixture(()=>{throw Error('broken binding');},{fetcher:()=>{injectedCalls++;}});
  assert.equal((await run(f,{method:'GET',route:'/e06/models'})).status,503);
  assert.equal((await (await run(f)).json()).status,'uncertain');f.restart();
  assert.equal((await (await run(f)).json()).status,'uncertain');assert.equal(f.calls.length,2);
  assert.equal(globalCalls,0);assert.equal(injectedCalls,0);
 } finally {globalThis.fetch=original;}
});
test('E06 VPC rejects target path query and absolute URL injection before dispatch',async()=>{
 const f=fixture();
 for(const route of ['/models?url=https://evil.example.com','//evil.example.com/models','https://evil.example.com/responses','/qualify','/models/','/responses/../qualify'])await assert.rejects(f.coordinator().origin(route));
 for(const route of ['/e06/models?host=evil.example.com','/e06/models/','/e06/%2fmodels','/e06/responses/../qualify'])assert.equal((await run(f,{method:'GET',route})).status,404);
 assert.equal((await frontDoor(new Request('https://evil.example.com/e06/models',{headers:{'Cf-Access-Jwt-Assertion':goodJWT}}),f.bound)).status,404);
 assert.equal(f.calls.length,0);
});
test('E06 VPC deployment example keeps owner placeholders closed and exact service binding',()=>{
 const c=JSON.parse(fs.readFileSync(new URL('../wrangler.e06.example.json',import.meta.url),'utf8'));
 assert.equal(c.name,'trognet-e06-owner-front-door');assert.equal(c.workers_dev,true);assert.equal(c.preview_urls,false);assert.equal(c.vars.ENABLED,'false');
 assert.equal(c.vars.APP_ORIGIN,'https://trognet-e06-owner-front-door.valateve.workers.dev');assert(!Object.hasOwn(c.vars,'ORIGIN_URL'));assert(!Object.hasOwn(c,'vpc_networks'));
 assert.deepEqual(c.vpc_services,[{binding:'PRIVATE_GATEWAY',service_id:'01a10c6d-8025-7163-a6b9-c87a58e11918'}]);assert.equal(c.vars.ACCESS_PUBLIC_KEYS,'[]');
});
for(const [name,options,status] of [
 ['unauthenticated',{headers:{'Cf-Access-Jwt-Assertion':''}},401],
 ['forged origin admission',{headers:{'X-TrogNet-Admission':'forged'}},403],
 ['forged owner admission',{headers:{'X-TrogNet-Owner-Admission':'forged'}},403],
 ['forged request identity header',{headers:{'X-TrogNet-Request-Id':rid(1)}},403],
 ['authorization header',{headers:{Authorization:'Bearer fixture'}},403],
 ['cross Origin',{headers:{Origin:'https://evil.example.com'}},403],
 ['missing Origin',{headers:{Origin:''}},403],
 ['cross site Cookie',{headers:{Cookie:'CF_Authorization=fixture','Sec-Fetch-Site':'cross-site'}},403],
 ['same site subdomain',{headers:{'Sec-Fetch-Site':'same-site'}},403],
 ['missing csrf',{headers:{'X-TrogNet-CSRF':''}},403],
 ['malformed JSON',{body:'{'},503],
 ['oversized body',{body:'x'.repeat(36865)},413],
 ['excessive bytes',{headers:{Cookie:'x'.repeat(8193)}},431],
 ['excessive header count',{headers:Object.fromEntries(Array.from({length:33},(_,i)=>['X-Test-'+i,'x']))},431],
 ['generic proxy',{route:'/e06/responses?url=https://evil.example.com'},404],
 ['token route',{route:'/token'},404],
 ['owner socket route',{route:'/qualify'},404],
 ['health not browser exposed',{route:'/health',method:'GET'},404],
 ['method override',{method:'PUT'},404],
 ['preflight',{method:'OPTIONS'},404],
 ['unexpected field',{body:{request_id:rid(1),payload:p(),url:'https://evil.example.com'}},400],
 ['tools',{body:{request_id:rid(1),payload:{...p(),tools:[]}}},400],
 ['oversized instructions',{body:{request_id:rid(1),payload:{...p(),instructions:'x'.repeat(16001)}}},400],
 ['bad encoding',{headers:{'Content-Encoding':'gzip'}},403],
])test('E06 browser rejects '+name,async()=>{const f=fixture();const r=await run(f,options);assert.equal(r.status,status);assert.equal(f.calls.length,0);assert(!r.headers.has('access-control-allow-origin'));});
for(const [name,claims,header] of [
 ['unauthorized owner',{sub:'different-owner'},{}],['service identity',{type:'service'},{}],['expired',{exp:1},{}],
 ['issuer',{iss:'https://evil.example.com'},{}],['audience',{aud:['other']},{}],['future nbf',{nbf:9999999999},{}],
 ['algorithm',{}, {alg:'none'}],['untrusted key URL',{}, {jku:'https://evil.example.com'}],
])test('E06 JWT rejects '+name,async()=>{const f=fixture();const r=await run(f,{headers:{'Cf-Access-Jwt-Assertion':await jwt(claims,header)}});assert([401,403].includes(r.status));assert.equal(f.calls.length,0);});
for(const name of ['OPENAI_API_KEY','CREDITS_FALLBACK','TOKEN_ENCRYPTION_KEY','OWNER_ADMISSION','ACCESS_TOKEN','REFRESH_TOKEN'])test('E06 forbids configuration '+name,async()=>{const f=fixture();f.bound[name]='';assert.equal((await run(f)).status,503);assert.equal(f.calls.length,0);});
test('E06 browser Cookie and JWT stripped; only reviewed origin headers and route',async()=>{
 const f=fixture();const r=await run(f,{headers:{Cookie:'CF_Authorization=fixture','X-Forwarded-Host':'evil.example.com'}});assert.equal(r.status,200);
 const c=f.calls[0];assert.equal(c.u,'http://private-gateway.invalid/responses');assert.deepEqual(c.i.headers,{'Accept':'application/json','Content-Type':'application/json','X-TrogNet-Admission':env.ORIGIN_ADMISSION,'X-TrogNet-Request-Id':sequenceId(1)});assert.equal(c.i.redirect,'error');assert.equal(c.i.method,'POST');assert.deepEqual(JSON.parse(c.i.body),p());
 const output=await r.text();assert(!output.includes(env.ORIGIN_ADMISSION));assert(!output.includes(goodJWT));assert.equal(JSON.parse(output).inference,'confirmed');
});
test('E06 duplicate request and intent across Worker restart never dispatch',async()=>{
 const f=fixture();assert.equal((await run(f)).status,200);f.restart();assert.equal((await run(f)).status,200);assert.equal(f.calls.length,1);
 assert.equal((await run(f,{body:{request_id:rid(2),payload:p()}})).status,409);assert.equal(f.calls.length,1);
 assert.equal((await run(f,{body:{request_id:rid(1),payload:{...p(),instructions:'Changed'}}})).status,409);
 const r=await run(f,{method:'GET',route:'/e06/requests/'+rid(1)});assert.equal((await r.json()).status,'completed');assert.equal(f.calls.length,1);
});
test('E06 explicit new attempt binds consent to latest identical intent',async()=>{
 const f=fixture();await run(f);
 for(const b of [{new_attempt_of:rid(1)},{consent:'I_AUTHORIZE_ONE_NEW_ATTEMPT'},{new_attempt_of:rid(3),consent:'I_AUTHORIZE_ONE_NEW_ATTEMPT'}])assert.equal((await run(f,{body:{request_id:rid(2),payload:p(),...b}})).status,409);
 assert.equal(f.calls.length,1);
 assert.equal((await run(f,{body:{request_id:rid(2),payload:p(),new_attempt_of:rid(1),consent:'I_AUTHORIZE_ONE_NEW_ATTEMPT'}})).status,200);
 assert.equal(f.calls.length,2);assert.equal(f.calls[1].i.headers['X-TrogNet-Request-Id'],sequenceId(2));
 assert.equal((await run(f,{body:{request_id:rid(3),payload:p(),new_attempt_of:rid(1),consent:'I_AUTHORIZE_ONE_NEW_ATTEMPT'}})).status,409);
});
for(const mode of ['tunnel_before_reservation','tunnel_after_reservation','provider_transport','provider_http','timeout','wrong_content_type','raw_provider_body','oversized_upstream','admission_secret_echo','bearer_echo','redirect'])test('E06 uncertainty no replay '+mode,async()=>{
 const f=fixture(async()=>{
  if(['tunnel_before_reservation','tunnel_after_reservation','provider_transport'].includes(mode))throw Error('PLACEHOLDER_PRIVATE_ERROR');
  if(mode==='timeout')return new Promise(()=>{});
  if(mode==='provider_http')return json({error:'PROVIDER_UNCERTAIN',provider:{http_status:429}},502);
  if(mode==='wrong_content_type')return new Response('<html>private</html>',{headers:{'Content-Type':'text/html'}});
  if(mode==='redirect')return new Response(null,{status:302,headers:{Location:'https://evil.example.com'}});
  if(mode==='oversized_upstream')return json({text:'x'.repeat(262145)});
  return json({schema:'trognet-gateway-response/v1',status:'completed',text:mode==='admission_secret_echo'?env.ORIGIN_ADMISSION:mode==='bearer_echo'?'Bearer PRIVATE_VALUE':'raw',request_sha256:'wrong',usage:{private:true}});
 },{timeoutMs:15});
 const r=await run(f);assert.equal(r.status,409);const b=await r.json();assert.equal(b.status,'uncertain');assert.equal(b.inference,'unknown');assert(!JSON.stringify(b).includes('PRIVATE'));
 f.restart();await run(f);assert.equal(f.calls.length,1);
});
for(const label of ['ADMISSION_DENIED','GATEWAY_BUSY','MODEL_NOT_VISIBLE'])test('E06 confirmed pre-dispatch '+label+' still consumes identity',async()=>{
 const f=fixture(async()=>json({error:label},403));const r=await run(f);assert.equal((await r.json()).status,'not_dispatched');await run(f);assert.equal(f.calls.length,1);
});
test('E06 caller disconnect before admission performs no work',async()=>{const f=fixture(),c=new AbortController();c.abort();assert.equal((await run(f,{signal:c.signal})).status,409);assert.equal(f.calls.length,0);});
test('E06 disconnect after dispatch cannot trigger a second attempt',async()=>{
 const c=new AbortController(),f=fixture(async()=>{c.abort();throw Error('disconnect');});const r=await run(f,{signal:c.signal});assert.equal((await r.json()).status,'uncertain');await run(f);assert.equal(f.calls.length,1);
});
test('E06 transaction crash before admission leaves no dispatch; after marker persists uncertainty',async()=>{
 const f=fixture();f.storage.transaction=async()=>{throw Error('crash');};assert.equal((await run(f)).status,503);assert.equal(f.calls.length,0);
 const g=fixture();g.coordinator().origin=async()=>{throw Error('crash after marker');};await run(g);g.restart();await run(g);assert.equal(g.calls.length,0);
});
test('E06 result persistence failure remains uncertain after restart',async()=>{
 const f=fixture();f.storage.put=async()=>{throw Error('disk');};assert.equal((await run(f)).status,503);f.restart();const r=await run(f);assert.equal((await r.json()).status,'uncertain');assert.equal(f.calls.length,1);
});
test('E06 ledger exhaustion never deletes intent or attempt history',async()=>{const f=fixture();await f.storage.put('meta',{sequence:2048,count:2048});assert.equal((await run(f)).status,409);assert.equal(f.calls.length,0);});
test('E06 overlapping requests allow at most one origin operation',async()=>{
 let release;const gate=new Promise(r=>release=r),f=fixture(async()=>{await gate;throw Error('uncertain');});const first=run(f);while(f.calls.length===0)await new Promise(r=>setTimeout(r,1));
 assert.equal((await run(f,{body:{request_id:rid(2),payload:p()}})).status,503);release();await first;assert.equal(f.calls.length,1);
});
const linux=(name,fn)=>test('E06 Linux '+name,{skip:process.platform!=='linux'},fn);
async function disk(t,options={}) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'trognet-e06-'));fs.chmodSync(root,0o700);const dir=path.join(root,'state');fs.mkdirSync(dir,{mode:0o700});
 const stores=[];const open=async opts=>{const s=await FileProtectedStore.open(dir,opts);stores.push(s);return s;};const store=await open(options);
 t.after(async()=>{for(const s of stores)await s.close();fs.rmSync(root,{force:true,recursive:true});});return {root,dir,store,open};
}
const enable=async s=>s.enableRequestFence(await digest(JSON.stringify(await s.requestArchive())));
linux('archival persists export before fence; replay and legacy IDs remain closed',async t=>{
 const f=await disk(t);for(let i=0;i<512;i++)await f.store.reserveRequest(await digest(rid(i)),NOW);
 await assert.rejects(f.store.reserveRequest(await digest('new'),NOW),/REQUEST_LEDGER_FULL/);await f.store.close();
 const archiveFile=path.join(f.root,'archive.json');const r=await archiveAndFence({stateDir:f.dir,archiveFile});assert.equal(r.legacy_count,512);assert.equal(r.high_water,0);
 assert.equal((await archiveAndFence({stateDir:f.dir,archiveFile})).status,'ALREADY_ENABLED');const s=await f.open();await assert.rejects(s.reserveGatewayRequest(rid(0),NOW));
 for(let i=1;i<=520;i++)await s.reserveGatewayRequest(sequenceId(i),NOW);
 await s.close();const next=await f.open();for(const n of [1,256,512,520])await assert.rejects(next.reserveGatewayRequest(sequenceId(n),NOW),/REQUEST_ALREADY_SEEN/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'state.json'))).requests.length,0);assert.equal(JSON.parse(fs.readFileSync(archiveFile)).requests.length,512);
});
linux('sequenced requests refused until explicit fence activation',async t=>{const f=await disk(t);await assert.rejects(f.store.reserveGatewayRequest(sequenceId(1),NOW),/REQUEST_FENCE_REQUIRED/);});
for(const stage of ['before_file_sync','after_file_sync','after_rename','after_directory_sync'])linux('fence crash '+stage,async t=>{
 let armed=false;const f=await disk(t,{fault:s=>{if(armed&&s===stage)throw Error('crash');}});await f.store.reserveRequest(await digest(rid(1)),NOW);armed=true;await assert.rejects(enable(f.store));await f.store.close();
 const s=await f.open();if(['after_rename','after_directory_sync'].includes(stage)){await assert.rejects(s.reserveGatewayRequest(rid(1),NOW));await s.reserveGatewayRequest(sequenceId(1),NOW);}
 else{await assert.rejects(s.reserveGatewayRequest(rid(1),NOW));await assert.rejects(s.reserveGatewayRequest(sequenceId(1),NOW));}
});
for(const stage of ['before_file_sync','after_file_sync','after_rename','after_directory_sync'])linux('reservation crash '+stage,async t=>{
 let armed=false;const f=await disk(t,{fault:s=>{if(armed&&s===stage)throw Error('crash');}});await enable(f.store);armed=true;await assert.rejects(f.store.reserveGatewayRequest(sequenceId(1),NOW));await f.store.close();
 const s=await f.open();if(['after_rename','after_directory_sync'].includes(stage))await assert.rejects(s.reserveGatewayRequest(sequenceId(1),NOW));else await s.reserveGatewayRequest(sequenceId(1),NOW);
});
linux('real process death after durable reservation prevents replay',async t=>{
 const f=await disk(t);await enable(f.store);await f.store.close();
 const source=new URL('../self-hosted/protected-store.mjs',import.meta.url).href;
 const code=`import {FileProtectedStore} from ${JSON.stringify(source)};const s=await FileProtectedStore.open(${JSON.stringify(f.dir)},{fault:step=>{if(step==='after_directory_sync')process.exit(88)}});await s.reserveGatewayRequest(${JSON.stringify(sequenceId(1))},${NOW});`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:'ignore'});assert.equal(await new Promise(r=>child.on('exit',r)),88);const s=await f.open();await assert.rejects(s.reserveGatewayRequest(sequenceId(1),NOW));
});
linux('archive mismatch refuses transition without changing old ledger',async t=>{const f=await disk(t);await f.store.reserveRequest(await digest(rid(1)),NOW);await assert.rejects(f.store.enableRequestFence('0'.repeat(64)));await assert.rejects(f.store.reserveGatewayRequest(rid(1),NOW));});
linux('out-of-order sequence remains rejected including unissued gaps',async t=>{const f=await disk(t);await enable(f.store);await f.store.reserveGatewayRequest(sequenceId(10),NOW);for(const n of [0,1,9,10])await assert.rejects(f.store.reserveGatewayRequest(sequenceId(n),NOW));});
const tokens=()=>({client_id:CLIENT,subject:'fixture-subject',issuer:'https://auth.openai.com',ext_agent_host_id:HOST,access_token:'PLACEHOLDER_ACCESS_A',refresh_token:'PLACEHOLDER_REFRESH_A',scopes:REQUIRED_SCOPES,expires_at_ms:NOW+3600000,refresh_expires_at_ms:NOW+86400000});
const catalog=()=>json({models:[{slug:'fixture-model',display_name:'Fixture',visibility:'list'}]});
const events=()=>new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'OK'})+'\n\ndata: '+JSON.stringify({type:'response.completed',response:{status:'completed'}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});
linux('front door through real loopback gateway and provider fixture completes exactly once',async t=>{
 const f=await disk(t);await new BrokerCore(f.store,KEY,HOST).initialize(tokens());await enable(f.store);let inference=0;
 const service=new GatewayService({store:f.store,key:KEY,host:HOST,now:()=>NOW,fetcher:async u=>{if(u.endsWith('/models'))return catalog();inference++;return events();}});
 const server=createGatewayServer({service,secret:env.ORIGIN_ADMISSION});await listenLoopback(server,{port:0});t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const transport=async(_u,i)=>new Promise((resolve,reject)=>{const q=http.request({host:'127.0.0.1',port:server.address().port,path:'/responses',method:i.method,headers:i.headers},r=>{const chunks=[];r.on('data',b=>chunks.push(b));r.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:r.statusCode,headers:r.headers})));});q.on('error',reject);q.end(i.body);});
 const front=fixture(transport);const response=await run(front);assert.equal(response.status,200);assert.equal((await response.json()).gateway_completion,true);await run(front);assert.equal(inference,1);
});
for(const phase of ['before_dispatch','after_dispatch','http_rejection'])linux('gateway failure and restart '+phase,async t=>{
 const f=await disk(t);await new BrokerCore(f.store,KEY,HOST).initialize(tokens());await enable(f.store);let inference=0;
 const service=new GatewayService({store:f.store,key:KEY,host:HOST,now:()=>NOW,timeoutMs:10,fetcher:async u=>{if(u.endsWith('/models'))return phase==='before_dispatch'?new Promise(()=>{}):catalog();inference++;return phase==='http_rejection'?json({error:'rejected'},429):new Promise(()=>{});}});
 await assert.rejects(service.responses(p(),sequenceId(1)));assert.equal(inference,phase==='before_dispatch'?0:1);await f.store.close();const s=await f.open();const next=new GatewayService({store:s,key:KEY,host:HOST,fetcher:()=>{throw Error('must not dispatch');}});await assert.rejects(next.responses(p(),sequenceId(1)),/REQUEST_ALREADY_SEEN/);
});
linux('legacy ID colliding with future sequence remains rejected after archival',async t=>{const f=await disk(t);await f.store.reserveRequest(await digest(sequenceId(500)),NOW);await enable(f.store);await assert.rejects(f.store.reserveGatewayRequest(sequenceId(500),NOW));await f.store.reserveGatewayRequest(sequenceId(1),NOW);});
linux('late catalog after deadline cannot begin inference',async t=>{
 const f=await disk(t);await new BrokerCore(f.store,KEY,HOST).initialize(tokens());await enable(f.store);let release,inference=0;const gate=new Promise(r=>release=r);
 const service=new GatewayService({store:f.store,key:KEY,host:HOST,now:()=>NOW,timeoutMs:5,fetcher:async u=>{if(u.endsWith('/models')){await gate;return catalog();}inference++;return events();}});
 await assert.rejects(service.responses(p(),sequenceId(1)));release();await new Promise(r=>setTimeout(r,15));assert.equal(inference,0);
});
import {qualifyOnce,reconcileQualification} from '../e06/owner/qualification.mjs';
const attestation={source_verified:true,only_plan_gateway:true,no_api_key_or_credits_fallback:true,gate_5i:'PASS',manifest_sha256:'a'.repeat(64)};
function qualifierFixture(fetcher) {
 const data=new Map();let tail=Promise.resolve();return {model:'fixture-model',models:[{slug:'fixture-model'}],authorize:'I_AUTHORIZE_EXACTLY_ONE_INFERENCE',attestation,
 storage:{getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,v)},locks:{request(_k,_o,fn){const p=tail.then(fn);tail=p.catch(()=>{});return p;}},fetcher};
}
test('E06 qualification one deliberate identity and sanitized receipt; repeat and simultaneous calls stop',async()=>{
 let calls=0;const q=qualifierFixture(async(_u,i)=>{calls++;const b=JSON.parse(i.body);return json({schema:'trognet-e06-attempt/v1',request_id:b.request_id,model:b.payload.model,gateway_request_sha256:'b'.repeat(64),status:'completed',inference:'confirmed',gateway_completion:true,text:'OK'});});
 const result=await Promise.allSettled([qualifyOnce(q),qualifyOnce(q)]);assert.equal(calls,1);assert.equal(result[0].value.status,'PASS_PENDING_OWNER_PATH_CORRELATION');assert.equal(result[1].status,'rejected');assert(!('text' in result[0].value));
});
test('E06 qualification ambiguity does not retry and reconciliation is GET only',async()=>{
 let calls=0;const q=qualifierFixture(async()=>{calls++;throw Error('PRIVATE');});const r=await qualifyOnce(q);assert.equal(r.status,'STOP_UNCERTAIN');assert.equal(r.inference,'unknown');await assert.rejects(qualifyOnce(q));assert.equal(calls,1);
 q.fetcher=async(u,i)=>{assert(u.startsWith('/e06/requests/'));assert(!i.method||i.method==='GET');return json({status:'uncertain',inference:'unknown'});};assert.equal((await reconcileQualification(q)).status,'STOP_UNCERTAIN');
});
test('E06 qualification requires visible selected model, owner consent and reviewed plan-only attestation',async()=>{
 for(const change of [{model:'hidden'},{authorize:''},{attestation:{...attestation,no_api_key_or_credits_fallback:false}},{attestation:{...attestation,gate_5i:'PENDING'}},{locks:null}]){
  const q=qualifierFixture(async()=>{throw Error('must not call');});await assert.rejects(qualifyOnce({...q,...change}),/STOP_PREREQUISITES/);
 }
});
test('E06 qualification local persistence failure causes no request',async()=>{let calls=0;const q=qualifierFixture(async()=>{calls++;});q.storage.setItem=()=>{throw Error('storage');};await assert.rejects(qualifyOnce(q));assert.equal(calls,0);});
test('E06 errors and logs never include private provider exception',async()=>{
 const saved=console.log,logs=[];console.log=(...a)=>logs.push(a);
 try{const f=fixture(async()=>{throw Error('PLACEHOLDER_PRIVATE_EXCEPTION');});const r=await run(f);assert(!JSON.stringify(await r.json()).includes('PRIVATE'));assert.deepEqual(logs,[]);}finally{console.log=saved;}
});
test('E06 qualification page requires owner authentication and performs no origin operation',async()=>{const f=fixture();const r=await run(f,{method:'GET',route:'/e06/qualification'});assert.equal(r.status,200);assert(r.headers.get('content-security-policy').includes("frame-ancestors 'none'"));const html=await r.text();assert(html.includes('Authorize exactly one inference'));assert(!html.includes(env.ORIGIN_ADMISSION));assert.equal(f.calls.length,0);assert.equal((await run(f,{method:'GET',route:'/e06/qualification',headers:{'Cf-Access-Jwt-Assertion':''}})).status,401);});
import {boundedJSON} from '../e06/front-door.mjs';
import {qualificationPage} from '../e06/owner/qualification.mjs';
test('E06 generated browser module parses without executing owner actions',()=>{const html=qualificationPage('fixture-nonce');const code=html.match(/<script[^>]*>([\s\S]*)<\/script>/)[1];assert.doesNotThrow(()=>new Function(code));});
test('E06 bounded stream cancellation releases stalled body on deadline signal',async()=>{let cancelled=false;const c=new AbortController();const r=new Response(new ReadableStream({cancel(){cancelled=true;}}));const pending=boundedJSON(r,32,c.signal);c.abort();await assert.rejects(pending);assert(cancelled);});
test('E06 malformed UTF-8 refuses parsing',async()=>{await assert.rejects(boundedJSON(new Response(new Uint8Array([0xff])),32));});
test('E06 canonical intent ignores object property order',async()=>{const f=fixture();await run(f);const original=p(),reordered={stream:true,store:false,input:original.input,instructions:original.instructions,model:original.model};assert.equal((await run(f,{body:{request_id:rid(2),payload:reordered}})).status,409);assert.equal(f.calls.length,1);});
test('E06 commit acknowledgment loss returns saved completion without redispatch',async()=>{const f=fixture();const put=f.storage.put.bind(f.storage);f.storage.put=async(k,v)=>{await put(k,v);throw Error('ack lost');};assert.equal((await run(f)).status,503);f.restart();assert.equal((await run(f)).status,200);assert.equal(f.calls.length,1);});
test('E06 signature forgery is rejected',async()=>{const f=fixture();const pieces=goodJWT.split('.');pieces[2]=b64(new Uint8Array(256));assert.equal((await run(f,{headers:{'Cf-Access-Jwt-Assertion':pieces.join('.')}})).status,401);assert.equal(f.calls.length,0);});
import {fenceStatus} from '../e06/owner/fence-status.mjs';
linux('owner fence receipt correlates reservation without claiming inference or exposing session',async t=>{const f=await disk(t);await new BrokerCore(f.store,KEY,HOST).initialize(tokens());await enable(f.store);assert.equal(fenceStatus(f.dir).high_water,0);await f.store.reserveGatewayRequest(sequenceId(1),NOW);const r=fenceStatus(f.dir);assert.equal(r.last_gateway_request_sha256,await digest(sequenceId(1)));assert.equal(r.inference,'not_established_by_reservation');assert(!JSON.stringify(r).includes('sealed'));assert(!JSON.stringify(r).includes('PLACEHOLDER'));});
