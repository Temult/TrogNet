import {pathToFileURL} from 'node:url';
import {openToken,sealToken,validateTokens} from '../dist/credential-broker.js';
import {normalizeRefreshSchedule} from '../dist/refresh-schedule.js';
import {validHostId} from '../dist/oauth-protocol.js';
import {FileProtectedStore,readProtected} from './protected-store.mjs';
import {hash} from './gateway.mjs';

export const REQUIRED_SCOPES=['openid','profile','email','offline_access','resource.invoke','chatgpt.tokens.use.direct'];
const stop=()=>{throw Error('MIGRATION_REJECTED');};
const uint=n=>Number.isSafeInteger(n)&&n>0;
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const tokenDigest=t=>hash(JSON.stringify(canonical(t)));
export function readIdentity({hostPath,keyPath}) {
  const host=readProtected(hostPath,512).trim(),key=readProtected(keyPath,128).trim();
  if(!validHostId(host)||!/^[A-Za-z0-9+/]{43}=$/.test(key)||Buffer.from(key,'base64').length!==32) stop();
  return {host,key};
}
export function validateCurrentTokens(t,host,now) {
  validateTokens(t,host);
  const fields=['client_id','subject','issuer','ext_agent_host_id','workspace_id','id_token','access_token','refresh_token','scopes','expires_at_ms','refresh_expires_at_ms','earliest_refresh_at_ms'];
  if(Object.keys(t).some(k=>!fields.includes(k)) || REQUIRED_SCOPES.some(s=>!t.scopes.includes(s)) ||
    t.scopes.some(s=>typeof s!=='string'||s.length>128) || t.scopes.length>32 ||
    !uint(t.expires_at_ms)||!uint(t.refresh_expires_at_ms)||t.refresh_expires_at_ms<=now || t.refresh_expires_at_ms<=t.expires_at_ms ||
    ['client_id','subject','workspace_id','id_token'].some(k=>t[k]!==undefined&&(typeof t[k]!=='string'||!t[k]||t[k].length>16384)) ||
    !t.access_token.trim() || !t.refresh_token.trim()) stop();
  if(t.earliest_refresh_at_ms!==undefined && (!uint(t.earliest_refresh_at_ms) || t.earliest_refresh_at_ms%1000!==0 ||
    normalizeRefreshSchedule({earliest_refresh_at:t.earliest_refresh_at_ms/1000},t.expires_at_ms)!==t.earliest_refresh_at_ms)) stop();
}
/** Explicit protected source paths only. Never obtains, refreshes, or deletes credentials. */
export async function migrate({sessionPath,hostPath,keyPath,stateDir,expectedAccess,expectedEarliest,verify=false,now=Date.now()}) {
  let store;
  try {
    const {host,key}=readIdentity({hostPath,keyPath});
    const raw=readProtected(sessionPath,196608),legacy=JSON.parse(raw);
    if(!legacy || legacy.schema!=='trognet-self-hosted-vm-session/v1' || legacy.host_id!==host || Object.hasOwn(legacy,'unqualified_refresh_schedule')) stop();
    const tokens=await openToken(legacy.sealed,key,host);
    validateCurrentTokens(tokens,host,now);
    if(legacy.client_id!==tokens.client_id || legacy.subject!==tokens.subject) stop();
    // Both assertions are mandatory for the operator command. They prevent an
    // old but valid transfer/session from silently becoming authoritative.
    if(!uint(expectedAccess)||!uint(expectedEarliest) || tokens.expires_at_ms!==expectedAccess || tokens.earliest_refresh_at_ms!==expectedEarliest) stop();
    const identity={source_sha256:hash(raw),host_sha256:hash(host),tokens_sha256:tokenDigest(tokens),
      access_expires_at_ms:tokens.expires_at_ms,earliest_refresh_at_ms:tokens.earliest_refresh_at_ms??null};
    store=await FileProtectedStore.open(stateDir);
    const old=await store.get('session'),prior=await store.migration();
    let status;
    if(old || prior) {
      if(!old || !prior || JSON.stringify(prior)!==JSON.stringify(identity) || old.phase!=='ready' || old.generation!==0 ||
        tokenDigest(await openToken(old.sealed,key,host))!==identity.tokens_sha256) stop();
      status=verify?'VERIFIED':'ALREADY_MIGRATED';
    } else {
      if(verify) stop();
      await store.initializeMigration({phase:'ready',generation:0,sealed:await sealToken(tokens,key,host)},identity);
      const saved=await store.get('session');
      if(tokenDigest(await openToken(saved.sealed,key,host))!==identity.tokens_sha256) stop();
      status='MIGRATED';
    }
    return {schema:'trognet-session-migration/v1',status,source_sha256:identity.source_sha256,host_sha256:identity.host_sha256,
      access_expires_at_ms:identity.access_expires_at_ms,earliest_refresh_at_ms:identity.earliest_refresh_at_ms,generation:0,
      source_preserved:true,network_requests:0};
  } catch {stop();} finally {await store?.close();}
}
export function argumentsFor(argv) {
  const [command,...args]=argv;
  if(!['migrate','verify'].includes(command)||args.length!==12) stop();
  const map=new Map();
  for(let i=0;i<args.length;i+=2) {if(map.has(args[i]))stop();map.set(args[i],args[i+1]);}
  const names=['--session','--host-id','--key','--state-dir','--expected-access','--expected-earliest'];
  if(names.some(k=>!map.has(k))||[...map.keys()].some(k=>!names.includes(k))||!/^\d+$/.test(map.get('--expected-access'))||!/^\d+$/.test(map.get('--expected-earliest'))) stop();
  return {sessionPath:map.get('--session'),hostPath:map.get('--host-id'),keyPath:map.get('--key'),stateDir:map.get('--state-dir'),
    expectedAccess:Number(map.get('--expected-access')),expectedEarliest:Number(map.get('--expected-earliest')),verify:command==='verify'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {process.stdout.write(JSON.stringify(await migrate(argumentsFor(process.argv.slice(2))))+'\n');}
  catch {process.stderr.write('MIGRATION_REJECTED\n');process.exitCode=1;}
}
