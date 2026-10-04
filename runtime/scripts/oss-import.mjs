/** Temporary owner aperture client. Never authorizes, refreshes, probes or deploys. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {requirePublication} from './oss-bootstrap.mjs';
import {checkPlanContract} from '../dist/plan-contract.js';
import {boundedText,sha256} from '../dist/util.js';
export async function importSealed(config,receipt,raw,fetcher=fetch){
 requirePublication(receipt,config.OSS_SOURCE_SHA256);checkPlanContract(config);
 if(!/^oaiapp_[A-Za-z0-9_-]+$/.test(config.PLAN_CLIENT_ID)||Buffer.byteLength(raw)>131072)throw Error('IMPORT_CONFIGURATION');
 const envelope=JSON.parse(raw);if(envelope.schema==='trognet-owner-enrollment/v2'){if(!envelope.bundle)throw Error('NO_PENDING_TRANSFER');raw=JSON.stringify(envelope.bundle);}
 if(Buffer.byteLength(raw)>65536)throw Error('IMPORT_CONFIGURATION');
 const origin=new URL(config.import_origin);
 if(origin.protocol!=='https:'||origin.href!==origin.origin+'/'||origin.username||origin.password)throw Error('IMPORT_CONFIGURATION');
 const secret=process.env.TROGNET_IMPORT_SECRET,jwt=process.env.TROGNET_ACCESS_JWT;
 if(!secret||secret.length<32||!jwt)throw Error('OWNER_ACCESS_REQUIRED');
 const response=await fetcher(origin.origin+'/owner-import',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',Origin:origin.origin,'Cf-Access-Jwt-Assertion':jwt,'cf-access-token':jwt,'X-TrogNet-Import':secret},body:raw});
 if(!response.ok)throw Error('IMPORT_REJECTED_OR_UNCERTAIN');
 const r=JSON.parse(await boundedText(response.body,8192));
 if(!['IMPORTED','ALREADY_IMPORTED'].includes(r.status)||r.epoch!==Number(config.BROKER_SESSION_EPOCH)||r.digest!==await sha256(raw))throw Error('IMPORT_REJECTED_OR_UNCERTAIN');
 return {status:r.status,epoch:r.epoch,digest:r.digest};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [configFile,receiptFile,bundleFile]=process.argv.slice(2);
 Promise.resolve().then(()=>importSealed(JSON.parse(fs.readFileSync(configFile,'utf8')),JSON.parse(fs.readFileSync(receiptFile,'utf8')),fs.readFileSync(bundleFile,'utf8'))).then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('IMPORT_STOPPED: inspect broker status before any exact replay.');process.exitCode=1;});
}
