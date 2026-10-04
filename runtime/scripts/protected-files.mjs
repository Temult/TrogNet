import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
export function privateDirectory(dir){
 const st=fs.lstatSync(dir);if(!st.isDirectory()||st.isSymbolicLink())throw Error('PRIVATE_DIRECTORY_REQUIRED');
 if(process.platform==='win32'){
  const literal=path.resolve(dir).replaceAll("'","''");
  const ps=`$a=[System.IO.Directory]::GetAccessControl('${literal}'); $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; if(-not $a.AreAccessRulesProtected){exit 1}; foreach($r in $a.Access){$s=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if($r.AccessControlType -eq 'Allow' -and $s -notin @($sid,'S-1-5-18','S-1-5-32-544')){exit 1}}`;
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{stdio:'ignore',windowsHide:true});
 }else if((st.mode&0o077)!==0||st.uid!==process.getuid())throw Error('PRIVATE_DIRECTORY_REQUIRED');
}
export function writeOnce(file,value){privateDirectory(path.dirname(path.resolve(file)));const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,value);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}

export function writeAtomic(file,value){
 const dir=path.dirname(path.resolve(file));privateDirectory(dir);
 if(fs.existsSync(file)&&(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()))throw Error('PRIVATE_FILE_REQUIRED');
 const temporary=path.join(dir,'.enrollment-'+crypto.randomUUID()+'.tmp');
 const fd=fs.openSync(temporary,'wx',0o600);
 try{fs.writeFileSync(fd,value);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 try{fs.renameSync(temporary,file);if(process.platform!=='win32'){const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
