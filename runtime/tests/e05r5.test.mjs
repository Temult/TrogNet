import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {FileProtectedStore,readProtected} from '../self-hosted/protected-store.mjs';
import {GatewayService,createGatewayServer,listenLoopback,validateRequest,secretMatches} from '../self-hosted/gateway.mjs';
import {migrate,REQUIRED_SCOPES} from '../self-hosted/migrate.mjs';
import {qualify} from '../self-hosted/qualify.mjs';
import {BrokerCore,sealToken,openToken} from '../dist/credential-broker.js';
import {normalizeRefreshSchedule} from '../dist/refresh-schedule.js';
import {KEY,HOST,CLIENT,NOW} from '../scripts/oss-fixtures.mjs';

const linux=process.platform==='linux';
const secret='PLACEHOLDER_ORIGIN_ADMISSION_ONLY_12345';
const ownerSecret='PLACEHOLDER_OWNER_ADMISSION_ONLY_12345';
const tokens=(extra={})=>({client_id:CLIENT,subject:'fixture-subject',issuer:'https://auth.openai.com',ext_agent_host_id:HOST,
  access_token:'PLACEHOLDER_ACCESS_A',refresh_token:'PLACEHOLDER_REFRESH_A',scopes:REQUIRED_SCOPES,
  expires_at_ms:NOW+3600000,refresh_expires_at_ms:NOW+30*86400000,...extra});
const grant=()=>({token_type:'Bearer',access_token:'PLACEHOLDER_ACCESS_B',refresh_token:'PLACEHOLDER_REFRESH_B',expires_in:3600,earliest_refresh_at:(NOW+3240000)/1000});
const payload=()=>({model:'fixture-model',instructions:'Answer from evidence.',input:[{role:'user',content:'Fixture question'}],store:false,stream:true});
const catalog=()=>Response.json({models:[{slug:'fixture-model',display_name:'Fixture model',visibility:'list',private:'PLACEHOLDER_PRIVATE_PROVIDER_FIELD'},
  {slug:'hidden-model',display_name:'Hidden',visibility:'hidden'}],private:'PLACEHOLDER_PRIVATE_PROVIDER_FIELD'});
