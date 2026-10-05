import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {FileProtectedStore,privateDirectory,readProtected} from '../self-hosted/protected-store.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
/** Owner only; service must be stopped. No credential decryption or network. */
export async function archiveAndFence({stateDir,archiveFile}) {
  privateDirectory(path.dirname(archiveFile));
  if(path.resolve(path.dirname(archiveFile))===path.resolve(stateDir))throw Error('ARCHIVE_REJECTED');
  const store=await FileProtectedStore.open(stateDir);
  try {
    let archive;
    try{archive=JSON.stringify(await store.requestArchive());}
    catch(e){if(e.message!=='REQUEST_FENCE_ALREADY_ENABLED')throw e;
      const raw=readProtected(archiveFile,131072);
      const fence=await store.enableRequestFence(sha(raw));
      return {schema:'trognet-e06-fence/v1',status:'ALREADY_ENABLED',...fence,network_requests:0};}
    let fd;
    try{fd=fs.openSync(archiveFile,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);fs.writeFileSync(fd,archive);fs.fsyncSync(fd);}
    catch(e){if(e.code!=='EEXIST')throw e;if(readProtected(archiveFile,131072)!==archive)throw Error('ARCHIVE_REJECTED');}
    finally{if(fd!==undefined)fs.closeSync(fd);}
    const dir=fs.openSync(path.dirname(archiveFile),fs.constants.O_DIRECTORY|fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
    if(readProtected(archiveFile,131072)!==archive)throw Error('ARCHIVE_REJECTED');
    const fence=await store.enableRequestFence(sha(archive));
    return {schema:'trognet-e06-fence/v1',status:'ENABLED',...fence,network_requests:0};
  } finally{await store.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const a=process.argv.slice(2);
    if(a.length!==5||a[0]!=='--permanently-close-legacy-ids'||a[1]!=='--state-dir'||a[3]!=='--archive-file')throw Error();
    process.stdout.write(JSON.stringify(await archiveAndFence({stateDir:a[2],archiveFile:a[4]}))+'\n');
  } catch{process.stderr.write('ARCHIVE_REJECTED\n');process.exitCode=1;}
}
