const assert = require('node:assert/strict');
const { afterEach, describe, it } = require('node:test');
const {
  evaluateActiveDataEvidence,
  getHierarchicalDataReadinessSnapshot,
  refreshHierarchicalDataReadiness,
  resetHierarchicalDataReadinessForTests,
} = require('../src/services/hierarchicalDataReadiness.service');

const videoId = '6a6da69556dd124511ec51eb';
const contractMetadata = {
  embeddingProvider: 'gemini',
  embeddingModel: 'gemini-embedding-2',
  embeddingDimension: 3072,
  embeddingTaskType: null,
  embeddingInstructionVersion: 'gemini_embedding_2_asymmetric_retrieval_v2',
  generationVersion: 'text_search_generation_v2',
  normalizationVersion: 'unit_l2_v1',
  embeddingContractVersion: 'gemini_embedding_2_text_v2',
};

function fixtures(overrides = {}) {
  return {
    allowedVideoIds: [videoId],
    parents: [{
      videoId,
      childChunkIds: ['child-1', 'child-2'],
      isActive: true,
      ...contractMetadata,
      embeddingSchemaVersion: 'parent_embedding_v2',
    }],
    leaves: [
      { chunkId: 'child-1', videoId, ...contractMetadata, embeddingSchemaVersion: 'gemini_embedding_2_text_v2' },
      { chunkId: 'child-2', videoId, ...contractMetadata, embeddingSchemaVersion: 'gemini_embedding_2_text_v2' },
    ],
    leafIndexes: [{ name: 'chunkId_1', key: { chunkId: 1 } }],
    parentSearchIndexes: [{
      name: 'parent_embedding_index', status: 'READY', queryable: true,
      latestDefinition: {
        fields: [
          { type: 'vector', path: 'embedding' },
          { type: 'filter', path: 'courseId' },
          { type: 'filter', path: 'videoId' },
          { type: 'filter', path: 'generationVersion' },
          { type: 'filter', path: 'isActive' },
        ],
      },
    }],
    parentIndexName: 'parent_embedding_index',
    ...overrides,
  };
}

function cursor(records) {
  return { async toArray() { return records; } };
}

afterEach(() => resetHierarchicalDataReadinessForTests());

describe('hierarchical active-data readiness', () => {
  it('verifies one generation only when Parent, Leaf, and both indexes agree', () => {
    const result = evaluateActiveDataEvidence(fixtures());
    assert.equal(result.ready, true);
    assert.equal(result.status, 'verified');
    assert.equal(result.evidence.generationVersion, 'text_search_generation_v2');
    assert.equal(result.evidence.activeParentCount, 1);
    assert.equal(result.evidence.activeLeafCount, 2);
    assert.equal(result.evidence.contractHash.length, 64);
  });

  it('fails closed for stale generations, missing children, and empty rollout scope', () => {
    const stale = fixtures();
    stale.parents[0].generationVersion = 'stale_generation';
    assert.equal(
      evaluateActiveDataEvidence(stale).failures.includes('ACTIVE_PARENT_CONTRACT_MISMATCH'),
      true,
    );

    const missingLeaf = fixtures({ leaves: [] });
    assert.equal(
      evaluateActiveDataEvidence(missingLeaf).failures.includes('ACTIVE_LEAF_CHILD_MISSING'),
      true,
    );

    assert.equal(
      evaluateActiveDataEvidence(fixtures({ allowedVideoIds: [] })).failures
        .includes('ROLLOUT_VIDEO_ALLOWLIST_EMPTY'),
      true,
    );
  });

  it('rejects a READY vector index that cannot filter active generation', () => {
    const input = fixtures();
    input.parentSearchIndexes[0].latestDefinition.fields = input.parentSearchIndexes[0]
      .latestDefinition.fields.filter((field) => !['generationVersion', 'isActive'].includes(field.path));
    const result = evaluateActiveDataEvidence(input);
    assert.equal(result.ready, false);
    assert.equal(result.failures.includes('PARENT_VECTOR_FILTER_CONTRACT_MISMATCH'), true);
  });

  it('refreshes the process snapshot using read-only collection operations', async () => {
    const input = fixtures();
    const parentCollection = {
      find() { return cursor(input.parents); },
      listSearchIndexes() { return cursor(input.parentSearchIndexes); },
    };
    const leafCollection = {
      find() { return cursor(input.leaves); },
      listIndexes() { return cursor(input.leafIndexes); },
    };
    const result = await refreshHierarchicalDataReadiness({
      allowedVideoIds: [videoId],
      parentCollection,
      leafCollection,
      parentIndexName: 'parent_embedding_index',
      now: () => new Date('2026-08-13T00:00:00.000Z'),
    });
    assert.equal(result.ready, true);
    assert.equal(result.checkedAt, '2026-08-13T00:00:00.000Z');
    assert.equal(getHierarchicalDataReadinessSnapshot().status, 'verified');
  });

  it('sanitizes read failures and never exposes database error details', async () => {
    const secret = 'mongodb+srv://user:password@example.invalid';
    const result = await refreshHierarchicalDataReadiness({
      allowedVideoIds: [videoId],
      parentCollection: { find() { throw new Error(secret); } },
      leafCollection: {},
      now: () => new Date('2026-08-13T00:00:00.000Z'),
    });
    assert.equal(result.status, 'verification_failed');
    assert.equal(JSON.stringify(result).includes(secret), false);
  });
});
