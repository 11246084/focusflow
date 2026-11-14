const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const c = require('../scripts/atlas-multimodal/control');
const s = require('../scripts/atlas-multimodal/video1-scope');
const v = require('../scripts/atlas-multimodal/video1');
const { fixture, repository } = require('./helpers/video1Fixture');

test('V1 exact117 allowlist,351 vectors and B-only contract reject unauthorized identity and transcript changes', () => {
  const f = fixture(), snapshot = { database: 'focusflow', collection: 'video_segments_text', documents: f.documents, videos: f.videos };
  assert.equal(c.planWrites(snapshot, f.bundle, 'B', f.scope).length, 117);
  assert.throws(() => c.planWrites(snapshot, f.bundle, 'A', f.scope));
  for (const mutate of [x => x.ids.pop(), x => x.ids[0] = x.ids[1], x => x.chunks[0].videoId = 'outside',
    x => x.chunks[0].chunkId = `${s.VIDEO_ID}_chunk_0118`]) {
    const scope = structuredClone(f.scope); mutate(scope); assert.throws(() => c.planWrites(snapshot, f.bundle, 'B', scope));
  }
  f.documents[0].text = 'changed'; assert.throws(() => c.planWrites(snapshot, f.bundle, 'B', f.scope));
});

test('117 CAS writes preserve original embedding and all non-owned data, then restore exact preimages', async () => {
  const f = fixture(), snapshot = { database: 'focusflow', collection: 'video_segments_text', documents: f.documents, videos: f.videos };
  const plans = c.planWrites(snapshot, f.bundle, 'B', f.scope), db = repository(f.documents), intents = [], receipts = [];
  await c.applyPlan(db, plans, { execute: true, intent: async e => intents.push(e), receipt: async r => receipts.push(r.length) });
  assert.equal(db.writes, 117); assert.equal(intents.length, 117); assert.equal(receipts.at(-1), 117);
  assert.ok(db.rows.every((r, i) => c.hash(r.embedding) === c.hash(f.documents[i].embedding) && c.protectedHash(r) === plans[i].protectedHash));
  await c.applyPlan(db, plans, { execute: true }); assert.equal(db.writes, 117);
  await c.rollbackPlan(db, plans, { execute: true }); assert.equal(c.hash(db.rows), c.hash(f.documents));
});

test('CAS conflict and timeout/unknown outcome stop immediately; replay reconciles before any resubmission', async () => {
  const f = fixture(), plans = c.planWrites({ database: 'focusflow', collection: 'video_segments_text', documents: f.documents, videos: f.videos }, f.bundle, 'B', f.scope);
  const conflict = repository(f.documents); conflict.updateOne = async () => ({ matchedCount: 0 });
  await assert.rejects(c.applyPlan(conflict, plans, { execute: true }), /CAS conflict/);
  const db = repository(f.documents), original = db.updateOne; let calls = 0;
  db.updateOne = async (...args) => { calls++; await original(...args); throw new Error('timeout: unknown outcome'); };
  const intents = [];
  await assert.rejects(c.applyPlan(db, plans, { execute: true, intent: async e => intents.push(e) }), /unknown/);
  assert.equal(calls, 1); assert.equal(intents.length, 1);
  await c.applyPlan(db, plans.slice(0, 1), { execute: true }); assert.equal(calls, 1);
  db.rows[0].text = 'another writer'; await assert.rejects(c.rollbackPlan(db, plans, { execute: true }), /conflict/);
});

test('fresh backup/permissions/index/version hashes gate every target before first write; dry-run never writes', async () => {
  const f = fixture();
  const extras = Array.from({ length: 577 }, (_, i) => ({ _id: `extra-${i}`, chunkId: `extra-${i}`, videoId: c.VIDEO_IDS[1] }));
  const dbcol = repository([...f.documents, ...extras]);
  dbcol.collectionName = 'video_segments_text';
  dbcol.find = () => ({ limit: () => ({ toArray: async () => dbcol.rows }) });
  dbcol.aggregate = () => ({ toArray: async () => [f.index] });
  let permissionActions = ['find', 'update', 'listSearchIndexes', 'updateSearchIndex'];
  const db = { databaseName: 'focusflow', command: async () => ({ authInfo: { authenticatedUserPrivileges: [
    { resource: { db: 'focusflow', collection: '' }, actions: permissionActions }] } }),
  collection: () => ({ find: () => ({ toArray: async () => f.videos }) }) };
  const folder = fs.mkdtempSync(path.resolve(__dirname, '../../.local-tools/video1-test-'));
  try {
    const plan = await v.prepare(db, dbcol, { scope: f.scope, manifestHash: 'm', bundle: f.bundle, bundleHash: 'b', backupFile: path.join(folder, 'backup.json') });
    const options = { plan, scope: f.scope, manifestHash: 'm', bundle: f.bundle, bundleHash: 'b' };
    assert.equal((await v.execute(db, dbcol, options)).length, 117); assert.equal(dbcol.writes, 0);
    await assert.rejects(v.execute(db, dbcol, { ...options, executeWrite: true, approvePlan: 'bad' }), /hash/);
    await v.execute(db, dbcol, { ...options, executeWrite: true, approvePlan: plan.approvalHash,
      freshBackupFile: path.join(folder, 'fresh-before-write.json') });
    assert.equal(dbcol.writes, 117);
    assert.ok(fs.existsSync(path.join(folder, 'fresh-before-write.json')));
    await v.execute(db, dbcol, { ...options, executeWrite: true, approvePlan: plan.approvalHash, direction: 'restore',
      freshBackupFile: path.join(folder, 'fresh-before-restore.json') });
    assert.equal(dbcol.writes, 234);
    f.videos[0].activeTranscriptVersion = 'new'; await assert.rejects(v.execute(db, dbcol, options), /version/);
    f.videos[0].activeTranscriptVersion = 'fixed-v1'; permissionActions = ['find'];
    await assert.rejects(v.execute(db, dbcol, options), /privileges/); assert.equal(dbcol.writes, 234);
  } finally { fs.rmSync(folder, { recursive: true }); }
});