const events=(values)=>new Response(new TextEncoder().encode(values.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')));
const completed=(value='Fixture answer')=>events([{type:'response.output_text.delta',delta:value},{type:'response.completed',response:{status:'completed',usage:{private:'PLACEHOLDER_PRIVATE_PROVIDER_FIELD'}}}]);
async function fixture(t,opts={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'trognet-e05r5-'));fs.chmodSync(root,0o700);
  const dir=path.join(root,'state');fs.mkdirSync(dir,{mode:0o700});
  const handles=[];t.after(async()=>{for(const s of handles)await s.close();fs.rmSync(root,{recursive:true,force:true});});
  const open=async(options)=>{const s=await FileProtectedStore.open(dir,options);handles.push(s);return s;};
  const store=await open(opts);
  return {root,dir,store,open};
}
const localTest=(name,fn)=>test('E05R5 '+name,{skip:!linux},fn);
const safeReject=async p=>assert.rejects(p,e=>{assert(!String(e.stack).includes('PLACEHOLDER'));return true;});

test('E05R5 binds third live normalized schedule',()=>assert.equal(normalizeRefreshSchedule({earliest_refresh_at:1791171737},1791172095935),1791171737000));
test('E05R5 bind refuses wildcard/public/IPv6/hostname without listening',async()=>{
  const server=http.createServer();for(const host of ['0.0.0.0','::','::1','localhost','192.0.2.1'])await assert.rejects(listenLoopback(server,{host,port:0}),/LOOPBACK_REQUIRED/);
  assert(!server.listening);
});
test('E05R5 shared secret constant-size hash validation',()=>{assert(secretMatches(secret,secret));for(const bad of [undefined,'',secret+'x','x'.repeat(257)])assert(!secretMatches(secret,bad));});
for(const field of ['tools','background','metadata','user','previous_response_id','service_tier','temperature','url','headers','max_output_tokens','__proto__'])
  test('E05R5 request rejects extra '+field,()=>assert.throws(()=>validateRequest(JSON.parse(JSON.stringify(payload()).slice(0,-1)+',"'+field+'":true}')),/REQUEST_REJECTED/));
for(const change of [{store:true},{stream:false},{input:'text'},{input:[{role:'system',content:'x'}]},{input:[{role:'user',content:[{type:'input_text',text:'x'}]}]},{input:[{role:'user',content:'x',type:'message'}]},{model:'https://invalid.invalid'},{instructions:'x'.repeat(16001)},{input:Array(14).fill({role:'user',content:'x'})}])
  test('E05R5 rejects expanded request '+JSON.stringify(change).slice(0,60),()=>assert.throws(()=>validateRequest({...payload(),...change})));

localTest('state durable mode, encryption, serialization and fsync sequence',async t=>{
  const sequence=[],f=await fixture(t,{fault:step=>sequence.push(step)}),core=new BrokerCore(f.store,KEY,HOST);
  await core.initialize(tokens());
  assert.deepEqual(sequence,['before_file_sync','after_file_sync','after_rename','after_directory_sync']);
  assert.equal(fs.statSync(f.dir).mode&0o777,0o700);assert.equal(fs.statSync(path.join(f.dir,'state.json')).mode&0o777,0o600);
  const raw=readProtected(path.join(f.dir,'state.json'));assert(!raw.includes('PLACEHOLDER'));assert.equal(JSON.parse(raw).schema,'trognet-file-broker/v1');
  await Promise.all(Array.from({length:8},()=>core.getToken()));
  await assert.rejects(f.store.get('../session'));await assert.rejects(f.store.put('other',{}));
});
localTest('one writer across processes and kernel lock release',async t=>{
  const f=await fixture(t);await assert.rejects(FileProtectedStore.open(f.dir));
  const module=new URL('../self-hosted/protected-store.mjs',import.meta.url).href;
  const child=spawn(process.execPath,['--input-type=module','-e',`import {FileProtectedStore} from ${JSON.stringify(module)};try{const s=await FileProtectedStore.open(${JSON.stringify(f.dir)});await s.close();process.exit(3)}catch{process.exit(0)}`],{stdio:'ignore'});
  assert.equal(await new Promise(r=>child.on('exit',r)),0);
  await f.store.close();const reopened=await f.open();assert.equal(await reopened.get('session'),undefined);
});
for(const stage of ['before_file_sync','after_file_sync','after_rename','after_directory_sync']) localTest('atomic recovery '+stage,async t=>{
  let armed=false;const f=await fixture(t,{fault:s=>{if(armed&&s===stage)throw Error('PLACEHOLDER_PRIVATE_FAILURE');}});
  const core=new BrokerCore(f.store,KEY,HOST);await core.initialize(tokens());const before=await f.store.get('session');armed=true;
  await safeReject(f.store.put('session',{...before,generation:1}));await f.store.close();
  const next=await f.open();assert.equal((await next.get('session')).generation,['after_rename','after_directory_sync'].includes(stage)?1:0);
});
for(const mode of ['directory_permissions','file_permissions','symlink','dangling_symlink','ancestor_symlink','hardlink','oversized','malformed','schema','record','unknown_file','fifo']) localTest('protected state rejects '+mode,async t=>{
  const f=await fixture(t);await new BrokerCore(f.store,KEY,HOST).initialize(tokens());await f.store.close();
  const file=path.join(f.dir,'state.json');
  if(mode==='directory_permissions')fs.chmodSync(f.dir,0o755);
  if(mode==='file_permissions')fs.chmodSync(file,0o644);
  if(mode==='symlink'||mode==='dangling_symlink'){fs.unlinkSync(file);fs.symlinkSync(path.join(f.root,'outside'),file);if(mode==='symlink')fs.writeFileSync(path.join(f.root,'outside'),'{}',{mode:0o600});}
  if(mode==='ancestor_symlink'){const alias=path.join(f.root,'alias');fs.symlinkSync(f.dir,alias);await assert.rejects(FileProtectedStore.open(alias));return;}
  if(mode==='hardlink')fs.linkSync(file,path.join(f.root,'alias'));
  if(mode==='oversized')fs.writeFileSync(file,'x'.repeat(262145));
  if(mode==='malformed')fs.writeFileSync(file,'{');
  if(mode==='schema')fs.writeFileSync(file,JSON.stringify({schema:'wrong',requests:[]}));
  if(mode==='record')fs.writeFileSync(file,JSON.stringify({schema:'trognet-file-broker/v1',session:{phase:'ready',generation:-1},requests:[]}));
  if(mode==='unknown_file')fs.writeFileSync(path.join(f.dir,'unexpected'),'x',{mode:0o600});
  if(mode==='fifo'){fs.unlinkSync(file);const c=spawn('/usr/bin/mkfifo',[file],{stdio:'ignore'});await new Promise(r=>c.on('exit',r));}
  await safeReject(FileProtectedStore.open(f.dir));
});

async function legacyFixture(t,extra={}) {
  const f=await fixture(t);await f.store.close();
  const protectedDir=path.join(f.root,'source');fs.mkdirSync(protectedDir,{mode:0o700});
  const source=tokens({expires_at_ms:1791172095935,earliest_refresh_at_ms:1791171737000,refresh_expires_at_ms:1791172095935+29*86400000,...extra});
  const legacy={schema:'trognet-self-hosted-vm-session/v1',host_id:HOST,client_id:CLIENT,subject:source.subject,imported_at:'2026-10-05T00:00:00Z',sealed:await sealToken(source,KEY,HOST)};
  const args={sessionPath:path.join(protectedDir,'session.json'),hostPath:path.join(protectedDir,'host-id'),keyPath:path.join(protectedDir,'credential-key'),stateDir:f.dir,
    expectedAccess:1791172095935,expectedEarliest:1791171737000,now:1791170000000};
  for(const [file,value] of [[args.sessionPath,JSON.stringify(legacy)],[args.hostPath,HOST],[args.keyPath,KEY]])fs.writeFileSync(file,value,{mode:0o600});
  return {...f,args,source,legacy};
}
localTest('current generation migration preserves normalized tokens and source; verifies idempotently',async t=>{
  const f=await legacyFixture(t),bytes=fs.readFileSync(f.args.sessionPath);
  const first=await migrate(f.args);assert.equal(first.status,'MIGRATED');assert.equal(first.access_expires_at_ms,1791172095935);assert.equal(first.earliest_refresh_at_ms,1791171737000);
  assert(!JSON.stringify(first).includes('PLACEHOLDER'));assert.deepEqual(fs.readFileSync(f.args.sessionPath),bytes);
  assert.equal((await migrate(f.args)).status,'ALREADY_MIGRATED');assert.equal((await migrate({...f.args,verify:true})).status,'VERIFIED');
  const s=await f.open();assert.deepEqual(await openToken((await s.get('session')).sealed,KEY,HOST),f.source);
});
for(const kind of ['host','outer_client','old_generation','old_expected','unqualified','schedule_units','scopes','expired_refresh','changed_source','rotated_destination','verify_empty']) localTest('migration fails closed '+kind,async t=>{
  const extra=kind==='unqualified'?{unqualified_refresh_schedule:1791171737}:kind==='schedule_units'?{earliest_refresh_at_ms:1791171737}:kind==='scopes'?{scopes:['chatgpt.tokens.use.direct']}:kind==='expired_refresh'?{refresh_expires_at_ms:1}:kind==='old_generation'?{expires_at_ms:1791168685760,earliest_refresh_at_ms:1791168326000}:{};
  const f=await legacyFixture(t,extra);
  if(kind==='host')fs.writeFileSync(f.args.hostPath,HOST.replace(/1$/,'2'));
  if(kind==='outer_client')fs.writeFileSync(f.args.sessionPath,JSON.stringify({...f.legacy,client_id:'different'}));
  if(kind==='old_expected')f.args.expectedAccess=1791168685760;
  if(kind==='verify_empty')f.args.verify=true;
  if(kind==='changed_source'){await migrate(f.args);fs.appendFileSync(f.args.sessionPath,'\n');}
  if(kind==='rotated_destination'){await migrate(f.args);const s=await f.open();const r=await s.get('session');await s.put('session',{...r,generation:1});await s.close();}
  await safeReject(migrate(f.args));
});

for(const phase of ['ready','replacement_staged','refreshing','configuration_error','reauth_required','disabled']) localTest('restart from '+phase,async t=>{
  const f=await fixture(t);await new BrokerCore(f.store,KEY,HOST).initialize(tokens());
  const r=await f.store.get('session');r.phase=phase;if(phase==='reauth_required')delete r.sealed;await f.store.put('session',r);await f.store.close();
  const s=await f.open();let calls=0;const core=new BrokerCore(s,KEY,HOST,async()=>{calls++;throw Error('no');});
  if(['ready','replacement_staged'].includes(phase)){assert.equal(await core.getToken(),tokens().access_token);assert.equal((await s.get('session')).phase,'ready');}
  else await safeReject(core.getToken());assert.equal(calls,0);
});
localTest('backoff persists across restart and no refresh storm',async t=>{
  const f=await fixture(t);let calls=0,now=NOW;const fetcher=async()=>{calls++;throw new TypeError('fixture',{cause:{code:'ECONNREFUSED'}});};
  const core=new BrokerCore(f.store,KEY,HOST,fetcher,()=>now);await core.initialize(tokens({expires_at_ms:NOW+1000}));await safeReject(core.getToken());await f.store.close();
  const s=await f.open(),next=new BrokerCore(s,KEY,HOST,fetcher,()=>now);await Promise.all(Array.from({length:10},()=>safeReject(next.getToken())));assert.equal(calls,1);
  now+=30000;await safeReject(next.getToken());assert.equal(calls,2);
});

async function serviceFixture(t,{provider,extra={},timeoutMs=1000}={}) {
  const f=await fixture(t);await new BrokerCore(f.store,KEY,HOST).initialize(tokens(extra));
  const calls=[];const fetcher=async(u,i)=>{calls.push({url:u,init:i});if(provider)return provider(u,i);return u.endsWith('/models')?catalog():completed();};
  return {...f,calls,service:new GatewayService({store:f.store,key:KEY,host:HOST,fetcher,now:()=>NOW,timeoutMs})};
}
localTest('model catalog strips private fields and keeps server ordering',async t=>{
  const f=await serviceFixture(t);assert.deepEqual(await f.service.models(),{models:[{slug:'fixture-model',display_name:'Fixture model'}]});
  assert.equal(f.calls[0].url,'https://api.openai.com/v1/models');assert.equal(f.calls[0].init.redirect,'error');
});
localTest('response absent content type completes through shared parser',async t=>{
  const f=await serviceFixture(t);const r=await f.service.responses(payload(),'fixture-request-0001');
  assert.deepEqual(r,{schema:'trognet-gateway-response/v1',status:'completed',text:'Fixture answer'});
  assert.equal(f.calls.length,2);assert.equal(f.calls[1].url,'https://api.openai.com/v1/responses');assert.deepEqual(JSON.parse(f.calls[1].init.body),payload());
  assert(!JSON.stringify(r).includes('PLACEHOLDER'));
});
localTest('model visibility enforces current account catalog',async t=>{
  const f=await serviceFixture(t);await assert.rejects(f.service.responses({...payload(),model:'hidden-model'},'fixture-request-0001'),/MODEL_NOT_VISIBLE/);assert.equal(f.calls.length,1);
});
for(const mode of ['incomplete','failed','truncated','bad_json','http_503','timeout','reset','wrong_type','token_echo','huge_output','after_completed_failure']) localTest('response uncertainty never replays '+mode,async t=>{
  const f=await serviceFixture(t,{timeoutMs:30,provider:async u=>{
    if(u.endsWith('/models'))return catalog();
    if(mode==='timeout')return new Promise(()=>{});
    if(mode==='reset')throw Error('PLACEHOLDER_PRIVATE_EXCEPTION');
    if(mode==='http_503')return new Response('PLACEHOLDER_PRIVATE_EXCEPTION',{status:503});
    if(mode==='wrong_type')return new Response('not sse');
    if(mode==='token_echo')return completed(tokens().access_token);
    if(mode==='huge_output')return completed('x'.repeat(32769));
    if(mode==='bad_json')return new Response(new TextEncoder().encode('data: invalid\n\n'));
    if(mode==='truncated')return events([{type:'response.output_text.delta',delta:'partial'}]);
    if(mode==='after_completed_failure')return events([{type:'response.output_text.delta',delta:'partial'},{type:'response.completed',response:{status:'completed'}},{type:'response.failed'}]);
    return events([{type:'response.output_text.delta',delta:'partial'},{type:'response.'+mode}]);
  }});
  await assert.rejects(f.service.responses(payload(),'fixture-request-0001'),/PROVIDER_UNCERTAIN/);assert.equal(f.calls.length,2);
  await assert.rejects(f.service.responses(payload(),'fixture-request-0001'),/REQUEST_ALREADY_SEEN/);assert.equal(f.calls.length,2);
  await f.store.close();const s=await f.open(),next=new GatewayService({store:s,key:KEY,host:HOST,fetcher:async()=>{throw Error('no replay');},now:()=>NOW});
  await assert.rejects(next.responses(payload(),'fixture-request-0001'),/REQUEST_ALREADY_SEEN/);
});
localTest('same production models path automatically renews and qualification reads persistence',async t=>{
  const f=await serviceFixture(t,{extra:{expires_at_ms:NOW+1000,earliest_refresh_at_ms:NOW-360000},provider:async u=>u.endsWith('/oauth/token')?Response.json(grant()):catalog()});
  const r=await f.service.qualify();assert.equal(r.status,'AUTOMATIC_REFRESH_OBSERVED');assert.equal(r.before.generation,0);assert.equal(r.after.generation,1);assert(r.persisted);assert.equal(r.inference_requests,0);
  assert.equal(f.calls.length,2);assert.equal((await openToken((await f.store.get('session')).sealed,KEY,HOST)).refresh_token,grant().refresh_token);
  assert.equal((await f.service.qualify()).status,'NO_REFRESH_OBSERVED');assert.equal(f.calls.length,3);assert(!JSON.stringify(r).includes('PLACEHOLDER'));
});
localTest('gateway staged replacement recovery after restart makes no refresh request',async t=>{
  const f=await serviceFixture(t);const r=await f.store.get('session');await f.store.put('session',{...r,phase:'replacement_staged',generation:1});await f.store.close();
  const s=await f.open();let calls=0;const service=new GatewayService({store:s,key:KEY,host:HOST,fetcher:async u=>{assert(u.endsWith('/models'));calls++;return catalog();},now:()=>NOW});
  const receipt=await service.qualify();assert.equal(receipt.status,'NO_REFRESH_OBSERVED');assert.equal(receipt.after.phase,'ready');assert.equal(calls,1);
});
localTest('real process crash after staged fsync recovers latest rotation only',async t=>{
  const f=await fixture(t);await f.store.close();
  const storeModule=new URL('../self-hosted/protected-store.mjs',import.meta.url).href;
  const coreModule=new URL('../dist/credential-broker.js',import.meta.url).href;
  const code=`import fs from 'node:fs';import {FileProtectedStore} from ${JSON.stringify(storeModule)};import {BrokerCore} from ${JSON.stringify(coreModule)};
    const dir=${JSON.stringify(f.dir)};const store=await FileProtectedStore.open(dir,{fault:step=>{if(step==='after_directory_sync'&&JSON.parse(fs.readFileSync(dir+'/state.json')).session.phase==='replacement_staged')process.exit(88)}});
    const core=new BrokerCore(store,${JSON.stringify(KEY)},${JSON.stringify(HOST)},async()=>Response.json(${JSON.stringify(grant())}),()=>${NOW});
    await core.initialize(${JSON.stringify(tokens({expires_at_ms:NOW+1000}))});await core.getToken();process.exit(1);`;
  const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:'ignore'});
  assert.equal(await new Promise(resolve=>child.on('exit',resolve)),88);
  const s=await f.open();assert.equal((await s.get('session')).phase,'replacement_staged');
  let calls=0;const core=new BrokerCore(s,KEY,HOST,async()=>{calls++;throw Error('no replay');},()=>NOW);
  assert.equal(await core.getToken(),grant().access_token);assert.equal(calls,0);
  assert.equal((await openToken((await s.get('session')).sealed,KEY,HOST)).refresh_token,grant().refresh_token);
});
localTest('ledger remains bounded and never evicts old uncertain identities',async t=>{
  const f=await fixture(t);await new BrokerCore(f.store,KEY,HOST).initialize(tokens());
  for(let i=0;i<512;i++)await f.store.reserveRequest(i.toString(16).padStart(64,'0'),NOW);
  await assert.rejects(f.store.reserveRequest('f'.repeat(64),NOW),/REQUEST_LEDGER_FULL/);
  await assert.rejects(f.store.reserveRequest('0'.repeat(64),NOW),/REQUEST_ALREADY_SEEN/);
});
localTest('catalog bearer echo, oversized data and malformed models never escape',async t=>{
  for(const provider of [()=>Response.json({models:[{slug:'fixture-model',display_name:tokens().refresh_token,visibility:'list'}]}),
    ()=>Response.json({models:[{slug:'fixture-model',display_name:'x'.repeat(257),visibility:'list'}]}),
    ()=>new Response('x'.repeat(262145)),()=>Response.json({models:'invalid'})]){
    const f=await serviceFixture(t,{provider});await safeReject(f.service.models());
  }
});
localTest('simultaneous gateway requests share exactly one automatic broker refresh',async t=>{
  const f=await serviceFixture(t,{extra:{expires_at_ms:NOW+1000},provider:async u=>u.endsWith('/oauth/token')?Response.json(grant()):catalog()});
  await Promise.all(Array.from({length:8},()=>f.service.models()));assert.equal(f.calls.filter(c=>c.url.endsWith('/oauth/token')).length,1);
});
localTest('production startup rejects fallback and public bind before reading files',async()=>{
  const {start}=await import('../self-hosted/serve.mjs');
  for(const env of [{OPENAI_API_KEY:''},{CREDITS_FALLBACK:'true'},{GATEWAY_HOST:'0.0.0.0'}])await assert.rejects(start(env),/GATEWAY_CONFIGURATION/);
});
localTest('production entry point starts with synthetic protected inputs and health makes no provider call',async t=>{
  const f=await fixture(t);await new BrokerCore(f.store,KEY,HOST).initialize(tokens());await f.store.close();
  const files={host:HOST,key:KEY,origin:secret,owner:ownerSecret};for(const [name,value] of Object.entries(files))fs.writeFileSync(path.join(f.root,name),value,{mode:0o600});
  const probe=http.createServer();await listenLoopback(probe,{port:0});const port=probe.address().port;await new Promise(r=>probe.close(r));
  const {start}=await import('../self-hosted/serve.mjs');const app=await start({GATEWAY_PORT:String(port),GATEWAY_HOST_ID_FILE:path.join(f.root,'host'),GATEWAY_KEY_FILE:path.join(f.root,'key'),
    GATEWAY_ADMISSION_FILE:path.join(f.root,'origin'),GATEWAY_OWNER_FILE:path.join(f.root,'owner'),GATEWAY_STATE_DIR:f.dir,GATEWAY_RUN_DIR:f.root});
  t.after(()=>app.close());const r=await request({address:()=>({port})},{url:'/health'});assert.equal(r.status,200);assert.deepEqual(JSON.parse(r.body),{ready:true});
  assert.equal(fs.statSync(path.join(f.root,'owner.sock')).mode&0o777,0o600);
});
localTest('gateway rejects legacy unqualified schedule even before expiry window',async t=>{
  const f=await serviceFixture(t,{extra:{unqualified_refresh_schedule:1791171737}});assert.equal(await f.service.ready(),false);await assert.rejects(f.service.models());assert.equal(f.calls.length,0);
});
localTest('owner qualification records frozen automatic refresh without exposing failure',async t=>{
  const f=await serviceFixture(t,{extra:{expires_at_ms:NOW+1000},provider:async()=>{throw Error('PLACEHOLDER_PRIVATE_EXCEPTION');}});
  const r=await f.service.qualify();assert.equal(r.status,'BLOCKED');assert.equal(r.before.phase,'ready');assert.equal(r.after.phase,'refreshing');assert.equal(r.model_catalog_succeeded,false);
  assert(!JSON.stringify(r).includes('PLACEHOLDER'));await f.service.qualify();assert.equal(f.calls.length,1);
});
localTest('provider rejection preserves sanitized status, shape and known code only',async t=>{
  const f=await serviceFixture(t,{provider:async u=>u.endsWith('/models')?catalog():Response.json({error:{code:'subscription_sharing_usage_limit_exceeded',param:'model',message:tokens().access_token}},{status:429,headers:{'x-request-id':'fixture-request'}})});
  await assert.rejects(f.service.responses(payload(),'fixture-request-0001'),e=>{
    assert.equal(e.message,'PROVIDER_UNCERTAIN');assert.deepEqual(e.diagnostic,{http_status:429,body_shape:'error_object',code:'subscription_sharing_usage_limit_exceeded',param:'model',request_id:'fixture-request'});
    assert(!JSON.stringify(e).includes('PLACEHOLDER'));return true;
  });
});

