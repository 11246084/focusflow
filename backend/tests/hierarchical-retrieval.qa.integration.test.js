const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, it } = require('node:test');
const {
  env,
  ids,
  resetStore,
} = require('./helpers/backendTestHarness');
const { askQuestion } = require('../src/services/qa.service');

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
    env.hierarchicalRetrievalEnabled = false;
    env.hierarchicalRetrievalFallbackToLeaf = true;
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

  it('gate=true safely falls back from unavailable parent storage to leaf citations', async () => {
    env.hierarchicalRetrievalEnabled = true;
    env.hierarchicalRetrievalFallbackToLeaf = true;
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const result = await ask();
      assert.equal(result.matches.length > 0, true);
      assert.equal(result.citations[0].segmentId, result.matches[0].segmentId);
      assert.equal(result.runtime.hierarchicalRetrieval.retrievalMode, 'leaf_fallback');
      assert.equal(result.runtime.hierarchicalRetrieval.fallbackReason, 'PARENT_REPOSITORY_UNAVAILABLE');
      assert.equal(result.runtime.fallbacks.some((item) => item.code === 'PARENT_REPOSITORY_UNAVAILABLE'), true);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('fallback=false returns the existing safe AppError contract without crashing', async () => {
    env.hierarchicalRetrievalEnabled = true;
    env.hierarchicalRetrievalFallbackToLeaf = false;
    await assert.rejects(
      ask(),
      (error) => error.code === 'HIERARCHICAL_RETRIEVAL_UNAVAILABLE' && error.statusCode === 503,
    );
  });
});
