import {verifyJwt} from '../dist/auth.js';
import {qualificationPage} from './owner/qualification.mjs';

const encoder=new TextEncoder();
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,fields)=>plain(x)&&Object.keys(x).every(k=>fields.includes(k));
const str=(s,n)=>typeof s==='string'&&s.length>0&&encoder.encode(s).length<=n;
const id=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{16,96}$/.test(s);
const fail=(code,status=400)=>{throw Object.assign(Error(code),{status});};
export const digest=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
export const sequenceId=n=>'e06_'+String(n).padStart(16,'0');
export function json(value,status=200) {
  return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}
export async function boundedJSON(response,limit,signal) {
  const reader=response.body?.getReader(); if(!reader) fail('INVALID_JSON');
  const chunks=[];let size=0;
  const abort=()=>{void reader.cancel().catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  try {
    signal?.throwIfAborted();
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)fail('BODY_TOO_LARGE',413);chunks.push(value);}
    signal?.throwIfAborted();
    const bytes=new Uint8Array(size);let p=0;for(const c of chunks){bytes.set(c,p);p+=c.length;}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  } finally {signal?.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function timed(fn,ms) {
  const controller=new AbortController();let timer;
  try{return await Promise.race([fn(controller.signal),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('TIMEOUT'));},ms);})]);}
  finally{clearTimeout(timer);controller.abort();}
}
export function payload(p) {
  if(!exact(p,['model','instructions','input','store','stream'])||!str(p.model,128)||!/^[A-Za-z0-9._-]+$/.test(p.model)||p.store!==false||p.stream!==true||
    !str(p.instructions,16000)||!Array.isArray(p.input)||p.input.length<1||p.input.length>13||
    p.input.some(m=>!exact(m,['role','content'])||!['user','assistant'].includes(m.role)||!str(m.content,12000)))fail('INVALID_REQUEST');
  const out={model:p.model,instructions:p.instructions,input:p.input.map(m=>({role:m.role,content:m.content})),store:false,stream:true};
  if(encoder.encode(JSON.stringify(out)).length>32768)fail('BODY_TOO_LARGE',413);
  return out;
}
function configuration(env) {
  if(env.ENABLED!=='true'||['OPENAI_API_KEY','CREDITS_FALLBACK','TOKEN_ENCRYPTION_KEY','OWNER_ADMISSION','ACCESS_TOKEN','REFRESH_TOKEN'].some(k=>Object.hasOwn(env,k)))fail('FRONT_DOOR_UNAVAILABLE',503);
  if(Object.hasOwn(env,'ORIGIN_URL')||typeof env.PRIVATE_GATEWAY?.fetch!=='function')fail('FRONT_DOOR_UNAVAILABLE',503);
  for(const name of ['APP_ORIGIN']) {
    let u;try{u=new URL(env[name]);}catch{fail('FRONT_DOOR_UNAVAILABLE',503);}
    if(u.protocol!=='https:'||u.origin!==env[name]||u.username||u.password||u.port||u.hostname.endsWith('.invalid'))fail('FRONT_DOOR_UNAVAILABLE',503);
  }
  if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER)||!str(env.ACCESS_AUDIENCE,256)||!str(env.OWNER_SUBJECT,256)||
     !/^[-A-Za-z0-9_]{32,128}$/.test(env.ORIGIN_ADMISSION??'')||typeof env.ACCESS_PUBLIC_KEYS!=='string'||env.ACCESS_PUBLIC_KEYS.length>16384)fail('FRONT_DOOR_UNAVAILABLE',503);
}
function headers(request) {
  let count=0,bytes=0;
  for(const [k,v] of request.headers){count++;bytes+=encoder.encode(k+v).length+4;}
  if(count>32||bytes>8192)fail('HEADERS_TOO_LARGE',431);
  for(const [k] of request.headers) if((k.startsWith('x-trognet-')&&!['x-trognet-csrf'].includes(k))||['authorization','proxy-authorization','content-encoding','range','x-http-method-override'].includes(k))fail('HEADER_REJECTED',403);
}
export async function frontDoor(request,env) {
  try {
    configuration(env);headers(request);
    const u=new URL(request.url);
    if(u.origin!==env.APP_ORIGIN||u.search||u.hash)fail('NOT_FOUND',404);
    const status=/^\/e06\/requests\/([A-Za-z0-9_-]{16,96})$/.exec(u.pathname);
    if(!((request.method==='GET'&&(['/e06/models','/e06/qualification'].includes(u.pathname)||status))||(request.method==='POST'&&u.pathname==='/e06/responses')))fail('NOT_FOUND',404);
    const origin=request.headers.get('Origin');
    const fetchSite=request.headers.get('Sec-Fetch-Site');
    const qualificationCallback=request.method==='GET'&&u.pathname==='/e06/qualification'&&origin===null&&fetchSite==='cross-site'&&
      request.headers.get('Sec-Fetch-Mode')==='navigate'&&request.headers.get('Sec-Fetch-Dest')==='document';
    if((origin!==null&&origin!==env.APP_ORIGIN)||fetchSite==='same-site'||(fetchSite==='cross-site'&&!qualificationCallback))fail('ORIGIN_REJECTED',403);
    if(request.method==='POST'&&(origin!==env.APP_ORIGIN||request.headers.get('X-TrogNet-CSRF')!=='1'||request.headers.get('Content-Type')!=='application/json'))fail('ORIGIN_REJECTED',403);
    const token=request.headers.get('Cf-Access-Jwt-Assertion');if(!token)fail('AUTH_REQUIRED',401);
    let claims;
    try {
      const keys=JSON.parse(env.ACCESS_PUBLIC_KEYS);
      if(!Array.isArray(keys)||keys.length<1||keys.length>8||keys.some(k=>k.d||k.p||k.q))throw Error();
      claims=await verifyJwt(token,keys,env.ACCESS_ISSUER,env.ACCESS_AUDIENCE);
    } catch{fail('AUTH_REQUIRED',401);}
    if(claims.sub!==env.OWNER_SUBJECT||claims.type!=='app')fail('OWNER_REQUIRED',403);
    if(u.pathname==='/e06/qualification') {
      const nonce=crypto.randomUUID();
      return new Response(qualificationPage(nonce),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
        'Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
        'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
    }
    if(request.signal.aborted)fail('CALLER_DISCONNECTED',409);
    let action={kind:status?'status':'models',request_id:status?.[1]};
    if(request.method==='POST') {
      const b=await timed(signal=>boundedJSON(request,36864,signal),15000);
      if(!exact(b,['request_id','payload','new_attempt_of','consent'])||!id(b.request_id)||
         (b.new_attempt_of!==undefined&&!id(b.new_attempt_of))||
         (b.consent!==undefined&&b.consent!=='I_AUTHORIZE_ONE_NEW_ATTEMPT'))fail('INVALID_REQUEST');
      action={kind:'response',request_id:b.request_id,payload:payload(b.payload),new_attempt_of:b.new_attempt_of,consent:b.consent};
    }
    if(request.signal.aborted)fail('CALLER_DISCONNECTED',409);
    // New internal request: browser cookies, JWT, forwarding and admission headers never cross this boundary.
    const object=env.REQUESTS.get(env.REQUESTS.idFromName('e06-owner-ledger-v1'));
    return await object.fetch(new Request('https://internal.invalid/action',{method:'POST',body:JSON.stringify(action)}));
  } catch(e) {
    const allowed=['INVALID_REQUEST','BODY_TOO_LARGE','HEADERS_TOO_LARGE','HEADER_REJECTED','NOT_FOUND','ORIGIN_REJECTED','AUTH_REQUIRED','OWNER_REQUIRED','CALLER_DISCONNECTED'];
    return json({error:allowed.includes(e.message)?e.message:'FRONT_DOOR_UNAVAILABLE'},allowed.includes(e.message)?e.status:503);
  }
}
export default {fetch:frontDoor};

/** One durable admission coordinator. No timers, alarms, retry queues or provider credentials. */
export class RequestCoordinator {
  constructor(state,env,{timeoutMs=115000}={}) {this.state=state;this.env=env;this.busy=false;this.timeoutMs=timeoutMs;}
  async fetch(request) {
    try {
      configuration(this.env);
      const a=await boundedJSON(request,36864);
      if(a.kind==='status'&&id(a.request_id)) {
        const saved=await this.state.storage.get('r:'+await digest(a.request_id));
        return saved?json(this.receipt(saved)):json({error:'UNKNOWN_REQUEST'},404);
      }
      if(this.busy)return json({error:'FRONT_DOOR_BUSY'},503);
      this.busy=true;
      try {
        if(a.kind==='models')return json(await this.origin('/models'));
        if(a.kind!=='response'||!id(a.request_id))fail('INVALID_REQUEST');
        a.payload=payload(a.payload);
        return await this.attempt(a);
      } finally {this.busy=false;}
    } catch(e) {
      const allowed=['INVALID_REQUEST','INTENT_ALREADY_CONSUMED','REQUEST_ID_CONFLICT','NEW_ATTEMPT_CONSENT_REQUIRED','LEDGER_FULL'];
      return json({error:allowed.includes(e.message)?e.message:'FRONT_DOOR_UNAVAILABLE'},allowed.includes(e.message)?409:503);
    }
  }
  receipt(r) {
    return {schema:'trognet-e06-attempt/v1',request_id:r.request_id,gateway_request_sha256:r.gateway_hash,model:r.model,
      status:r.status,inference:r.status==='completed'?'confirmed':r.status==='not_dispatched'?'no':'unknown',
      gateway_completion:r.status==='completed',...(r.text!==undefined?{text:r.text}:{}),
      new_attempt_requires_consent:true};
  }
  async origin(path,body,gatewayId) {
    configuration(this.env);
    if(!['/models','/responses'].includes(path))fail('INVALID_REQUEST');
    return timed(async signal=>{
      const h={'Accept':'application/json','X-TrogNet-Admission':this.env.ORIGIN_ADMISSION};
      if(body){h['Content-Type']='application/json';h['X-TrogNet-Request-Id']=gatewayId;}
      // Synthetic HTTP URL/Host only; the registered VPC Service fixes the target.
      const r=await this.env.PRIVATE_GATEWAY.fetch('http://private-gateway.invalid'+path,{method:body?'POST':'GET',headers:h,body:body?JSON.stringify(body):undefined,redirect:'manual',signal});
      if(r.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw Error('UPSTREAM_REJECTED');
      const b=await boundedJSON(r,262144,signal);
      const raw=JSON.stringify(b);
      if(raw.includes(this.env.ORIGIN_ADMISSION)||/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(raw)||/\bBearer\s+\S+/i.test(raw))throw Error('UPSTREAM_REJECTED');
      if(r.status!==200) {
        // Do not expose provider diagnostics. Even HTTP rejection is not proof of no inference.
        const safe=['ADMISSION_DENIED','GATEWAY_BUSY','REQUEST_REJECTED','REQUEST_TOO_LARGE','REQUEST_ID_REQUIRED','MODEL_NOT_VISIBLE'];
        const e=Error('UPSTREAM_REJECTED');e.noDispatch=body&&safe.includes(b?.error);throw e;
      }
      if(!body) {
        if(!exact(b,['models'])||!Array.isArray(b.models)||b.models.length>256||b.models.some(m=>!exact(m,['slug','display_name'])||!str(m.slug,128)||!/^[A-Za-z0-9._-]+$/.test(m.slug)||!str(m.display_name,256)||/[\u0000-\u001f\u007f]/.test(m.display_name)))throw Error('UPSTREAM_REJECTED');
        return {models:b.models.map(m=>({slug:m.slug,display_name:m.display_name}))};
      }
      if(!exact(b,['schema','status','text','request_sha256'])||b.schema!=='trognet-gateway-response/v1'||b.status!=='completed'||!str(b.text,32768)||b.request_sha256!==await digest(gatewayId))throw Error('UPSTREAM_REJECTED');
      return b;
    },this.timeoutMs);
  }
  async attempt(a) {
    const key='r:'+await digest(a.request_id),intent=await digest(JSON.stringify(a.payload));
    const gatewayHash=async n=>digest(sequenceId(n));
    // All identity decisions and the uncertain marker commit before external work.
    const admitted=await this.state.storage.transaction(async tx=>{
      const old=await tx.get(key);
      if(old){if(old.intent!==intent)fail('REQUEST_ID_CONFLICT');return {old};}
      const prior=await tx.get('i:'+intent);
      if(prior) {
        if(a.new_attempt_of!==prior||a.consent!=='I_AUTHORIZE_ONE_NEW_ATTEMPT')fail('INTENT_ALREADY_CONSUMED');
      } else if(a.new_attempt_of!==undefined||a.consent!==undefined)fail('NEW_ATTEMPT_CONSENT_REQUIRED');
      const meta=await tx.get('meta')??{sequence:0,count:0};
      if(!Number.isSafeInteger(meta.count)||meta.count<0||meta.count>=2048||meta.sequence!==meta.count||!Number.isSafeInteger(meta.sequence)||meta.sequence>=Number.MAX_SAFE_INTEGER)fail('LEDGER_FULL');
      const sequence=meta.sequence+1;
      const r={request_id:a.request_id,intent,sequence,gateway_hash:await gatewayHash(sequence),model:a.payload.model,status:'uncertain'};
      await tx.put(key,r);await tx.put('i:'+intent,a.request_id);await tx.put('meta',{sequence,count:meta.count+1});
      return {r};
    });
    if(admitted.old)return json(this.receipt(admitted.old),admitted.old.status==='completed'?200:409);
    const r=admitted.r;
    try {const b=await this.origin('/responses',a.payload,sequenceId(r.sequence));r.status='completed';r.text=b.text;}
    catch(e){r.status=e.noDispatch?'not_dispatched':'uncertain';}
    // A persistence failure leaves the previously committed uncertain record. Never redispatch.
    await this.state.storage.put(key,r);
    return json(this.receipt(r),r.status==='completed'?200:409);
  }
}
