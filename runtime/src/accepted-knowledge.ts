import {AppError, type AcceptedClaim, type AcceptedIndexEntry, type AcceptedKnowledgeDocument} from './types.js';
import {acceptedKnowledgePayload} from './accepted-knowledge-data.js';
import {acceptedKnowledgeBinding as pin} from './accepted-knowledge-binding.js';

export const KNOWLEDGE_MAX_RESPONSE_BYTES = 32768;
const MAX_SOURCE_BYTES = 1048576;
const encoder = new TextEncoder();
function incompatible(): never { throw new AppError('INCOMPATIBLE_KNOWLEDGE_RELEASE', 503); }
function bounded<T>(value:T, maxBytes:number):T {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 256 || maxBytes > KNOWLEDGE_MAX_RESPONSE_BYTES || encoder.encode(JSON.stringify(value)).byteLength > maxBytes)
    throw new AppError('RESPONSE_BUDGET_EXCEEDED', 413);
  return structuredClone(value);
}
/** Internal, immutable, release-pinned transport. Loader is an offline qualification seam. */
export function createAcceptedKnowledgeTransport(load:()=>Promise<string> = async()=>acceptedKnowledgePayload) {
  let verified:Promise<AcceptedKnowledgeDocument>|undefined;
  async function verify():Promise<AcceptedKnowledgeDocument> {
    let raw:string;
    try { raw = await load(); } catch { throw new AppError('KNOWLEDGE_SOURCE_UNAVAILABLE',503); }
    if (typeof raw !== 'string') incompatible();
    if (encoder.encode(raw).byteLength > MAX_SOURCE_BYTES) throw new AppError('RESPONSE_BUDGET_EXCEEDED',413);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(raw))), b=>b.toString(16).padStart(2,'0')).join('');
    if (digest !== pin.payload_sha256) incompatible();
    let doc:AcceptedKnowledgeDocument;
    try { doc=JSON.parse(raw) as AcceptedKnowledgeDocument; } catch { return incompatible(); }
    if (doc.manifest.schema !== pin.schema || doc.manifest.source.sha256 !== pin.source_sha256 || doc.manifest.artifact_namespace !== pin.namespace || doc.manifest.claim_count !== pin.claim_count || doc.claims.length !== pin.claim_count || new Set(doc.claims.map(c=>c.claim_id)).size !== pin.claim_count) incompatible();
    return doc;
  }
  const document = ()=>verified ??= verify();
  return {
    async manifest(maxBytes=KNOWLEDGE_MAX_RESPONSE_BYTES) {
      return bounded({status:'OK' as const, manifest:(await document()).manifest},maxBytes);
    },
    async read(codexId:string,maxBytes=KNOWLEDGE_MAX_RESPONSE_BYTES) {
      if (typeof codexId !== 'string' || !/^EE-[A-Z]+-\d{4}$/.test(codexId)) throw new AppError('INVALID_INPUT');
      const doc=await document();
      const claim=doc.claims.find(c=>c.native.row.codex_id===codexId);
      if (!claim) throw new AppError('CLAIM_NOT_FOUND',404);
      return bounded({status:'OK' as const,source_sha256:pin.source_sha256,claim},maxBytes);
    },
    async discover(query:string,limit=10,maxBytes=KNOWLEDGE_MAX_RESPONSE_BYTES) {
      if (typeof query !== 'string' || encoder.encode(query).byteLength>256 || !Number.isSafeInteger(limit) || limit<1 || limit>20) throw new AppError('INVALID_INPUT');
      const doc=await document();
      const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const claims = new Map<string,AcceptedClaim>(doc.claims.map(c=>[c.claim_id,c]));
      const entries:AcceptedIndexEntry[]=doc.index.claims.filter(e=>{
        const row=claims.get(e.claim_id)!.native.row;
        const text=[row.codex_id,row.domain,row.subject,row.claim,row.scope].join(' ').toLowerCase();
        return e.default_discovery && terms.every(t=>text.includes(t));
      }).sort((a,b)=>a.claim_id<b.claim_id?-1:a.claim_id>b.claim_id?1:0);
      return bounded({status:entries.length?'OK' as const:'NO_MATCH_IN_ACCEPTED_PROJECTION' as const,source_sha256:pin.source_sha256,matches:entries.slice(0,limit),total_matches:entries.length,truncated:entries.length>limit,absence_is_not_gameplay_absence:true as const},maxBytes);
    }
  };
}

/** No authorized Worker-to-EchoesSom route was established. Never invoke a chat connector. */
export async function expandAcceptedEvidence(operation:string,selector:string,maxBytes=KNOWLEDGE_MAX_RESPONSE_BYTES):Promise<never> {
  if (operation !== 'echoes_get') throw new AppError('EVIDENCE_OPERATION_UNSUPPORTED',501);
  if (typeof selector !== 'string' || !selector || encoder.encode(selector).byteLength>512) throw new AppError('INVALID_INPUT');
  if (!Number.isSafeInteger(maxBytes) || maxBytes<256 || maxBytes>KNOWLEDGE_MAX_RESPONSE_BYTES) throw new AppError('EVIDENCE_BUDGET_EXCEEDED',413);
  throw new AppError('EVIDENCE_EXPANSION_TRANSPORT_NOT_YET_AVAILABLE',503);
}
