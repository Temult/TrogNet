import test from 'node:test';
import assert from 'node:assert/strict';
import {registration,prepareOSS} from '../dist/oss-oauth.js';
import {bootstrapSession,requirePublication,liveBootstrap,loopback,protectLoginHint} from '../scripts/oss-bootstrap.mjs';
import {fakeOAuth,identity,NOW,HOST,CLIENT,KEY,MemoryStore,planConfig,dryRun} from '../scripts/oss-fixtures.mjs';
import {BrokerCore,openToken,sealToken} from '../dist/credential-broker.js';
import {discoverPlanModel} from '../dist/oss-plan-staging.js';
import {brokerIdentity,PlanCredentialBroker} from '../dist/plan-broker.js';
import {sha256} from '../dist/util.js';
import {ProbeCore} from '../dist/plan-probe-worker.js';
import {composePacket,composeRequest,validateCandidate,rehearse,assertProviderSafe} from '../scripts/cyberdeck-seam.mjs';
const run=async(change={},extra={})=>{const f=await fakeOAuth(change);return bootstrapSession({identity:identity(),callback:f.callback,fetcher:f.fetcher,now:NOW,savePending:async()=>{},confirmIdentity:async()=>true,commitActive:async r=>{if(extra.saveIdentity)await extra.saveIdentity(r.identity);},protectHint:(v,r)=>protectLoginHint(v,KEY,r),seal:async t=>t,...extra});};
test('E05R1 first use selects dynamic registration and stable TrogNet hint',async()=>{
 const r=identity(),a=await prepareOSS(r,1455,NOW),b=await prepareOSS(r,1455,NOW);
 const url=new URL(a.authorization_url);assert.equal(url.searchParams.get('agent_name_hint'),'TrogNet');assert.equal(url.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(url.searchParams.get('ext_agent_host_id'),HOST);assert.equal(b.attempt.host_id,HOST);assert.notEqual(a.attempt.state,b.attempt.state);
});
test('E05R1 issued client survives persisted registration reload and later authorization',async()=>{
 let persisted;const result=await run({}, {saveIdentity:async r=>{persisted=JSON.stringify(r);}});
 const restored=registration(HOST,JSON.parse(persisted)),p=await prepareOSS(restored,1455,NOW);
 assert.equal(result.bundle.client_id,CLIENT);assert.equal(new URL(p.authorization_url).searchParams.get('client_id'),CLIENT);assert(!new URL(p.authorization_url).searchParams.has('agent_name_hint'));
 assert(!persisted.includes('access_token'));assert(!persisted.includes('refresh_token'));assert(!persisted.includes('id_token'));
 await run({}, {identity:restored});
});
for(const [name,change]of Object.entries({missing_scope:{grant:{scope:'openid profile email offline_access resource.invoke'}},wrong_client:{callback:{client_id:'oaiapp_wrong'}},invalid_client:{callback:{client_id:'not-issued'}},host:{callback:{ext_agent_host_id:HOST.replace('000001','000002')}},state:{callback:{state:'wrong'}},pkce:{verifier:true},denied:{callback:{error:'access_denied'}},nonce:{claims:{nonce:'wrong'}},audience:{claims:{aud:'oaiapp_other'}},expired_id:{claims:{exp:1}}}))test('E05R1 rejects '+name+' before credential persistence',async()=>{
 let writes=0;await assert.rejects(run(change,{saveIdentity:async()=>{writes++;}}));assert.equal(writes,0);
});
test('E05R2 pending persistence failure prevents sealing and exchange',async()=>{let sealed=0;await assert.rejects(run({}, {savePending:async()=>{throw Error('disk failed');},seal:async()=>{sealed++;}}));assert.equal(sealed,0);});
test('E05R2 malformed active registration and host drift fail closed',()=>{const active={...identity(),client_id:CLIENT,issuer:'https://auth.openai.com',subject:'fixture-subject'};for(const change of [{host_id:HOST.replace('000001','000002')},{subject:''},{issuer:'wrong'},{client_id:'dynamic_agent_client'}])assert.throws(()=>registration(HOST,{...active,...change}));});
test('E05R1 dry bootstrap imports through existing broker and closes aperture',async()=>assert.equal((await dryRun()).aperture_closed,true));
test('E05R1 broker import and session identity retain the optional legacy workspace guard',async()=>{
 const base={...planConfig(),PLAN_WORKSPACE_ID:'fixture-workspace'},store=new MemoryStore();
 const t=(await run()).bundle;
 const raw=JSON.stringify({schema:'trognet-plan-import/v1',host_id:HOST,client_id:CLIENT,subject:t.subject,epoch:0,sealed:await sealToken({...t,workspace_id:'wrong'},KEY,HOST)});
 const env={...base,IMPORT_ENABLED:'true',IMPORT_EPOCH:'0',IMPORT_SHA256:await sha256(raw),IMPORT_EXPIRES_MS:String(NOW+300000)};
 const broker=new PlanCredentialBroker({storage:store},env,async()=>{throw Error('NO_NETWORK');},()=>NOW);
 assert.equal((await broker.fetch(new Request('https://fixture.internal/import',{method:'POST',body:raw}))).status,503);
 assert.equal(await store.get('session'),undefined);
 assert.notEqual(brokerIdentity(base),brokerIdentity({...base,PLAN_WORKSPACE_ID:'wrong'}));
});
test('E05R1 absent or invalid publication receipt prevents all live effects',async()=>{
 for(const r of [undefined,{}, {schema:'trognet-oss-publication-receipt/v1',published:true}, {published:false}]){assert.throws(()=>requirePublication(r,'0'.repeat(64)));await assert.rejects(liveBootstrap({},r,'MUST_NOT_CREATE'));}
});
test('E05R1 loopback callback runs on loopback only and closes after one response',async()=>{
 const port=19455,state='fixture-state';let status;
 const callback=await loopback(port,async()=>{const r=await fetch(`http://127.0.0.1:${port}/auth/callback?state=${state}&code=fixture&client_id=${CLIENT}`);status=r.status;await r.text();},`https://fixture.invalid/authorize?state=${state}`,3000);
 assert(callback.startsWith(`http://127.0.0.1:${port}/auth/callback?`));
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(status,200);
 await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
});
const token=()=>({client_id:CLIENT,subject:'fixture-subject',issuer:'https://auth.openai.com',ext_agent_host_id:HOST,access_token:'PLACEHOLDER_ACCESS',refresh_token:'PLACEHOLDER_REFRESH',scopes:['chatgpt.tokens.use.direct','offline_access','resource.invoke'],expires_at_ms:NOW+1000,refresh_expires_at_ms:NOW+86400000});
test('E05R1 issued client reused for serialized refresh and rotation',async()=>{
 const store=new MemoryStore();let calls=0;
 const core=new BrokerCore(store,KEY,HOST,async(u,i)=>{calls++;assert.equal(i.body.get('client_id'),CLIENT);return Response.json({token_type:'Bearer',access_token:'PLACEHOLDER_NEXT_ACCESS',refresh_token:'PLACEHOLDER_NEXT_REFRESH',expires_in:3600});},()=>NOW);
 await core.initialize(token());assert.deepEqual(await Promise.all([core.getToken(),core.getToken()]),['PLACEHOLDER_NEXT_ACCESS','PLACEHOLDER_NEXT_ACCESS']);assert.equal(calls,1);assert.equal((await openToken((await store.get('session')).sealed,KEY,HOST)).client_id,CLIENT);
});
for(const mode of ['expired','terminal','ambiguous_persistence'])test('E05R1 reconnect required after '+mode,async()=>{
 const store=new MemoryStore();let calls=0;
 const core=new BrokerCore(store,KEY,HOST,async()=>{calls++;if(mode==='terminal')return new Response(null,{status:400});return Response.json({token_type:'Bearer',access_token:'PLACEHOLDER_NEXT_ACCESS',refresh_token:'PLACEHOLDER_NEXT_REFRESH',expires_in:3600});},()=>NOW);
 await core.initialize({...token(),...(mode==='expired'?{refresh_expires_at_ms:NOW-1}:{})});
 if(mode==='ambiguous_persistence'){const put=store.put.bind(store);store.put=async(k,v)=>{if(v.phase==='replacement_staged'||v.phase==='reauth_required')throw Error('disk');await put(k,v);};}
 await assert.rejects(core.getToken());await assert.rejects(core.getToken());assert.equal(calls,mode==='expired'?0:1);
 assert(['reauth_required','refreshing'].includes((await store.get('session')).phase));
});
test('E05R1 account catalog chooses only the discovered visible selection',async()=>{
 const env={...planConfig(),PLAN_POLICY_EXPIRES_MS:String(Date.now()+3600000),P0_MODEL:'fixture-discovered',MODEL:'fixture-discovered'};
 env.BROKER={idFromName:n=>n,get:()=>({fetch:async()=>Response.json({access_token:'PLACEHOLDER_BROKER_TOKEN',broker_identity:brokerIdentity(env),epoch:0})})};
 for(const models of [[],[{slug:env.MODEL,visibility:'hidden'}],[{slug:env.MODEL,visibility:'list'},{slug:env.MODEL,visibility:'list'}]])await assert.rejects(discoverPlanModel(env,async()=>Response.json({models})));
 assert.equal(await discoverPlanModel(env,async(u,i)=>{assert.equal(i.headers.Authorization,'Bearer '+'PLACEHOLDER_BROKER_TOKEN');return Response.json({models:[{slug:env.MODEL,visibility:'list'}]});}),env.MODEL);
 for(const change of [{INFERENCE_MODE:'api'},{OPENAI_API_KEY:''},{CREDITS_FALLBACK:'true'}])await assert.rejects(discoverPlanModel({...env,...change},async()=>{throw Error('must not call');}));
});
const syntheticPacket=()=>({schema:'trognet-bounded-evidence/v1',question:'Fixture question',evidence:[{id:'X:fixture',kind:'exact_evidence',semantics:{native_class:'OBSERVED',coverage_notes:['OPEN: fixture remains unresolved.']},payload:{fixture:true}}],boundaries:['OPEN: fixture remains unresolved.']});
const answer=p=>({answer_class:'unknown',paragraphs:[{text:'The fixture remains unresolved.',citations:p.evidence.map(e=>({id:e.id,semantics:e.semantics}))}],boundaries:p.boundaries,research_needed:true});
test('E05R1 fabricated evidence and detectable OPEN/MODEL/OBSERVED promotion rejected',()=>{
 for(const kind of ['OPEN','MODEL','OBSERVED']){const p=syntheticPacket();p.evidence[0].semantics.native_class=kind;const a=answer(p);assert.deepEqual(validateCandidate(a,p),a);for(const mutate of [x=>x.paragraphs[0].citations[0].id='X:fabricated',x=>x.paragraphs[0].citations[0].semantics.native_class='SOURCE',x=>x.boundaries=[],x=>x.answer_class='evidence_summary',x=>x.research_needed=false]){const bad=structuredClone(a);mutate(bad);assert.throws(()=>validateCandidate(bad,p));}}
});
test('E05R1 completed SSE parses without Content-Type; incomplete stream rejects',async()=>{
 const p=syntheticPacket(),a=answer(p),event=(type,data)=>'data: '+JSON.stringify({type,...data})+'\n\n';
 const text=event('response.output_text.delta',{delta:JSON.stringify(a)}),done=event('response.completed',{response:{status:'completed'}});
 const provider=async request=>{assert(!('max_output_tokens'in request));assert.equal(request.store,false);return new Response(text+done);};assert.deepEqual((await rehearse(p,'fixture-model',provider)).answer,a);
 await assert.rejects(rehearse(p,'fixture-model',async()=>new Response(text)));
 await assert.rejects(rehearse(p,'fixture-model',async()=>Response.json({status:'completed'})));
});
test('E05R3 one-shot ProbeCore accepts completed SSE without Content-Type',async()=>{
 const event=(type,data)=>'data: '+JSON.stringify({type,...data})+'\n\n';
 const body=event('response.output_text.delta',{delta:'LIBRARIAN_PROBE_OK'})+event('response.completed',{response:{status:'completed'}});
 const env={...planConfig(),P0_ENABLED:'true',P0_OWNER_EMAIL:['owner','example.invalid'].join('@'),P0_PROBE_ID:'transport-no-content-type',P0_MODEL:'gpt-fixture',MODEL:'gpt-fixture',P0_ACCESS_TOKEN:undefined};
 const store=new MemoryStore();let calls=0;
 const fetcher=async(url,init)=>{calls++;if(String(url).endsWith('/v1/models'))return Response.json({models:[{slug:'gpt-fixture',visibility:'list'}]});assert(String(url).endsWith('/v1/responses'));assert.equal(init.headers.Accept,'text/event-stream');return new Response(body);};
 const core=new ProbeCore(store,env,fetcher,async()=> 'PLACEHOLDER_BROKER_TOKEN','fixture-context');
 const result=await core.run();assert.equal(result.status,'PASS');assert.equal(result.response_completed,true);assert.equal(result.expected_text,true);assert.equal(calls,2);
});
for(const bad of [{access_token:'fixture'}, {refresh_token:'fixture'}, {id_token:'fixture'}, {hidden_evaluator:{}}, {text:'C:\\private\\secret'}, {text:['','home','private','file'].join('/')}, {text:'Bearer '+'fixture-only'}])test('E05R1 provider input rejects '+Object.keys(bad)[0]+' '+JSON.stringify(bad).length,()=>assert.throws(()=>assertProviderSafe(bad)));
test('E05R1 composer rejects oversized whole packets without truncation',async()=>{
 await assert.rejects(composePacket({question:'fixture',exact:[{id:'big',operation:'fake',request:{}}],expand:async()=>({status:'PROJECTED_EXACT_HIT',evidence:{id:'big',result:{text:'x'.repeat(140000)},coverage_notes:[]}})}));
 assert.throws(()=>composeRequest(syntheticPacket(),''));
});
