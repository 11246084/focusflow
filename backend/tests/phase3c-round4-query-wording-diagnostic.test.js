const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  STUDENT_PILOT_Q11_G2_QUERY_WORDINGS,
  STUDENT_PILOT_Q11_G2_WORDING_PROFILE,
} = require('../src/data/studentPilotQueryDecomposition');
const {
  createCommandMonitor,
} = require('../src/scripts/phase2_2_hierarchical_e2e_runner');
const {
  CANDIDATE_DEPTHS,
  Q11_G2_AUDITED_CORE_GROUP,
  runQueryWordingDiagnostic,
} = require('../src/scripts/phase3c_round4_query_wording_diagnostic');

function vector(marker) {
  return Array.from({ length: 3072 }, (_, index) => {
    if (index === 0) return 1;
    if (index === 1) return marker;
    return 0;
  });
}

describe('Phase 3C Round 4 query wording diagnostic', () => {
  it('reuses each fixed embedding for K30/K50 and never calls answer generation', async () => {
    const monitor = createCommandMonitor();
    const allowedVideoIds = Array.from(
      { length: 15 },
      (_, index) => `6a00000000000000000000${index.toString(16).padStart(2, '0')}`,
    );
    const markerByQuestion = new Map(STUDENT_PILOT_Q11_G2_QUERY_WORDINGS.map(
      (wording, index) => [wording.question, index + 1],
    ));
    const observedDepths = [];
    let embedCalls = 0;
    const expectedChunkId = Q11_G2_AUDITED_CORE_GROUP.chunkIds[0];
    const result = await runQueryWordingDiagnostic({
      commandMonitor: monitor,
      async inspectStudentPilotOpenCvScope() {
        return {
          allowedVideoIds,
          excludedVideoPresent: true,
          segmentCount: 129,
          databaseAccess: { verified: true, role: 'read', database: 'focusflow' },
        };
      },
      async embed(question) {
        embedCalls += 1;
        return vector(markerByQuestion.get(question));
      },
      async searchStudentPilotLeaves({ queryVector, candidateDepth }) {
        observedDepths.push({ marker: queryVector[1], candidateDepth });
        return {
          backend: 'atlas',
          fallbackUsed: false,
          fallbacks: [],
          matches: [{
            chunkId: expectedChunkId,
            segmentId: expectedChunkId,
            videoId: Q11_G2_AUDITED_CORE_GROUP.videoId,
            startSec: 10,
            endSec: 20,
            transcript: 'local diagnostic transcript',
            score: 0.8,
          }],
        };
      },
    });

    assert.equal(result.profile, STUDENT_PILOT_Q11_G2_WORDING_PROFILE);
    assert.deepEqual(result.retrieval.candidateDepths, CANDIDATE_DEPTHS);
    assert.equal(embedCalls, STUDENT_PILOT_Q11_G2_QUERY_WORDINGS.length);
    assert.equal(observedDepths.length, STUDENT_PILOT_Q11_G2_QUERY_WORDINGS.length * 2);
    assert.deepEqual(observedDepths.slice(0, 2).map((item) => item.candidateDepth), [30, 50]);
    assert.equal(result.queries[0].depthResults[0]
      .auditedCoreEvaluation.metrics.retrievedExpectedLeafCountAtK, 1);
    assert.equal(result.groundTruth.auditedCoreInterpretation.persistedToFormalGroundTruth, false);
    assert.deepEqual(result.safety.callCounts, {
      queryEmbeddingCalls: 4,
      atlasRetrievalCalls: 8,
      answerGenerationCalls: 0,
    });
    assert.equal(result.safety.mongoWrites, 0);
  });
});
