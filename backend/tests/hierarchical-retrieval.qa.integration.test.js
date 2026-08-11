const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, it } = require('node:test');
const {
  env,
  ids,
  resetStore,
  store,
} = require('./helpers/backendTestHarness');
const VideoSegmentParent = require('../src/models/videoSegmentParent.model');
const { askQuestion } = require('../src/services/qa.service');

const originalParentAggregate = VideoSegmentParent.aggregate;
const originalMockEmbeddingDimensions = env.qaMockEmbeddingDimensions;
const rolloutKeys = [
  'hierarchicalRetrievalRolloutMode',
  'hierarchicalRetrievalRolloutModeValid',
  'hierarchicalRetrievalAllowedCourseIds',
  'hierarchicalRetrievalAllowedVideoIds',
  'hierarchicalRetrievalAllowedUserIds',
  'hierarchicalRetrievalAllowlistsValid',
];
const originalRollout = Object.fromEntries(rolloutKeys.map((key) => [key, env[key]]));

function enableEligibleRollout(mode = 'serve') {
  env.hierarchicalRetrievalEnabled = true;
  env.hierarchicalRetrievalRolloutMode = mode;
  env.hierarchicalRetrievalRolloutModeValid = true;
  env.hierarchicalRetrievalAllowedCourseIds = [ids.publishedCourse];
  env.hierarchicalRetrievalAllowedVideoIds = [ids.publishedVideo];
  env.hierarchicalRetrievalAllowedUserIds = [ids.student];
  env.hierarchicalRetrievalAllowlistsValid = true;
  env.qaActiveParentEmbeddingContractJson = JSON.stringify({
    provider: 'mock', model: 'mock', dimension: env.qaMockEmbeddingDimensions,
    instructionVersion: null, generationVersion: null, normalizationVersion: null,
    contractVersion: null, schemaVersion: null, taskType: null,
  });
}

function ask() {
  return askQuestion({
    user: { id: ids.student, role: 'student' },
    courseId: ids.publishedCourse,
    question: 'Tell me about JWT authentication and role based access control.',
    source: 'hierarchical-integration-test',
  });
}

