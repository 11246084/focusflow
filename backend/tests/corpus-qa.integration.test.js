const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/video1Fixture');
const c = require('../scripts/atlas-multimodal/control');
const { runAcceptance } = require('../scripts/atlas-multimodal/video1-qa');

for (let number = 2; number <= 6; number++) test(`V${number} memory-only HTTP QA/Bridge/RRF acceptance respects its own allowlist`, async () => {
  const f = fixture(number);
  const documents = f.documents.map(d => ({ ...d, stableTextEmbedding: f.vector,
    ...(d.endSec - d.startSec <= 60 ? { audioEmbedding: f.vector, visualEmbedding: f.vector } : {}),
    mediaEmbeddingMeta: Object.fromEntries(f.bundle.records.filter(r => r.identity.chunkId === d.chunkId).map(r => [r.kind, r.metadata])) }));
  const index = { ...f.index, latestDefinition: c.indexPlan(f.index).after };
  let vectorCalls = 0;
  const collection = { aggregate: p => ({ toArray: async () => {
    if (p[0].$listSearchIndexes) return [index];
    if (p[0].$match) return documents.map(({ chunkId, videoId, startSec, endSec }) => ({ chunkId, videoId, startSec, endSec }));
    vectorCalls++; assert.deepEqual(p[0].$vectorSearch.filter.videoId.$in, [f.scope.videoId]);
    return documents.filter(d => d[p[0].$vectorSearch.path]).slice(0, 20).map((d, i) => ({ ...d, score: 1 - i / 100 }));
  } }) };
  const report = await runAcceptance({ collection, scope: f.scope, documents,
    video: { _id: f.scope.videoId, courseId: f.scope.courseId, title: 'Synthetic contract fixture', sourceType: 'upload', sourceUrl: '/uploads/synthetic-contract-fixture.mp4' },
    query: { kind: 'query', queryText: 'authentication course evidence', embedding: f.vector,
      metadata: { provider: 'gemini', model: 'gemini-embedding-2', status: 'success', dimension: 3072 } },
    evidenceSource: 'fake-atlas-synthetic-contract-fixture' });
  assert.equal(report.scope.chunks, f.scope.ids.length); assert.equal(report.status, 'passed');
  assert.equal(report.atlasWrites, 0); assert.equal(report.paidCalls, 0); assert.equal(vectorCalls, 6);
  assert.equal(report.authorizationNegativeControl, 'passed'); assert.equal(report.answerQualityVerified, false);
});
