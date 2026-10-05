import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readProtected,privateDirectory,checkedPath} from './protected-store.mjs';

// Owner-only UNIX socket. This command cannot initialize a broker or implement
// renewal: the resident production GatewayService calls its ordinary models path.
export async function qualify({socket,secretPath}) {
  checkedPath(socket);privateDirectory(path.dirname(socket));
  const stat=fs.lstatSync(socket);
  if(!stat.isSocket()||stat.uid!==process.getuid()||(stat.mode&0o777)!==0o600) throw Error('QUALIFICATION_REJECTED');
  const secret=readProtected(secretPath,256).trim();
  const raw=await new Promise((resolve,reject)=>{
    const request=http.request({socketPath:socket,path:'/qualify',method:'POST',headers:{'X-TrogNet-Admission':secret,'Content-Length':'0'},timeout:110000},response=>{
      const chunks=[];let n=0;
      response.on('data',chunk=>{n+=chunk.length;if(n>16384){request.destroy();reject(Error('QUALIFICATION_REJECTED'));}else chunks.push(chunk);});
      response.on('error',reject);
      response.on('end',()=>response.statusCode===200?resolve(Buffer.concat(chunks).toString('utf8')):reject(Error('QUALIFICATION_REJECTED')));
    });
    request.on('error',reject);request.on('timeout',()=>request.destroy(Error('QUALIFICATION_REJECTED')));request.end();
  });
  const value=JSON.parse(raw);
  const snapshot=s=>{
    if(!s||!['ready','replacement_staged','refreshing','configuration_error','reauth_required','disabled'].includes(s.phase)||!Number.isSafeInteger(s.generation)||s.generation<0||!(s.envelope_sha256===null||/^[a-f0-9]{64}$/.test(s.envelope_sha256))||
      !(s.access_expires_at_ms===null||Number.isSafeInteger(s.access_expires_at_ms))||!([null].includes(s.earliest_refresh_at_ms)||Number.isSafeInteger(s.earliest_refresh_at_ms))||
      !(s.retry_not_before_ms===null||Number.isSafeInteger(s.retry_not_before_ms))) throw Error('QUALIFICATION_REJECTED');
    return {phase:s.phase,generation:s.generation,envelope_sha256:s.envelope_sha256,access_expires_at_ms:s.access_expires_at_ms,
      earliest_refresh_at_ms:s.earliest_refresh_at_ms,retry_not_before_ms:s.retry_not_before_ms};
  };
  if(value.schema!=='trognet-gateway-renewal-check/v1'||!['AUTOMATIC_REFRESH_OBSERVED','NO_REFRESH_OBSERVED','BLOCKED'].includes(value.status)||value.persisted!==true||value.model_catalog_succeeded!==(value.status!=='BLOCKED')||value.inference_requests!==0||!Number.isInteger(value.visible_model_count)||value.visible_model_count<0||value.visible_model_count>256) throw Error('QUALIFICATION_REJECTED');
  return {schema:value.schema,status:value.status,before:snapshot(value.before),after:snapshot(value.after),persisted:true,model_catalog_succeeded:value.model_catalog_succeeded,visible_model_count:value.visible_model_count,inference_requests:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const a=process.argv.slice(2);
    if(a.length!==4||a[0]!=='--socket'||a[2]!=='--secret') throw Error('QUALIFICATION_REJECTED');
    const receipt=await qualify({socket:a[1],secretPath:a[3]});process.stdout.write(JSON.stringify(receipt)+'\n');if(receipt.status==='BLOCKED')process.exitCode=2;
  } catch {process.stderr.write('QUALIFICATION_REJECTED\n');process.exitCode=1;}
}
