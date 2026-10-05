import http from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {BrokerCore,openToken} from '../dist/credential-broker.js';
import {consumeResponse} from '../dist/sse.js';
import {boundedText} from '../dist/util.js';

export const hash = value => createHash('sha256').update(value).digest('hex');
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x,fields) => plain(x) && Object.keys(x).every(k=>fields.includes(k));
const text = (x,max) => typeof x === 'string' && x.length>0 && Buffer.byteLength(x)<=max;
const error = (code,status=503) => Object.assign(Error(code),{status});
export function secretMatches(expected,actual) {
  if(typeof expected!=='string' || expected.length<32 || expected.length>256 || typeof actual!=='string' || actual.length>256) return false;
  return timingSafeEqual(createHash('sha256').update(expected).digest(),createHash('sha256').update(actual).digest());
}
export function validateRequest(p) {
  if(!exact(p,['model','instructions','input','store','stream']) || !text(p.model,128) || !/^[A-Za-z0-9._-]+$/.test(p.model) ||
     p.store!==false || p.stream!==true || !text(p.instructions,16000) || !Array.isArray(p.input) || p.input.length<1 || p.input.length>13 ||
     p.input.some(t=>!exact(t,['role','content']) || !['user','assistant'].includes(t.role) || !text(t.content,12000)) ||
     Buffer.byteLength(JSON.stringify(p))>32768) throw error('REQUEST_REJECTED',400);
  return structuredClone(p);
}
function noSecrets(value,secrets) {
  const raw=JSON.stringify(value);
  if(secrets.some(s=>s && (raw.includes(s)||raw.includes(JSON.stringify(s).slice(1,-1)))) || /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(raw)) throw error('PROVIDER_OUTPUT_REJECTED',502);
  return value;
}
async function deadline(task,ms) {
  const controller=new AbortController(); let timer;
  try {
    return await Promise.race([task(controller.signal),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(error('PROVIDER_UNCERTAIN',502));},ms);})]);
  } finally {clearTimeout(timer);controller.abort();}
}
async function providerDiagnostic(response,secrets) {
  const codes=['subscription_sharing_user_not_eligible','subscription_sharing_usage_limit_exceeded','subscription_sharing_usage_unavailable',
    'subscription_sharing_unsupported_capability','subscription_sharing_route_not_supported','subscription_sharing_invalid_user',
    'chatpass_v2_scope_not_authorized','chatpass_v2_invalid_authorization_context','subscription_sharing_user_unavailable'];
  let body_shape='unreadable',code=null,param=null;
  try {
    const b=JSON.parse(await boundedText(response.body,32768));
    body_shape=plain(b?.error)?'error_object':plain(b)&&'detail'in b?'detail':'other';
    if(codes.includes(b?.error?.code))code=b.error.code;
    if(['model','input','instructions','store','stream'].includes(b?.error?.param))param=b.error.param;
  } catch { /* Preserve only the fact that a bounded body was unreadable. */ }
  const rid=response.headers.get('x-request-id');
  const d={http_status:response.status,body_shape,code,param,request_id:rid&&/^[A-Za-z0-9_-]{1,128}$/.test(rid)?rid:null};
  try {return noSecrets(d,secrets);} catch {return {http_status:response.status,body_shape:'redacted',code:null,param:null,request_id:null};}
}
/** This is the only service that owns BrokerCore. The owner hook calls models()
 * through this same object. No scheduling loop, token export, or retry wrapper. */
