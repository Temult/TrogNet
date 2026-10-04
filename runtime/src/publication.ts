import {AppError,type Database,type Hit,type PublicPublicationCard,type PublicationClass,type Chunk} from './types.js';
import {object,safePublicText} from './util.js';
import {queryTerms} from './retrieval-terms.js';

const CLASSES=new Set<PublicationClass>(['SOURCE','DERIVED','MODEL','OBSERVED','OPEN']);
const NAMED=new Set(['leviathan','ragnarok','avatar','erebus','wyvern','hel','aeon','nyx']);
const ALLOWED=new Set(['schema','card_id','class','title','statement','snapshot','scope','entities','topics','source_refs','source_artifact','limitations','publication','required_cards','assumptions','formula','inputs','environment','open_boundary','superseded_by','supersedes','legacy']);
const PRIVATE_KEY=/(?:^|_)(?:source|path|artifacts?|sha256?|hash|uri|handle|locator|tool|mcp|files?|legacy)(?:_|$)/i;
const PRIVATE_VALUE=/(?:artifact:\/\/|mcp:\/\/|\/mnt\/|[A-Za-z]:\\|\.zip(?:$|[#?])|source_inputs\/)/i;

export interface PublicationCard extends PublicPublicationCard {
  schema:'echoes-publication-card/v1'; publication:'candidate_only'; entities:string[]; topics:string[];
  source_refs:string[]; source_artifact:string; required_cards:string[]; supersedes?:string[]; legacy?:Record<string,unknown>;
  inputs?:Record<string,unknown>[];
}
export interface EvidenceSelection {status:'OK'|'NO_SUPPORTED_EVIDENCE'|'EVIDENCE_BUDGET_EXCEEDED'|'SNAPSHOT_SCOPE_CONFLICT';hits:Hit[];}
export const STRICT_PROFILE='publication-v1.2-strict';
export const PRODUCER_RELEASE='echoes-publication/v1.2.0-candidate';
export function isPublicExchange(c:PublicationCard):boolean{return c.legacy?.producer_release===PRODUCER_RELEASE;}
const PUBLIC_LOCATOR=/(?:artifact|echoes|file|mcp):\/\/|[A-Za-z]:[\\/]|\/(?:mnt|home|Users)\/|tunnel_[A-Za-z0-9]+/i;
export function validateExchangeSemantics(c:PublicationCard):void{
 if(!isPublicExchange(c)||!/^publication-corpus-sha256:[a-f0-9]{64}$/.test(c.source_artifact)||c.source_refs.some(x=>!/^publication-source:[a-f0-9]{64}$/.test(x)))throw new AppError('PUBLICATION_EXCHANGE_INVALID',503);
 if(Object.keys(c.legacy??{}).some(k=>!['producer_release','model_id','result','transformation_operation'].includes(k)))throw new AppError('PUBLICATION_EXCHANGE_INVALID',503);
 const pending:unknown[]=[c];let nodes=0;while(pending.length){const x=pending.pop();if(++nodes>20000)throw new AppError('PUBLICATION_EXCHANGE_INVALID',503);if(typeof x==='string'&&PUBLIC_LOCATOR.test(x))throw new AppError('PUBLICATION_PRIVATE_LOCATOR',503);if(typeof x==='number'&&!Number.isFinite(x))throw new AppError('PUBLICATION_EXCHANGE_INVALID',503);if(x&&typeof x==='object'){if(Object.keys(x).some(k=>['__proto__','constructor','prototype'].includes(k)))throw new AppError('PUBLICATION_EXCHANGE_INVALID',503);pending.push(...Object.values(x));}}
 if(c.class==='MODEL'&&typeof c.legacy?.model_id!=='string')throw new AppError('PUBLICATION_EXCHANGE_INVALID',503);
 for(const item of c.inputs??[]){if(typeof item.card_id==='string'&&!c.required_cards.includes(item.card_id))throw new AppError('PUBLICATION_MATERIAL_CONTEXT_MISSING',503);}
}

function strings(v:unknown,name:string,max=128):string[]{
  if(v===undefined)return [];
  if(!Array.isArray(v)||v.length>max||v.some(x=>typeof x!=='string'||x.length<1||x.length>20000))throw new AppError('PUBLICATION_INVALID',503);
  return v as string[];
}
function stringField(o:Record<string,unknown>,name:string):string{
  const v=o[name];if(typeof v!=='string'||v.length<1||v.length>30000)throw new AppError('PUBLICATION_INVALID',503);return v;
}
export function validatePublicationCard(raw:unknown):PublicationCard{
  const o=object(raw);if(Object.keys(o).some(k=>!ALLOWED.has(k)))throw new AppError('PUBLICATION_INVALID',503);
  if(o.schema!=='echoes-publication-card/v1'||o.publication!=='candidate_only'||typeof o.class!=='string'||!CLASSES.has(o.class as PublicationClass))throw new AppError('PUBLICATION_INVALID',503);
  const c:PublicationCard={
    schema:'echoes-publication-card/v1',publication:'candidate_only',card_id:stringField(o,'card_id'),class:o.class as PublicationClass,
    title:stringField(o,'title'),statement:stringField(o,'statement'),snapshot:stringField(o,'snapshot'),scope:stringField(o,'scope'),
    entities:strings(o.entities,'entities'),topics:strings(o.topics,'topics'),source_refs:strings(o.source_refs,'source_refs'),source_artifact:stringField(o,'source_artifact'),
    limitations:strings(o.limitations,'limitations'),required_cards:strings(o.required_cards,'required_cards'),
  };
  if(!c.source_refs.length)throw new AppError('PUBLICATION_INVALID',503);
  if(o.assumptions!==undefined)c.assumptions=strings(o.assumptions,'assumptions');
  if(o.formula!==undefined){if(typeof o.formula!=='string'||!o.formula)throw new AppError('PUBLICATION_INVALID',503);c.formula=o.formula;}
  if(o.inputs!==undefined){if(!Array.isArray(o.inputs)||o.inputs.length<1||o.inputs.length>128||o.inputs.some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw new AppError('PUBLICATION_INVALID',503);c.inputs=o.inputs as Record<string,unknown>[];}
  if(o.environment!==undefined){if(!o.environment||typeof o.environment!=='object'||Array.isArray(o.environment))throw new AppError('PUBLICATION_INVALID',503);const e=object(o.environment);if(typeof e.conditions!=='string'||!e.conditions||typeof e.observation_id!=='string'||!e.observation_id)throw new AppError('PUBLICATION_INVALID',503);c.environment=e;}
  if(o.open_boundary!==undefined){const b=object(o.open_boundary);if(typeof b.question!=='string'||!b.question||typeof b.closes_with!=='string'||!b.closes_with)throw new AppError('PUBLICATION_INVALID',503);c.open_boundary=b as NonNullable<PublicationCard['open_boundary']>;}
  if(o.superseded_by!==undefined)c.superseded_by=strings(o.superseded_by,'superseded_by');
  if(o.supersedes!==undefined)c.supersedes=strings(o.supersedes,'supersedes');
  if(o.legacy!==undefined){if(!o.legacy||typeof o.legacy!=='object'||Array.isArray(o.legacy))throw new AppError('PUBLICATION_INVALID',503);c.legacy=o.legacy as Record<string,unknown>;}
  if(c.class==='DERIVED'&&(!c.formula||!c.inputs?.length))throw new AppError('PUBLICATION_INVALID',503);
  if(c.class==='MODEL'&&!c.assumptions?.length)throw new AppError('PUBLICATION_INVALID',503);
  if(c.class==='OBSERVED'&&!c.environment)throw new AppError('PUBLICATION_INVALID',503);
  if(c.class==='OPEN'&&!c.open_boundary)throw new AppError('PUBLICATION_INVALID',503);
  if(new TextEncoder().encode(JSON.stringify(c)).byteLength>131072)throw new AppError('PUBLICATION_INVALID',503);
  if(isPublicExchange(c))validateExchangeSemantics(c);
  return c;
}
export function validatePublicationCards(raw:unknown[]):PublicationCard[]{
  const cards=raw.map(validatePublicationCard),by=new Map<string,PublicationCard>();
  for(const c of cards){if(by.has(c.card_id))throw new AppError('PUBLICATION_DUPLICATE_ID',503);by.set(c.card_id,c);}
  for(const c of cards){for(const id of [...c.required_cards,...(c.superseded_by??[]),...(c.supersedes??[])])if(!by.has(id))throw new AppError('PUBLICATION_MISSING_LINK',503);for(const ref of c.source_refs){if(!ref.startsWith('card://'))continue;const parent=by.get(ref.slice(7));if(!parent)throw new AppError('PUBLICATION_MISSING_LINK',503);if((c.class==='SOURCE'||c.class==='DERIVED')&&(parent.class==='MODEL'||parent.class==='OPEN'))throw new AppError('PUBLICATION_AUTHORITY_PROMOTION',503);}}
  for(const c of cards){for(const item of c.inputs??[]){if(typeof item.card_id!=='string')continue;const parent=by.get(item.card_id);if(!parent)throw new AppError('PUBLICATION_MISSING_LINK',503);if((c.class==='SOURCE'||c.class==='DERIVED')&&(parent.class==='MODEL'||parent.class==='OPEN'))throw new AppError('PUBLICATION_AUTHORITY_PROMOTION',503);}}
  for(const c of cards){const seen=new Set<string>(),stack=[...(c.superseded_by??[])];while(stack.length){const id=stack.pop()!;if(id===c.card_id)throw new AppError('PUBLICATION_SUPERSESSION_CYCLE',503);if(seen.has(id))continue;seen.add(id);stack.push(...(by.get(id)?.superseded_by??[]));}}
  return cards;
}
function safeNested(v:unknown,depth=0):unknown{
  if(depth>4)return undefined;
  if(v===null||typeof v==='number'||typeof v==='boolean')return v;
  if(typeof v==='string')return v.length<=4000&&!PRIVATE_VALUE.test(v)&&safePublicText(v)?v:undefined;
  if(Array.isArray(v)){const a=v.slice(0,64).map(x=>safeNested(x,depth+1)).filter(x=>x!==undefined);return a.length?a:undefined;}
  if(typeof v==='object'){
    const out:Record<string,unknown>={};for(const [k,x] of Object.entries(v as Record<string,unknown>)){if(PRIVATE_KEY.test(k))continue;const y=safeNested(x,depth+1);if(y!==undefined)out[k]=y;}return Object.keys(out).length?out:undefined;
  }
  return undefined;
}
export function publicPublicationCard(c:PublicationCard):PublicPublicationCard{
  if(isPublicExchange(c)){validateExchangeSemantics(c);return structuredClone(c);}
  const out:PublicPublicationCard={card_id:c.card_id,class:c.class,title:c.title,statement:c.statement,snapshot:c.snapshot,scope:c.scope,limitations:[...c.limitations]};
  if(c.assumptions)out.assumptions=[...c.assumptions];if(c.formula)out.formula=c.formula;
  if(c.inputs){const inputs=c.inputs.map(x=>safeNested(x)).filter((x):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x));if(inputs.length)out.inputs=inputs;else out.inputs_note='Material input locators are retained only in the owner-side candidate; the public projection preserves the derived result and formula without private artifact references.';}
  if(c.environment)out.environment=structuredClone(c.environment);if(c.open_boundary)out.open_boundary=structuredClone(c.open_boundary);if(c.superseded_by)out.superseded_by=[...c.superseded_by];return out;
}
export function searchablePublicationCard(c:PublicationCard):{title:string;statement:string;tags:string}{
  const b=[c.statement,...c.limitations,c.open_boundary?.question??'',c.open_boundary?.closes_with??''].join(' ');
  return {title:c.title,statement:b,tags:[...c.entities,...c.topics,c.card_id].join(' ')};
}
function mapLayer(c:PublicationCard):Chunk['layer']{return c.class==='SOURCE'?'source_evidence':c.class==='MODEL'?'simulation_result':c.class==='OPEN'?'boundary_note':'mechanics_claim';}
function mapAuthority(c:PublicationCard):Chunk['authority']{return c.class==='MODEL'?'conditional_model':c.class==='SOURCE'?'client':'report_only';}
function hit(c:PublicationCard,rank:number,role:'primary'|'required',release:string):Hit{
  const p=publicPublicationCard(c);return {rank,context_role:role,publication_card:p,chunk:{chunk_id:c.card_id,release_id:release,document_id:c.card_id,heading:c.title,body:c.statement,snapshot_id:c.snapshot,layer:mapLayer(c),fidelity:c.class,authority:mapAuthority(c),assumptions:c.assumptions??[],unresolved:[c.scope,...c.limitations,...(c.open_boundary?[c.open_boundary.question,c.open_boundary.closes_with]:[])],source_sha256:'0'.repeat(64),source_file:'publication-card',start_line:1,end_line:1,body_sha256:'0'.repeat(64),publication:'fixture_only',tags:[...c.topics,...c.entities]}};
}
async function loadCard(db:Database,release:string,id:string,allowCandidate:boolean):Promise<PublicationCard|null>{
  const r=await db.prepare(`SELECT record_json FROM publication_cards WHERE release_id=? AND card_id=? AND (publication='tester_approved' OR ?=1)`).bind(release,id,allowCandidate?1:0).first<{record_json:string}>();
  return r?validatePublicationCard(JSON.parse(r.record_json)):null;
}
export async function retrievePublication(db:Database,question:string,release:string,limit=5,allowCandidate=false,snapshot?:string,maxBytes=32768):Promise<EvidenceSelection>{
  if(typeof question!=='string'||new TextEncoder().encode(question).byteLength>4096)throw new AppError('INVALID_INPUT');
  if(limit<1||limit>8)throw new AppError('INVALID_INPUT');
  const terms=queryTerms(question);if(!terms.length)return {status:'NO_SUPPORTED_EVIDENCE',hits:[]};
  const q=terms.map(t=>'"'+t.replace(/"/g,'""')+'"').join(' OR ');
  const rows=await db.prepare(`SELECT p.record_json,bm25(publication_cards_fts,0,5,1) AS rank FROM publication_cards_fts JOIN publication_cards p ON p.rowid=publication_cards_fts.rowid WHERE publication_cards_fts MATCH ? AND p.release_id=? AND p.is_superseded=0 AND (p.publication='tester_approved' OR ?=1) ORDER BY rank,p.card_id LIMIT 80`).bind(q,release,allowCandidate?1:0).all<{record_json:string;rank:number}>();
  if(!rows.success)throw new AppError('RETRIEVAL_UNAVAILABLE',503);
  const original=new Set(queryTerms(question)),named=new Set([...NAMED].filter(n=>new RegExp('\\b'+n+'\\b','i').test(question))),ranked:{card:PublicationCard;rank:number;score:number}[]=[];
  for(const r of rows.results){const c=validatePublicationCard(JSON.parse(r.record_json));if(c.superseded_by?.length)continue;if(snapshot!==undefined&&snapshot!=='all'&&c.snapshot!==snapshot)continue;const text=(c.title+' '+c.statement+' '+c.entities.join(' ')).toLowerCase();const toks=new Set(queryTerms(text));const matched=[...named].filter(n=>text.includes(n)).length,overlap=[...original].filter(t=>toks.has(t)).length;let score=-r.rank*(1+0.7*matched)+0.05*overlap;if(named.size&&!matched)score*=0.35;ranked.push({card:c,rank:r.rank,score});}
  ranked.sort((a,b)=>b.score-a.score||a.card.card_id.localeCompare(b.card.card_id));const primary=ranked.slice(0,limit);
  const identifiers=question.match(/\b(?:[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+|\d{10,12})\b/g)??[];const text=primary.map(x=>x.card.title+' '+x.card.statement).join(' ').toLowerCase();
  if(identifiers.some(x=>!text.includes(x.toLowerCase()))||[...named].some(n=>!text.includes(n)))return {status:'NO_SUPPORTED_EVIDENCE',hits:[]};
  if(!primary.length)return {status:'NO_SUPPORTED_EVIDENCE',hits:[]};
  return selectPublicationRoots(db,primary.map(p=>p.card.card_id),release,allowCandidate,snapshot,maxBytes);
}
/** Internal graph-selection function, not a tester-supplied root or execution interface. */
export async function selectPublicationRoots(db:Database,ids:string[],release:string,allowCandidate=false,snapshot?:string,maxBytes=32768):Promise<EvidenceSelection>{
  if(!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>32768||!ids.length||ids.length>8||new Set(ids).size!==ids.length)throw new AppError('INVALID_INPUT');
  const adapter=await db.prepare('SELECT profile,producer_corpus_sha256 FROM release_adapters WHERE release_id=?').bind(release).first<{profile:string;producer_corpus_sha256:string|null}>();
  const strict=adapter?.profile===STRICT_PROFILE;
  const selected=new Map<string,{card:PublicationCard;rank:number;role:'primary'|'required'}>();
  for(const id of ids){const c=await loadCard(db,release,id,allowCandidate);if(!c||c.superseded_by?.length)return {status:'NO_SUPPORTED_EVIDENCE',hits:[]};if(snapshot!==undefined&&snapshot!=='all'&&c.snapshot!==snapshot)return {status:'NO_SUPPORTED_EVIDENCE',hits:[]};selected.set(id,{card:c,rank:0,role:'primary'});}
  const pending=[...selected.values()].flatMap(p=>p.card.required_cards),visited=new Set(selected.keys());
  while(pending.length){const id=pending.pop()!;if(visited.has(id))continue;visited.add(id);const c=await loadCard(db,release,id,allowCandidate);if(!c)throw new AppError('PUBLICATION_CONTEXT_INVALID',503);selected.set(id,{card:c,rank:0,role:'required'});pending.push(...c.required_cards);if(selected.size>64)throw new AppError('PUBLICATION_CONTEXT_INVALID',503);}
  for(const {card:c} of selected.values()){
    if(strict){validateExchangeSemantics(c);if(c.source_artifact!=='publication-corpus-sha256:'+adapter.producer_corpus_sha256)throw new AppError('PUBLICATION_BINDING_MISMATCH',503);if(snapshot!==undefined&&snapshot!=='all'&&c.snapshot!==snapshot)return {status:'SNAPSHOT_SCOPE_CONFLICT',hits:[]};}
  }
  const payload={release_id:release,requested_snapshot:snapshot??'all',evidence:[...selected.values()].map(x=>({context_role:x.role,...publicPublicationCard(x.card)}))};
  if(new TextEncoder().encode(JSON.stringify(payload)).byteLength>maxBytes)return {status:'EVIDENCE_BUDGET_EXCEEDED',hits:[]};
  const hits=[...selected.values()].map(x=>hit(x.card,x.rank,x.role,release));hits.sort((a,b)=>a.context_role===b.context_role?(a.context_role==='primary'?ids.indexOf(a.publication_card!.card_id)-ids.indexOf(b.publication_card!.card_id):a.chunk.chunk_id.localeCompare(b.chunk.chunk_id)):a.context_role==='primary'?-1:1);return {status:'OK',hits};
}
