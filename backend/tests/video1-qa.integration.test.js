const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, repository } = require('./helpers/video1Fixture');
const { runAcceptance, readonlyAtlas } = require('../scripts/atlas-multimodal/video1-qa');
const c = require('../scripts/atlas-multimodal/control');

test('readonly capability rejects write stages, outside scope, wrong query, wrong path before calling Mongo', () => {
  const f = fixture(); let calls = 0;
  const db = { aggregate: () => { calls++; } };
  const col = readonlyAtlas(db, f.scope, { embedding: f.vector }, []);
  assert.equal(col.updateOne, undefined);
  for (const pipeline of [[{ $out: 'real' }], [{ $merge: 'real' }], [{ $vectorSearch: { path: 'embedding' } }],
    [{ $match: { videoId: { $in: ['outside'] } } }]]) assert.throws(() => col.aggregate(pipeline));
  const { buildAtlasPipeline } = require('../src/services/atlasMultimodalAdapter.service');
  const base = buildAtlasPipeline('text', f.vector, [f.scope.videoId], 'stableTextEmbedding');
  const outside = structuredClone(base); outside[0].$vectorSearch.filter.videoId.$in = ['outside'];
  assert.throws(() => col.aggregate(outside));
  const wrongQuery = structuredClone(base); wrongQuery[0].$vectorSearch.queryVector = [0, 1, ...Array(3070).fill(0)];
  assert.throws(() => col.aggregate(wrongQuery));
  const rounded = structuredClone(base); rounded[0].$vectorSearch.queryVector[0] -= 1e-16;
  assert.doesNotThrow(() => col.aggregate(rounded));
  assert.equal(calls, 0);
});

test('actual HTTP QA/Bridge/RRF uses three Fake Atlas routes; all state writes remain in harness memory', async () => {
  const f = fixture(), db = repository(f.documents);
  const plans = c.planWrites({ database: 'focusflow', collection: 'video_segments_text', documents: f.documents, videos: f.videos }, f.bundle, 'B', f.scope);
  await c.applyPlan(db, plans, { execute: true });
  const definition = c.indexPlan(f.index).after;
  let aggregates = 0;
  const capability = { aggregate: pipeline => ({ toArray: async () => {
    aggregates++;
    if (pipeline[0].$listSearchIndexes) return [{ ...f.index, latestDefinition: definition }];
    if (pipeline[0].$match) return db.rows.map(({ chunkId, videoId, startSec, endSec }) => ({ chunkId, videoId, startSec, endSec }));
    return db.rows.slice(0, 20).map((r, i) => ({ ...r, score: 1 - i / 100 }));
  } }) };
  const before = c.hash(db.rows);
  const report = await runAcceptance({ collection: capability, scope: f.scope, documents: db.rows,
    video: { _id: f.scope.videoId, courseId: f.scope.courseId, title: 'Synthetic contract fixture', sourceType: 'upload', sourceUrl: '/uploads/contract-fixture.mp4' },
    query: { kind: 'query', queryText: 'authentication course evidence', embedding: f.vector,
      metadata: { provider: 'gemini', model: 'gemini-embedding-2', status: 'success', dimension: 3072 } }, evidenceSource: 'fake-atlas-synthetic-vector' });
  assert.equal(report.status, 'passed'); assert.equal(report.atlasWrites, 0); assert.equal(report.paidCalls, 0);
  assert.equal(report.answerQualityVerified, false); assert.equal(report.channels.length, 3);
  assert.ok(aggregates >= 5); assert.equal(c.hash(db.rows), before); assert.equal(db.writes, 117);
  assert.ok(report.memoryWrites.messages > 0);
});
