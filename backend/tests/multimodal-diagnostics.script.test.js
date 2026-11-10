const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildGeminiTextSearchContract } = require('../src/services/embeddingContract.service');
const { COURSE_ID, VIDEO_IDS, chunkProjection, summarizeChunks, readRows, diagnose, safeLabel } = require('../scripts/multimodal-diagnostics/run');

function row(extra = {}) {
  const contract = buildGeminiTextSearchContract();
  return { courseId: COURSE_ID, videoId: VIDEO_IDS[0], chunkId: `${VIDEO_IDS[0]}_chunk_0001`,
    startSec: 1, endSec: 12, textPresent: true, embeddingProvider: contract.provider,
    embeddingModel: contract.model, embeddingDimension: contract.dimension,
    embeddingTaskType: null, embeddingInstructionVersion: contract.instructionVersion,
    generationVersion: contract.generationVersion, normalizationVersion: contract.normalizationVersion,
    embeddingContractVersion: contract.contractVersion, embeddingSchemaVersion: contract.schemaVersion,
    textVector: { type: 'array', dimension: 3072, validNumbers: 3072, squaredNorm: 1 }, ...extra };
}

test('summary distinguishes valid dimensions from missing or incompatible model metadata', () => {
  const rows = [row(), row({ chunkId: `${VIDEO_IDS[0]}_chunk_0002`, embeddingModel: 'gemini-embedding-2-preview' })];
  const report = summarizeChunks(rows, [{ _id: VIDEO_IDS[0], durationSec: 100 }], []);
  assert.equal(report.malformedVectors, 0);
  assert.equal(report.incompatibleDeclaredMetadata, 1);
  assert.equal(report.incompleteMetadata, 0);
  assert.equal(report.contractMismatches.model, 1);
  assert.equal(report.byVideo[VIDEO_IDS[0]].count, 2);
});

test('summary flags duplicate ids, malformed vectors, invalid time and broken parent references', () => {
  const rows = [row(), row({ startSec: null, textVector: { type: 'missing', dimension: 0 } })];
  const report = summarizeChunks(rows, [{ _id: VIDEO_IDS[0], durationSec: 5 }],
    [{ videoId: VIDEO_IDS[0], childChunkIds: ['missing'] }]);
  assert.equal(report.duplicateIds, 1);
  assert.equal(report.invalidTimes, 1);
  assert.equal(report.outOfVideo, 1);
  assert.equal(report.malformedVectors, 1);
  assert.equal(report.brokenParentReferences, 1);
  const missing = summarizeChunks([row({ embeddingModel: undefined })], [], []);
  assert.equal(missing.incompleteMetadata, 1);
  assert.equal(missing.incompatibleDeclaredMetadata, 0);
});

test('read queries have explicit scope, row limit, time limit and server-side vector statistics', async () => {
  let captured;
  const db = { collection: () => ({ aggregate: (pipeline, options) => {
    captured = { pipeline, options }; return { toArray: async () => [] };
  } }) };
  await readRows(db, 'leaf', { courseId: COURSE_ID }, chunkProjection());
  assert.equal(captured.pipeline[0].$match.courseId, COURSE_ID);
  assert.equal(captured.pipeline[1].$limit, 5001);
  assert.equal(captured.options.maxTimeMS, 15000);
  assert.equal(captured.options.allowDiskUse, false);
  assert.equal(captured.pipeline[2].$project.embedding, undefined);
  assert.equal(captured.pipeline[2].$project.text, undefined);
  assert.equal(captured.pipeline[2].$project.audioEmbedding, undefined);
});

test('diagnostics use aggregation reads only and report denied index permissions without credentials', async () => {
  const calls = [];
  const db = { databaseName: 'focusflow', collection: (name) => ({ aggregate: (pipeline) => {
    calls.push({ name, pipeline });
    return { toArray: async () => {
      if (pipeline[0].$listSearchIndexes) throw Object.assign(new Error('secret connection string'), { code: 13 });
      if (name === 'video_segments_text') return [row()];
      return [];
    } };
  } }) };
  const result = await diagnose(db, { leaf: 'video_segments_text', parent: 'video_segments_parent', index: 'text_embedding_index' });
  assert.deepEqual(result.errors, [{ section: 'searchIndexes', code: '13' }]);
  assert.ok(!JSON.stringify(result).includes('secret connection string'));
  assert.ok(calls.every((call) => call.pipeline.every((stage) => ['$match', '$limit', '$project', '$listSearchIndexes'].includes(Object.keys(stage)[0]))));
  assert.equal(safeLabel('mongodb+srv://user:password@host'), '<unrecognized>');
});
