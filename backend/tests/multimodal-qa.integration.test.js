const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const { env, ids, resetStore, store, startServer, stopServer, loginAs, jsonRequest } = require('./helpers/backendTestHarness');
const { askQuestion } = require('../src/services/qa.service');
const VideoSegment = require('../src/models/videoSegment.model');
const VideoSegmentParent = require('../src/models/videoSegmentParent.model');
const { contractHash, setHierarchicalDataReadinessForTests, resetHierarchicalDataReadinessForTests }
  = require('../src/services/hierarchicalDataReadiness.service');
const { buildGeminiTextSearchContract } = require('../src/services/embeddingContract.service');
const { clearMultimodalIndexCache } = require('../src/services/multimodalReadiness.service');
const originalAggregate = VideoSegment.collection.aggregate;
const originalModelAggregate = VideoSegment.aggregate;
const originalParentAggregate = VideoSegmentParent.aggregate;
const originalFetch = global.fetch;
const keys = ['qaMultimodalFusionEnabled', 'qaVectorSearchMode', 'qaQueryEmbeddingProvider',
  'qaAnswerProvider', 'geminiApiKey', 'qaVisualRetrievalEnabled', 'faqCacheEnabled',
  'qaActiveLeafEmbeddingContractJson', 'qaAtlasVectorIndexName', 'qaActiveParentEmbeddingContractJson',
  'hierarchicalRetrievalEnabled', 'hierarchicalRetrievalRolloutMode', 'hierarchicalRetrievalRolloutModeValid',
  'hierarchicalRetrievalAllowedCourseIds', 'hierarchicalRetrievalAllowedVideoIds',
  'hierarchicalRetrievalAllowedUserIds', 'hierarchicalRetrievalAllowlistsValid'];
const saved = Object.fromEntries(keys.map(key => [key, env[key]]));
afterEach(() => { clearMultimodalIndexCache(); Object.assign(env, saved); global.fetch = originalFetch;
  VideoSegment.aggregate = originalModelAggregate;
  VideoSegmentParent.aggregate = originalParentAggregate;
  resetHierarchicalDataReadinessForTests();
  VideoSegment.collection.aggregate = originalAggregate; });
const ask = () => askQuestion({ user: { id: ids.student, role: 'student' },
  courseId: ids.publishedCourse, question: 'JWT authentication', source: 'test' });

test('new vector fields stay excluded and conversation source provenance survives schema casting', () => {
  for (const key of ['stableTextEmbedding', 'audioEmbedding', 'visualEmbedding', 'mediaEmbeddingMeta']) {
    assert.equal(VideoSegment.schema.path(key).options.select, false);
  }
  const { conversationSourcesFromCitations } = require('../src/services/conversation.service');
  const Message = require('../src/models/message.model');
  const sources = conversationSourcesFromCitations([{ videoId: ids.publishedVideo,
    retrievedBy: ['audio'], channelRanks: { audio: 1 }, timestamp: { startSec: 12, endSec: 32 } }]);
  const message = new Message({ sources });
  assert.deepEqual(message.toJSON().sources[0].retrievedBy, ['audio']);
  assert.deepEqual(message.toJSON().sources[0].channelRanks, { audio: 1 });
});

test('flag switch bypasses old FAQ evidence and flag OFF retains the legacy cache', async () => {
  resetStore();
  Object.assign(env, { qaMultimodalFusionEnabled: false, faqCacheEnabled: true,
    qaVectorSearchMode: 'memory', qaQueryEmbeddingProvider: 'mock', qaAnswerProvider: 'template' });
  const { saveFaqEntry } = require('../src/services/faqCache.service');
  await saveFaqEntry({ courseId: ids.publishedCourse, question: 'JWT authentication',
    answer: 'Cached teacher answer', matches: [{ segmentId: ids.segmentOne,
      videoId: ids.publishedVideo, startSec: 12, endSec: 32,
      _answerEvidenceVersion: 'supporting-evidence-v1' }], clip: null, questionEmbedding: [] });
  assert.equal((await ask()).answer, 'Cached teacher answer');
  env.qaMultimodalFusionEnabled = true;
  const on = await ask();
  assert.ok(on.runtime.multimodal);
  assert.notEqual(on.answer, 'Cached teacher answer');
  env.qaMultimodalFusionEnabled = false;
  assert.equal((await ask()).answer, 'Cached teacher answer');
});

