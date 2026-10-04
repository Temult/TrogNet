import {AppError, type Env, type Fetcher, type Principal} from './types.js';
import {boundedText,hmac,object} from './util.js';
export interface JWK extends JsonWebKey {kid?:string;}
export function base64urlDecode(s:string):Uint8Array {
  if(!/^[A-Za-z0-9_-]+$/.test(s)) throw new AppError('AUTH_REQUIRED',401);
  const padded=s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4);
  try {return Uint8Array.from(atob(padded),c=>c.charCodeAt(0));} catch {throw new AppError('AUTH_REQUIRED',401);}
}
export function parseJwt(token:string):{header:Record<string,unknown>;claims:Record<string,unknown>;signed:Uint8Array;signature:Uint8Array} {
  if(token.length>16384)throw new AppError('AUTH_REQUIRED',401);
  const parts=token.split('.'); if(parts.length!==3)throw new AppError('AUTH_REQUIRED',401);
  try {
    const h=object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(base64urlDecode(parts[0]!))));
    const c=object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(base64urlDecode(parts[1]!))));
    if(h.alg!=='RS256'||typeof h.kid!=='string'||h.kid.length>256||h.crit!==undefined||h.jku!==undefined||h.x5u!==undefined||h.jwk!==undefined)throw new Error('header');
    return {header:h,claims:c,signed:new TextEncoder().encode(parts[0]+'.'+parts[1]),signature:base64urlDecode(parts[2]!)};
  }catch{throw new AppError('AUTH_REQUIRED',401);}
}
/** RS256-only verifier. Keys must come from a caller-pinned issuer, never a token URL. */
export async function verifyJwt(token:string,keys:JWK[],issuer:string,audience:string,now=Math.floor(Date.now()/1000),nonce?:string):Promise<Record<string,unknown>> {
  const p=parseJwt(token), c=p.claims;
  const key=keys.find(k=>k.kid===p.header.kid && k.kty==='RSA' && (k.alg===undefined||k.alg==='RS256')&&(k.use===undefined||k.use==='sig'));
  const aud=typeof c.aud==='string'?[c.aud]:c.aud;
  if(!key||c.iss!==issuer||!Array.isArray(aud)||!aud.includes(audience)||typeof c.sub!=='string'||!c.sub||
      typeof c.exp!=='number'||!Number.isFinite(c.exp)||c.exp<=now||
      (c.nbf!==undefined&&(typeof c.nbf!=='number'||!Number.isFinite(c.nbf)||c.nbf>now))||
      (c.iat!==undefined&&(typeof c.iat!=='number'||!Number.isFinite(c.iat)||c.iat>now+30))||
      (nonce!==undefined&&c.nonce!==nonce))throw new AppError('AUTH_REQUIRED',401);
  try {
    const k=await crypto.subtle.importKey('jwk',key,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',k,p.signature,p.signed))throw new Error('signature');
  }catch{throw new AppError('AUTH_REQUIRED',401);}
  return c;
}
const cache=new Map<string,{expires:number;keys:JWK[];pending?:Promise<JWK[]>}>();
async function getKeys(issuer:string,fetcher:Fetcher):Promise<JWK[]> {
  const old=cache.get(issuer); if(old&&old.expires>Date.now())return old.keys;
  if(old?.pending)return old.pending;
  const load=async()=>{
    const response=await fetcher(issuer+'/cdn-cgi/access/certs',{redirect:'manual',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new AppError('AUTH_UNAVAILABLE',503);
    const parsed=object(JSON.parse(await boundedText(response.body,65536)));
    if(!Array.isArray(parsed.keys)||parsed.keys.length>20)throw new AppError('AUTH_UNAVAILABLE',503);
    const keys=parsed.keys as JWK[];
    cache.set(issuer,{expires:Date.now()+600000,keys}); return keys;
  };
  const pending=load().catch(e=>{cache.delete(issuer);throw e;});
  cache.set(issuer,{expires:0,keys:[],pending}); return pending;
}
export async function authenticate(request:Request,env:Env,fetcher:Fetcher=fetch):Promise<Principal> {
  if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER)||!env.ACCESS_AUDIENCE)throw new AppError('CONFIGURATION',503);
  const token=request.headers.get('Cf-Access-Jwt-Assertion');if(!token)throw new AppError('AUTH_REQUIRED',401);
  const claims=await verifyJwt(token,await getKeys(env.ACCESS_ISSUER,fetcher),env.ACCESS_ISSUER,env.ACCESS_AUDIENCE);
  if(typeof claims.email!=='string'||claims.email.length>254)throw new AppError('AUTH_REQUIRED',401);
  const email=claims.email.toLowerCase();
  return {id:await hmac(env.PRINCIPAL_HMAC_KEY,env.ACCESS_ISSUER+'|'+String(claims.sub)),email};
}
export function enforceOrigin(request:Request,origin:string):void {
  const url=new URL(request.url);
  if(url.origin!==origin)throw new AppError('NOT_FOUND',404);
  if(request.method!=='GET'&&request.method!=='HEAD') {
    if(request.headers.get('Origin')!==origin || request.headers.get('Sec-Fetch-Site')==='cross-site')throw new AppError('FORBIDDEN',403);
    if(request.headers.get('Content-Type')?.split(';')[0]?.trim()!=='application/json')throw new AppError('INVALID_INPUT',415);
  }
}
