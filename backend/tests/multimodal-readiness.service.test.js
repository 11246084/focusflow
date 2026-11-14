const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createIndexSnapshotReader, readStableTextCoverage } = require('../src/services/multimodalReadiness.service');

test('index metadata is single-flight, expires, retries errors after short TTL and supports explicit invalidation', async () => {
  let time = 0, calls = 0, fail = false;
  const collection = {}, other = {};
  const cache = createIndexSnapshotReader({ now: () => time, read: async () => {
    calls++; if (fail) throw new Error('SECRET'); return { status: 'READY', latestDefinition: { fields: [] } };
  } });
  const results = await Promise.all(Array.from({ length: 5 }, () => cache.get(collection)));
  assert.equal(calls, 1);
  results[0].status = 'mutated'; assert.equal((await cache.get(collection)).status, 'READY');
  time = 30000; fail = true; assert.equal(await cache.get(collection), null); assert.equal(calls, 2);
  assert.equal(await cache.get(collection), null); assert.equal(calls, 2);
  time += 5000; fail = false; await cache.get(collection); assert.equal(calls, 3);
  await cache.get(other); assert.equal(calls, 4);
  cache.clear(); await cache.get(collection); assert.equal(calls, 5);
});
test('clearing while a read is pending cannot repopulate the new cache with the old result', async () => {
  let resolve; let calls = 0;
  const cache = createIndexSnapshotReader({ read: () => { calls++; return calls === 1 ? new Promise(r => { resolve = r; }) : Promise.resolve({ status: 'NEW' }); } });
  const collection = {}, old = cache.get(collection);
  await Promise.resolve(); cache.clear(); await cache.get(collection); resolve({ status: 'OLD' }); await old;
  assert.equal((await cache.get(collection)).status, 'NEW'); assert.equal(calls, 2);
});
const segments = Array.from({ length: 40 }, (_, i) => ({ videoId: i < 25 ? 'v1' : 'v2', chunkId: `c${i}`, startSec: i * 10, endSec: i * 10 + 8 }));
const scope = { courseId: 'course', allowedVideoIds: ['v1', 'v2'] };
test('25 available chunks still cannot stand for all 40; identities, contracts and vectors are checked beyond top20', async () => {
  let returned = segments.slice(0, 25), pipeline;
  const collection = { aggregate: (p, options) => {
    pipeline = p; assert.equal(options.maxTimeMS, 3000); assert.ok(options.signal);
    return { toArray: async () => returned };
  } };
  const partial = await readStableTextCoverage(collection, scope, segments);
  assert.deepEqual(partial, { complete: false, expected: 40, covered: 25, reason: 'partial_stable_text_coverage' });
  assert.deepEqual(pipeline[0].$match.videoId.$in, scope.allowedVideoIds);
  assert.equal(pipeline[0].$match['mediaEmbeddingMeta.text.contractVersion'], 'gemini_embedding_2_text_v2');
  assert.ok(pipeline[1].$match.$expr.$and.length > 1);
  assert.equal(pipeline[2].$project.stableTextEmbedding, undefined);
  returned = segments; assert.equal((await readStableTextCoverage(collection, scope, segments)).complete, true);
  // A deletion after a previous successful check must be observed, not hidden by a positive cache.
  returned = segments.slice(0, 39); assert.equal((await readStableTextCoverage(collection, scope, segments)).complete, false);
  returned = [...segments.slice(0, 39), segments[0]];
  assert.equal((await readStableTextCoverage(collection, scope, segments)).reason, 'coverage_identity_conflict');
  returned = segments.map(r => ({ ...r, endSec: r.endSec + 1 }));
  assert.equal((await readStableTextCoverage(collection, scope, segments)).complete, false);
});
test('unknown, empty or legacy scope and coverage failure cannot enable stable text', async () => {
  const collection = { aggregate: () => { throw new Error('SECRET'); } };
  assert.equal((await readStableTextCoverage(collection, scope, segments)).reason, 'coverage_check_failed');
  assert.equal((await readStableTextCoverage(collection, scope, [])).complete, false);
  assert.equal((await readStableTextCoverage(collection, scope, [{ ...segments[0], chunkId: null }])).complete, false);
});
