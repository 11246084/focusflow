const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  STUDENT_PILOT_OPENCV_COURSE_ID,
  createCommandMonitor,
} = require('../src/scripts/phase2_2_hierarchical_e2e_runner');
const {
  ROUND6_FACETS,
} = require('../src/scripts/phase3c_round6_per_facet_quota_diagnostic');
const {
  ROUND7_PROFILE,
  ROUND7_SCHEMA_VERSION,
} = require('../src/scripts/phase3c_round7_annotated_anchor_upper_bound_diagnostic');
const {
  ROUND8_SELECTOR_RULE,
  qualifyDeterministicFacetAnchor,
  rankFacetExclusiveSeeds,
  runRound8Diagnostic,
  selectQualifiedFacetContext,
  validateRound7Evidence,
} = require('../src/scripts/phase3c_round8_deterministic_facet_anchor_diagnostic');

const Q11_G1_VIDEO = '6a02f38c17c615e872035b94';
const Q11_G2_VIDEO = '6a02f48c17c615e872035cea';
const Q08_VIDEO = '6a02f46317c615e872035c93';
const SHARED_VIDEOS = [
  '100000000000000000000001',
  '100000000000000000000002',
  '100000000000000000000003',
  '100000000000000000000004',
  '100000000000000000000005',
  '100000000000000000000006',
  '100000000000000000000007',
  '100000000000000000000008',
  '100000000000000000000009',
  '10000000000000000000000a',
  '10000000000000000000000b',
  '10000000000000000000000c',
];
const ALLOWED_VIDEOS = [Q11_G1_VIDEO, Q11_G2_VIDEO, Q08_VIDEO, ...SHARED_VIDEOS];

function chunkId(videoId, ordinal) {
  return `${videoId}_chunk_${String(ordinal).padStart(4, '0')}`;
}

function leaf(videoId, ordinal, score = 0.8) {
  return {
    chunkId: chunkId(videoId, ordinal),
    segmentId: `${videoId}-segment-${ordinal}`,
    videoId,
    startSec: ordinal * 10,
    endSec: (ordinal + 1) * 10,
    transcript: `leaf ${ordinal}`,
    score,
  };
}

function scope() {
  return {
    allowedCourseIds: new Set([STUDENT_PILOT_OPENCV_COURSE_ID]),
    allowedVideoIds: new Set(ALLOWED_VIDEOS),
  };
}

function strategyLeaves(matches) {
  return matches.map((match, index) => ({
    rank: index + 1,
    score: match.score,
    chunkId: match.chunkId,
    segmentId: match.segmentId,
    videoId: match.videoId,
    startSec: match.startSec,
    endSec: match.endSec,
  }));
}

function buildCurrentBest(questionId, matches, facetDefinitions) {
  const owners = [];
  for (const facet of facetDefinitions) {
    for (let index = 0; index < facet.quota; index += 1) owners.push(facet.facetId);
  }
  return {
    strategy: 'round6-fixture',
    leafCount: matches.length,
    leaves: strategyLeaves(matches),
    merge: {
      leaves: matches.map((match, index) => ({
        contextPosition: index + 1,
        chunkId: match.chunkId,
        videoId: match.videoId,
        quotaOwner: owners[index],
        sources: [],
      })),
      distribution: facetDefinitions.map((facet) => ({
        facetId: facet.facetId,
        quota: facet.quota,
        contextLeafCount: facet.quota,
      })),
    },
    facets: facetDefinitions.map((facet) => ({
      facetId: facet.facetId,
      queryId: facet.id,
      question: facet.question,
      quota: facet.quota,
    })),
  };
}

