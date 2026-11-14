const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildGeminiTextSearchContract } = require('../src/services/embeddingContract.service');
const { VECTOR_FIELDS, buildAtlasPipeline, channelReadiness, readAtlasIndex, retrieveAtlasMultimodal } = require('../src/services/atlasMultimodalAdapter.service');

const scope = { courseId: 'course', allowedVideoIds: ['video'] };
const contract = buildGeminiTextSearchContract();
const query = { provider: 'gemini', model: 'gemini-embedding-2', status: 'success', dimension: 3072,
  modality: 'query', contractVersion: contract.contractVersion, embedding: [1, ...Array(3071).fill(0)] };
const index = { name: 'text_embedding_index', type: 'vectorSearch', status: 'READY', queryable: true,
  latestDefinition: { fields: [...Object.values(VECTOR_FIELDS).map((path) => ({ path, type: 'vector', numDimensions: 3072, similarity: 'cosine' })),
    { path: 'videoId', type: 'filter' }] } };
function candidate(chunkId = 'video_chunk_0001', extra = {}) {
  return { videoId: 'video', chunkId, startSec: 10, endSec: 12, text: chunkId, score: 0.8,
    embeddingProvider: contract.provider, embeddingModel: contract.model, embeddingDimension: contract.dimension,
    embeddingTaskType: null, embeddingInstructionVersion: contract.instructionVersion,
    generationVersion: contract.generationVersion, normalizationVersion: contract.normalizationVersion,
    embeddingContractVersion: contract.contractVersion, embeddingSchemaVersion: contract.schemaVersion,
    mediaEmbeddingMeta: { audio: { provider: 'gemini', dimension: 3072, status: 'success', model: 'gemini-embedding-2', contractVersion: 'gemini_embedding_2_audio_v1' },
      visual: { provider: 'gemini', dimension: 3072, status: 'success', model: 'gemini-embedding-2', contractVersion: 'gemini_embedding_2_visual_v1' } }, ...extra };
}

test('three Atlas paths share the authorized video filter and omit vectors from candidate projection', () => {
  for (const [channel, path] of Object.entries(VECTOR_FIELDS)) {
    const pipeline = buildAtlasPipeline(channel, query.embedding, scope.allowedVideoIds);
    assert.equal(pipeline[0].$vectorSearch.path, path);
    assert.equal(pipeline[0].$vectorSearch.limit, 20);
    assert.equal(pipeline[0].$vectorSearch.numCandidates, 100);
    assert.deepEqual(pipeline[0].$vectorSearch.filter, { videoId: { $in: ['video'] } });
    assert.equal(pipeline[1].$project.embedding, undefined);
  }
  assert.throws(() => buildAtlasPipeline('unknown', [], ['video']), /channel/);
});

test('mock repository connects all three real query builders to actual RRF', async () => {
  const calls = [];
  const collection = { aggregate: (pipeline, options) => {
    calls.push({ pipeline, options });
    return { toArray: async () => [candidate(), candidate('video_chunk_0002')] };
  } };
  const result = await retrieveAtlasMultimodal({ collection, queryEmbedding: query, scope, indexSnapshot: index, textDataContract: contract });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.options.maxTimeMS === 10000 && call.options.signal));
  assert.equal(result.matches.length, 2);
  assert.equal(result.matches[0].fusionScore, 3 / 61);
  assert.deepEqual(result.matches[0].retrievedBy, ['text', 'audio', 'visual']);
  assert.equal(result.matches[0].courseId, 'course');
  assert.equal(result.matches[0].startSec, 10);
  assert.ok(result.diagnostics.audio.ms >= 0);
});

test('existing text-only index and unknown preview contract cause zero queries', async () => {
  let calls = 0;
  const collection = { aggregate: () => { calls += 1; throw new Error('Should not query'); } };
  const old = { ...index, latestDefinition: { fields: index.latestDefinition.fields.filter((field) => !['audioEmbedding', 'visualEmbedding'].includes(field.path)) } };
  const result = await retrieveAtlasMultimodal({ collection, queryEmbedding: query, scope, indexSnapshot: old });
  assert.equal(calls, 0);
  assert.equal(result.diagnostics.text.reason, 'text_contract_unverified');
  assert.equal(result.diagnostics.audio.reason, 'index_field_missing');
  assert.deepEqual(result.matches, []);
  assert.equal(channelReadiness({ ...index, queryable: false }, 'text', contract), 'index_not_ready');
});

test('unauthorized videos and invalid metadata are excluded; source course does not override authorized video sharing', async () => {
  const collection = { aggregate: () => ({ toArray: async () => [candidate('bad', { videoId: 'other' }),
    candidate('bad2', { courseId: 'other-course' }), candidate('bad3', { mediaEmbeddingMeta: {} }), candidate()] }) };
  const result = await retrieveAtlasMultimodal({ collection, queryEmbedding: query, scope, indexSnapshot: index });
  assert.deepEqual(result.matches.map((item) => item.chunkId), ['bad2', 'video_chunk_0001']);
});

test('one failed route degrades safely and provider error contents stay private', async () => {
  const collection = { aggregate: (pipeline) => ({ toArray: async () => {
    if (pipeline[0].$vectorSearch.path === 'audioEmbedding') throw new Error('SECRET');
    return [candidate()];
  } }) };
  const result = await retrieveAtlasMultimodal({ collection, queryEmbedding: query, scope, indexSnapshot: index, textDataContract: contract });
  assert.equal(result.diagnostics.audio.status, 'failed');
  assert.equal(result.diagnostics.audio.reason, 'atlas_query_failed');
  assert.deepEqual(result.matches[0].retrievedBy, ['text', 'visual']);
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
});

test('query contract and explicit scope are validated before repository access', async () => {
  await assert.rejects(retrieveAtlasMultimodal({ queryEmbedding: { ...query, model: 'preview' } }), /stable/);
  await assert.rejects(retrieveAtlasMultimodal({ queryEmbedding: query, scope: {} }), /authorized/);
  await assert.rejects(retrieveAtlasMultimodal({ queryEmbedding: query, scope, timeoutMs: 0 }), /timeout/);
});

test('index preflight is bounded and read-only', async () => {
  const collection = { aggregate: (pipeline, options) => {
    assert.deepEqual(pipeline, [{ $listSearchIndexes: { name: 'text_embedding_index' } }]);
    assert.equal(options.maxTimeMS, 10000);
    return { toArray: async () => [index] };
  } };
  assert.equal(await readAtlasIndex(collection), index);
  await assert.rejects(readAtlasIndex({ aggregate: () => { throw new Error('SECRET'); } }),
    (error) => error.message === 'Atlas index preflight failed; details redacted.');
});
