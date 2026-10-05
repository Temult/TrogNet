/** Pure owner-bootstrap protocol helpers. No listener, credential file, or network is created here. */
import {AppError} from './types.js';import {object} from './util.js';import {verifyJwt,type JWK} from './auth.js';import {type TokenSet,validateTokens} from './credential-broker.js';
import {normalizeRefreshSchedule} from './refresh-schedule.js';
export const AUTHORIZATION_ENDPOINT='https://auth.openai.com/api/accounts/authorize';
export const TOKEN_ENDPOINT='https://auth.openai.com/api/accounts/oauth/token';
export const RESOURCE='https://api.openai.com/v1';
const SCOPES=['openid','profile','email','offline_access','resource.invoke','chatgpt.tokens.use.direct'];
function b64url(data:Uint8Array):string{return btoa(String.fromCharCode(...data)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
const random=()=>b64url(crypto.getRandomValues(new Uint8Array(32)));
export function validHostId(host:string):boolean{return /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(host)||/^urn:ietf:params:oauth:jwk-thumbprint:[A-Za-z0-9:_-]+$/.test(host)||/^did:key:[A-Za-z0-9]+$/.test(host);}
export interface OAuthAttempt {state:string;nonce:string;verifier:string;redirect_uri:string;host_id:string;issued_client_id?:string;resolved_client_id?:string;created_ms:number;consumed:boolean;}
export async function prepareAuthorization(port:number,host:string,issuedClientId?:string,now=Date.now()):Promise<{attempt:OAuthAttempt;authorization_url:string}> {
 if(!Number.isInteger(port)||port<1024||port>65535||!validHostId(host)||issuedClientId==='dynamic_agent_client')throw new AppError('BOOTSTRAP_CONFIGURATION');
 const attempt:OAuthAttempt={state:random(),nonce:random(),verifier:random(),redirect_uri:`http://127.0.0.1:${port}/auth/callback`,host_id:host,created_ms:now,consumed:false,...(issuedClientId?{issued_client_id:issuedClientId}:{})};
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(attempt.verifier));
 const url=new URL(AUTHORIZATION_ENDPOINT);url.search=new URLSearchParams({client_id:issuedClientId??'dynamic_agent_client',ext_agent_host_id:host,response_type:'code',redirect_uri:attempt.redirect_uri,scope:SCOPES.join(' '),resource:RESOURCE,state:attempt.state,nonce:attempt.nonce,code_challenge_method:'S256',code_challenge:b64url(new Uint8Array(digest)),...(!issuedClientId?{agent_name_hint:'Echoes Librarian'}:{})}).toString();
 return {attempt,authorization_url:url.href};
}
export function consumeCallback(rawUrl:string,attempt:OAuthAttempt,now=Date.now()):{client_id:string;form:URLSearchParams} {
 const url=new URL(rawUrl),expected=new URL(attempt.redirect_uri);
 const one=(key:string)=>{const values=url.searchParams.getAll(key);if(values.length>1)throw new AppError('OAUTH_CALLBACK_REJECTED');return values[0];};
 if(attempt.consumed||now-attempt.created_ms>600000||now<attempt.created_ms||url.origin!==expected.origin||url.pathname!==expected.pathname||url.hash||one('state')!==attempt.state)throw new AppError('OAUTH_CALLBACK_REJECTED');
 attempt.consumed=true;
 if(one('error'))throw new AppError('OAUTH_DECLINED');
 const code=one('code'),client=one('client_id')??attempt.issued_client_id;
 if(!code||code.length>16384||!client||client==='dynamic_agent_client'||client.length>512||(attempt.issued_client_id&&client!==attempt.issued_client_id))throw new AppError('OAUTH_CALLBACK_REJECTED');
 attempt.resolved_client_id=client;
 return {client_id:client,form:new URLSearchParams({grant_type:'authorization_code',client_id:client,code,code_verifier:attempt.verifier,redirect_uri:attempt.redirect_uri,resource:RESOURCE})};
}
export async function validateGrant(raw:unknown,attempt:OAuthAttempt,client:string,keys:JWK[],now=Date.now(),expectedSubject?:string):Promise<TokenSet> {
 const response=object(raw);
 if(!attempt.consumed||attempt.resolved_client_id!==client||typeof response.id_token!=='string'||typeof response.scope!=='string'||response.expires_in!==3600||String(response.token_type).toLowerCase()!=='bearer')throw new AppError('OAUTH_GRANT_REJECTED');
 const identity=await verifyJwt(response.id_token,keys,'https://auth.openai.com',client,Math.floor(now/1000),attempt.nonce);
 if((identity.azp!==undefined&&identity.azp!==client)||(Array.isArray(identity.aud)&&identity.aud.length>1&&identity.azp!==client))throw new AppError('OAUTH_GRANT_REJECTED');
 if(expectedSubject&&identity.sub!==expectedSubject)throw new AppError('OAUTH_IDENTITY_CHANGED');
 const scopes=response.scope.split(/\s+/);if(SCOPES.some(s=>!scopes.includes(s)))throw new AppError('OAUTH_SCOPE_REJECTED');
 const tokens:TokenSet={client_id:client,subject:String(identity.sub),issuer:'https://auth.openai.com',ext_agent_host_id:attempt.host_id,access_token:(response.access_token as string),refresh_token:(response.refresh_token as string),scopes,expires_at_ms:now+response.expires_in*1000,refresh_expires_at_ms:now+30*86400000};
 const schedule=normalizeRefreshSchedule(response,tokens.expires_at_ms);
 if(schedule!==undefined)tokens.earliest_refresh_at_ms=schedule;
 validateTokens(tokens,attempt.host_id);return tokens;
}
