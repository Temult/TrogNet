import {AppError,type Database,type EvidenceRelease,type PublicAnswer} from './types.js';
import {selectPublicationRoots} from './publication.js';
import {boundAnswer,extractiveAnswer,evidenceBudgetAnswer,projectAnswer} from './answer.js';
import {createAcceptedKnowledgeTransport} from './accepted-knowledge.js';
/** Additional internal E01 source; deliberately separate from publication identity. */
export const acceptedKnowledge = createAcceptedKnowledgeTransport();
export {createAcceptedKnowledgeTransport} from './accepted-knowledge.js';
import {expandAcceptedEvidence as legacyEvidenceBoundary} from './accepted-knowledge.js';
import {pilotEvidence, type EvidenceRequest} from './pilot-evidence.js';
export {pilotEvidence,createPilotEvidenceTransport} from './pilot-evidence.js';
/** E04 legacy artifact selectors retain their boundary. Exact native requests use the E04B whitelist. */
export async function expandAcceptedEvidence(operation:string,selector:string|EvidenceRequest,maxBytes?:number){
  return typeof selector==='string' ? legacyEvidenceBoundary(operation,selector,maxBytes) : pilotEvidence.expand(operation,selector,maxBytes);
}
export async function evidenceRelease(db:Database,release:string,allowFixtures:boolean,snapshot='all'):Promise<EvidenceRelease>{
 const row=await db.prepare('SELECT profile,producer_release,producer_corpus_sha256,public_cards_sha256 FROM release_adapters WHERE release_id=?').bind(release).first<{profile:string;producer_release:string|null;producer_corpus_sha256:string|null;public_cards_sha256:string|null}>();
 return {release_id:release,profile:row?.profile??'legacy',producer_release:row?.producer_release??null,producer_corpus_sha256:row?.producer_corpus_sha256??null,public_cards_sha256:row?.public_cards_sha256??null,requested_snapshot:snapshot,publication:allowFixtures?'candidate_only':'tester_approved',scope_notice:snapshot==='all'?'All explicitly labeled evidence layers; cross-layer comparison is not version or mechanics equivalence.':'Exact snapshot scope applies to roots and all material companions for the v1.2 profile.'};
}
export async function reading(db:Database,id:string,release:string,allowFixtures:boolean,snapshot='all'):Promise<PublicAnswer>{
 if(!/^[A-Z0-9][A-Z0-9-]{2,100}$/.test(id))throw new AppError('INVALID_INPUT');
 const selected=await selectPublicationRoots(db,[id],release,allowFixtures,snapshot);
 const draft=selected.status==='EVIDENCE_BUDGET_EXCEEDED'?evidenceBudgetAnswer():extractiveAnswer(selected.hits);
 const answer=projectAnswer(draft,selected.hits,'00000000-0000-4000-8000-000000000000',false);answer.files=[];answer.evidence_release=await evidenceRelease(db,release,allowFixtures,snapshot);answer.evidence_status=selected.status;
 const result=boundAnswer(answer);result.files=[];return result;
}
