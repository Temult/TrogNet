import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {registration,prepareOSS,redactAuthorization} from '../dist/oss-oauth.js';
import {bootstrapSession,protectLoginHint,openLoginHint,enrollmentStore} from '../scripts/oss-bootstrap.mjs';
import {fakeOAuth,identity,NOW,HOST,CLIENT,KEY,MemoryStore} from '../scripts/oss-fixtures.mjs';
import {BrokerCore,sealToken} from '../dist/credential-broker.js';
const activeIdentity={...identity(),client_id:CLIENT,issuer:'https://auth.openai.com',subject:'fixture-subject'};
async function harness(change={},options={}){
 const f=await fakeOAuth(change),events=[],state={active:'prior-active'};
 const args={identity:identity(),now:NOW,callback:f.callback,
  savePending:async p=>{state.pending=structuredClone(p);events.push('pending');},
  fetcher:async(...a)=>{assert(state.pending);events.push('fetch');return f.fetcher(...a);},
  confirmIdentity:async r=>{events.push('confirm');assert.equal(r.subject,'fixture-subject');return true;},
  seal:async t=>{events.push('seal');return sealToken(t,KEY,HOST);},
  protectHint:(v,r)=>protectLoginHint(v,KEY,r),
  commitActive:async r=>{events.push('active');state.active=r;},...options};
 return {args,events,state,f,run:()=>bootstrapSession(args)};
}
test('E05R2 fresh enrollment learns signed identity without workspace extension, then confirms',async()=>{
 const h=await harness();assert.equal(h.args.identity.subject,undefined);await h.run();
 assert.deepEqual(h.events.slice(0,2),['pending','fetch']);assert(h.events.indexOf('confirm')<h.events.indexOf('seal'));
 assert.equal(h.state.active.identity.workspace_binding,'ISSUED_CLIENT_PROVIDER_BOUND');
 assert.deepEqual(Object.keys(h.state.pending).sort(),['client_id','host_id','schema']);
 assert.equal(h.state.pending.client_id,CLIENT);assert(!JSON.stringify(h.state.active).includes('PLACEHOLDER_ACCESS_ONLY'));
});
for(const confirm of [false,undefined,'CONFIRM'])test('E05R2 explicit boolean owner confirmation required '+String(confirm),async()=>{
 const h=await harness({}, {confirmIdentity:async()=>confirm});await assert.rejects(h.run(),/OWNER_CONFIRMATION/);assert.equal(h.state.active,'prior-active');assert(!h.events.includes('seal'));
});
test('E05R2 missing confirmation adapter fails before callback',async()=>{const h=await harness({}, {confirmIdentity:undefined});await assert.rejects(h.run());assert.equal(h.f.calls(),0);assert.equal(h.state.pending,undefined);});
for(const mode of ['invalid_grant','transport','jwks'])test('E05R2 durable pending precedes '+mode+' and explicit retry reuses client',async()=>{
 const h=await harness();h.args.fetcher=async(u,i)=>{assert.equal(h.state.pending.client_id,CLIENT);if(mode==='transport')throw Error('uncertain');if(mode==='invalid_grant')return Response.json({error:mode},{status:400});if(String(u).endsWith('/oauth/token'))return h.f.fetcher(u,i);throw Error('jwks failed');};
 await assert.rejects(h.run());assert.equal(h.state.active,'prior-active');
 const r=registration(HOST,undefined,h.state.pending),p=await prepareOSS(r,1455,NOW);
 assert.equal(new URL(p.authorization_url).searchParams.get('client_id'),CLIENT);assert.equal(r.subject,undefined);
 const retry=await harness({}, {identity:r});await retry.run();assert.equal(retry.state.active.identity.subject,'fixture-subject');
});
for(const callback of [{error:'access_denied'},{state:'bad'},{client_id:'oaiapp_different'}])test('E05R2 callback rejection persists nothing '+JSON.stringify(callback),async()=>{
 const h=await harness({callback},{identity:activeIdentity});await assert.rejects(h.run());assert.equal(h.state.pending,undefined);assert.equal(h.f.calls(),0);assert.equal(h.state.active,'prior-active');
});
test('E05R2 failed pending write prevents exchange',async()=>{const h=await harness({}, {savePending:async()=>{throw Error('disk');}});await assert.rejects(h.run());assert.equal(h.f.calls(),0);assert.equal(h.state.active,'prior-active');});
for(const claims of [{sub:'different'},{iss:'https://wrong.invalid'},{aud:'wrong'},{nonce:'wrong'},{exp:1}])test('E05R2 returning verified claim mismatch rejects '+Object.keys(claims)[0],async()=>{const h=await harness({claims},{identity:activeIdentity});await assert.rejects(h.run());assert.equal(h.state.active,'prior-active');});
test('E05R2 missing plan scope never confirms',async()=>{const h=await harness({grant:{scope:'openid profile offline_access'}});await assert.rejects(h.run());assert(!h.events.includes('confirm'));});
test('E05R2 invalid signature never confirms',async()=>{const h=await harness();const original=h.args.fetcher;h.args.fetcher=async(u,i)=>{const r=await original(u,i);if(!String(u).endsWith('/oauth/token'))return r;const body=await r.json();body.id_token=(body.id_token.slice(0,-10)+'AAAAAAAAAA');return Response.json(body);};await assert.rejects(h.run());assert(!h.events.includes('confirm'));});
test('E05R2 commit failure preserves prior active and retained pending',async()=>{const h=await harness({}, {commitActive:async()=>{throw Error('commit failed');}});await assert.rejects(h.run());assert.equal(h.state.active,'prior-active');assert.equal(h.state.pending.client_id,CLIENT);});
test('E05R2 protected hint binds identity, redacts URLs, and cannot authenticate a new grant',async()=>{
 const hint='PLACEHOLDER_EXPIRED_HINT',sealed=await protectLoginHint(hint,KEY,activeIdentity);
 assert(!JSON.stringify(sealed).includes(hint));assert.equal(await openLoginHint(sealed,KEY,activeIdentity),hint);
 await assert.rejects(openLoginHint(sealed,KEY,{...activeIdentity,subject:'other'}));
 const p=await prepareOSS(activeIdentity,1455,NOW,hint);assert.equal(new URL(p.authorization_url).searchParams.get('id_token_hint'),hint);assert(!redactAuthorization(p.authorization_url).includes(hint));
 const h=await harness({claims:{sub:'other'}},{identity:activeIdentity,idTokenHint:hint});await assert.rejects(h.run());assert.equal(h.state.active,'prior-active');
});
for(const schedule of [1800000000,1800000000000,'1800000000','2027-01-15T08:00:00Z',null,{}])test('E05R2 unsupported renewal encoding stays stopped '+JSON.stringify(schedule),async()=>{
 let sealed=0;const h=await harness({grant:{earliest_refresh_at:schedule}},{seal:async()=>{sealed++;return {};}});
 await assert.rejects(h.run(),/REFRESH_SCHEDULE_REJECTED/);assert.equal(sealed,0);
});