function buildRound7Fixture() {
  const q11CurrentMatches = [
    leaf(Q11_G1_VIDEO, 2), leaf(Q11_G1_VIDEO, 3), leaf(Q11_G1_VIDEO, 4),
    leaf(Q11_G1_VIDEO, 5), leaf(Q11_G1_VIDEO, 6), leaf(SHARED_VIDEOS[0], 1),
    leaf(SHARED_VIDEOS[1], 1), leaf(SHARED_VIDEOS[2], 1),
    leaf(SHARED_VIDEOS[3], 1), leaf(SHARED_VIDEOS[4], 1),
    leaf(SHARED_VIDEOS[5], 1), leaf(SHARED_VIDEOS[6], 1),
    leaf(SHARED_VIDEOS[0], 3), leaf(SHARED_VIDEOS[1], 3), leaf(Q11_G2_VIDEO, 6),
  ];
  const q08CurrentMatches = [
    leaf(SHARED_VIDEOS[0], 1), leaf(SHARED_VIDEOS[1], 1),
    leaf(SHARED_VIDEOS[2], 1), leaf(SHARED_VIDEOS[3], 1),
    leaf(SHARED_VIDEOS[4], 1), leaf(SHARED_VIDEOS[5], 1),
    leaf(SHARED_VIDEOS[6], 1), leaf(Q11_G1_VIDEO, 8),
    leaf(Q11_G2_VIDEO, 8), leaf(SHARED_VIDEOS[0], 3),
    leaf(SHARED_VIDEOS[1], 3), leaf(SHARED_VIDEOS[2], 3),
    leaf(SHARED_VIDEOS[3], 3), leaf(SHARED_VIDEOS[4], 3), leaf(Q08_VIDEO, 6),
  ];
  const q11Current = buildCurrentBest('Q11', q11CurrentMatches, ROUND6_FACETS.Q11);
  const q08Current = buildCurrentBest('Q08', q08CurrentMatches, ROUND6_FACETS.Q08);
  const q11OracleMatches = [
    leaf(Q11_G2_VIDEO, 4), leaf(Q11_G2_VIDEO, 5), leaf(Q11_G2_VIDEO, 6),
    ...q11CurrentMatches.slice(0, 12),
  ];
  const q08OracleMatches = [
    leaf(Q08_VIDEO, 4), leaf(Q08_VIDEO, 5), leaf(Q08_VIDEO, 6),
    ...q08CurrentMatches.slice(0, 12),
  ];
  return {
    schemaVersion: ROUND7_SCHEMA_VERSION,
    profile: ROUND7_PROFILE,
    productionRuntimeAffected: false,
    questions: [
      {
        id: 'Q11',
        question: 'Q11 fixture',
        comparisons: {
          currentBestRound6PerFacetQuotaAdjacent: q11Current,
          annotatedCorrectAnchorAdjacent: {
            strategy: 'round7-oracle-fixture',
            leafCount: 15,
            leaves: strategyLeaves(q11OracleMatches),
            targetGroupCoverage: { groupId: 'G2' },
          },
        },
      },
      {
        id: 'Q08',
        question: 'Q08 fixture',
        comparisons: {
          currentBestRound6PerFacetQuotaAdjacent: q08Current,
          annotatedCorrectAnchorAdjacent: {
            strategy: 'round7-oracle-fixture',
            leafCount: 15,
            leaves: strategyLeaves(q08OracleMatches),
            targetGroupCoverage: { groupId: 'G1' },
          },
        },
      },
    ],
    goNoGo: { decision: 'GO' },
    safety: {
      mongoWrites: 0,
      writeDetected: false,
      databaseAccess: { verified: true, role: 'read', database: 'focusflow' },
      callCounts: { answerGenerationCalls: 0 },
    },
  };
}

function sharedCandidates(count, offset = 0) {
  return Array.from({ length: count }, (_, index) => (
    leaf(SHARED_VIDEOS[(index + offset) % SHARED_VIDEOS.length], index + 10, 0.9 - index / 100)
  ));
}

