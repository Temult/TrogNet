import test from 'node:test';
import assert from 'node:assert/strict';
import {createAcceptedKnowledgeTransport} from '../dist/accepted-knowledge.js';
import {createPilotEvidenceTransport} from '../dist/pilot-evidence.js';
test('Public reader ships a valid empty synthetic release, never private research',async()=>{
 const r=createAcceptedKnowledgeTransport(),manifest=await r.manifest();
 assert.equal(manifest.manifest.claim_count,0);assert.equal(manifest.manifest.artifact_namespace,'synthetic-only');
 assert.equal((await r.discover('fixture')).total_matches,0);
 await assert.rejects(r.read('EE-FIX-0001'),e=>e.code==='CLAIM_NOT_FOUND');
 await assert.rejects(createPilotEvidenceTransport().expand('echoes_get',{ref:'synthetic-only'}),e=>e.code==='EVIDENCE_SELECTOR_NOT_PROJECTED');
});
test('Public readers fail closed when payload bytes differ from reviewed pins',async()=>{
 await assert.rejects(createAcceptedKnowledgeTransport(async()=>'{}').manifest(),e=>e.code==='INCOMPATIBLE_KNOWLEDGE_RELEASE');
 await assert.rejects(createPilotEvidenceTransport(async()=>'{}').expand('echoes_get',{}),e=>e.code==='INCOMPATIBLE_EVIDENCE_PROJECTION');
});
