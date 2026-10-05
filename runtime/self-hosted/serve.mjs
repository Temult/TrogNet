import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {FileProtectedStore,readProtected,privateDirectory} from './protected-store.mjs';
import {readIdentity} from './migrate.mjs';
import {GatewayService,createGatewayServer,listenLoopback} from './gateway.mjs';

export async function start(env=process.env) {
  if(env.OPENAI_API_KEY!==undefined || env.CREDITS_FALLBACK!==undefined || (env.GATEWAY_HOST??'127.0.0.1')!=='127.0.0.1') throw Error('GATEWAY_CONFIGURATION');
  const port=Number(env.GATEWAY_PORT??19456);
  if(!Number.isInteger(port)||port<1024||port>65535) throw Error('GATEWAY_CONFIGURATION');
  const {host,key}=readIdentity({hostPath:env.GATEWAY_HOST_ID_FILE,keyPath:env.GATEWAY_KEY_FILE});
  const secret=readProtected(env.GATEWAY_ADMISSION_FILE,256).trim(),ownerSecret=readProtected(env.GATEWAY_OWNER_FILE,256).trim();
  if(secret===ownerSecret) throw Error('GATEWAY_CONFIGURATION');
  privateDirectory(env.GATEWAY_RUN_DIR);
  const socket=path.join(env.GATEWAY_RUN_DIR,'owner.sock');
  const store=await FileProtectedStore.open(env.GATEWAY_STATE_DIR);
  let publicServer,ownerServer;
  try {
    // Bind and load protected state without dispatching any provider request.
    if(!await store.get('session')) throw Error('GATEWAY_CONFIGURATION');
    const service=new GatewayService({store,key,host});
    publicServer=createGatewayServer({service,secret});
    ownerServer=createGatewayServer({service,secret:ownerSecret,owner:true});
    if(fs.existsSync(socket)) {
      const s=fs.lstatSync(socket);
      if(!s.isSocket()||s.uid!==process.getuid()) throw Error('GATEWAY_CONFIGURATION');
      fs.unlinkSync(socket);
    }
    await new Promise((resolve,reject)=>{ownerServer.once('error',reject);ownerServer.listen(socket,resolve);});
    fs.chmodSync(socket,0o600);
    await listenLoopback(publicServer,{port});
    return {service,close:async()=>{
      await Promise.all([publicServer,ownerServer].map(s=>new Promise(resolve=>{s.close(resolve);s.closeAllConnections();})));
      await store.close();
    }};
  } catch {
    publicServer?.close();ownerServer?.close();await store.close();throw Error('GATEWAY_START_REJECTED');
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  const fatal=()=>{process.stderr.write('GATEWAY_STOPPED\n');process.exit(1);};
  process.on('uncaughtException',fatal);process.on('unhandledRejection',fatal);
  try {
    const app=await start();let stopping=false;
    const stop=()=>{if(stopping)return;stopping=true;void app.close().then(()=>process.exit(0),fatal);};
    process.on('SIGTERM',stop);process.on('SIGINT',stop);
    process.stdout.write('GATEWAY_STARTED\n');
  } catch {fatal();}
}
