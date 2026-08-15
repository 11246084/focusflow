const assert = require('node:assert/strict');
const { afterEach, describe, it } = require('node:test');
const env = require('../src/config/env');
const { generateAnswer } = require('../src/services/answerGeneration.service');
const { buildCitations } = require('../src/services/qa.service');
const { retrieveWithHierarchy } = require('../src/services/hierarchicalRetrieval.service');
const { createFakeParentRepository } = require('./helpers/fakeParentRepository');

const originalAnswerProvider = env.qaAnswerProvider;
const originalWarn = console.warn;

const parentHit = {
  parentId: 'video-1_parent_0001', courseId: 'course-1', videoId: 'video-1',
  childChunkIds: ['c1', 'c2'], score: 0.9, startSec: 10, endSec: 30, order: 1,
  hierarchyLevel: 1, documentType: 'parent_chunk',
  isActive: true,
  embeddingProvider: 'gemini', embeddingModel: 'gemini-embedding-2', embeddingDimension: 3072,
  embeddingTaskType: null, embeddingInstructionVersion: 'gemini_embedding_2_asymmetric_retrieval_v2',
  generationVersion: 'text_search_generation_v2', normalizationVersion: 'unit_l2_v1',
  embeddingContractVersion: 'gemini_embedding_2_text_v2', embeddingSchemaVersion: 'parent_embedding_v2',
};
const leafDocuments = [
  { chunkId: 'c1', videoId: 'video-1', courseId: 'course-1', startSec: 10, endSec: 20, text: 'first leaf' },
  { chunkId: 'c2', videoId: 'video-1', courseId: 'course-1', startSec: 20, endSec: 30, text: 'second leaf' },
];
const scope = { allowedCourseIds: new Set(['course-1']), allowedVideoIds: new Set(['video-1']) };

function leafRepository(documents = leafDocuments) {
  return { async findLeavesByChunkIds(ids) { return documents.filter((item) => ids.includes(item.chunkId)); } };
}

function leafResult() {
  return {
    matches: [{ segmentId: 'leaf-fallback', videoId: 'video-1', startSec: 1, endSec: 2, transcript: 'fallback', score: 0.5 }],
    diagnostics: { searchBackendUsed: 'memory', scoringMode: 'lexical', fallbacks: [] },
  };
}

function retrieve(overrides = {}) {
  return retrieveWithHierarchy({
    enabled: true,
    fallbackToLeaf: true,
    parentRepositoryFactory: () => createFakeParentRepository({ hits: [parentHit] }),
    leafRepositoryFactory: () => leafRepository(),
    leafSearch: async () => leafResult(),
    queryEmbedding: [0.1, 0.2],
    courseId: 'course-1',
    scope,
    parentLimit: 5,
    childExpansionLimit: 10,
    contextMaxLeaves: 5,
    contextMaxCharacters: 1000,
    parentTimeoutMs: 30,
    ...overrides,
  });
}

afterEach(() => {
  env.qaAnswerProvider = originalAnswerProvider;
  console.warn = originalWarn;
});

describe('hierarchical retrieval orchestrator', () => {
  it('gate=false returns the exact leaf result without constructing parent repository', async () => {
    const expected = leafResult();
    let parentFactoryCalls = 0;
    const result = await retrieve({
      enabled: false,
      parentRepositoryFactory: () => { parentFactoryCalls += 1; return null; },
      leafSearch: async () => expected,
    });
    assert.equal(result, expected);
    assert.equal(parentFactoryCalls, 0);
  });

  it('completes mock parent search through leaf answer and citation', async () => {
    env.qaAnswerProvider = 'template';
    const result = await retrieve();
    const answer = await generateAnswer('question', result.matches);
    const citations = buildCitations(result.matches);
    assert.deepEqual(result.matches.map((match) => match.segmentId), ['c1', 'c2']);
    assert.equal(result.diagnostics.hierarchical.retrievalMode, 'hierarchical');
    assert.equal(result.diagnostics.searchBackendUsed, 'parent_vector');
    assert.equal(result.diagnostics.hierarchical.parentHitCount, 1);
    assert.equal(result.diagnostics.hierarchical.requestedChildCount, 2);
    assert.equal(result.diagnostics.hierarchical.expandedLeafCount, 2);
    assert.deepEqual(result.diagnostics.hierarchical.diagnostics, {
      requestedChildCount: 2,
      foundChildCount: 2,
      missingChildCount: 0,
      duplicateChildCount: 0,
      scopeMismatchCount: 0,
      truncatedChildCount: 0,
      contextTruncated: false,
    });
    assert.equal(answer.provider, 'template');
    assert.equal(citations[0].chunkId, 'c1');
    assert.equal(citations[0].segmentId, 'c1');
    assert.equal(citations[0].timestamp.startSec, 10);
  });

  for (const [name, code, overrides] of [
    ['no hits', 'PARENT_NO_HITS', { parentRepositoryFactory: () => createFakeParentRepository() }],
    ['timeout', 'PARENT_SEARCH_TIMEOUT', { parentRepositoryFactory: () => createFakeParentRepository({ delayMs: 50 }), parentTimeoutMs: 2 }],
    ['index missing', 'PARENT_INDEX_MISSING', { parentRepositoryFactory: () => createFakeParentRepository({ error: Object.assign(new Error('index detail'), { code: 'PARENT_INDEX_MISSING' }) }) }],
    ['collection missing', 'PARENT_COLLECTION_MISSING', { parentRepositoryFactory: () => createFakeParentRepository({ error: Object.assign(new Error('collection detail'), { code: 'PARENT_COLLECTION_MISSING' }) }) }],
    ['invalid parent', 'PARENT_DOCUMENT_INVALID', { parentRepositoryFactory: () => createFakeParentRepository({ hits: [{ ...parentHit, childChunkIds: [] }] }) }],
    ['child empty', 'PARENT_CHILD_EXPANSION_EMPTY', { leafRepositoryFactory: () => leafRepository([]) }],
    ['context empty', 'PARENT_CONTEXT_EMPTY', { leafRepositoryFactory: () => leafRepository(leafDocuments.map((leaf) => ({ ...leaf, text: '' }))) }],
  ]) {
    it(`${name} safely falls back to leaf retrieval`, async () => {
      console.warn = () => {};
      const result = await retrieve(overrides);
      assert.equal(result.matches[0].segmentId, 'leaf-fallback');
      assert.equal(result.diagnostics.hierarchical.retrievalMode, 'leaf_fallback');
      assert.equal(result.diagnostics.hierarchical.fallbackReason, code);
      assert.equal(result.diagnostics.fallbacks.at(-1).code, code);
    });
  }

  it('fallback=false returns a safe AppError contract', async () => {
    await assert.rejects(
      retrieve({ fallbackToLeaf: false, parentRepositoryFactory: () => createFakeParentRepository() }),
      (error) => error.code === 'HIERARCHICAL_RETRIEVAL_UNAVAILABLE'
        && error.statusCode === 503
        && !error.message.includes('Parent'),
    );
  });

  it('unexpected parent errors do not leak secrets through fallback metadata', async () => {
    console.warn = () => {};
    const secret = 'mongodb+srv://user:password@example.invalid';
    const result = await retrieve({
      parentRepositoryFactory: () => createFakeParentRepository({ error: new Error(secret) }),
    });
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(result.diagnostics.hierarchical.fallbackReason, 'PARENT_SEARCH_FAILED');
  });
});
