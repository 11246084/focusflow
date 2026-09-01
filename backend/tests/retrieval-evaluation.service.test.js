const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  aggregateRetrievalEvaluations,
  buildRetrievalEvaluationRecord,
  evaluateRetrievalCandidates,
  hitAtK,
  reciprocalRank,
} = require('../src/services/retrievalEvaluation.service');
const {
  STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH,
  STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH_SOURCE,
} = require('../src/data/studentPilotRetrievalGroundTruth');
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

  it('reports candidate rank, score, partial Leaf-group coverage, Hit@K, and reciprocal rank', () => {
    const evaluation = evaluateRetrievalCandidates({
      expectedLeafGroups: [
        { groupId: 'G1', videoId: 'v1', chunkIds: ['v1_chunk_0001', 'v1_chunk_0002'] },
        { groupId: 'G2', videoId: 'v2', chunkIds: ['v2_chunk_0001', 'v2_chunk_0002'] },
      ],
      candidates: [
        { chunkId: 'other', score: 0.93, videoId: 'v3', startSec: 0, endSec: 10 },
        { chunkId: 'v1_chunk_0002', score: 0.81, videoId: 'v1', startSec: 10, endSec: 20 },
        { chunkId: 'v2_chunk_0001', score: 0.72, videoId: 'v2', startSec: 20, endSec: 30 },
      ],
      k: 3,
    });

    assert.equal(evaluation.groundTruthStatus, 'annotated');
    assert.deepEqual(evaluation.expectedLeaves[1], {
      chunkId: 'v1_chunk_0002', hitAtK: true, rank: 2, score: 0.81,
      segmentId: null, videoId: 'v1', startSec: 10, endSec: 20,
    });
    assert.equal(evaluation.metrics.hitAtK, 1);
    assert.equal(evaluation.metrics.reciprocalRank, 0.5);
    assert.equal(evaluation.metrics.expectedLeafRecallAtK, 0.5);
    assert.equal(evaluation.metrics.completeGroupCountAtK, 0);
    assert.deepEqual(evaluation.groupCoverage[0].missingChunkIds, ['v1_chunk_0001']);
    assert.deepEqual(evaluation.groupCoverage[1].missingChunkIds, ['v2_chunk_0002']);
  });

  it('aggregates Hit@K, MRR, expected Leaf recall, and partial/complete group coverage', () => {
    const metrics = aggregateRetrievalEvaluations([
      {
        groundTruthStatus: 'annotated',
        groupCoverage: [{ hitAtK: true }, { hitAtK: false }],
        metrics: {
          hitAtK: 1, reciprocalRank: 0.5,
          expectedLeafCount: 3, retrievedExpectedLeafCountAtK: 2,
          expectedGroupCount: 2, completeGroupCountAtK: 1,
        },
      },
      {
        groundTruthStatus: 'annotated',
        groupCoverage: [{ hitAtK: true }],
        metrics: {
          hitAtK: 0, reciprocalRank: 0,
          expectedLeafCount: 1, retrievedExpectedLeafCountAtK: 0,
          expectedGroupCount: 1, completeGroupCountAtK: 0,
        },
      },
      { groundTruthStatus: 'not_annotated', metrics: null },
    ]);

    assert.deepEqual(metrics, {
      annotatedQuestionCount: 2,
      hitAtK: 0.5,
      mrr: 0.25,
      expectedLeafCount: 4,
      retrievedExpectedLeafCountAtK: 2,
      expectedLeafRecallAtK: 0.5,
      expectedGroupCount: 3,
      partialGroupCountAtK: 2,
      partialGroupCoverageAtK: 2 / 3,
      completeGroupCountAtK: 1,
      completeGroupCoverageAtK: 1 / 3,
    });
  });

  it('maps the Markdown annotations to Q01-Q12 and preserves multi-range ground truth', () => {
    assert.deepEqual(Object.keys(STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH),
      Array.from({ length: 12 }, (_, index) => `Q${String(index + 1).padStart(2, '0')}`));
    assert.deepEqual(
      STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH.Q03.expectedLeafGroups[0].chunkIds,
      [
        '69fb5c8db52433fda32dbab5_chunk_0002',
        '69fb5c8db52433fda32dbab5_chunk_0003',
        '69fb5c8db52433fda32dbab5_chunk_0004',
      ],
    );
    assert.equal(STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH.Q09.expectedLeafGroups.length, 2);
    assert.equal(STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH.Q11.expectedLeafGroups.length, 2);
    assert.equal(STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH.Q12.expectedLeafGroups.length, 2);
    assert.equal(STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH_SOURCE.endsWith('baseline_questions.md'), true);
  });
});
