import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {readProtected} from '../../self-hosted/protected-store.mjs';
/** Read-only atomic-file observation. No decryption, owner socket or network. */
export function fenceStatus(stateDir) {
  const s=JSON.parse(readProtected(path.join(stateDir,'state.json'))),f=s.requestFence;
  if(s.schema!=='trognet-file-broker/v1'||!f||f.legacy_closed!==true||!Number.isSafeInteger(f.high_water)||f.high_water<0||!Number.isInteger(f.legacy_count)||f.legacy_count<0||f.legacy_count>512||!/^([a-f0-9]{64})$/.test(f.archive_sha256??''))throw Error('FENCE_STATUS_REJECTED');
  return {schema:'trognet-e06-fence-observation/v1',high_water:f.high_water,legacy_closed:true,legacy_count:f.legacy_count,archive_sha256:f.archive_sha256,
    last_gateway_request_sha256:f.high_water?createHash('sha256').update('e06_'+String(f.high_water).padStart(16,'0')).digest('hex'):null,
    inference:'not_established_by_reservation',network_requests:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try{if(process.argv.length!==4||process.argv[2]!=='--state-dir')throw Error();process.stdout.write(JSON.stringify(fenceStatus(process.argv[3]))+'\n');}
  catch{process.stderr.write('FENCE_STATUS_REJECTED\n');process.exitCode=1;}
}
