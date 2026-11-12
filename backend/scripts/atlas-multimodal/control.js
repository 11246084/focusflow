// Independent preparation tools. Never import app, models, migrations or Gemini.
const crypto = require('node:crypto');
const { BSON } = require('mongodb');
const { COURSE_ID, VIDEO_IDS } = require('../multimodal-diagnostics/run');
const { buildGeminiTextSearchContract, compareEmbeddingContracts } = require('../../src/services/embeddingContract.service');
const IDS = ['6a6da68e56dd124511ec51b4_chunk_0117', '6a6da68e56dd124511ec51b4_chunk_0001',
  '6a6da69256dd124511ec51d5_chunk_0070'];
const PATHS = { text: 'stableTextEmbedding', audio: 'audioEmbedding', visual: 'visualEmbedding' };
const OPTIONS = { maxTimeMS: 15000 };
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sorted(value[k])]));
  return value;
}
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(sorted(BSON.EJSON.serialize(value, { relaxed: false })))).digest('hex'); }
function get(row, key) { return key.split('.').reduce((v, k) => v?.[k], row); }
function vectorDigest(vector) {
  if (!Array.isArray(vector) || vector.length !== 3072 || !vector.every(v => typeof v === 'number' && Number.isFinite(v))
    || Math.abs(vector.reduce((s, v) => s + v * v, 0) - 1) > .001) throw new Error('Invalid vector');
  const bytes = Buffer.alloc(3072 * 8);
  vector.forEach((v, i) => bytes.writeDoubleLE(v, i * 8));
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function validateBundle(bundle, scope = null) {
  const ids = scope?.ids || IDS;
  const kinds = scope ? ['text', 'audio', 'visual'] : ['query', 'text', 'audio', 'visual'];
  if (bundle?.schemaVersion !== (scope ? 'atlas_video1_v1' : 'atlas_sample_v1') || bundle.executionMode !== 'gemini' || bundle.records?.length !== ids.length * kinds.length) throw new Error('Invalid bundle');
  const seen = new Set();
  for (const r of bundle.records) {
    const m = r.metadata;
    const key = `${r.identity?.chunkId}:${r.kind}`;
    if (seen.has(key) || !ids.includes(r.identity?.chunkId) || !kinds.includes(r.kind)
      || r.identity.courseId !== COURSE_ID || !VIDEO_IDS.includes(r.identity.videoId)
      || !r.identity.chunkId.startsWith(`${r.identity.videoId}_chunk_`)
      || !Number.isFinite(r.identity.startSec) || !(r.identity.endSec > r.identity.startSec)
      || m?.provider !== 'gemini' || m.model !== 'gemini-embedding-2' || m.status !== 'success'
      || m.modality !== r.kind || m.dimension !== 3072 || !/^[a-f0-9]{64}$/.test(m.signature || '')
      || vectorDigest(r.embedding) !== r.vectorDigest) throw new Error('Bundle contract failed');
    if (['query', 'text'].includes(r.kind)) {
      if (compareEmbeddingContracts(buildGeminiTextSearchContract(), m).length) throw new Error('Text contract failed');
    } else if (m.contractVersion !== `gemini_embedding_2_${r.kind}_v1`
      || !(m.sampleEndSec > m.sampleStartSec) || m.sampleEndSec - m.sampleStartSec > 60.001
      || !Number.isFinite(m.mediaDurationSec)) throw new Error('Media contract failed');
    for (const [k, v] of Object.entries(r.identity)) if (m[k] !== v) throw new Error('Metadata identity failed');
    seen.add(key);
  }
  return bundle;
}
function indexPlan(index, strategy = 'B') {
  if (!['A', 'B'].includes(strategy) || index?.name !== 'text_embedding_index' || index.type !== 'vectorSearch'
    || !Array.isArray(index.latestDefinition?.fields)) throw new Error('Invalid index snapshot');
  const before = structuredClone(index.latestDefinition);
  const after = structuredClone(before);
  if (new Set(before.fields.map(f => f.path)).size !== before.fields.length) throw new Error('Duplicate index paths');
  for (const path of ['embedding', 'videoId', 'courseId']) {
    const f = before.fields.find(f => f.path === path);
    if (!f || (path === 'embedding' ? f.type !== 'vector' || f.numDimensions !== 3072 || f.similarity !== 'cosine' : f.type !== 'filter')) throw new Error('Legacy index conflict');
  }
  const added = [];
  for (const path of Object.values(PATHS).filter(p => strategy === 'B' || p !== PATHS.text)) {
    const existing = after.fields.find(f => f.path === path);
    if (existing && (existing.type !== 'vector' || existing.numDimensions !== 3072 || existing.similarity !== 'cosine')) throw new Error('Index field conflict');
    if (!existing) { after.fields.push({ type: 'vector', path, numDimensions: 3072, similarity: 'cosine' }); added.push(path); }
  }
  return { strategy, before, after, added, beforeHash: hash(before), afterHash: hash(after), approvalRequired: true };
}
async function waitReady(read, definition, { attempts = 61, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  validate = () => {}, isReady = () => true } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 61) throw new Error('Invalid polling attempts');
  for (let i = 0; i < attempts; i++) {
    const index = await read();
    validate(index);
    if (index?.status === 'FAILED') throw new Error('Index failed; stop and inspect platform state');
    if (index?.status === 'READY' && index.queryable === true && hash(index.latestDefinition) === hash(definition) && isReady(index)) return index;
    if (i + 1 < attempts) await sleep(30000);
  }
  throw new Error('Index readiness timeout; stop');
}
function assertScope(doc, videos, identity, ids = IDS) {
  const video = videos.find(v => String(v._id) === doc.videoId);
  if (!ids.includes(doc.chunkId) || !video || String(video.courseId) !== COURSE_ID
    || (doc.courseId != null && String(doc.courseId) !== COURSE_ID)
    || doc.videoId !== identity.videoId || doc.chunkId !== identity.chunkId
    || doc.startSec !== identity.startSec || doc.endSec !== identity.endSec) throw new Error('Live identity conflict');
}
function ownedKeys(strategy) {
  if (!['A', 'B'].includes(strategy)) throw new Error('Invalid strategy');
  return Object.entries(PATHS).filter(([k]) => strategy === 'B' || k !== 'text').flatMap(([k, p]) => [p, `mediaEmbeddingMeta.${k}`]);
}
function protectedHash(doc) {
  // Preserve every existing non-owned field, including any future schema additions.
  const copy = { ...doc };
  for (const p of Object.values(PATHS)) delete copy[p];
  if (copy.mediaEmbeddingMeta && typeof copy.mediaEmbeddingMeta === 'object') {
    copy.mediaEmbeddingMeta = { ...copy.mediaEmbeddingMeta };
    for (const k of Object.keys(PATHS)) delete copy.mediaEmbeddingMeta[k];
    if (!Object.keys(copy.mediaEmbeddingMeta).length) delete copy.mediaEmbeddingMeta;
  }
  return hash(copy);
}
function planWrites(snapshot, bundle, strategy = 'B', scope = null) {
  if (scope) require('./video1-scope').validateScope(scope);
  const ids = scope?.ids || IDS;
  if (scope && strategy !== 'B') throw new Error('Video1 requires strategy B');
  validateBundle(bundle, scope);
  if (snapshot.database !== 'focusflow' || snapshot.collection !== 'video_segments_text' || snapshot.documents.length !== ids.length
    || new Set(snapshot.documents.map(d => d.chunkId)).size !== ids.length) throw new Error('Invalid snapshot scope');
  return ids.map(id => {
    const doc = snapshot.documents.find(d => d.chunkId === id);
    if (!doc) throw new Error('Missing target');
    if (doc.mediaEmbeddingMeta != null && (typeof doc.mediaEmbeddingMeta !== 'object' || Array.isArray(doc.mediaEmbeddingMeta))) throw new Error('Metadata root conflict');
    if (Object.hasOwn(doc, 'mediaEmbeddingMeta') && doc.mediaEmbeddingMeta === null) throw new Error('Metadata root conflict');
    const desired = {};
    for (const kind of Object.keys(PATHS).filter(k => strategy === 'B' || k !== 'text')) {
      const r = bundle.records.find(r => r.kind === kind && r.identity.chunkId === id);
      assertScope(doc, snapshot.videos, r.identity, ids);
      if (scope) {
        const frozen = scope.chunks.find(c => c.chunkId === id);
        if (doc.text !== frozen.text || ['videoId', 'startSec', 'endSec'].some(k => doc[k] !== frozen[k])) throw new Error('Manifest identity conflict');
      }
      const text = bundle.records.find(r => r.kind === 'text' && r.identity.chunkId === id);
      if (doc.text !== text.text) throw new Error('Transcript conflict');
      desired[PATHS[kind]] = r.embedding;
      desired[`mediaEmbeddingMeta.${kind}`] = { ...r.metadata, vectorDigest: r.vectorDigest };
    }
    const keys = ownedKeys(strategy);
    for (const key of keys) if (get(doc, key) !== undefined && hash(get(doc, key)) !== hash(desired[key])) throw new Error('Existing target conflict');
    return { chunkId: id, before: doc, protectedHash: protectedHash(doc), desired, keys };
  });
}
function currentMatches(current, expected) { return hash(current) === hash(expected); }
function casFilter(current) {
  // $expr compares the complete document; any concurrent edit causes matchedCount=0.
  return { _id: current._id, $expr: { $eq: ['$$ROOT', { $literal: current }] } };
}
async function applyPlan(collection, plans, { execute = false, receipt = async () => {}, intent = async () => {} } = {}) {
  const results = [];
  for (const plan of plans) {
    const current = await collection.findOne({ _id: plan.before._id }, OPTIONS);
    if (!current || protectedHash(current) !== plan.protectedHash) throw new Error('Protected data conflict; stopped');
    if (plan.keys.every(k => hash(get(current, k)) === hash(plan.desired[k]))) {
      results.push({ chunkId: plan.chunkId, status: 'already_applied' }); await receipt(results); continue;
    }
    if (!currentMatches(current, plan.before)) throw new Error('Concurrent data conflict; stopped');
    if (!execute) { results.push({ chunkId: plan.chunkId, status: 'dry_run', fields: plan.keys,
      changes: plan.keys.map(path => ({ path, existed: get(current, path) !== undefined,
        beforeHash: hash(get(current, path)), afterHash: hash(plan.desired[path]) })) }); continue; }
    await intent({ chunkId: plan.chunkId, operation: 'apply', beforeHash: hash(current), desiredHash: hash(plan.desired) });
    const update = await collection.updateOne(casFilter(current), { $set: plan.desired }, { ...OPTIONS, upsert: false });
    if (update.matchedCount !== 1 || update.modifiedCount !== 1) throw new Error('CAS conflict; stopped');
    const after = await collection.findOne({ _id: current._id }, OPTIONS);
    if (!after || protectedHash(after) !== plan.protectedHash || !plan.keys.every(k => hash(get(after, k)) === hash(plan.desired[k]))) throw new Error('Post-write verification failed; stopped');
    results.push({ chunkId: plan.chunkId, status: 'verified', beforeHash: hash(current), afterHash: hash(after),
      protectedBeforeHash: plan.protectedHash, protectedAfterHash: protectedHash(after), fields: plan.keys }); await receipt(results);
  }
  return results;
}
async function rollbackPlan(collection, plans, { execute = false, receipt = async () => {}, intent = async () => {} } = {}) {
  const result = [];
  for (const p of plans) {
    const current = await collection.findOne({ _id: p.before._id }, OPTIONS);
    if (currentMatches(current, p.before)) { result.push({ chunkId: p.chunkId, status: 'already_restored' }); await receipt(result); continue; }
    if (!current || protectedHash(current) !== p.protectedHash || !p.keys.every(k => hash(get(current, k)) === hash(p.desired[k]))) throw new Error('Rollback conflict; stopped');
    const $set = {}, $unset = {};
    for (const k of p.keys) { if (get(p.before, k) === undefined) $unset[k] = ''; else $set[k] = get(p.before, k); }
    // Remove an originally absent metadata root only if it contains exactly our entries.
    if (!Object.hasOwn(p.before, 'mediaEmbeddingMeta') && Object.keys(current.mediaEmbeddingMeta || {}).every(k => p.keys.includes(`mediaEmbeddingMeta.${k}`))) {
      for (const k of Object.keys($unset)) if (k.startsWith('mediaEmbeddingMeta.')) delete $unset[k];
      $unset.mediaEmbeddingMeta = '';
    }
    if (execute) {
      const update = { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) };
      await intent({ chunkId: p.chunkId, operation: 'restore', beforeHash: hash(current), desiredHash: hash(p.before) });
      const r = await collection.updateOne(casFilter(current), update, { ...OPTIONS, upsert: false });
      if (r.matchedCount !== 1 || !currentMatches(await collection.findOne({ _id: current._id }, OPTIONS), p.before)) throw new Error('Rollback verification failed');
    }
    result.push({ chunkId: p.chunkId, status: execute ? 'restored' : 'rollback_dry_run',
      beforeHash: hash(current), afterHash: hash(p.before), fields: p.keys });
    await receipt(result);
  }
  return result;
}
module.exports = { IDS, PATHS, COURSE_ID, VIDEO_IDS, hash, get, vectorDigest, validateBundle, indexPlan,
  waitReady, planWrites, applyPlan, rollbackPlan, protectedHash };
