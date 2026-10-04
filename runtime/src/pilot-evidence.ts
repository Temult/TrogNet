import {AppError} from './types.js';
import {pilotEvidencePayload} from './pilot-evidence-data.js';
import {pilotEvidenceBinding as pin} from './pilot-evidence-binding.js';

export type EvidenceRequest = Record<string,unknown>;
export interface EvidenceRecord {id:string;family:string;operation:string;request:EvidenceRequest;result:unknown;result_sha256:string;projection_status:string;coverage_notes:string[];}
interface Projection {schema:string;projection_status:string;source:Record<string,unknown>;source_sha256:string;max_response_bytes:number;records:EvidenceRecord[];}
const encoder=new TextEncoder();
export const PILOT_MAX_RESPONSE_BYTES=65536;
const operations=new Set(['echoes_get','echoes_data','echoes_dossier','echoes_modifier_trace','echoes_xref','field_note_excerpt']);
function fail(code:string,status=503):never{throw new AppError(code,status);}
/** Canonical JSON object keys; arrays and native values are never rearranged. */
function canonical(value:unknown,depth=0):string {
  if(depth>64) return fail('INVALID_INPUT',400);
  if(value===null || typeof value==='boolean' || typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number' && Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
  if(typeof value==='object' && value && Object.getPrototypeOf(value)===Object.prototype)
    return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as EvidenceRequest)[k],depth+1)).join(',')+'}';
  return fail('INVALID_INPUT',400);
}
async function sha(raw:string):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(raw))),b=>b.toString(16).padStart(2,'0')).join('');}
function budget(maxBytes:number):void{if(!Number.isSafeInteger(maxBytes)||maxBytes<256||maxBytes>PILOT_MAX_RESPONSE_BYTES)fail('EVIDENCE_BUDGET_EXCEEDED',413);}
function bounded<T>(value:T,maxBytes:number):T{budget(maxBytes);if(encoder.encode(JSON.stringify(value)).byteLength>maxBytes)fail('EVIDENCE_BUDGET_EXCEEDED',413);return structuredClone(value);}
/** Offline loader seam for qualification only. Pins cannot be caller overridden. No I/O at runtime. */
export function createPilotEvidenceTransport(load:()=>Promise<string>=async()=>pilotEvidencePayload){
  let verified:Promise<Projection>|undefined;
  async function verify():Promise<Projection>{
    let raw:string;try{raw=await load();}catch{return fail('EVIDENCE_SOURCE_UNAVAILABLE_AT_BUILD_TIME');}
    if(typeof raw!=='string')return fail('INCOMPATIBLE_EVIDENCE_PROJECTION');
    if(encoder.encode(raw).byteLength>1048576)return fail('EVIDENCE_BUDGET_EXCEEDED',413);
    if(await sha(raw)!==pin.payload_sha256)return fail('INCOMPATIBLE_EVIDENCE_PROJECTION');
    let doc:Projection;try{doc=JSON.parse(raw) as Projection;}catch{return fail('INCOMPATIBLE_EVIDENCE_PROJECTION');}
    if(doc.schema!==pin.schema||doc.source_sha256!==pin.source_sha256||doc.source.snapshot!==pin.snapshot||doc.projection_status!=='BOUND_READ_REPLICA'||doc.records.length!==pin.record_count||doc.max_response_bytes!==PILOT_MAX_RESPONSE_BYTES)return fail('INCOMPATIBLE_EVIDENCE_PROJECTION');
    if(await sha(canonical(doc.source))!==pin.source_sha256)return fail('INCOMPATIBLE_EVIDENCE_PROJECTION');
    const keys=new Set<string>();
    for(const rec of doc.records){
      const key=rec.operation+':'+canonical(rec.request);
      if(keys.has(key)||!operations.has(rec.operation)||rec.projection_status!=='BOUND_READ_REPLICA')return fail('INCOMPATIBLE_EVIDENCE_PROJECTION');
      keys.add(key);
    }
    return doc;
  }
  const document=()=>verified??=verify();
  return {
    async expand(operation:string,request:EvidenceRequest,maxBytes=PILOT_MAX_RESPONSE_BYTES){
      if(!operations.has(operation))return fail('EVIDENCE_OPERATION_UNSUPPORTED',501);
      budget(maxBytes);
      if(!request||Array.isArray(request)||typeof request!=='object')return fail('INVALID_INPUT',400);
      const selector=canonical(request);if(encoder.encode(selector).byteLength>8192)return fail('INVALID_INPUT',400);
      const doc=await document();const rec=doc.records.find(r=>r.operation===operation && canonical(r.request)===selector);
      if(!rec)return fail('EVIDENCE_SELECTOR_NOT_PROJECTED',404);
      return bounded({status:'PROJECTED_EXACT_HIT' as const,source:doc.source,source_sha256:doc.source_sha256,evidence:rec},maxBytes);
    }
  };
}
export const pilotEvidence=createPilotEvidenceTransport();
