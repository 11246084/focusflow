const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  hitAtK, reciprocalRank, buildRetrievalEvaluationRecord,
} = require('../src/services/retrievalEvaluation.service');
const pendingCases = require('./fixtures/retrievalEvaluationCases');

describe('multi-turn retrieval evaluation foundation', () => {
  it('computes Hit@K and reciprocal rank from annotated chunk ids', () => {
    assert.equal(hitAtK({ expectedRelevantChunkIds: ['c2'], retrievedChunkIds: ['c1', 'c2'], k: 2 }), 1);
    assert.equal(hitAtK({ expectedRelevantChunkIds: ['c3'], retrievedChunkIds: ['c1', 'c2'], k: 2 }), 0);
    assert.equal(reciprocalRank({ expectedRelevantChunkIds: ['c2'], retrievedChunkIds: ['c1', 'c2'] }), 0.5);
  });

  it('marks records without ground truth as pending manual annotation', () => {
    for (const testCase of pendingCases) {
      const record = buildRetrievalEvaluationRecord(testCase);
      assert.equal(record.groundTruthStatus, 'pending_manual_annotation');
      assert.equal(record.metrics, null);
    }
  });
});
