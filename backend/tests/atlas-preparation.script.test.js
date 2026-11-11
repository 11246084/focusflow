const { test } = require('node:test');
const assert = require('node:assert/strict');
const c = require('../scripts/atlas-multimodal/control');
const { retrieveAtlasMultimodal } = require('../src/services/atlasMultimodalAdapter.service');
const { buildGeminiTextSearchContract } = require('../src/services/embeddingContract.service');
const { sanitized, localPath } = require('../scripts/atlas-multimodal/run');
const vector = [1, ...Array(3071).fill(0)];
const contract = buildGeminiTextSearchContract();
const index = { name: 'text_embedding_index', type: 'vectorSearch', status: 'READY', queryable: true,
  latestDefinition: { fields: [{ path: 'embedding', type: 'vector', numDimensions: 3072, similarity: 'cosine' },
    { path: 'courseId', type: 'filter' }, { path: 'videoId', type: 'filter' }] } };
function fixtures() {
  const documents = c.IDS.map((chunkId, i) => ({ _id: `id${i}`, chunkId, videoId: chunkId.split('_chunk_')[0], startSec: i * 10, endSec: i * 10 + 9, text: `transcript${i}`, embedding: vector }));
  const bundle = { schemaVersion: 'atlas_sample_v1', executionMode: 'gemini', records: documents.flatMap(d => ['query', 'text', 'audio', 'visual'].map(kind => {
    const identity = { courseId: c.COURSE_ID, videoId: d.videoId, chunkId: d.chunkId, startSec: d.startSec, endSec: d.endSec };
    return { kind, identity, text: kind === 'text' ? d.text : null, embedding: vector, vectorDigest: c.vectorDigest(vector), metadata: {
      ...contract, ...identity, status: 'success', modality: kind, signature: 'a'.repeat(64),
      contractVersion: ['query', 'text'].includes(kind) ? contract.contractVersion : `gemini_embedding_2_${kind}_v1`,
      sampleStartSec: d.startSec, sampleEndSec: d.endSec, mediaDurationSec: 9 } };
  })) };
  const snapshot = { database: 'focusflow', collection: 'video_segments_text', documents, videos: c.VIDEO_IDS.map(_id => ({ _id, courseId: c.COURSE_ID })) };
  return { snapshot, bundle };
}
function repo(documents) {
  const rows = structuredClone(documents);
  let writes = 0;
  return { rows, get writes() { return writes; }, findOne: async ({ _id }) => structuredClone(rows.find(r => r._id === _id)),
    updateOne: async (filter, update, options) => {
      writes++;
      assert.equal(options.upsert, false);
      const row = rows.find(r => r._id === filter._id);
      if (c.hash(row) !== c.hash(filter.$expr.$eq[1].$literal)) return { matchedCount: 0, modifiedCount: 0 };
      for (const [p, value] of Object.entries(update.$set || {})) {
        const parts = p.split('.');
        if (parts.length === 1) row[p] = structuredClone(value);
        else { row[parts[0]] ||= {}; row[parts[0]][parts[1]] = structuredClone(value); }
      }
      for (const p of Object.keys(update.$unset || {})) {
        const parts = p.split('.');
        if (parts.length === 1) delete row[p]; else delete row[parts[0]][parts[1]];
      }
      return { matchedCount: 1, modifiedCount: 1 };
    } };
}
test('bundle validates full contracts, finite dimensions, digest and identity', () => {
  const { snapshot, bundle } = fixtures();
  assert.equal(c.planWrites(snapshot, bundle).length, 3);
  for (const change of [b => b.records[0].embedding = [NaN], b => b.records[0].metadata.model = 'preview',
    b => b.records[0].identity.courseId = 'other', b => b.records[0].metadata.generationVersion = 'old',
    b => b.records[0].vectorDigest = 'tampered', b => b.records[1] = b.records[0]]) {
    const copy = structuredClone(bundle); change(copy); assert.throws(() => c.validateBundle(copy));
  }
  snapshot.documents[0].text = 'recut'; assert.throws(() => c.planWrites(snapshot, bundle), /Transcript/);
});
test('dry run cannot write, execution is conditional, repeated execution and rollback are idempotent', async () => {
  const { snapshot, bundle } = fixtures();
  const plans = c.planWrites(snapshot, bundle);
  const db = repo(snapshot.documents);
  assert.ok((await c.applyPlan(db, plans)).every(r => r.status === 'dry_run')); assert.equal(db.writes, 0);
  await c.applyPlan(db, plans, { execute: true }); assert.equal(db.writes, 3);
  assert.ok((await c.applyPlan(db, plans, { execute: true })).every(r => r.status === 'already_applied')); assert.equal(db.writes, 3);
  await c.rollbackPlan(db, plans); assert.equal(db.writes, 3);
  await c.rollbackPlan(db, plans, { execute: true }); assert.equal(db.writes, 6);
  assert.deepEqual(db.rows, snapshot.documents);
  assert.ok((await c.rollbackPlan(db, plans)).every(r => r.status === 'already_restored'));
});
test('partial failure stops then resumes completed rows without rewriting and detects concurrency', async () => {
  const { snapshot, bundle } = fixtures(); const plans = c.planWrites(snapshot, bundle); const db = repo(snapshot.documents);
  let checkpoints = 0;
  await assert.rejects(c.applyPlan(db, plans, { execute: true, receipt: async () => { if (++checkpoints === 1) throw new Error('disk full'); } }));
  assert.equal(db.writes, 1);
  const result = await c.applyPlan(db, plans, { execute: true }); assert.equal(result[0].status, 'already_applied'); assert.equal(db.writes, 3);
  db.rows[1].text = 'concurrent';
  await assert.rejects(c.applyPlan(db, plans, { execute: true }), /conflict/);
  await assert.rejects(c.rollbackPlan(db, plans, { execute: true }), /conflict/);
});
test('CAS loses a race safely and existing owned fields cannot be overwritten', async () => {
  const { snapshot, bundle } = fixtures(); const plans = c.planWrites(snapshot, bundle); const db = repo(snapshot.documents);
  db.updateOne = async () => ({ matchedCount: 0, modifiedCount: 0 });
  await assert.rejects(c.applyPlan(db, plans, { execute: true }), /CAS/);
  snapshot.documents[0].audioEmbedding = [2]; assert.throws(() => c.planWrites(snapshot, bundle), /Existing/);
});
test('three CAS receipts preserve old embeddings, rollback checkpoints survive interruption and repeated restore', async () => {
  const { snapshot, bundle } = fixtures(); const plans = c.planWrites(snapshot, bundle); const db = repo(snapshot.documents);
  const applied = [], restored = [];
  await c.applyPlan(db, plans, { execute: true, receipt: async r => applied.push(structuredClone(r)) });
  assert.deepEqual(applied.map(r => r.length), [1, 2, 3]);
  assert.ok(applied.at(-1).every(r => r.status === 'verified' && r.protectedBeforeHash === r.protectedAfterHash));
  assert.deepEqual(db.rows.map(r => r.embedding), snapshot.documents.map(r => r.embedding));
  await assert.rejects(c.rollbackPlan(db, plans, { execute: true, receipt: async r => {
    restored.push(structuredClone(r)); throw new Error('receipt disk full');
  } }), /disk full/);
  assert.equal(db.writes, 4); assert.equal(restored[0][0].status, 'restored');
  const retry = await c.rollbackPlan(db, plans, { execute: true, receipt: async r => restored.push(structuredClone(r)) });
  assert.deepEqual(retry.map(r => r.status), ['already_restored', 'restored', 'restored']);
  assert.equal(db.writes, 6); assert.deepEqual(db.rows, snapshot.documents);
  await c.rollbackPlan(db, plans, { execute: true }); assert.equal(db.writes, 6);
});
test('rollback stops on a lost CAS or intervening owned/protected changes without overwriting them', async () => {
  for (const mutate of [db => { db.updateOne = async () => ({ matchedCount: 0, modifiedCount: 0 }); },
    db => { db.rows[0].audioEmbedding = [99]; }, db => { db.rows[0].embedding = [99]; },
    db => { db.rows[0].mediaEmbeddingMeta.otherOwner = { value: 'concurrent' }; }]) {
    const { snapshot, bundle } = fixtures(); const db = repo(snapshot.documents); const plans = c.planWrites(snapshot, bundle);
    await c.applyPlan(db, plans, { execute: true }); mutate(db);
    const beforeAttempt = structuredClone(db.rows);
    await assert.rejects(c.rollbackPlan(db, plans, { execute: true }), /conflict|verification/);
    assert.deepEqual(db.rows, beforeAttempt);
  }
});
test('post-write read mismatch stops subsequent rows and never emits a verified receipt', async () => {
  const { snapshot, bundle } = fixtures(); const db = repo(snapshot.documents); const plans = c.planWrites(snapshot, bundle);
  const write = db.updateOne; db.updateOne = async (...args) => { const result = await write(...args); db.rows[0].text = 'another writer'; return result; };
  const receipts = [];
  await assert.rejects(c.applyPlan(db, plans, { execute: true, receipt: async r => receipts.push(r) }), /Post-write/);
  assert.equal(db.writes, 1); assert.equal(receipts.length, 0);
});
test('index proposals preserve legacy fields, reject conflicts and poll expected definition only', async () => {
  const p = c.indexPlan(index); assert.equal(p.added.length, 3); assert.deepEqual(p.before, index.latestDefinition);
  assert.equal(c.indexPlan(index, 'A').added.length, 2);
  assert.equal(c.indexPlan({ ...index, latestDefinition: p.after }).added.length, 0);
  const conflict = structuredClone(index); conflict.latestDefinition.fields[0].numDimensions = 10;
  assert.throws(() => c.indexPlan(conflict));
  let n = 0; const pauses = [];
  await c.waitReady(async () => ++n === 1 ? index : { ...index, latestDefinition: p.after }, p.after,
    { attempts: 2, sleep: async ms => pauses.push(ms) }); assert.deepEqual(pauses, [30000]);
  await assert.rejects(c.waitReady(async () => ({ ...index, status: 'FAILED' }), p.after));
  await assert.rejects(c.waitReady(async () => index, p.after, { attempts: 1 }), /timeout/);
});
test('stable separate path connects three Atlas mock searches to RRF and strips raw data from reports', async () => {
  const { snapshot, bundle } = fixtures(); const plans = c.planWrites(snapshot, bundle); const db = repo(snapshot.documents);
  await c.applyPlan(db, plans, { execute: true });
  const calls = [];
  const collection = { aggregate: pipeline => { calls.push(pipeline[0].$vectorSearch); return { toArray: async () => db.rows.map(r => ({ ...r, score: .8 })) }; } };
  const args = { collection, queryEmbedding: { ...bundle.records[0].metadata, embedding: vector },
    scope: { courseId: c.COURSE_ID, allowedVideoIds: c.VIDEO_IDS, allowedChunkIds: [c.IDS[0]] },
    indexSnapshot: { ...index, latestDefinition: c.indexPlan(index).after }, textPath: 'stableTextEmbedding', textDataContract: contract };
  const result = await retrieveAtlasMultimodal(args);
  assert.deepEqual(calls.map(r => r.path), Object.values(c.PATHS));
  assert.equal(result.matches.length, 1); assert.equal(result.matches[0].fusionScore, 3 / 61);
  assert.equal(sanitized(result).candidates.length, 1);
  assert.equal(JSON.stringify(sanitized(result)).includes('transcript'), false);
  assert.equal(Object.hasOwn(sanitized(result).candidates[0], 'embedding'), false);
  await assert.rejects(retrieveAtlasMultimodal({ ...args, textPath: '$unsafe' }));
  assert.throws(() => localPath('backend/leak.json'));
});
