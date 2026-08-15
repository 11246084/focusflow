const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  buildGeminiTextSearchContract,
  compareEmbeddingContracts,
  parseActiveEmbeddingContract,
} = require('../src/services/embeddingContract.service');

describe('embedding contract service', () => {
  it('compares model, dimension, instruction, generation, normalization, version and taskType', () => {
    const expected = buildGeminiTextSearchContract();
    const active = {
      ...expected,
      contractVersion: 'old_contract',
      taskType: 'RETRIEVAL_DOCUMENT',
    };

    assert.deepEqual(
      compareEmbeddingContracts(expected, active),
      ['contractVersion', 'taskType'],
    );
  });

  it('normalizes supported legacy metadata aliases without returning arbitrary fields', () => {
    const parsed = parseActiveEmbeddingContract(JSON.stringify({
      embeddingProvider: 'gemini',
      embeddingModel: 'gemini-embedding-2',
      embeddingDimension: 3072,
      embeddingInstructionVersion: 'gemini_embedding_2_asymmetric_retrieval_v2',
      generationVersion: 'text_search_generation_v2',
      normalizationVersion: 'unit_l2_v1',
      embeddingSchemaVersion: 'gemini_embedding_2_text_v2',
      embeddingTaskType: null,
      secret: 'must-not-be-exposed',
    }), 'leaf-source');

    assert.equal(parsed.declared, true);
    assert.equal(parsed.error, null);
    assert.equal(parsed.contract.provider, 'gemini');
    assert.equal(parsed.contract.contractVersion, 'gemini_embedding_2_text_v2');
    assert.equal(Object.hasOwn(parsed.contract, 'secret'), false);
  });

  it('returns a safe mismatch for malformed active metadata', () => {
    const parsed = parseActiveEmbeddingContract('{not-json', 'parent-source');

    assert.equal(parsed.declared, true);
    assert.equal(parsed.contract, null);
    assert.equal(parsed.error, 'Invalid JSON contract metadata.');
  });
});