test('flag ON with unavailable multimodal contract preserves legacy text and disables old visual path', async () => {
  resetStore();
  env.qaMultimodalFusionEnabled = true;
  env.qaVectorSearchMode = 'memory';
  env.qaQueryEmbeddingProvider = 'mock';
  env.qaAnswerProvider = 'template';
  env.qaVisualRetrievalEnabled = true;
  const result = await ask();
  assert.ok(result.citations.length);
  assert.equal(result.runtime.multimodal.usedFallback, true);
  assert.ok(result.runtime.fallbacks.some(row => row.code === 'QA_MULTIMODAL_TEXT_FALLBACK'));
  assert.equal(result.runtime.visualSearch, null);
});

test('QA with25/40 stable vectors still uses the full legacy text scope even when stable search returns20', async () => {
  resetStore(); clearMultimodalIndexCache();
  const original = store.videoSegments[0], vector = [1, ...Array(3071).fill(0)], contract = buildGeminiTextSearchContract();
  const rows = Array.from({ length: 40 }, (_, i) => ({ ...original, _id: `coverage-${i}`,
    segmentId: `coverage-${i}`, chunkId: `coverage-${i}`, startSec: i * 3, endSec: i * 3 + 2 }));
  store.videoSegments.splice(0, store.videoSegments.length, ...rows);
  Object.assign(env, { qaMultimodalFusionEnabled: true, qaVectorSearchMode: 'atlas', qaQueryEmbeddingProvider: 'gemini',
    qaAnswerProvider: 'template', geminiApiKey: 'fake-test-key', faqCacheEnabled: false,
    qaAtlasVectorIndexName: 'text_embedding_index', qaActiveLeafEmbeddingContractJson: JSON.stringify(contract) });
  global.fetch = async () => ({ ok: true, json: async () => ({ embedding: { values: vector } }) });
  VideoSegment.aggregate = async () => [rows[39], ...rows.slice(0, 19)].map(row => ({ ...row, score: .9 }));
  VideoSegment.collection.aggregate = p => ({ toArray: async () => {
    if (p[0].$listSearchIndexes) return [{ name: 'text_embedding_index', type: 'vectorSearch', status: 'READY', queryable: true,
      latestDefinition: { fields: ['stableTextEmbedding', 'audioEmbedding', 'visualEmbedding'].map(path => ({ path, type: 'vector', numDimensions: 3072, similarity: 'cosine' }))
        .concat([{ path: 'videoId', type: 'filter' }]) } }];
    if (p[0].$match) return rows.slice(0, 25);
    const path = p[0].$vectorSearch.path, kind = path === 'stableTextEmbedding' ? 'text' : path === 'audioEmbedding' ? 'audio' : 'visual';
    return (kind === 'text' ? rows.slice(0, 20) : rows.slice(0, 1)).map(r => ({ ...r, score: .9,
      mediaEmbeddingMeta: { [kind]: kind === 'text' ? contract : { provider: 'gemini', model: contract.model,
        dimension: 3072, status: 'success', contractVersion: `gemini_embedding_2_${kind}_v1` } } }));
  } });
  const r = await ask();
  assert.equal(r.runtime.multimodal.channels.textSource, 'scoped_text_search');
  assert.deepEqual(r.runtime.multimodal.channels.atlas.stableTextCoverage, {
    complete: false, expected: 40, covered: 25, reason: 'partial_stable_text_coverage' });
  assert.ok(r.matches.some(m => m.chunkId === rows[39].chunkId));
});

