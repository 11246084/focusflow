const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const c = require('../scripts/atlas-multimodal/control');
const s = require('../scripts/atlas-multimodal/video1-scope');
const v = require('../scripts/atlas-multimodal/video1');
const { fixture, repository } = require('./helpers/video1Fixture');
function snapshot(f) { return { database: 'focusflow', collection: 'video_segments_text', documents: f.documents, videos: f.videos }; }
function applyDesired(doc, plan) {
  const copy = structuredClone(doc);
  for (const [key, value] of Object.entries(plan.desired)) {
    const [root, nested] = key.split('.');
    if (nested) { copy[root] ||= {}; copy[root][nested] = value; } else copy[root] = value;
  }
  return copy;
}
test('all five frozen allowlists have577 targets/1727 vectors; only the two fixed long chunks are text-only', () => {
  let targets = 0, vectors = 0, skipped = 0;
  for (let number = 2; number <= 6; number++) {
    const f = fixture(number), plans = c.planWrites(snapshot(f), f.bundle, 'B', f.scope);
    assert.equal(plans.length, s.CORPUS.videos[number - 1].count);
    targets += plans.length; vectors += f.bundle.records.length;
    for (const p of plans) {
      assert.ok(!s.IDS.includes(p.chunkId));
      if (s.expectedKinds(f.scope, p.chunkId).length === 1) {
        skipped++; assert.deepEqual(p.keys, ['stableTextEmbedding', 'mediaEmbeddingMeta.text']);
      } else assert.equal(p.keys.length, 6);
    }
    const bad = structuredClone(f.scope); bad.ids[0] = s.IDS[0];
    assert.throws(() => c.planWrites(snapshot(f), f.bundle, 'B', bad));
    const mixed = structuredClone(f.bundle); mixed.records[0].identity.videoId = s.VIDEO_ID;
    assert.throws(() => c.validateBundle(mixed, f.scope));
    const foreign = structuredClone(f.scope); foreign.artifactSha256 = '0'.repeat(64);
    assert.throws(() => s.validateScope(foreign));
  }
  assert.equal(targets, 577); assert.equal(vectors, 1727); assert.equal(skipped, 2);
});

test('text-only CAS preserves skipped media as protected data; conflicts/unknown outcomes stop without retry', async () => {
  const f = fixture(3), plans = c.planWrites(snapshot(f), f.bundle, 'B', f.scope);
  const plan = plans.find(p => p.keys.length === 2), db = repository([plan.before]);
  await c.applyPlan(db, [plan], { execute: true });
  assert.equal(db.rows[0].audioEmbedding, undefined); assert.equal(db.rows[0].visualEmbedding, undefined);
  assert.deepEqual(db.rows[0].embedding, plan.before.embedding);
  db.rows[0].audioEmbedding = f.vector;
  await assert.rejects(c.rollbackPlan(db, [plan], { execute: true }), /conflict/);
  const unknown = repository([plans[0].before]); const write = unknown.updateOne;
  unknown.updateOne = async (...args) => { await write(...args); throw new Error('unknown timeout'); };
  await assert.rejects(c.applyPlan(unknown, plans, { execute: true }), /unknown/);
  assert.equal(unknown.writes, 1);
  await c.applyPlan(unknown, [plans[0]], { execute: true }); assert.equal(unknown.writes, 1);
});

test('new video plans require the existing three-path index and fully preserve completed V1', () => {
  const all = Array.from({ length: 6 }, (_, i) => fixture(i + 1));
  const f1 = all[0], firstPlans = c.planWrites(snapshot(f1), f1.bundle, 'B', f1.scope);
  const completed = f1.documents.map((d, i) => applyDesired(d, firstPlans[i]));
  const f2 = all[1], snap = { ...snapshot(f2), documents: [...completed, ...all.slice(1).flatMap(f => f.documents)], index: f2.index };
  assert.throws(() => v.validateBackup(snap, f2.scope, f2.bundle), /three-path/);
  const expanded = c.indexPlan(f2.index).after;
  snap.index = { ...f2.index, latestDefinition: expanded, statusDetail: f2.index.statusDetail.map(n => ({ ...n, mainIndex: { ...n.mainIndex, definition: expanded } })) };
  assert.equal(v.validateBackup(snap, f2.scope, f2.bundle).length, 123);
  assert.equal(c.indexPlan(snap.index).added.length, 0);
  const beforeHash = v.completedV1Hash(completed);
  completed[0].text = 'outside writer changed V1';
  assert.notEqual(v.completedV1Hash(completed), beforeHash);
  completed[0].audioEmbedding = [];
  assert.throws(() => v.validateBackup(snap, f2.scope, f2.bundle));
});

test('data-only orchestration backs up all694, checks V1 before/after writes and rejects a V1 concurrent edit', async () => {
  const all = Array.from({ length: 6 }, (_, i) => fixture(i + 1)), f = all[1];
  const plans1 = c.planWrites(snapshot(all[0]), all[0].bundle, 'B', all[0].scope);
  const completed = all[0].documents.map((d, i) => applyDesired(d, plans1[i]));
  const repo = repository([...completed, ...all.slice(1).flatMap(f => f.documents)]);
  const definition = c.indexPlan(f.index).after;
  const index = { ...f.index, latestDefinition: definition,
    statusDetail: f.index.statusDetail.map(n => ({ ...n, mainIndex: { ...n.mainIndex, definition } })) };
  repo.collectionName = 'video_segments_text';
  repo.find = query => {
    const rows = query.videoId === s.VIDEO_ID ? repo.rows.filter(r => r.videoId === s.VIDEO_ID) : repo.rows;
    return { toArray: async () => rows, limit: () => ({ toArray: async () => rows }) };
  };
  repo.aggregate = () => ({ toArray: async () => [index] });
  const db = { databaseName: 'focusflow', command: async () => ({ authInfo: { authenticatedUserPrivileges: [
    { resource: { db: 'focusflow', collection: '' }, actions: ['find', 'update', 'listSearchIndexes'] }] } }),
    collection: () => ({ find: () => ({ toArray: async () => f.videos }) }) };
  const folder = fs.mkdtempSync(path.resolve(__dirname, '../../.local-tools/corpus-test-'));
  try {
    const plan = await v.prepare(db, repo, { scope: f.scope, manifestHash: 'approved', bundle: f.bundle,
      bundleHash: 'bundle', backupFile: path.join(folder, 'backup.json') });
    assert.equal(plan.indexMutationAllowed, false); assert.equal(plan.index.added.length, 0);
    const options = { plan, scope: f.scope, manifestHash: 'approved', bundle: f.bundle, bundleHash: 'bundle' };
    repo.rows[0].text = 'another writer';
    await assert.rejects(v.execute(db, repo, options), /V1 changed/); assert.equal(repo.writes, 0);
    repo.rows[0].text = completed[0].text;
    const old = v.completedV1Hash(repo.rows);
    const result = await v.execute(db, repo, { ...options, executeWrite: true, approvePlan: plan.approvalHash,
      freshBackupFile: path.join(folder, 'prewrite.json') });
    assert.equal(result.length, 123); assert.equal(repo.writes, 123);
    assert.equal(v.completedV1Hash(repo.rows), old);
    assert.ok(fs.existsSync(path.join(folder, 'prewrite.json')));
  } finally { fs.rmSync(folder, { recursive: true }); }
});