test('E05R2 process termination after pending write preserves disk record and previous active',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'trognet-enrollment-'));fs.chmodSync(dir,0o700);
 try{
  if(process.platform==='win32'){
   const literal=dir.replaceAll("'","''"),ps=`$s=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;$a=New-Object System.Security.AccessControl.DirectorySecurity;$a.SetAccessRuleProtection($true,$false);$r=New-Object System.Security.AccessControl.FileSystemAccessRule($s,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$a.AddAccessRule($r);[System.IO.Directory]::SetAccessControl('${literal}',$a)`;
   execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{windowsHide:true});
  }
  const store=enrollmentStore(dir);await store.commitActive({marker:'unchanged'});const before=fs.readFileSync(path.join(dir,'active.json'));
  const bootstrap=new URL('../scripts/oss-bootstrap.mjs',import.meta.url).href,fixtures=new URL('../scripts/oss-fixtures.mjs',import.meta.url).href;
  const code=`import {bootstrapSession,enrollmentStore} from ${JSON.stringify(bootstrap)};import {fakeOAuth,identity,NOW} from ${JSON.stringify(fixtures)};const s=enrollmentStore(process.argv[1]),f=await fakeOAuth();await bootstrapSession({identity:identity(),now:NOW,callback:f.callback,savePending:s.savePending,fetcher:async()=>process.exit(17),confirmIdentity:async()=>true,seal:async()=>{},protectHint:async()=>{},commitActive:s.commitActive});`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code,dir],{encoding:'utf8',windowsHide:true});assert.equal(child.status,17,child.stderr);
  const loaded=store.load();assert.deepEqual(Object.keys(loaded.pending).sort(),['client_id','host_id','schema']);assert.deepEqual(fs.readFileSync(path.join(dir,'active.json')),before);
  const retry=await harness({}, {identity:registration(HOST,undefined,loaded.pending),savePending:store.savePending,fetcher:undefined});retry.args.fetcher=retry.f.fetcher;await retry.run();
 }finally{for(const name of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,name));fs.rmdirSync(dir);}
});
