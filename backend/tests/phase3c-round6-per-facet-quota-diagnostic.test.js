const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  STUDENT_PILOT_QUERY_DECOMPOSITIONS,
} = require('../src/data/studentPilotQueryDecomposition');
const {
  createCommandMonitor,
} = require('../src/scripts/phase2_2_hierarchical_e2e_runner');
const {
  CONTEXT_LIMIT,
  ROUND6_FACETS,
  ROUND6_PROFILE,
  mergeFacetQuotaSelections,
  runRound6Diagnostic,
} = require('../src/scripts/phase3c_round6_per_facet_quota_diagnostic');

function vector(marker = 0) {
  return Array.from({ length: 3072 }, (_, index) => (index === 0 ? 1 : index === 1 ? marker : 0));
}

function leaf(chunkId, videoId, rank = 1) {
  return {
    chunkId,
    segmentId: chunkId,
    videoId,
    startSec: rank * 10,
    endSec: (rank * 10) + 9,
    transcript: chunkId,
    score: 1 - (rank / 1000),
  };
}

describe('Phase 3C Round 6 per-facet quota diagnostic', () => {
  it('uses the fixed Round 4 G2 wording and a reproducible 6/9 Context15 split', () => {
    assert.equal(ROUND6_FACETS.Q11[0].quota, 6);
    assert.equal(ROUND6_FACETS.Q11[1].quota, 9);
    assert.equal(ROUND6_FACETS.Q11[1].id, 'Q11-G2-THREE-VS-ONE');
    assert.equal(ROUND6_FACETS.Q11.reduce((sum, facet) => sum + facet.quota, 0), CONTEXT_LIMIT);
    assert.deepEqual(ROUND6_FACETS.Q08.map((facet) => facet.question),
      STUDENT_PILOT_QUERY_DECOMPOSITIONS.Q08.map((query) => query.question));
  });

  it('deduplicates by chunk while preserving six and nine owned context slots', () => {
    const videoId = '6a0000000000000000000001';
    const shared = leaf('shared', videoId);
    const facet1Matches = [shared, ...Array.from(
      { length: 10 },
      (_, index) => leaf(`f1-${index + 1}`, videoId, index + 2),
    )];
    const facet2Matches = [shared, ...Array.from(
      { length: 12 },
      (_, index) => leaf(`f2-${index + 1}`, videoId, index + 2),
    )];
    const merged = mergeFacetQuotaSelections({
      facets: [
        {
          facetId: 'F1', quota: 6, matches: facet1Matches,
          selection: { matches: facet1Matches.slice(0, 6) },
        },
        {
          facetId: 'F2', quota: 9, matches: facet2Matches,
          selection: { matches: facet2Matches.slice(0, 9) },
        },
      ],
    });

    assert.equal(merged.matches.length, 15);
    assert.equal(new Set(merged.matches.map((match) => match.chunkId)).size, 15);
    assert.deepEqual(merged.diagnostics.distribution, [
      { facetId: 'F1', quota: 6, contextLeafCount: 6 },
      { facetId: 'F2', quota: 9, contextLeafCount: 9 },
    ]);
    assert.equal(merged.diagnostics.leaves.find((item) => item.chunkId === 'shared').sources.length, 2);
  });

  it('retains a secondary-facet rank-9 required anchor that no-quota round robin drops', async () => {
    const q11G1VideoId = '6a02f38c17c615e872035b94';
    const q11G2VideoId = '6a02f48c17c615e872035cea';
    const q08VideoId = '6a02f46317c615e872035c93';
    const allowedVideoIds = [q11G1VideoId, q11G2VideoId, q08VideoId,
      ...Array.from({ length: 12 }, (_, index) => `6a0000000000000000000${String(index + 1).padStart(3, '0')}`)];
    const markerByQuestion = new Map([
      ['OpenCV 與 YOLO 在硬體需求及多物件偵測方式上有何差異？', 1],
      [ROUND6_FACETS.Q11[0].question, 2],
      [ROUND6_FACETS.Q11[1].question, 3],
      ['如果分別訓練找狗、找貓與找車的偵測器，為什麼目標種類增加會提高運算成本？', 4],
      [ROUND6_FACETS.Q08[0].question, 5],
      [ROUND6_FACETS.Q08[1].question, 6],
    ]);
    const noiseVideoId = allowedVideoIds[3];
    const candidatesByMarker = new Map();
    for (let marker = 1; marker <= 6; marker += 1) {
      candidatesByMarker.set(marker, Array.from(
        { length: 30 },
        (_, index) => leaf(`m${marker}-noise-${index + 1}`, noiseVideoId, index + 1),
      ));
    }
    candidatesByMarker.get(2)[0] = leaf(`${q11G1VideoId}_chunk_0002`, q11G1VideoId, 1);
    candidatesByMarker.get(3)[8] = leaf(`${q11G2VideoId}_chunk_0006`, q11G2VideoId, 9);

    let adjacentReadCalls = 0;
    const monitor = createCommandMonitor();
    const result = await runRound6Diagnostic({
      commandMonitor: monitor,
      questionBank: {
        questions: [
          { id: 'Q11', question: 'OpenCV 與 YOLO 在硬體需求及多物件偵測方式上有何差異？' },
          { id: 'Q08', question: '如果分別訓練找狗、找貓與找車的偵測器，為什麼目標種類增加會提高運算成本？' },
        ],
      },
      async inspectStudentPilotOpenCvScope() {
        return {
          allowedVideoIds,
          excludedVideoPresent: true,
          segmentCount: 129,
          scopedVideos: {
            videos: allowedVideoIds.map((_id) => ({ _id, youtubeVideoId: `youtube-${_id}` })),
          },
          databaseAccess: { verified: true, role: 'read', database: 'focusflow' },
        };
      },
      async embed(question) { return vector(markerByQuestion.get(question)); },
      async searchStudentPilotLeaves({ queryVector }) {
        return {
          backend: 'atlas',
          fallbackUsed: false,
          fallbacks: [],
          matches: candidatesByMarker.get(queryVector[1]),
        };
      },
      async loadStudentPilotAdjacentLeaves() {
        adjacentReadCalls += 1;
        return [];
      },
    });

    const q11 = result.questions.find((question) => question.id === 'Q11');
    const noQuotaG2 = q11.comparisons.queryDecompositionNoQuotaNoAdjacent
      .anchorRetention.find((facet) => facet.expectedGroupId === 'G2');
    const quotaG2 = q11.comparisons.perFacetQuotaAdjacent
      .anchorRetention.find((facet) => facet.expectedGroupId === 'G2');
    assert.equal(noQuotaG2.requiredCandidateAnchors[0].candidateRank, 9);
    assert.equal(noQuotaG2.retainedRequiredCandidateAnchors.length, 0);
    assert.equal(quotaG2.retainedRequiredCandidateAnchors.length, 1);
    assert.deepEqual(q11.comparisons.perFacetQuotaAdjacent.merge.distribution, [
      { facetId: 'Q11-G1-HARDWARE', quota: 6, contextLeafCount: 6 },
      { facetId: 'Q11-G2-MULTI-OBJECT', quota: 9, contextLeafCount: 9 },
    ]);
    assert.equal(q11.comparisons.perFacetQuotaAdjacent.leafCount, 15);
    assert.equal(result.profile, ROUND6_PROFILE);
    assert.equal(adjacentReadCalls, 4);
    assert.deepEqual(result.safety.callCounts, {
      queryEmbeddingCalls: 6,
      atlasRetrievalCalls: 6,
      answerGenerationCalls: 0,
    });
    assert.equal(result.safety.mongoWrites, 0);
  });
});
