import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

export const STATE_LIMIT = 262144;
const fail = () => { throw Error('PROTECTED_STORE_REJECTED'); };
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const keys = (x, allowed) => plain(x) && Object.keys(x).every(k => allowed.includes(k));
const uint = n => Number.isSafeInteger(n) && n >= 0;
const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);

// Ancestors must not be replaceable by another unprivileged user. A root-owned
// sticky temporary directory is allowed for isolated fixtures, never as the leaf.
export function checkedPath(name) {
  if(process.platform !== 'linux' || !path.isAbsolute(name) || name.includes('\0') || name.split('/').some(p => p === '..' || p === '.')) fail();
  const absolute = path.resolve(name);
  let current = '/';
  for(const part of absolute.split('/').filter(Boolean).slice(0,-1)) {
    current = path.join(current, part);
    const st = fs.lstatSync(current);
    if(!st.isDirectory() || st.isSymbolicLink() || ![0,process.getuid()].includes(st.uid) ||
       ((st.mode & 0o022) && !(st.uid === 0 && (st.mode & 0o1000)))) fail();
  }
  return absolute;
}
export function privateDirectory(name) {
  checkedPath(name);
  const st = fs.lstatSync(name);
  if(!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid() || (st.mode & 0o777) !== 0o700) fail();
}
function checkFile(st, max) {
  if(!st.isFile() || st.uid !== process.getuid() || (st.mode & 0o777) !== 0o600 || st.nlink !== 1 || st.size > max) fail();
}
export function readProtected(name, max = STATE_LIMIT) {
  let fd;
  try {
    checkedPath(name); privateDirectory(path.dirname(name));
    fd = fs.openSync(name, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    checkFile(fs.fstatSync(fd), max);
    const b = Buffer.alloc(max+1); let n=0, count;
    while(n <= max && (count=fs.readSync(fd,b,n,b.length-n,null))) n+=count;
    if(n > max) fail();
    return new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(0,n));
  } catch { fail(); } finally { if(fd !== undefined) fs.closeSync(fd); }
}
export function validRecord(r) {
  if(!keys(r,['phase','generation','sealed','retry_not_before_ms','qualification']) ||
    !['ready','refreshing','replacement_staged','reauth_required','disabled','configuration_error'].includes(r.phase) || !uint(r.generation)) return false;
  if(r.retry_not_before_ms !== undefined && !uint(r.retry_not_before_ms)) return false;
  if(r.qualification !== undefined && (!keys(r.qualification,['identity','epoch','digest']) || typeof r.qualification.identity !== 'string' || r.qualification.identity.length > 512 || !uint(r.qualification.epoch) || !digest(r.qualification.digest))) return false;
  if(r.phase === 'reauth_required') return r.sealed === undefined;
  const e=r.sealed;
  return keys(e,['schema','iv','ciphertext']) && e.schema === 'librarian-token-envelope/v1' &&
    typeof e.iv === 'string' && /^[A-Za-z0-9+/]{16}$/.test(e.iv) && typeof e.ciphertext === 'string' &&
    e.ciphertext.length >= 24 && e.ciphertext.length <= 131072 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(e.ciphertext);
}
function validState(s) {
  if(!keys(s,['schema','session','migration','requests','requestFence']) || s.schema !== 'trognet-file-broker/v1' || (s.session !== undefined && !validRecord(s.session))) return false;
  if(s.requestFence !== undefined) {
    const f=s.requestFence;
    if(!keys(f,['high_water','legacy_closed','archive_sha256','legacy_count','legacy_hashes']) || !uint(f.high_water) || f.legacy_closed!==true ||
       !digest(f.archive_sha256) || !uint(f.legacy_count) || f.legacy_count>512 || s.requests?.length!==0 ||
       !Array.isArray(f.legacy_hashes) || f.legacy_hashes.length!==f.legacy_count || !f.legacy_hashes.every(digest) || new Set(f.legacy_hashes).size!==f.legacy_count) return false;
  }
  if(s.migration !== undefined) {
    const m=s.migration;
    if(!keys(m,['source_sha256','host_sha256','tokens_sha256','access_expires_at_ms','earliest_refresh_at_ms']) ||
      !digest(m.source_sha256) || !digest(m.host_sha256) || !digest(m.tokens_sha256) || !uint(m.access_expires_at_ms) ||
      (m.earliest_refresh_at_ms !== null && !uint(m.earliest_refresh_at_ms)) || !s.session) return false;
  }
  if(!Array.isArray(s.requests) || s.requests.length > 512) return false;
  const seen=new Set();
  return s.requests.every(r => keys(r,['id','at_ms']) && digest(r.id) && uint(r.at_ms) && !seen.has(r.id) && !!seen.add(r.id));
}

