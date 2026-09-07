const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, it } = require('node:test');
const env = require('../src/config/env');
const VideoSegment = require('../src/models/videoSegment.model');
const { askQuestion } = require('../src/services/qa.service');
const {
  ids,
  newObjectId,
  resetStore,
  store,
} = require('./helpers/backendTestHarness');

const originalFetch = global.fetch;
const originalAggregate = VideoSegment.aggregate;
const originalEnv = {
  faqCacheEnabled: env.faqCacheEnabled,
  hierarchicalRetrievalEnabled: env.hierarchicalRetrievalEnabled,
  openaiApiKey: env.openaiApiKey,
  qaActiveLeafEmbeddingContractJson: env.qaActiveLeafEmbeddingContractJson,
  qaAnswerProvider: env.qaAnswerProvider,
  qaAtlasFilterMode: env.qaAtlasFilterMode,
  qaAtlasVectorIndexName: env.qaAtlasVectorIndexName,
  qaLeafAdjacentContextEnabled: env.qaLeafAdjacentContextEnabled,
  qaMatchLimit: env.qaMatchLimit,
  qaQueryEmbeddingProvider: env.qaQueryEmbeddingProvider,
  qaVectorSearchMode: env.qaVectorSearchMode,
};

function atlasLeaf(chunkId, rank, overrides = {}) {
  return {
    _id: newObjectId(),
    courseId: ids.publishedCourse,
    segmentId: `${chunkId}-segment`,
    chunkId,
    videoId: ids.publishedVideo,
    startSec: rank * 10,
    endSec: rank * 10 + 9,
    text: `course material rank ${rank}`,
    score: Number((1 - rank / 100).toFixed(4)),
    ...overrides,
  };
}

function configureAtlasSelection() {
  env.faqCacheEnabled = false;
  env.hierarchicalRetrievalEnabled = false;
  env.openaiApiKey = 'openai-test-key';
  env.qaActiveLeafEmbeddingContractJson = JSON.stringify({
    provider: 'openai',
    model: 'text-embedding-3-small',
    dimension: 1536,
    instructionVersion: null,
    generationVersion: null,
    normalizationVersion: null,
    contractVersion: null,
    taskType: null,
  });
  env.qaAnswerProvider = 'template';
  env.qaAtlasFilterMode = 'bridge_course_or_video';
  env.qaAtlasVectorIndexName = 'text_embedding_index';
  env.qaLeafAdjacentContextEnabled = true;
  env.qaMatchLimit = 15;
  env.qaQueryEmbeddingProvider = 'openai';
  env.qaVectorSearchMode = 'atlas';
  global.fetch = async () => ({
    ok: true,
    async json() {
      return { data: [{ embedding: [0.1, 0.2, 0.3] }] };
    },
  });
}

function buildAtlasCandidatePool() {
  const anchorChunkId = `${ids.publishedVideo}_chunk_0005`;
  const candidates = [atlasLeaf(anchorChunkId, 1, { startSec: 50, endSec: 60 })];
  for (let rank = 2; rank <= 15; rank += 1) {
    candidates.push(atlasLeaf(`opaque-chunk-${rank}`, rank));
  }
  candidates.push(atlasLeaf(`${ids.publishedVideo}_chunk_0006`, 16, {
    startSec: 61,
    endSec: 70,
  }));
  for (let rank = 17; rank <= 30; rank += 1) {
    candidates.push(atlasLeaf(`opaque-chunk-${rank}`, rank));
  }
  return candidates;
}

