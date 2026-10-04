import {AppError,type AnswerDraft,type Hit,type PublicAnswer,type PublicCitation} from './types.js';
import {exactKeys,object,safePublicText} from './util.js';
function strings(v:unknown,max=24):string[]{if(!Array.isArray(v)||v.length>max||v.some(x=>typeof x!=='string'||x.length>2000||!safePublicText(x)))throw new AppError('ANSWER_REJECTED',502);return v as string[];}
export function validateAnswer(raw:unknown,hits:Hit[]):AnswerDraft {
  const o=object(raw);exactKeys(o,['answer_class','paragraphs','caveats','research_needed']);
  if(!['evidence_summary','conditional','unknown'].includes(String(o.answer_class))||typeof o.research_needed!=='boolean'||!Array.isArray(o.paragraphs)||o.paragraphs.length>8)throw new AppError('ANSWER_REJECTED',502);
  const validIds=new Set(hits.map((_,i)=>'E'+(i+1)));
  const paragraphs=o.paragraphs.map(p=>{const x=object(p);exactKeys(x,['text','evidence_ids']);if(typeof x.text!=='string'||x.text.length<1||x.text.length>2500||!safePublicText(x.text))throw new AppError('ANSWER_REJECTED',502);const ids=strings(x.evidence_ids,16);if(ids.some(i=>!validIds.has(i))||(!ids.length&&o.answer_class!=='unknown'))throw new AppError('ANSWER_REJECTED',502);return {text:x.text,evidence_ids:ids};});
  if(!paragraphs.length)throw new AppError('ANSWER_REJECTED',502);if(o.answer_class==='unknown'&&!o.research_needed)throw new AppError('ANSWER_REJECTED',502);return {answer_class:o.answer_class as AnswerDraft['answer_class'],paragraphs,caveats:strings(o.caveats,24),research_needed:o.research_needed};
}
export function extractiveAnswer(hits:Hit[]):AnswerDraft {
  const primary=hits.filter(h=>(h.context_role??'primary')==='primary');
  if(!primary.length)return {answer_class:'unknown',paragraphs:[{text:'The published library does not contain evidence I can return for this question. This is a coverage gap, not proof that the mechanic is absent.',evidence_ids:[]}],caveats:['No new investigation was performed.'],research_needed:true};
  const paragraphs=primary.slice(0,3).map(h=>{const idx=hits.indexOf(h);return {text:h.chunk.body,evidence_ids:['E'+(idx+1)]};});
  const conditional=primary.some(h=>h.publication_card?.class==='MODEL'||h.chunk.authority==='conditional_model');
  return {answer_class:conditional?'conditional':'evidence_summary',paragraphs,caveats:['These are matching published evidence excerpts, not a newly reasoned answer.'],research_needed:false};
}
export function evidenceBudgetAnswer():AnswerDraft{return {answer_class:'unknown',paragraphs:[{text:'The complete evidence package for this question is larger than the safe response budget, so Librarian is abstaining rather than dropping required caveats or context.',evidence_ids:[]}],caveats:['No evidence card was truncated to fit the budget.'],research_needed:false};}
export function implementationProbeAnswer():AnswerDraft{return {answer_class:'unknown',paragraphs:[{text:'Librarian answers from the published EVE Echoes evidence library. Internal service, credential, and configuration details are not part of that evidence surface.',evidence_ids:[]}],caveats:['No inference request was made for this implementation-detail question.'],research_needed:false};}
function citationFor(h:Hit,index:number):PublicCitation{
  if(h.publication_card){const p=h.publication_card;const assumptions=[p.scope,...p.limitations,...(p.assumptions??[]),...(p.open_boundary?[p.open_boundary.question,p.open_boundary.closes_with]:[])];return {id:'E'+index,card_id:p.card_id,publication_card:structuredClone(p),title:p.title,excerpt:p.statement,status:p.class,assumptions:[...new Set(assumptions)],class:p.class,snapshot:p.snapshot,scope:p.scope,limitations:p.limitations,context_role:h.context_role??'primary',...(p.formula?{formula:p.formula}:{}),...(p.inputs?{inputs:p.inputs}:{}),...(p.inputs_note?{inputs_note:p.inputs_note}:{}),...(p.environment?{environment:p.environment}:{}),...(p.open_boundary?{open_boundary:p.open_boundary}:{})};}
  return {id:'E'+index,title:h.chunk.heading,excerpt:h.chunk.body,status:h.chunk.fidelity,assumptions:[...h.chunk.assumptions,...h.chunk.unresolved],snapshot:h.chunk.snapshot_id,context_role:h.context_role??'primary'};
}
export function projectAnswer(draft:AnswerDraft,hits:Hit[],interactionId:string,researchRecorded:boolean):PublicAnswer {
  const used=new Set(draft.paragraphs.flatMap(p=>p.evidence_ids));
  const allowed=new Set(hits.map((_,i)=>'E'+(i+1)));if([...used].some(id=>!allowed.has(id)))throw new AppError('ANSWER_REJECTED',502);
  const citations=hits.map((h,i)=>citationFor(h,i+1)).filter((c,i)=>!!hits[i]?.publication_card||used.has(c.id)||(hits[i]?.context_role==='required'));
  const caveats=[...new Set([...draft.caveats,...citations.flatMap(c=>c.assumptions)])];
  const usesConditionalModel=hits.some((h,i)=>used.has('E'+(i+1))&&(h.publication_card?.class==='MODEL'||h.chunk.authority==='conditional_model'));
  const answerClass=draft.answer_class==='unknown'?'unknown':usesConditionalModel?'conditional':draft.answer_class;
  return {interaction_id:interactionId,answer_class:answerClass,paragraphs:draft.paragraphs.map(p=>({text:p.text,citations:p.evidence_ids})),citations,caveats,research_recorded:researchRecorded,files:[{label:'Markdown',path:'/api/answers/'+interactionId+'/file?format=md'},{label:'JSON',path:'/api/answers/'+interactionId+'/file?format=json'}]};
}
export function markdownArtifact(a:PublicAnswer,question?:string):string {
 const identity=question===undefined?[]:['## Interaction identity','Interaction ID: `'+a.interaction_id+'`','Question: '+markdownText(question),''];
 const lines=['# Librarian answer','',...identity,...(a.evidence_release?['## Publication identity',jsonFence(a.evidence_release),'']:[]),...a.paragraphs.map(p=>markdownText(p.text)+' '+p.citations.map(x=>'['+x+']').join(' ')),'','## Scope and limitations',...a.caveats.map(x=>'- '+markdownText(x)),'','## Evidence'];
 for(const c of a.citations){lines.push('### '+c.id+': '+markdownText(c.title),markdownText(c.excerpt),'Status: '+c.status+(c.context_role==='required'?' · required context':''));if(c.publication_card)lines.push('Complete published evidence card:',jsonFence(c.publication_card));else lines.push(jsonFence(c));}
 return lines.join('\n\n')+'\n';
}
export function jsonArtifact(a:PublicAnswer,question:string):string{return JSON.stringify({...a,question});}
function markdownText(text:string):string{return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\\`*_[\]#!]/g,'\\$&');}
function jsonFence(value:unknown):string{const text=JSON.stringify(value,null,2);const longest=Math.max(2,...(text.match(/`+/g)??[]).map(x=>x.length));const fence='`'.repeat(longest+1);return fence+'json\n'+text+'\n'+fence;}
export const PUBLIC_WIRE_LIMIT=65536;
export function boundAnswer(answer:PublicAnswer):PublicAnswer{
 const encoder=new TextEncoder();if(encoder.encode(JSON.stringify(answer)).byteLength<=PUBLIC_WIRE_LIMIT&&encoder.encode(markdownArtifact(answer)).byteLength<=PUBLIC_WIRE_LIMIT)return answer;
 const replacement=projectAnswer(evidenceBudgetAnswer(),[],answer.interaction_id,false);if(answer.evidence_release)replacement.evidence_release=answer.evidence_release;replacement.evidence_status='EVIDENCE_BUDGET_EXCEEDED';return replacement;
}

export function csvCell(s:string):string {const t=/^[\s]*[=+\-@\t\r]/.test(s)?"'"+s:s;return '"'+t.replace(/"/g,'""')+'"';}