/** Linux only. The kernel releases flock after crashes; lock files are never
 * unlinked. All callers (service and offline migration) acquire the same lock. */
export class FileProtectedStore {
  #dir; #lock; #closed=false; #poisoned=false; #fault;
  constructor(dir, lock, fault) { this.#dir=dir; this.#lock=lock; this.#fault=fault; }
  static async open(dir, {fault=()=>{}}={}) {
    let child;
    try {
      privateDirectory(dir);
      for(const name of fs.readdirSync(dir)) {
        if(!['state.json','writer.lock','.state.tmp'].includes(name)) fail();
        readProtected(path.join(dir,name));
      }
      const lockPath=path.join(dir,'writer.lock');
      try { const fd=fs.openSync(lockPath,'wx',0o600); fs.fsyncSync(fd); fs.closeSync(fd); }
      catch(e) { if(e.code !== 'EEXIST') throw e; }
      readProtected(lockPath,0);
      // Allow a just-crashed parent's pipe holder to observe EOF and release.
      // A live writer still causes a bounded startup refusal, never lock theft.
      child=spawn('/usr/bin/flock',['--exclusive','--timeout','2','--no-fork',lockPath,process.execPath,fileURLToPath(new URL('./writer-lock.mjs',import.meta.url))],{stdio:['pipe','pipe','ignore']});
      await new Promise((resolve,reject) => {
        const timer=setTimeout(()=>reject(Error('LOCK_TIMEOUT')),5000);
        child.once('error',()=>{clearTimeout(timer);reject(Error('LOCK_FAILED'));});
        child.once('exit',()=>{clearTimeout(timer);reject(Error('LOCK_FAILED'));});
        child.stdout.once('data',b=>{clearTimeout(timer);b.toString()==='LOCKED\n'?resolve():reject(Error('LOCK_FAILED'));});
      });
      const store=new FileProtectedStore(dir,child,fault);
      child.once('exit',()=>{store.#poisoned=true;});
      // A pre-rename temp file was never authoritative. Do not promote it.
      if(fs.existsSync(path.join(dir,'.state.tmp'))) { readProtected(path.join(dir,'.state.tmp')); fs.unlinkSync(path.join(dir,'.state.tmp')); store.#syncDirectory(); }
      store.#read();
      return store;
    } catch { child?.stdin.destroy(); child?.kill(); fail(); }
  }
  #check() { if(this.#closed || this.#poisoned || this.#lock.exitCode !== null) fail(); privateDirectory(this.#dir); }
  #read() {
    this.#check();
    for(const name of fs.readdirSync(this.#dir)) if(!['state.json','writer.lock'].includes(name)) fail();
    if(!fs.existsSync(path.join(this.#dir,'state.json'))) {
      // existsSync follows links, so lstat distinguishes a dangling link.
      try { fs.lstatSync(path.join(this.#dir,'state.json')); fail(); } catch(e) { if(e.code !== 'ENOENT') throw e; }
      return {schema:'trognet-file-broker/v1',requests:[]};
    }
    const s=JSON.parse(readProtected(path.join(this.#dir,'state.json')));
    if(!validState(s)) fail();
    return s;
  }
  #syncDirectory() { const fd=fs.openSync(this.#dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
  #write(s) {
    this.#check(); if(!validState(s)) fail();
    const raw=JSON.stringify(s); if(Buffer.byteLength(raw)>STATE_LIMIT) fail();
    const temporary=path.join(this.#dir,'.state.tmp'); let fd;
    try {
      fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
      fs.writeFileSync(fd,raw); this.#fault('before_file_sync'); fs.fsyncSync(fd); this.#fault('after_file_sync');
      fs.closeSync(fd); fd=undefined;
      fs.renameSync(temporary,path.join(this.#dir,'state.json')); this.#fault('after_rename');
      this.#syncDirectory(); this.#fault('after_directory_sync');
    } catch { this.#poisoned=true; fail(); } finally { if(fd!==undefined) fs.closeSync(fd); }
  }
  async get(key) { try { if(key !== 'session') fail(); return this.#read().session; } catch { fail(); } }
  async put(key,value) { try { if(key !== 'session') fail(); const s=this.#read(); s.session=structuredClone(value); this.#write(s); } catch { fail(); } }
  async migration() { try { return this.#read().migration; } catch { fail(); } }
  async initializeMigration(record,identity) {
    try { const s=this.#read(); if(s.session || s.migration) fail(); s.session=record; s.migration=identity; this.#write(s); } catch { fail(); }
  }
  async reserveRequest(id,now) {
    try {
      const s=this.#read();
      if(s.requestFence) throw Error('REQUEST_ALREADY_SEEN');
      // Durable tombstones have no automatic expiry: E06 must reconcile and
      // archive them offline. A full bounded ledger fails closed, never evicts.
      if(s.requests.some(r=>r.id===id)) throw Error('REQUEST_ALREADY_SEEN');
      if(s.requests.length>=512) throw Error('REQUEST_LEDGER_FULL');
      s.requests.push({id,at_ms:now}); this.#write(s);
    } catch(e) { if(['REQUEST_ALREADY_SEEN','REQUEST_LEDGER_FULL'].includes(e.message)) throw e; fail(); }
  }
  async requestArchive() {
    const s=this.#read();
    if(s.requestFence) throw Error('REQUEST_FENCE_ALREADY_ENABLED');
    return {schema:'trognet-request-archive/v1',requests:structuredClone(s.requests)};
  }
  async enableRequestFence(archiveSha256) {
    const s=this.#read();
    if(s.requestFence) {
      if(s.requestFence.archive_sha256!==archiveSha256) fail();
      return structuredClone(s.requestFence);
    }
    const archive=JSON.stringify(await this.requestArchive());
    if(createHash('sha256').update(archive).digest('hex')!==archiveSha256) fail();
    s.requestFence={high_water:0,legacy_closed:true,archive_sha256:archiveSha256,legacy_count:s.requests.length,legacy_hashes:s.requests.map(r=>r.id)};
    s.requests=[];
    this.#write(s);
    return structuredClone(s.requestFence);
  }
  async reserveGatewayRequest(requestId,now) {
    const s=this.#read();
    if(!s.requestFence) {
      if(requestId.startsWith('e06_')) throw Error('REQUEST_FENCE_REQUIRED');
      return this.reserveRequest(createHash('sha256').update(requestId).digest('hex'),now);
    }
    if(!/^e06_[0-9]{16}$/.test(requestId)) throw Error('REQUEST_ALREADY_SEEN');
    if(s.requestFence.legacy_hashes.includes(createHash('sha256').update(requestId).digest('hex'))) throw Error('REQUEST_ALREADY_SEEN');
    const sequence=Number(requestId.slice(4));
    if(!Number.isSafeInteger(sequence) || sequence<=s.requestFence.high_water) throw Error('REQUEST_ALREADY_SEEN');
    // A durable prefix tombstone: all lower sequences stay consumed forever.
    s.requestFence.high_water=sequence;
    this.#write(s);
  }
  async close() {
    if(this.#closed) return; this.#closed=true;
    if(this.#lock.exitCode!==null) return;
    await new Promise(resolve=>{this.#lock.once('exit',resolve);this.#lock.stdin.end();});
  }
}
