/** First enrollment learns identity only from a verified grant; pending IDs are not identities. */
import {prepareAuthorization,consumeCallback,validateGrant,type OAuthAttempt,validHostId} from './oauth-protocol.js';
import {type JWK} from './auth.js';
import {AppError} from './types.js';
import {object} from './util.js';
export interface Registration {schema:'trognet-oss-registration/v2';host_id:string;client_id?:string;issuer?:string;subject?:string;workspace_binding:'ISSUED_CLIENT_PROVIDER_BOUND';}
export interface PendingRegistration {schema:'trognet-oss-pending/v2';host_id:string;client_id:string;}
const issued=(s:unknown):s is string=>typeof s==='string'&&/^oaiapp_[A-Za-z0-9_-]{1,480}$/.test(s);
export function registration(host:string,saved?:Registration,pending?:PendingRegistration):Registration {
 if(!validHostId(host))throw new AppError('REGISTRATION_CONFIGURATION');
 if(saved&&(saved.schema!=='trognet-oss-registration/v2'||saved.host_id!==host||saved.workspace_binding!=='ISSUED_CLIENT_PROVIDER_BOUND'||!issued(saved.client_id)||saved.issuer!=='https://auth.openai.com'||typeof saved.subject!=='string'||!saved.subject))throw new AppError('REGISTRATION_IDENTITY_CHANGED');
 if(pending&&(pending.schema!=='trognet-oss-pending/v2'||pending.host_id!==host||!issued(pending.client_id)||(saved&&pending.client_id!==saved.client_id)||Object.keys(pending).some(k=>!['schema','host_id','client_id'].includes(k))))throw new AppError('PENDING_REGISTRATION_CHANGED');
 return saved??{schema:'trognet-oss-registration/v2',host_id:host,workspace_binding:'ISSUED_CLIENT_PROVIDER_BOUND',...(pending?{client_id:pending.client_id}:{})};
}
export async function prepareOSS(r:Registration,port=1455,now=Date.now(),idTokenHint?:string) {
 if(!validHostId(r.host_id)||r.schema!=='trognet-oss-registration/v2'||(r.client_id!==undefined&&!issued(r.client_id)))throw new AppError('REGISTRATION_CONFIGURATION');
 const p=await prepareAuthorization(port,r.host_id,r.client_id,now),u=new URL(p.authorization_url);
 if(!r.client_id)u.searchParams.set('agent_name_hint','TrogNet');
 if(idTokenHint!==undefined){if(!r.client_id||!r.subject||r.issuer!=='https://auth.openai.com'||!idTokenHint||idTokenHint.length>16384)throw new AppError('HINT_IDENTITY_REQUIRED');u.searchParams.set('id_token_hint',idTokenHint);}
 return {...p,authorization_url:u.href};
}
export function redactAuthorization(url:string):string {const u=new URL(url);for(const key of ['id_token_hint','login_hint','code','state','nonce','code_challenge'])if(u.searchParams.has(key))u.searchParams.set(key,'REDACTED');return u.href;}
export function consumeOSS(url:string,a:OAuthAttempt,r:Registration,now=Date.now()) {
 if(a.host_id!==r.host_id||a.issued_client_id!==r.client_id)throw new AppError('REGISTRATION_IDENTITY_CHANGED');
 const host=new URL(url).searchParams.getAll('ext_agent_host_id');
 if(host.length>1||(host.length===1&&host[0]!==r.host_id))throw new AppError('REGISTRATION_HOST_CHANGED');
 const grant=consumeCallback(url,a,now);
 if(!issued(grant.client_id)||(r.client_id&&grant.client_id!==r.client_id))throw new AppError('REGISTRATION_CLIENT_CHANGED');
 return grant;
}
export async function validateOSS(raw:unknown,a:OAuthAttempt,r:Registration,client:string,keys:JWK[],now=Date.now()) {
 if(a.host_id!==r.host_id||!issued(client)||(r.client_id&&client!==r.client_id))throw new AppError('REGISTRATION_IDENTITY_CHANGED');
 const tokens=await validateGrant(raw,a,client,keys,now,r.subject);
 // The issued registration is provider-bound to its user/workspace. Opaque metadata
 // is not interpreted; neither email nor subject is used as a workspace identifier.
 return {...tokens,id_token:String(object(raw).id_token)};
}
