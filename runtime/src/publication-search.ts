/** Frozen producer BM25 navigation. The index is derived navigation, never a mechanics authority. */
import {AppError,type Database} from './types.js';
import {sha256} from './util.js';
import {explicitIdentities,publicationTokens} from './publication-v12-tokens.js';
import {selectPublicationRoots,type EvidenceSelection} from './publication.js';
interface Index {schema:string;producer_corpus_sha256:string;n:number;avgdl:number;df:Record<string,number>;tf:Record<string,Record<string,number>>;snapshots:Record<string,string>;known_identities:string[];}
export async function indexedPublication(db:Database,question:string,release:string,limit=6,allowCandidate=false,snapshot='all',maxBytes=32768):Promise<EvidenceSelection>{
 if(!question.trim()||question.length>1000||!Number.isInteger(limit)||limit<1||limit>8)throw new AppError('INVALID_INPUT');
 const row=await db.prepare('SELECT n.record_json,n.index_sha256,a.producer_corpus_sha256 FROM publication_navigation n JOIN release_adapters a ON a.release_id=n.release_id WHERE n.release_id=?').bind(release).first<{record_json:string;index_sha256:string;producer_corpus_sha256:string}>();
 if(!row||new TextEncoder().encode(row.record_json).byteLength>2097152||await sha256(row.record_json)!==row.index_sha256)throw new AppError('NAVIGATION_IDENTITY_MISMATCH',503);
 const index=JSON.parse(row.record_json) as Index;
 if(index.schema!=='echoes-publication-navigation-index/v1'||index.producer_corpus_sha256!==row.producer_corpus_sha256||!Number.isInteger(index.n)||index.n<1||index.n>5000||index.n!==Object.keys(index.tf).length||!(index.avgdl>0))throw new AppError('NAVIGATION_INVALID',503);
 if(snapshot!=='all'&&!Object.values(index.snapshots).includes(snapshot))throw new AppError('INVALID_INPUT');
 const known=new Set(index.known_identities);if(explicitIdentities(question).some(x=>!known.has(x)))return {status:'NO_SUPPORTED_EVIDENCE',hits:[]};
 const query=new Set(publicationTokens(question)),ranked:{id:string;score:number}[]=[];
 for(const [id,counts] of Object.entries(index.tf)){
  if(snapshot!=='all'&&index.snapshots[id]!==snapshot)continue;
  const length=Object.values(counts).reduce((sum,n)=>sum+n,0);let score=0;
  for(const term of query){const tf=Object.hasOwn(counts,term)?counts[term]!:0;if(!tf)continue;const df=index.df[term]!;if(!Number.isInteger(tf)||tf<1||!Number.isInteger(df)||df<1||df>index.n)throw new AppError('NAVIGATION_INVALID',503);score+=Math.log(1+(index.n-df+0.5)/(df+0.5))*tf*2.2/(tf+1.2*(0.25+0.75*length/index.avgdl));}
  if(score>0)ranked.push({id,score});
 }
 ranked.sort((a,b)=>b.score-a.score||(a.id<b.id?-1:a.id>b.id?1:0));
 if(!ranked.length)return {status:'NO_SUPPORTED_EVIDENCE',hits:[]};
 return selectPublicationRoots(db,ranked.slice(0,limit).map(x=>x.id),release,allowCandidate,snapshot,maxBytes);
}
