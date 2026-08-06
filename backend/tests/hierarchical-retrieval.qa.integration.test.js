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
  });

  it('gate=false preserves leaf-only response and citation contract', async () => {
    env.hierarchicalRetrievalEnabled = false;
    const result = await ask();
    assert.equal(result.matches.length > 0, true);
    assert.equal(result.citations[0].segmentId, result.matches[0].segmentId);
    assert.equal(result.runtime.hierarchicalRetrieval, undefined);
  });

  it('gate=true safely falls back when the query embedding does not match the Parent index', async () => {
    env.hierarchicalRetrievalEnabled = true;
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
    env.hierarchicalRetrievalEnabled = true;
    env.qaMockEmbeddingDimensions = 3072;
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
    assert.equal(String(vectorSearch.filter.$or[0].courseId), ids.publishedCourse);
    assert.equal(vectorSearch.filter.$or[1].videoId.$in.includes(ids.publishedVideo), true);
    assert.equal(vectorSearch.index, env.videoSegmentParentVectorIndexName);
    assert.equal(result.runtime.searchBackendUsed, 'parent_vector');
    assert.equal(result.runtime.hierarchicalRetrieval.retrievalMode, 'hierarchical');
    assert.deepEqual(result.citations.map((citation) => citation.chunkId), [ids.segmentOne, ids.segmentTwo]);
    assert.deepEqual(result.citations.map((citation) => citation.segmentId), [ids.segmentOne, ids.segmentTwo]);
  });

  it('fallback=false returns the existing safe AppError contract without crashing', async () => {
    env.hierarchicalRetrievalEnabled = true;
    env.hierarchicalRetrievalFallbackToLeaf = false;
    env.qaMockEmbeddingDimensions = 3072;
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
});