test('flag ON saved vectors pass query, Atlas adapter, RRF, transcript, answer and citation', async () => {
  resetStore();
  const fs = require('node:fs');
  const bundlePath = process.env.MULTIMODAL_OFFLINE_BUNDLE;
  const bundle = bundlePath ? JSON.parse(fs.readFileSync(bundlePath, 'utf8')) : null;
  const query = bundle?.records.find(row => row.kind === 'query');
  const document = bundle?.records.find(row => row.kind === 'text');
  const vector = query?.embedding || [1, ...Array(3071).fill(0)];
  const chunk = { ...store.videoSegments[0], chunkId: 'canonical-test-chunk',
    startSec: document?.identity.startSec || 12, endSec: document?.identity.endSec || 32,
    text: document?.text || 'JWT authentication teacher transcript', embedding: vector };
  store.videoSegments.splice(0, store.videoSegments.length, chunk);
  store.clips[0].jumpUrl = `https://videos.local/watch?v=${ids.publishedVideoExternal}&t=${chunk.startSec}`;
  Object.assign(env, { qaMultimodalFusionEnabled: true, qaVectorSearchMode: 'atlas',
    qaQueryEmbeddingProvider: 'gemini', qaAnswerProvider: 'template', geminiApiKey: 'fake-test-key' });
  global.fetch = async () => ({ ok: true, json: async () => ({ embedding: { values: vector } }) });
  const contract = buildGeminiTextSearchContract();
  env.qaActiveLeafEmbeddingContractJson = JSON.stringify(contract);
  env.qaAtlasVectorIndexName = 'text_embedding_index';
  const index = { name: 'text_embedding_index', type: 'vectorSearch', status: 'READY', queryable: true,
    latestDefinition: { fields: ['stableTextEmbedding', 'audioEmbedding', 'visualEmbedding'].map(path => ({
      path, type: 'vector', numDimensions: 3072, similarity: 'cosine',
    })).concat([{ path: 'videoId', type: 'filter' }]) } };
  VideoSegment.aggregate = async () => [{ ...chunk, score: 0.9 }];
  let scenario = 'success';
  VideoSegment.collection.aggregate = pipeline => ({ toArray: async () => {
    if (pipeline[0].$match) return [chunk]; // Full-scope coverage preflight, separate from search top-K.
    if (pipeline[0].$listSearchIndexes) {
      if (scenario === 'preflight-failed') throw new Error('unavailable');
      if (scenario === 'missing-index') return [{ ...index, latestDefinition: { fields: [] } }];
      return [index];
    }
    const channel = { stableTextEmbedding: 'text', audioEmbedding: 'audio', visualEmbedding: 'visual' }
      [pipeline[0].$vectorSearch.path];
    assert.ok(pipeline[0].$vectorSearch.filter.videoId.$in.includes(chunk.videoId));
    if (scenario === 'all-failed' || (scenario === 'partial' && channel === 'audio')) throw new Error('unavailable');
    if (scenario === 'empty') return [];
    return [{ ...chunk, ...(scenario === 'invalid-time' ? { endSec: -1 } : {}), score: 0.9, mediaEmbeddingMeta: {
      [channel]: channel === 'text' ? contract : { provider: 'gemini', dimension: 3072,
        status: 'success', model: 'gemini-embedding-2', contractVersion: `gemini_embedding_2_${channel}_v1` },
    } }];
  } });
  const result = await ask();
  assert.equal(result.runtime.multimodal.usedFallback, false);
  assert.ok(result.answer);
  assert.equal(result.matches[0].transcript, chunk.text);
  assert.deepEqual(result.citations[0].retrievedBy, ['text', 'audio', 'visual']);
  assert.equal(result.citations[0].timestamp.startSec, chunk.startSec);
  assert.equal(result.citations[0].timestamp.endSec, chunk.endSec);
  assert.ok(result.clip.jumpUrl.endsWith(`t=${chunk.startSec}`));
  Object.assign(env, { hierarchicalRetrievalEnabled: true, hierarchicalRetrievalRolloutMode: 'serve',
    hierarchicalRetrievalRolloutModeValid: true, hierarchicalRetrievalAllowedCourseIds: [ids.publishedCourse],
    hierarchicalRetrievalAllowedVideoIds: [chunk.videoId], hierarchicalRetrievalAllowedUserIds: [ids.student],
    hierarchicalRetrievalAllowlistsValid: true, qaActiveParentEmbeddingContractJson: JSON.stringify(contract) });
  setHierarchicalDataReadinessForTests({ status: 'verified', ready: true, checkedAt: new Date(0).toISOString(),
    source: 'synthetic-fixture', reason: null, failures: [], evidence: { contractHash: contractHash(contract) } });
  let parentCalls = 0;
  VideoSegmentParent.aggregate = async () => {
    parentCalls++;
    return [{ parentId: 'synthetic-real-qa-parent', courseId: ids.publishedCourse, videoId: chunk.videoId,
      childChunkIds: [chunk.chunkId], startSec: 0, endSec: chunk.endSec + 10, score: 0.95,
      order: 1, hierarchyLevel: 1, documentType: 'parent_chunk', isActive: true,
      embeddingProvider: contract.provider, embeddingModel: contract.model, embeddingDimension: contract.dimension,
      embeddingTaskType: null, embeddingInstructionVersion: contract.instructionVersion,
      generationVersion: contract.generationVersion, normalizationVersion: contract.normalizationVersion,
      embeddingContractVersion: contract.contractVersion, embeddingSchemaVersion: 'parent_embedding_v2' }];
  };
  env.faqCacheEnabled = false;
  const hierarchical = await ask();
  assert.equal(parentCalls, 1);
  assert.equal(hierarchical.runtime.hierarchicalRetrieval.retrievalMode, 'hierarchical');
  assert.equal(hierarchical.citations[0].timestamp.startSec, chunk.startSec);
  assert.deepEqual(hierarchical.citations[0].retrievedBy, ['text', 'audio', 'visual']);
  env.hierarchicalRetrievalEnabled = false;
  for (const variant of ['partial', 'missing-index', 'preflight-failed', 'empty', 'invalid-time', 'all-failed']) {
    clearMultimodalIndexCache();
    scenario = variant;
    env.faqCacheEnabled = false;
    const degraded = await ask();
    assert.ok(degraded.citations.length, variant);
    assert.equal(degraded.runtime.multimodal.usedFallback, variant !== 'partial', variant);
    assert.equal(degraded.citations[0].timestamp.startSec, chunk.startSec);
  }
  scenario = 'success';
  clearMultimodalIndexCache();
  global.fetch = async (url, ...args) => String(url).startsWith('https://generativelanguage.googleapis.com/')
    ? { ok: true, json: async () => ({ embedding: { values: vector } }) }
    : originalFetch(url, ...args);
  const context = await startServer();
  try {
    const token = await loginAs(context.baseUrl, 'student@focusflow.local', 'Student123!');
    const response = await jsonRequest(context.baseUrl, '/api/v1/qa/ask', { method: 'POST', token,
      body: { courseId: ids.publishedCourse, question: 'JWT authentication' } });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data.citations[0].retrievedBy, ['text', 'audio', 'visual']);
    if (process.env.MULTIMODAL_BROWSER_FIXTURE) {
      const match = response.body.data.matches[0];
      fs.writeFileSync(process.env.MULTIMODAL_BROWSER_FIXTURE, JSON.stringify({
        provenance: 'saved-gemini-query / fake-atlas / template-answer',
        match: { videoId: match.videoId, chunkId: match.chunkId, startSec: match.startSec,
          endSec: match.endSec, retrievedBy: match.retrievedBy, channelRanks: match.channelRanks },
        citation: { videoId: response.body.data.citations[0].videoId,
          chunkId: response.body.data.citations[0].chunkId,
          timestamp: response.body.data.citations[0].timestamp,
          retrievedBy: response.body.data.citations[0].retrievedBy,
          channelRanks: response.body.data.citations[0].channelRanks },
      }));
    }
    const { toStudentCitation } = await import('../../frontend/focus-flow/src/pages/qaConversationUtils.js');
    assert.equal(toStudentCitation(response.body.data.matches[0]).retrievalLabel, '文字、聲音、畫面');
    if (process.env.MULTIMODAL_FULL_BROWSER_OUTPUT) {
      const { runStudentBrowser } = await import('../scripts/runStudentBrowserFixture.mjs');
      const result = await runStudentBrowser({ backendUrl: context.baseUrl, env, store, ids,
        chunkId: chunk.chunkId, startSec: chunk.startSec, endSec: chunk.endSec, setScenario: value => { scenario = value; clearMultimodalIndexCache(); },
        outputDirectory: process.env.MULTIMODAL_FULL_BROWSER_OUTPUT,
        mediaFile: process.env.MULTIMODAL_SYNTHETIC_MEDIA });
      assert.equal(result.length, 6);
    }
  } finally {
    await stopServer(context.server);
  }
});