describe('Phase 3C Round 8 deterministic facet-anchor diagnostic', () => {
  it('freezes a selector contract without LLM, ground truth, or question/chunk hardcoding', () => {
    assert.equal(ROUND8_SELECTOR_RULE.llmUsed, false);
    assert.equal(ROUND8_SELECTOR_RULE.groundTruthUsedForSelection, false);
    assert.equal(ROUND8_SELECTOR_RULE.questionIdSpecificAnchorRuleUsed, false);
    assert.equal(ROUND8_SELECTOR_RULE.annotatedChunkIdHardcodingUsed, false);
    assert.equal(ROUND8_SELECTOR_RULE.adjacentRadius, 1);
    assert.equal(ROUND8_SELECTOR_RULE.fixedContextLeafCount, 15);
  });

  it('selects the first quota-bounded exclusive-video seed and qualifies its safe predecessor', () => {
    const exclusiveVideo = Q11_G2_VIDEO;
    const facet = {
      facetId: 'facet-b',
      quota: 2,
      matches: [leaf(SHARED_VIDEOS[0], 1, 0.95), leaf(exclusiveVideo, 6, 0.9)],
    };
    const siblingFacets = [{ matches: [leaf(SHARED_VIDEOS[0], 2)] }];
    const playableVideoIds = new Set(ALLOWED_VIDEOS);
    const ranked = rankFacetExclusiveSeeds({
      facet, siblingFacets, scope: scope(), playableVideoIds,
    });
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].candidateRank, 2);

    const qualified = qualifyDeterministicFacetAnchor({
      facet,
      siblingFacets,
      adjacentLeaves: [leaf(exclusiveVideo, 5), leaf(exclusiveVideo, 7)],
      scope: scope(),
      playableVideoIds,
    });
    assert.equal(qualified.seed.chunkId, chunkId(exclusiveVideo, 6));
    assert.equal(qualified.anchor.chunkId, chunkId(exclusiveVideo, 5));
    assert.equal(qualified.diagnostics.status, 'safe_predecessor_qualified');
  });

  it('fails closed when every quota video also appears in a sibling Candidate30', () => {
    const facet = {
      facetId: 'facet-a',
      quota: 2,
      matches: [leaf(SHARED_VIDEOS[0], 1), leaf(SHARED_VIDEOS[1], 1)],
    };
    const siblingFacets = [{
      matches: [leaf(SHARED_VIDEOS[0], 2), leaf(SHARED_VIDEOS[1], 2)],
    }];
    const result = qualifyDeterministicFacetAnchor({
      facet,
      siblingFacets,
      adjacentLeaves: [],
      scope: scope(),
      playableVideoIds: new Set(ALLOWED_VIDEOS),
    });
    assert.equal(result.anchor, null);
    assert.equal(result.diagnostics.selectorMutationApplied, false);
  });

  it('keeps the qualified anchor and only adds its one-hop Leaves inside a fixed quota', () => {
    const anchor = leaf(Q11_G2_VIDEO, 5);
    const selected = selectQualifiedFacetContext({
      ownedMatches: [leaf(Q11_G2_VIDEO, 6), ...sharedCandidates(8)],
      anchor,
      adjacentLeaves: [leaf(Q11_G2_VIDEO, 4), leaf(Q11_G2_VIDEO, 6)],
      quota: 9,
      scope: scope(),
      playableVideoIds: new Set(ALLOWED_VIDEOS),
    });
    assert.equal(selected.matches.length, 9);
    assert.ok(selected.matches.some((match) => match.chunkId === anchor.chunkId));
    assert.ok(selected.matches.some(
      (match) => match.chunkId === chunkId(Q11_G2_VIDEO, 4),
    ));
    assert.ok(selected.matches.some(
      (match) => match.chunkId === chunkId(Q11_G2_VIDEO, 6),
    ));
    assert.ok(selected.diagnostics.added.every(
      (item) => item.anchorChunkId === anchor.chunkId,
    ));
  });

  it('reaches the frozen GO gate with four fixed facet searches and zero writes/answers', async () => {
    const round7Result = buildRound7Fixture();
    validateRound7Evidence(round7Result);
    let embeddingCall = 0;
    const candidateSets = [
      sharedCandidates(9),
      [...sharedCandidates(8), leaf(Q11_G2_VIDEO, 6, 0.79)],
      sharedCandidates(6, 1),
      [...sharedCandidates(4, 1), leaf(Q08_VIDEO, 6, 0.78), ...sharedCandidates(8, 1)],
    ];
    const commandMonitor = createCommandMonitor();
    const result = await runRound8Diagnostic({
      commandMonitor,
      round7Result,
      async embed() {
        embeddingCall += 1;
        return [embeddingCall, ...Array(3071).fill(0)];
      },
      async searchStudentPilotLeaves({ queryVector }) {
        return {
          backend: 'atlas',
          fallbackUsed: false,
          fallbacks: [],
          matches: candidateSets[queryVector[0] - 1],
        };
      },
      async loadStudentPilotAdjacentLeaves({ anchors }) {
        const seed = anchors[0];
        const match = /_chunk_(\d+)$/.exec(seed.chunkId);
        const ordinal = Number(match[1]);
        return [leaf(seed.videoId, ordinal - 1), leaf(seed.videoId, ordinal + 1)];
      },
      async inspectStudentPilotOpenCvScope() {
        return {
          allowedVideoIds: ALLOWED_VIDEOS,
          excludedVideoPresent: true,
          segmentCount: 129,
          scopedVideos: {
            videos: ALLOWED_VIDEOS.map((_id) => ({ _id, youtubeVideoId: `yt-${_id}` })),
          },
          databaseAccess: { verified: true, role: 'read', database: 'focusflow' },
        };
      },
    });

    const q11 = result.questions.find((question) => question.id === 'Q11');
    const q08 = result.questions.find((question) => question.id === 'Q08');
    assert.equal(result.productionCandidate.decision, 'GO');
    assert.equal(q11.comparisons.round8DeterministicAnchorAdjacent
      .targetGroupCoverage.requiredHitCountAtK, 3);
    assert.equal(q08.comparisons.round8DeterministicAnchorAdjacent
      .targetGroupCoverage.requiredHitCountAtK, 2);
    assert.match(q11.comparisons.round8DeterministicAnchorAdjacent
      .facetQualifications[1].qualifiedAnchor.chunkId, /_chunk_0005$/);
    assert.match(q08.comparisons.round8DeterministicAnchorAdjacent
      .facetQualifications[1].qualifiedAnchor.chunkId, /_chunk_0005$/);
    assert.deepEqual(result.safety.callCounts, {
      queryEmbeddingCalls: 4,
      atlasRetrievalCalls: 4,
      qualificationProbeReadCalls: 2,
      qualifiedAnchorAdjacentReadCalls: 2,
      answerGenerationCalls: 0,
    });
    assert.equal(result.safety.mongoWrites, 0);
    assert.equal(result.safety.writeDetected, false);
  });
});