describe('hierarchical retrieval QA integration', () => {
  beforeEach(() => {
    resetStore();
    env.qaAnswerProvider = 'template';
    env.qaQueryEmbeddingProvider = 'mock';
    env.qaVectorSearchMode = 'memory';
    env.faqCacheEnabled = false;
    env.qaActiveLeafEmbeddingContractJson = '';
    env.qaActiveParentEmbeddingContractJson = '';
    env.hierarchicalRetrievalRolloutMode = 'off';
    env.hierarchicalRetrievalRolloutModeValid = true;
    env.hierarchicalRetrievalAllowedCourseIds = [];
    env.hierarchicalRetrievalAllowedVideoIds = [];
    env.hierarchicalRetrievalAllowedUserIds = [];
    env.hierarchicalRetrievalAllowlistsValid = true;
  });

  afterEach(() => {
    VideoSegmentParent.aggregate = originalParentAggregate;
    env.hierarchicalRetrievalEnabled = false;
    env.hierarchicalRetrievalFallbackToLeaf = true;
    env.qaMockEmbeddingDimensions = originalMockEmbeddingDimensions;
    env.qaAnswerProvider = 'template';
    env.qaQueryEmbeddingProvider = 'mock';
    env.qaVectorSearchMode = 'memory';
    env.faqCacheEnabled = true;
    env.qaActiveLeafEmbeddingContractJson = '';
    env.qaActiveParentEmbeddingContractJson = '';
    Object.assign(env, originalRollout);
  });

  it('gate=false preserves leaf-only response and citation contract', async () => {
    env.hierarchicalRetrievalEnabled = false;
    const result = await ask();
    assert.equal(result.matches.length > 0, true);
    assert.equal(result.citations[0].segmentId, result.matches[0].segmentId);
    assert.equal(result.runtime.hierarchicalRetrieval, undefined);
  });

  it('gate=true safely falls back when the query embedding does not match the Parent index', async () => {
    enableEligibleRollout('serve');
    env.hierarchicalRetrievalFallbackToLeaf = true;
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const result = await ask();
      assert.equal(result.matches.length > 0, true);
      assert.equal(result.citations[0].segmentId, result.matches[0].segmentId);
      assert.equal(result.runtime.hierarchicalRetrieval.retrievalMode, 'leaf_fallback');
      assert.equal(result.runtime.hierarchicalRetrieval.fallbackReason, 'PARENT_EMBEDDING_DIMENSION_MISMATCH');
      assert.equal(result.runtime.fallbacks.some((item) => item.code === 'PARENT_EMBEDDING_DIMENSION_MISMATCH'), true);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('gate=true uses the formal Parent adapter for an allowed mounted video and returns Leaf citations', async () => {
    env.qaMockEmbeddingDimensions = 3072;
    enableEligibleRollout('serve');
    for (const segment of store.videoSegments) segment.videoId = ids.publishedVideo;

    let capturedPipeline;
    VideoSegmentParent.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [{
        parentId: `${ids.publishedVideo}_parent_0001`,
        courseId: ids.teacherCourse,
        videoId: ids.publishedVideo,
        childChunkIds: [ids.segmentOne, ids.segmentTwo],
        score: 0.93,
        startSec: 12,
        endSec: 58,
        order: 1,
        hierarchyLevel: 1,
        documentType: 'parent_chunk',
      }];
    };

    const result = await ask();
    const vectorSearch = capturedPipeline[0].$vectorSearch;
    const authorizedScope = vectorSearch.filter.$and[0];
    const rolloutScope = vectorSearch.filter.$and[1];
    assert.equal(String(authorizedScope.$or[0].courseId), ids.publishedCourse);
    assert.equal(authorizedScope.$or[1].videoId.$in.includes(ids.publishedVideo), true);
    assert.deepEqual(rolloutScope.videoId.$in, [ids.publishedVideo]);
    assert.equal(vectorSearch.index, env.videoSegmentParentVectorIndexName);
    assert.equal(result.runtime.searchBackendUsed, 'parent_vector');
    assert.equal(result.runtime.hierarchicalRetrieval.retrievalMode, 'hierarchical');
    assert.deepEqual(result.citations.map((citation) => citation.chunkId), [ids.segmentOne, ids.segmentTwo]);
    assert.deepEqual(result.citations.map((citation) => citation.segmentId), [ids.segmentOne, ids.segmentTwo]);
  });

  it('fallback=false returns the existing safe AppError contract without crashing', async () => {
    env.hierarchicalRetrievalFallbackToLeaf = false;
    env.qaMockEmbeddingDimensions = 3072;
    enableEligibleRollout('serve');
    VideoSegmentParent.aggregate = async () => {
      const error = new Error('index unavailable');
      error.codeName = 'IndexNotFound';
      throw error;
    };
    await assert.rejects(
      ask(),
      (error) => error.code === 'HIERARCHICAL_RETRIEVAL_UNAVAILABLE' && error.statusCode === 503,
    );
  });

  it('shadow mode preserves the Leaf answer, matches, and citations', async () => {
    env.qaMockEmbeddingDimensions = 3072;
    for (const segment of store.videoSegments) segment.videoId = ids.publishedVideo;
    env.hierarchicalRetrievalEnabled = false;
    const leafOnly = await ask();

    enableEligibleRollout('shadow');
    let shadowCalls = 0;
    VideoSegmentParent.aggregate = async () => [{
      parentId: `${ids.publishedVideo}_parent_0001`,
      courseId: ids.publishedCourse,
      videoId: ids.publishedVideo,
      childChunkIds: [ids.segmentTwo],
      score: 0.99,
      startSec: 20,
      endSec: 40,
      order: 1,
      hierarchyLevel: 1,
      documentType: 'parent_chunk',
    }].map((parent) => {
      shadowCalls += 1;
      return parent;
    });

    const shadow = await ask();
    assert.equal(shadowCalls, 1);
    assert.equal(shadow.answer, leafOnly.answer);
    assert.deepEqual(shadow.matches, leafOnly.matches);
    assert.deepEqual(shadow.citations, leafOnly.citations);
    assert.equal(shadow.runtime.answerProviderUsed, leafOnly.runtime.answerProviderUsed);
    assert.equal(shadow.runtime.hierarchicalRollout.retrievalRolloutMode, 'shadow');
    assert.equal(shadow.runtime.hierarchicalRollout.shadowExecuted, true);
    assert.equal(shadow.runtime.hierarchicalRetrieval, undefined);
  });
});
