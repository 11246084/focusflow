const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  createCommandMonitor,
} = require('../src/scripts/phase2_2_hierarchical_e2e_runner');
const {
  ROUND6_FACETS,
} = require('../src/scripts/phase3c_round6_per_facet_quota_diagnostic');
const {
  ROUND7_ANNOTATED_ANCHORS,
  ROUND7_PROFILE,
  runRound7Diagnostic,
  selectAnnotatedAnchorUpperBound,
  validateRound6Evidence,
} = require('../src/scripts/phase3c_round7_annotated_anchor_upper_bound_diagnostic');

function vector(marker = 0) {
  return Array.from({ length: 3072 }, (_, index) => (index === 0 ? 1 : index === 1 ? marker : 0));
}

function ordinalFromChunkId(chunkId) {
  return Number(String(chunkId).slice(-4));
}

function leaf(chunkId, videoId, rank = ordinalFromChunkId(chunkId) || 1) {
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

describe('Phase 3C Round 7 annotated-anchor upper-bound diagnostic', () => {
  it('freezes required chunk 0005 anchors and their exact one-hop neighbors', () => {
    assert.equal(ROUND7_ANNOTATED_ANCHORS.Q11.targetGroupId, 'G2');
    assert.match(ROUND7_ANNOTATED_ANCHORS.Q11.anchorChunkId, /_chunk_0005$/);
    assert.deepEqual(
      ROUND7_ANNOTATED_ANCHORS.Q11.expectedOneHopChunkIds.map((id) => id.slice(-4)),
      ['0004', '0006'],
    );
    assert.equal(ROUND7_ANNOTATED_ANCHORS.Q08.targetGroupId, 'G1');
    assert.match(ROUND7_ANNOTATED_ANCHORS.Q08.anchorChunkId, /_chunk_0005$/);
    assert.deepEqual(
      ROUND7_ANNOTATED_ANCHORS.Q08.expectedOneHopChunkIds.map((id) => id.slice(-4)),
      ['0004', '0006'],
    );
  });

  it('rejects incomplete or write-bearing Round 6 evidence reuse', () => {
    assert.throws(
      () => validateRound6Evidence({
        schemaVersion: 'phase3c-round6-per-facet-quota-v1',
        profile: 'fixed-facets-quota-6-9-adjacent-one-hop-v1',
        productionRuntimeAffected: false,
        questions: [{ id: 'Q11' }, { id: 'Q08' }],
        safety: {
          mongoWrites: 1,
          writeDetected: true,
          callCounts: { answerGenerationCalls: 0 },
        },
      }),
      (error) => error.code === 'E2E_ROUND6_EVIDENCE_INVALID',
    );
  });

  it('injects the exact Q11 G2 anchor and adds only its one-hop Leaf while keeping Context15', () => {
    const annotation = ROUND7_ANNOTATED_ANCHORS.Q11;
    const anchor = leaf(annotation.anchorChunkId, annotation.videoId);
    const chunk4 = leaf(annotation.expectedOneHopChunkIds[0], annotation.videoId);
    const chunk6 = leaf(annotation.expectedOneHopChunkIds[1], annotation.videoId);
    const noiseVideoId = '6a0000000000000000000001';
    const baseMatches = [
      chunk6,
      ...Array.from({ length: 14 }, (_, index) => leaf(`noise-${index + 1}`, noiseVideoId, index + 1)),
    ];
    const scope = { allowedVideoIds: new Set([annotation.videoId, noiseVideoId]) };
    const selection = selectAnnotatedAnchorUpperBound({
      baseMatches,
      anchor,
      adjacentLeaves: [chunk4, chunk6],
      annotation,
      scope,
      playableVideoIds: new Set([annotation.videoId, noiseVideoId]),
    });

    assert.equal(selection.matches.length, 15);
    assert.equal(new Set(selection.matches.map((match) => match.chunkId)).size, 15);
    assert.equal(selection.diagnostics.anchorPolicy, 'annotated_exact_required_leaf');
    assert.equal(selection.diagnostics.annotatedAnchor.injectedIntoContext, true);
    assert.deepEqual(
      selection.diagnostics.added.map((item) => item.chunkId),
      [annotation.expectedOneHopChunkIds[0]],
    );
    assert.equal(
      selection.diagnostics.added[0].source,
      'annotated_same_video_adjacent_lookup',
    );
    for (const id of [annotation.anchorChunkId, ...annotation.expectedOneHopChunkIds]) {
      assert.equal(selection.matches.some((match) => match.chunkId === id), true);
    }
  });

  it('runs the three-way diagnostic and applies the frozen GO threshold without DB writes', async () => {
    const q11G1VideoId = '6a02f38c17c615e872035b94';
    const q11G2VideoId = ROUND7_ANNOTATED_ANCHORS.Q11.videoId;
    const q08VideoId = ROUND7_ANNOTATED_ANCHORS.Q08.videoId;
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
    candidatesByMarker.get(2)[0] = leaf(`${q11G1VideoId}_chunk_0002`, q11G1VideoId, 2);
    candidatesByMarker.get(3)[8] = leaf(`${q11G2VideoId}_chunk_0006`, q11G2VideoId, 6);
    candidatesByMarker.get(5)[0] = leaf(`${q08VideoId}_chunk_0003`, q08VideoId, 3);

    let adjacentReadCalls = 0;
    const monitor = createCommandMonitor();
    const result = await runRound7Diagnostic({
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
      async loadStudentPilotAdjacentLeaves({ anchors }) {
        adjacentReadCalls += 1;
        const ids = new Set((anchors || []).map((item) => item.chunkId));
        for (const annotation of Object.values(ROUND7_ANNOTATED_ANCHORS)) {
          if (ids.has(annotation.lookupSeedChunkId)) {
            return [leaf(annotation.anchorChunkId, annotation.videoId)];
          }
          if (ids.has(annotation.anchorChunkId)) {
            return annotation.expectedOneHopChunkIds
              .map((id) => leaf(id, annotation.videoId));
          }
        }
        return [];
      },
    });

    const q11 = result.questions.find((question) => question.id === 'Q11');
    const q08 = result.questions.find((question) => question.id === 'Q08');
    assert.equal(q11.comparisons.currentBestRound6PerFacetQuotaAdjacent
      .targetGroupCoverage.requiredHitCountAtK, 1);
    assert.equal(q11.comparisons.annotatedCorrectAnchorAdjacent
      .targetGroupCoverage.requiredHitCountAtK, 3);
    assert.equal(q08.comparisons.annotatedCorrectAnchorAdjacent
      .targetGroupCoverage.requiredHitCountAtK, 3);
    assert.equal(q11.comparisons.annotatedCorrectAnchorAdjacent.leafCount, 15);
    assert.equal(q11.comparisons.annotatedCorrectAnchorAdjacent
      .deltaFromCurrentBest.added.noiseLeafCount, 0);
    assert.equal(result.profile, ROUND7_PROFILE);
    assert.equal(result.goNoGo.decision, 'GO');
    assert.deepEqual(result.goNoGo.observed.addedNoiseVersusCurrentBestByQuestion, {
      Q11: 0,
      Q08: 0,
    });
    assert.equal(result.goNoGo.checks.addedNoiseAtMostOnePerQuestion, true);
    assert.equal(adjacentReadCalls, 8);
    assert.equal(result.safety.mongoWrites, 0);
    assert.equal(result.safety.callCounts.answerGenerationCalls, 0);
  });
});
