import {type Database,type Hit,AppError} from './types.js';
import {indexedPublication} from './publication-search.js';
import {queryTerms} from './retrieval-terms.js';
import {retrievePublication,type EvidenceSelection} from './publication.js';
import {acceptedKnowledge} from './integration.js';
/** Bounded internal accepted-knowledge reads, without reclassifying native rows as cards. */
export const retrieveAcceptedClaim = (codexId:string,maxBytes?:number)=>acceptedKnowledge.read(codexId,maxBytes);
export const discoverAcceptedKnowledge = (query:string,limit?:number,maxBytes?:number)=>acceptedKnowledge.discover(query,limit,maxBytes);
export {queryTerms} from './retrieval-terms.js';
export function ftsQuery(question:string):string {return queryTerms(question).map(t=>'"'+t.replace(/"/g,'""')+'"').join(' OR ');}
export async function retrieve(db:Database,question:string,release:string,limit=5,allowFixtures=false):Promise<Hit[]> {
  const q=ftsQuery(question);if(!q)return [];
  const rows=await db.prepare(`SELECT c.record_json, bm25(chunks_fts,4.0,1.0,2.0) AS rank
    FROM chunks_fts JOIN chunks c ON c.rowid=chunks_fts.rowid
    WHERE chunks_fts MATCH ? AND c.release_id=? AND (c.publication='tester_approved' OR ?=1)
    ORDER BY rank ASC, c.chunk_id ASC LIMIT ?`).bind(q,release,allowFixtures?1:0,Math.max(1,Math.min(limit,8))).all<{record_json:string;rank:number}>();
  if(!rows.success)throw new AppError('RETRIEVAL_UNAVAILABLE',503);
  const hits=rows.results.map(r=>({chunk:JSON.parse(r.record_json),rank:r.rank} as Hit));
  const identifiers=question.match(/\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b/g)??[];
  if(identifiers.some(term=>!hits.some(h=>(h.chunk.heading+' '+h.chunk.body+' '+h.chunk.tags.join(' ')).toLowerCase().includes(term.toLowerCase()))))return [];
  const named=['avatar','erebus','leviathan','ragnarok'].filter(n=>new RegExp('\\b'+n+'\\b','i').test(question));
  if(named.some(n=>!hits.some(h=>h.chunk.tags.includes(n)||new RegExp('\\b'+n+'\\b','i').test(h.chunk.heading+' '+h.chunk.body))))return [];
  return hits;
}
export async function retrieveEvidence(db:Database,question:string,release:string,limit=5,allowFixtures=false,snapshot?:string,maxBytes=32768):Promise<EvidenceSelection>{
  const adapter=await db.prepare('SELECT contract,fixture_only,profile FROM release_adapters WHERE release_id=?').bind(release).first<{contract:string;fixture_only:number;profile:string}>();
  if(adapter){
    if(adapter.contract!=='echoes-publication-card/v1')throw new AppError('RETRIEVAL_UNAVAILABLE',503);
    if(adapter.fixture_only&&!allowFixtures)return {status:'NO_SUPPORTED_EVIDENCE',hits:[]};
    if(adapter.profile==='publication-v1.2-strict')return indexedPublication(db,question,release,limit,allowFixtures,snapshot??'all',maxBytes);
    return retrievePublication(db,question,release,limit,allowFixtures,snapshot,maxBytes);
  }
  const hits=await retrieve(db,question,release,limit,allowFixtures);return {status:hits.length?'OK':'NO_SUPPORTED_EVIDENCE',hits};
}
/** Only a safe presentation projection is supplied to a model; no paths, tool handles or raw reports. */
export function evidenceForModel(hits:Hit[]):unknown[] {return hits.map((h,i)=>h.publication_card?{id:'E'+(i+1),context_role:h.context_role??'primary',...h.publication_card}:{id:'E'+(i+1),title:h.chunk.heading,text:h.chunk.body,layer:h.chunk.layer,fidelity:h.chunk.fidelity,authority:h.chunk.authority,assumptions:h.chunk.assumptions,unresolved:h.chunk.unresolved,snapshot:h.chunk.snapshot_id});}
export function researchFingerprint(question:string):string {return queryTerms(question).sort().join('|');}