export class GatewayService {
  #store; #key; #host; #fetch; #now; #core; #tail=Promise.resolve(); #timeout;
  constructor({store,key,host,fetcher=fetch,now=Date.now,timeoutMs=90000}) {
    this.#store=store;this.#key=key;this.#host=host;this.#fetch=fetcher;this.#now=now;this.#timeout=timeoutMs;
    this.#core=new BrokerCore(store,key,host,fetcher,now,['openid','profile','email','offline_access','resource.invoke','chatgpt.tokens.use.direct']);
  }
  #exclusive(fn) { const p=this.#tail.then(fn,fn);this.#tail=p.catch(()=>{});return p; }
  async #snapshot() {
    const r=await this.#store.get('session'); if(!r) throw error('GATEWAY_NOT_READY');
    const t=r.sealed?await openToken(r.sealed,this.#key,this.#host):undefined;
    return {record:r,tokens:t,safe:{phase:r.phase,generation:r.generation,envelope_sha256:r.sealed?hash(JSON.stringify(r.sealed)):null,
      access_expires_at_ms:t?.expires_at_ms??null,earliest_refresh_at_ms:t?.earliest_refresh_at_ms??null,retry_not_before_ms:r.retry_not_before_ms??null}};
  }
  async ready() {
    try {const s=await this.#snapshot();return ['ready','replacement_staged'].includes(s.safe.phase) && !Object.hasOwn(s.tokens??{},'unqualified_refresh_schedule') && (s.safe.retry_not_before_ms??0)<=this.#now();} catch {return false;}
  }
  async #token() {
    const before=await this.#snapshot();
    if(Object.hasOwn(before.tokens??{},'unqualified_refresh_schedule'))throw error('GATEWAY_NOT_READY');
    const token=await this.#core.getToken(),after=await this.#snapshot();
    const secrets=[this.#key,...[before.tokens,after.tokens].flatMap(t=>t?[t.access_token,t.refresh_token,t.id_token].filter(Boolean):[])];
    return {before,after,token,secrets};
  }
  async #catalog(token,secrets,signal) {
    const r=await this.#fetch('https://api.openai.com/v1/models',{method:'GET',redirect:'error',signal,headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
    if(!r.ok) {const e=error('MODEL_CATALOG_UNAVAILABLE',502);e.diagnostic=await providerDiagnostic(r,secrets);throw e;}
    let b;try {b=JSON.parse(await boundedText(r.body,262144));} catch {throw error('MODEL_CATALOG_UNAVAILABLE',502);}
    if(!plain(b)||!Array.isArray(b.models)||b.models.length>256) throw error('MODEL_CATALOG_UNAVAILABLE',502);
    const models=b.models.filter(m=>plain(m)&&m.visibility==='list').map(m=>{
      if(!text(m.slug,128)||!/^[A-Za-z0-9._-]+$/.test(m.slug)||!text(m.display_name,256)||/[\u0000-\u001f\u007f]/.test(m.display_name)) throw error('MODEL_CATALOG_UNAVAILABLE',502);
      return {slug:m.slug,display_name:m.display_name};
    });
    if(new Set(models.map(m=>m.slug)).size!==models.length) throw error('MODEL_CATALOG_UNAVAILABLE',502);
    return noSecrets(models,secrets);
  }
  async #models() {const t=await this.#token();return {models:await deadline(signal=>this.#catalog(t.token,t.secrets,signal),this.#timeout),...t};}
  models() { return this.#exclusive(async()=>({models:(await this.#models()).models})); }
  responses(payload,requestId) {
    return this.#exclusive(async()=>{
      const p=validateRequest(payload);
      if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{16,96}$/.test(requestId)) throw error('REQUEST_ID_REQUIRED',400);
      try {await this.#store.reserveRequest(hash(requestId),this.#now());} catch(e) {
        throw error(e.message==='REQUEST_ALREADY_SEEN'?'REQUEST_ALREADY_SEEN':'REQUEST_LEDGER_UNAVAILABLE',409);
      }
      let dispatched=false;
      try {
        const t=await this.#token();
        return await deadline(async signal=>{
          const models=await this.#catalog(t.token,t.secrets,signal);
          if(!models.some(m=>m.slug===p.model)) throw error('MODEL_NOT_VISIBLE',400);
          dispatched=true;
          const r=await this.#fetch('https://api.openai.com/v1/responses',{method:'POST',redirect:'error',signal,
            headers:{Authorization:'Bearer '+t.token,'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify(p)});
          if(!r.ok) {const e=error('PROVIDER_UNCERTAIN',502);e.diagnostic=await providerDiagnostic(r,t.secrets);throw e;}
          const contentType=r.headers.get('content-type');
          if(!r.body || (contentType && !/^text\/event-stream(?:;|$)/i.test(contentType))) {await r.body?.cancel();throw error('PROVIDER_UNCERTAIN',502);}
          const result=await consumeResponse(r.body);
          // No raw events, IDs, reasoning, headers, or unbounded usage objects.
          return noSecrets({schema:'trognet-gateway-response/v1',status:'completed',text:result.text},t.secrets);
        },this.#timeout);
      } catch(e) {
        if(dispatched) {const failure=error('PROVIDER_UNCERTAIN',502);if(e.diagnostic)failure.diagnostic=e.diagnostic;throw failure;}
        if(e.message==='MODEL_NOT_VISIBLE') throw e;
        const failure=error('GATEWAY_NOT_READY');if(e.diagnostic)failure.diagnostic=e.diagnostic;throw failure;
      }
    });
  }
  qualify() {
    return this.#exclusive(async()=>{
      const before=(await this.#snapshot()).safe;
      let result;
      try {result=await this.#models();} catch {
        const after=(await this.#snapshot()).safe;
        return {schema:'trognet-gateway-renewal-check/v1',status:'BLOCKED',before,after,persisted:true,
          model_catalog_succeeded:false,visible_model_count:0,inference_requests:0};
      }
      // Read the persisted state again, not merely BrokerCore's return value.
      const after=(await this.#snapshot()).safe;
      const rotated=before.phase==='ready' && after.phase==='ready' && after.generation===before.generation+1 && before.envelope_sha256!==after.envelope_sha256;
      return {schema:'trognet-gateway-renewal-check/v1',status:rotated?'AUTOMATIC_REFRESH_OBSERVED':'NO_REFRESH_OBSERVED',before,after,
        persisted:after.envelope_sha256===result.after.safe.envelope_sha256,model_catalog_succeeded:true,visible_model_count:result.models.length,inference_requests:0};
    });
  }
}

function send(res,status,body) {
  const raw=JSON.stringify(body);
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Connection:'close'});
  res.end(raw);
}
async function body(req) {
  if(req.headers['content-type']!=='application/json' || req.headers['content-encoding']!==undefined) throw error('REQUEST_REJECTED',400);
  if(req.headers['content-length']!==undefined && (!/^\d+$/.test(req.headers['content-length']) || Number(req.headers['content-length'])>32768)) throw error('REQUEST_TOO_LARGE',413);
  const chunks=[];let total=0;
  for await(const c of req) {total+=c.length;if(total>32768) throw error('REQUEST_TOO_LARGE',413);chunks.push(c);}
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));} catch {throw error('REQUEST_REJECTED',400);}
}
export function createGatewayServer({service,secret,owner=false}) {
  if(typeof secret!=='string'||!/^[-A-Za-z0-9_]{32,128}$/.test(secret)) throw error('GATEWAY_CONFIGURATION');
  let busy=false;
  const handler=async(req,res)=>{
    let occupied=false;
    try {
      if(!owner && req.method==='GET' && req.url==='/health') {const ready=await service.ready();return send(res,ready?200:503,{ready});}
      // Origin/browser traffic is inadmissible even if it has guessed a header.
      if(req.headers.origin!==undefined || req.headers.cookie!==undefined || !secretMatches(secret,req.headers['x-trognet-admission'])) return send(res,403,{error:'ADMISSION_DENIED'});
      if(busy) return send(res,503,{error:'GATEWAY_BUSY'});
      busy=true;occupied=true;
      if(owner) {
        if(req.method!=='POST'||req.url!=='/qualify'||req.headers['transfer-encoding']||Number(req.headers['content-length']??0)!==0) return send(res,404,{error:'NOT_FOUND'});
        return send(res,200,await service.qualify());
      }
      if(req.method==='GET'&&req.url==='/models') return send(res,200,await service.models());
      if(req.method==='POST'&&req.url==='/responses') {
        const id=req.headers['x-trognet-request-id'];
        if(typeof id!=='string'||!/^[A-Za-z0-9_-]{16,96}$/.test(id)) throw error('REQUEST_ID_REQUIRED',400);
        return send(res,200,await service.responses(await body(req),id));
      }
      send(res,404,{error:'NOT_FOUND'});
    } catch(e) {
      const allowed=['REQUEST_REJECTED','REQUEST_TOO_LARGE','REQUEST_ID_REQUIRED','REQUEST_ALREADY_SEEN','REQUEST_LEDGER_UNAVAILABLE','MODEL_NOT_VISIBLE','PROVIDER_UNCERTAIN'];
      send(res,allowed.includes(e.message)?e.status:503,{error:allowed.includes(e.message)?e.message:'GATEWAY_NOT_READY',...(e.diagnostic?{provider:e.diagnostic}:{})});
    } finally {if(occupied)busy=false;}
  };
  const server=http.createServer({maxHeaderSize:8192,headersTimeout:10000,requestTimeout:15000,keepAliveTimeout:1000,connectionsCheckingInterval:1000},(req,res)=>{void handler(req,res);});
  server.maxHeadersCount=32;server.maxConnections=16;server.maxRequestsPerSocket=1;
  server.setTimeout(110000,socket=>socket.destroy());
  server.on('checkContinue',(_req,res)=>send(res,417,{error:'REQUEST_REJECTED'}));
  server.on('clientError',(_error,socket)=>socket.destroy());
  return server;
}
export async function listenLoopback(server,{host='127.0.0.1',port=19456}={}) {
  if(host!=='127.0.0.1'||!Number.isInteger(port)||port<0||port>65535) throw error('LOOPBACK_REQUIRED');
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  return server.address();
}