describe('qa production Leaf context selection integration', () => {
  beforeEach(() => {
    resetStore();
    configureAtlasSelection();
  });

  afterEach(() => {
    Object.assign(env, originalEnv);
    VideoSegment.aggregate = originalAggregate;
    global.fetch = originalFetch;
  });

  it('保留獨立 Top15 baseline，再用 Candidate30 與 scoped direct-read 組成 Context15', async () => {
    const candidates = buildAtlasCandidatePool();
    const previous = atlasLeaf(`${ids.publishedVideo}_chunk_0004`, 0, {
      startSec: 40,
      endSec: 49,
    });
    store.videoSegments.length = 0;
    store.videoSegments.push(...candidates, previous);
    const requestedLimits = [];
    VideoSegment.aggregate = async (pipeline) => {
      const limit = pipeline[0].$vectorSearch.limit;
      requestedLimits.push(limit);
      return candidates.slice(0, limit);
    };

    const result = await askQuestion({
      user: { id: ids.student, role: 'student' },
      courseId: ids.publishedCourse,
      question: '請說明這段教材的前後關係。',
      source: 'service-test',
    });

    assert.deepEqual(requestedLimits, [15, 30]);
    assert.equal(result.matches.length, 15);
    assert.deepEqual(result.matches.slice(0, 3).map((match) => match.chunkId), [
      `${ids.publishedVideo}_chunk_0004`,
      `${ids.publishedVideo}_chunk_0005`,
      `${ids.publishedVideo}_chunk_0006`,
    ]);
    assert.equal(result.runtime.leafContextSelection.enabled, true);
    assert.equal(result.runtime.leafContextSelection.eligible, true);
    assert.equal(result.runtime.leafContextSelection.applied, true);
    assert.equal(result.runtime.leafContextSelection.added.length, 2);
    assert.equal(result.runtime.leafContextSelection.maxAdditions, 2);
  });

  it('feature flag 預設關閉時只執行既有 Top15 且逐筆保留結果', async () => {
    env.qaLeafAdjacentContextEnabled = false;
    const candidates = buildAtlasCandidatePool();
    store.videoSegments.length = 0;
    store.videoSegments.push(...candidates);
    const requestedLimits = [];
    VideoSegment.aggregate = async (pipeline) => {
      const limit = pipeline[0].$vectorSearch.limit;
      requestedLimits.push(limit);
      return candidates.slice(0, limit);
    };

    const result = await askQuestion({
      user: { id: ids.student, role: 'student' },
      courseId: ids.publishedCourse,
      question: '請說明這段教材。',
      source: 'service-test',
    });

    assert.deepEqual(requestedLimits, [15]);
    assert.deepEqual(
      result.matches.map((match) => match.chunkId),
      candidates.slice(0, 15).map((match) => match.chunkId),
    );
    assert.equal(result.runtime.leafContextSelection.enabled, false);
    assert.equal(result.runtime.leafContextSelection.reason, 'FEATURE_DISABLED');
    assert.equal(
      result.runtime.fallbacks.some((fallback) => fallback.code === 'QA_LEAF_CONTEXT_SELECTION_FALLBACK'),
      false,
    );
  });

  it('Candidate30 查詢失敗時回傳原 Top15 並標記 degraded fallback', async () => {
    const candidates = buildAtlasCandidatePool();
    store.videoSegments.length = 0;
    store.videoSegments.push(...candidates);
    let aggregateCalls = 0;
    VideoSegment.aggregate = async (pipeline) => {
      aggregateCalls += 1;
      if (pipeline[0].$vectorSearch.limit === 30) {
        throw new Error('candidate query unavailable');
      }
      return candidates.slice(0, 15);
    };

    const result = await askQuestion({
      user: { id: ids.student, role: 'student' },
      courseId: ids.publishedCourse,
      question: '請說明這段教材。',
      source: 'service-test',
    });

    assert.equal(aggregateCalls, 2);
    assert.deepEqual(
      result.matches.map((match) => match.chunkId),
      candidates.slice(0, 15).map((match) => match.chunkId),
    );
    assert.equal(result.runtime.leafContextSelection.reason, 'CANDIDATE_SEARCH_FAILED');
    assert.equal(result.runtime.degraded, true);
    assert.equal(
      result.runtime.fallbacks.some((fallback) => fallback.code === 'QA_LEAF_CONTEXT_SELECTION_FALLBACK'),
      true,
    );
  });
});
