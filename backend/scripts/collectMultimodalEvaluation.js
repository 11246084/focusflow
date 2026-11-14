// Exact-cosine memory evaluation (decision MA). No DB, environment or provider imports.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { parseArgs } = require('node:util');
const { vectorDigest } = require('./atlas-multimodal/control');
const { buildComparisonRecords, GROUPS } = require('../src/services/multimodalOfflineEvaluation.service');
const { fingerprint, inspectInputs, evaluationProtocol, auditRetrieval } = require('../src/services/offlineRetrievalAudit.service');
const { verifyAudit } = require('./verifyMultimodalAudit');
const { buildGeminiSearchQueryText, buildGeminiTextSearchContract, compareEmbeddingContracts } = require('../src/services/embeddingContract.service');
const { expandParentHits } = require('../src/services/childExpansion.service');
const { assembleLeafContext } = require('../src/services/leafContextAssembly.service');
const { createHash } = require('node:crypto');
const sha = s => createHash('sha256').update(s).digest('hex');
function vector(record, synthetic) {
  const values = record.embedding;
  assert.equal(values?.length, 3072);
  assert(values.every(v => typeof v === 'number' && Number.isFinite(v)));
  assert(Math.abs(values.reduce((s,v)=>s+v*v,0)-1)<.001);
  assert.equal(record.vectorDigest, vectorDigest(values));
  const m = record.metadata;
  assert.equal(m?.model, 'gemini-embedding-2');
  assert.equal(m.dimension, 3072); assert.equal(m.status, 'success');
  assert.equal(m.provider, synthetic ? 'fake-sdk' : 'gemini');
  if (!synthetic) {
    const kind = record.kind || record.role;
    assert.equal(m.modality, kind);
    if (['audio','visual'].includes(kind)) assert.equal(m.contractVersion, `gemini_embedding_2_${kind}_v1`);
  }
  if (!synthetic && ['text','query'].includes(record.kind || record.role)) {
    assert.deepEqual(compareEmbeddingContracts(buildGeminiTextSearchContract(), m), []);
  }
  return values;
}
const cosine = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
const order = (a,b) => b.score-a.score || a.chunkId.localeCompare(b.chunkId,'en');
async function collect({ bank, manifest, leaves, queries, parents, legacy = null, synthetic = false }) {
  const inputs = inspectInputs(bank, manifest, { pendingX01: true });
  assert.equal(inputs.missingGold.length,0);
  const byChunk = new Map([...inputs.chunks].map(([id,c])=>[id,{...c,vectors:{}}]));
  for (const r of leaves) {
    const c = byChunk.get(r.identity?.chunkId); assert(c,'Unknown leaf');
    for (const k of ['courseId','videoId','startSec','endSec']) assert.equal(r.identity[k],c[k]);
    assert(['text','audio','visual'].includes(r.kind)); assert(!c.vectors[r.kind],'Duplicate leaf modality');
    c.vectors[r.kind]=vector(r,synthetic);
    if(r.kind==='text'){assert(typeof r.text==='string'&&r.text.trim());if(c.text!==undefined)assert.equal(c.text,r.text);c.text=r.text;}
  }
  for (const c of byChunk.values()) {
    assert(c.vectors.text,'Missing text');
    if(c.endSec-c.startSec<=60) assert(c.vectors.audio&&c.vectors.visual,'Missing media');
  }
  const legacyMap = new Map();
  if (!synthetic) assert(Array.isArray(legacy), 'Original text baseline required');
  for (const r of legacy || leaves.filter(r=>r.kind==='text')) {
    const c=byChunk.get(r.identity?.chunkId);assert(c&&!legacyMap.has(c.chunkId));
    for(const k of ['videoId','startSec','endSec'])assert.equal(r.identity[k],c[k]);
    assert.equal(r.text,c.text);assert.equal(r.embedding.length,3072);
    assert(r.embedding.every(v=>typeof v==='number'&&Number.isFinite(v)));
    assert(Math.abs(r.embedding.reduce((sum,v)=>sum+v*v,0)-1)<.001);
    legacyMap.set(c.chunkId,r.embedding);
  }
  assert.equal(legacyMap.size,byChunk.size);
  const queryMap = new Map();
  for(const q of queries){assert(!queryMap.has(q.id),'Duplicate query'); vector(q,synthetic);queryMap.set(q.id,q);}
  assert.equal(queryMap.size,bank.questions.length);
  const parentIds = new Set(),childIds = new Set();
  for(const p of parents){vector(p,synthetic);assert(!parentIds.has(p.id));parentIds.add(p.id);
    if(!synthetic) assert.equal(p.inputSha256,sha(`title: none | text: ${p.text.trim()}`));
    assert.equal(p.parent.parent_id,p.id);assert.equal(p.text,p.parent.text);
    const children=p.parent.child_chunk_ids;assert(children.length>=1&&children.length<=3);
    for(const id of children){const c=byChunk.get(id);assert(c&&c.videoId===p.parent.video_id&&!childIds.has(id));childIds.add(id);}
    const c=children.map(id=>byChunk.get(id));assert.equal(p.parent.start_sec,c[0].startSec);assert.equal(p.parent.end_sec,c.at(-1).endSec);assert.equal(p.text,c.map(x=>x.text).join('\n'));
  }
  assert.equal(childIds.size,byChunk.size,'Incomplete fixed-three Parent coverage');
  // Verify exact fixed-three membership in transcript order, rather than accepting arbitrary groups.
  for(const videoId of new Set([...byChunk.values()].map(c=>c.videoId))){const cs=[...byChunk.values()].filter(c=>c.videoId===videoId).sort((a,b)=>a.startSec-b.startSec||a.chunkId.localeCompare(b.chunkId));const ps=parents.filter(p=>p.parent.video_id===videoId).sort((a,b)=>a.parent.order-b.parent.order);assert.equal(ps.length,Math.ceil(cs.length/3));ps.forEach((p,i)=>assert.deepEqual(p.parent.child_chunk_ids,cs.slice(i*3,i*3+3).map(c=>c.chunkId)));}
  const scope={courseId:bank.courseId,allowedVideoIds:[...new Set([...byChunk.values()].map(c=>c.videoId))],allowedCourseIds:[bank.courseId]};
  const records=[],raw=[],legacyRankings=[];
  for(const question of bank.questions){const q=queryMap.get(question.id);assert(q);assert.equal(q.text,question.question);
    assert.equal(q.inputSha256,sha(buildGeminiSearchQueryText(question.question)));
    const legacyRanked=[...byChunk.values()].map(c=>({...c,score:cosine(q.embedding,legacyMap.get(c.chunkId))})).sort(order).slice(0,20).map((c,i)=>({rank:i+1,chunkId:c.chunkId,videoId:c.videoId,startSec:c.startSec,endSec:c.endSec}));
    legacyRankings.push({questionId:question.id,ranked:legacyRanked});
    const flat=Object.fromEntries(['text','audio','visual'].map(kind=>[kind,[...byChunk.values()].filter(c=>c.vectors[kind]).map(c=>({...c,score:cosine(q.embedding,c.vectors[kind])})).sort(order).slice(0,20)]));
    const hits=parents.map(p=>({parentId:p.id,videoId:p.parent.video_id,childChunkIds:p.parent.child_chunk_ids,score:cosine(q.embedding,p.embedding)})).sort((a,b)=>b.score-a.score||a.parentId.localeCompare(b.parentId,'en')).slice(0,5);
    const expansion=await expandParentHits({parentHits:hits,leafRepository:{findLeavesByChunkIds:async ids=>ids.map(id=>{const c=byChunk.get(id);return {...c,text:c.text};})},scope:{...scope,allowedVideoIds:new Set(scope.allowedVideoIds)},courseId:bank.courseId,limit:30});
    assert.equal(expansion.diagnostics.missingChildCount,0);assert.equal(expansion.diagnostics.scopeMismatchCount,0);
    const context=assembleLeafContext({leaves:expansion.leaves,maxLeaves:15,maxCharacters:5000});assert(context.matches.length);
    const hierarchical={text:context.matches.map(c=>({...c,text:byChunk.get(c.chunkId).text,courseId:bank.courseId}))};
    records.push(...buildComparisonRecords({questionId:question.id,flat,hierarchical,scope}));
    raw.push({questionId:question.id,queryDigest:vectorDigest(q.embedding),flat:Object.fromEntries(Object.entries(flat).map(([k,rs])=>[k,rs.map(({vectors,...r})=>r)])),parentHits:hits,hierarchical:hierarchical.text});
  }
  const config={bankHash:fingerprint(bank),manifestHash:fingerprint(manifest),protocolHash:fingerprint(evaluationProtocol(bank,{pendingX01:true})),k:60,perChannelLimit:20,questionCount:bank.questions.length,groups:Object.keys(GROUPS),modes:['flat','hierarchical'],weights:['equal','text_weighted'],provenance:synthetic?'synthetic':'saved-gemini-fake-atlas',formalEvaluation:false,pendingX01:true,
    collectionMode:'exact-cosine-memory',hierarchy:{parentLimit:5,childExpansionLimit:30,contextMaxLeaves:15,contextMaxCharacters:5000},inputHashes:{leaves:fingerprint(leaves),queries:fingerprint(queries),parents:fingerprint(parents),legacy:fingerprint(legacy || leaves.filter(r=>r.kind==='text'))}};
  const report=auditRetrieval({bank,manifest,records,config});verifyAudit({bank,manifest,records,config,report});
  const legacyRecords=records.map(r=>r.mode==='flat'&&r.group==='text'?{...r,ranked:legacyRankings.find(q=>q.questionId===r.questionId).ranked}:r);
  const legacyReport=auditRetrieval({bank,manifest,records:legacyRecords,config});verifyAudit({bank,manifest,records:legacyRecords,config,report:legacyReport});
  const legacyBaseline={kind:'original-text-flat-only',queryContract:'same saved text_v2 Query; original embedding baseline separately labeled',rankings:legacyRankings,aggregates:legacyReport.aggregates.filter(r=>r.mode==='flat'&&r.group==='text'),independentVerification:'passed'};
  return {records,raw,config,report,legacyBaseline,independentVerification:'passed',qualityGate:'External review and decision 11 still required'};
}
async function main(){const {values:v}=parseArgs({options:{bank:{type:'string'},manifest:{type:'string'},leaves:{type:'string'},queries:{type:'string'},parents:{type:'string'},legacy:{type:'string'},output:{type:'string'},synthetic:{type:'boolean'}}});const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));const out=path.resolve(v.output);assert(out.startsWith(path.resolve(__dirname,'../../.local-tools')+path.sep));fs.mkdirSync(out,{recursive:true});const leafFiles=read(v.leaves);assert(Array.isArray(leafFiles));const queryBundle=read(v.queries),parentBundle=read(v.parents);const bank=read(v.bank);if(!v.synthetic){assert.equal(queryBundle.executionMode,'gemini');assert.equal(parentBundle.executionMode,'gemini');const bankBytes=sha(fs.readFileSync(v.bank));assert.equal(queryBundle.bankSha256,bankBytes);assert.equal(parentBundle.bankSha256,bankBytes);}const result=await collect({bank,manifest:read(v.manifest),leaves:leafFiles.flatMap(p=>read(p).records),queries:queryBundle.records,parents:parentBundle.records,legacy:v.legacy?read(v.legacy):null,synthetic:!!v.synthetic});for(const [file,data]of Object.entries({'per-question':result.records,'raw-rankings':result.raw,'legacy-baseline':result.legacyBaseline,config:result.config,report:result.report})){fs.writeFileSync(path.join(out,file+'.json'),JSON.stringify(data,null,2),{flag:'wx'});}console.log(JSON.stringify({status:'collected-and-independently-audited',rows:result.records.length,formalEvaluation:false,apiCalls:0,dbWrites:0}));}
if(require.main===module)main().catch(()=>{console.error('Evaluation stopped; no provider or database calls performed.');process.exitCode=1;});
module.exports={collect};
