import {AppError} from './types.js';
export const utf8 = new TextEncoder();
export const hex = (b: ArrayBuffer): string => Array.from(new Uint8Array(b), v => v.toString(16).padStart(2,'0')).join('');
export async function sha256(text: string): Promise<string> { return hex(await crypto.subtle.digest('SHA-256', utf8.encode(text))); }
export async function hmac(key: string, value: string): Promise<string> {
  if (key.length < 32) throw new AppError('CONFIGURATION',503);
  const k = await crypto.subtle.importKey('raw',utf8.encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',k,utf8.encode(value)));
}
export const id = (): string => crypto.randomUUID();
export function isId(s: unknown): s is string {return typeof s==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);}
export function object(v: unknown): Record<string,unknown> { if(!v || typeof v!=='object' || Array.isArray(v)) throw new AppError('INVALID_INPUT'); return v as Record<string,unknown>; }
export function exactKeys(o: Record<string,unknown>, keys: string[]): void {if(Object.keys(o).some(k=>!keys.includes(k))) throw new AppError('INVALID_INPUT');}
export async function boundedText(body: ReadableStream<Uint8Array>|null, limit: number): Promise<string> {
  if (!body) return '';
  const reader=body.getReader(), decoder=new TextDecoder('utf-8',{fatal:true}); let size=0, result='';
  try { for (;;) {const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>limit) throw new AppError('TOO_LARGE',413); result+=decoder.decode(value,{stream:true});} return result+decoder.decode(); }
  catch(e) {await reader.cancel().catch(()=>{}); throw e;} finally {reader.releaseLock();}
}
export function publicHeaders(extra: Record<string,string>={}): Headers {
  return new Headers({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'Permissions-Policy':'camera=(), microphone=(), geolocation=()', ...extra});
}
export function json(v:unknown,status=200):Response{return new Response(JSON.stringify(v),{status,headers:publicHeaders({'Content-Type':'application/json; charset=utf-8'})});}
export function safePublicText(s:string):boolean {
  // Defense in depth, not a secrecy proof. Credentials/internal data are never put in model context.
  return !/(?:\b(?:OpenAI|ChatGPT|Cloudflare|Somner)\b|\bgpt-\d|\bcodex\s+(?:cli|app-server)\b|https?:\/\/|www\.|\b(?:access_token|refresh_token|client_secret)\b|\bBearer\s|\bsk-[A-Za-z0-9]{8}|[A-Za-z]:\\|\/mnt\/|<\/?(?:script|iframe|svg))/i.test(s);
}

/** Obvious accidental credentials are rejected before ledger admission, not logged and redacted later. */
export function containsObviousCredential(s:string):boolean {
  return /(?:\bsk-[A-Za-z0-9_-]{16,}|\bBearer\s+[A-Za-z0-9._~-]{16,}|\b(?:access_token|refresh_token|client_secret)\s*[:=]\s*["']?[A-Za-z0-9._~-]{8,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i.test(s);
}