async function listen(t,service,opts={}) {
  const s=createGatewayServer({service,secret,...opts});await listenLoopback(s,{port:0});
  t.after(()=>new Promise(resolve=>{s.close(resolve);s.closeAllConnections();}));return s;
}
function request(server,{url='/models',method='GET',headers={},raw,partial=false}={}) {
  return new Promise((resolve,reject)=>{
    const r=http.request({host:'127.0.0.1',port:server.address().port,path:url,method,headers},res=>{
      const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
    });r.on('error',reject);if(raw)r.write(raw);if(!partial)r.end();
  });
}
localTest('admission precedes body parsing and provider work, opaque health, no token route or CORS',async t=>{
  const f=await serviceFixture(t),s=await listen(t,f.service);
  const denied=await request(s,{url:'/responses',method:'POST',headers:{'Content-Type':'application/json','Content-Length':'999999'},raw:'{',partial:true});
  assert.equal(denied.status,403);assert.equal(f.calls.length,0);
  const health=await request(s,{url:'/health'});assert.deepEqual(JSON.parse(health.body),{ready:true});assert.equal(f.calls.length,0);assert(!('access-control-allow-origin'in health.headers));
  assert.equal((await request(s,{url:'/token',headers:{'X-TrogNet-Admission':secret}})).status,404);
  assert.equal((await request(s,{headers:{'X-TrogNet-Admission':secret,Origin:'https://example.invalid'}})).status,403);
});
localTest('HTTP accepts only bounded own contract and strips provider exceptions',async t=>{
  const f=await serviceFixture(t),s=await listen(t,f.service);
  const headers={'X-TrogNet-Admission':secret,'Content-Type':'application/json','X-TrogNet-Request-Id':'fixture-http-request-1'};
  assert.equal((await request(s,{url:'/responses',method:'POST',headers,raw:JSON.stringify({...payload(),tools:[]})})).status,400);assert.equal(f.calls.length,0);
  assert.equal((await request(s,{url:'/responses',method:'POST',headers,raw:JSON.stringify(payload())})).status,200);
  assert.equal((await request(s,{url:'/responses',method:'POST',headers,raw:JSON.stringify(payload())})).status,409);
});
localTest('owner UNIX hook has distinct admission and uses resident service with no inference',async t=>{
  const f=await serviceFixture(t),socket=path.join(f.root,'owner.sock'),secretPath=path.join(f.root,'owner-admission');
  fs.writeFileSync(secretPath,ownerSecret,{mode:0o600});const s=createGatewayServer({service:f.service,secret:ownerSecret,owner:true});
  await new Promise(resolve=>s.listen(socket,resolve));fs.chmodSync(socket,0o600);
  t.after(()=>new Promise(resolve=>{s.close(resolve);s.closeAllConnections();}));
  const r=await qualify({socket,secretPath});assert.equal(r.status,'NO_REFRESH_OBSERVED');assert.equal(r.inference_requests,0);assert.equal(f.calls.length,1);
  fs.writeFileSync(secretPath,secret);await assert.rejects(qualify({socket,secretPath}));assert.equal(f.calls.length,1);
});
test('E05R5 deployment restart and resource bounds are explicit',()=>{
  const unit=fs.readFileSync(new URL('../self-hosted/deploy/trognet-gateway.service',import.meta.url),'utf8');
  for(const setting of ['User=trognet','RestartSec=60','StartLimitBurst=3','UMask=0077','MemorySwapMax=0','NoNewPrivileges=true'])assert(unit.includes(setting));
});
