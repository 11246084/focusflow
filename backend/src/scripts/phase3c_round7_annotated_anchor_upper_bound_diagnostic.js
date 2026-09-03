const {
  STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH,
} = require('../data/studentPilotRetrievalGroundTruth');
const { embedQuery } = require('../services/queryEmbedding.service');
const { evaluateRetrievalCandidates } = require('../services/retrievalEvaluation.service');
const {
  IsolatedE2EError,
  STUDENT_PILOT_OPENCV_COURSE_ID,
  STUDENT_PILOT_OPENCV_EXCLUDED_VIDEO_ID,
  STUDENT_PILOT_OPENCV_EXPECTED_SEGMENT_COUNT,
  STUDENT_PILOT_OPENCV_EXPECTED_VIDEO_COUNT,
  STUDENT_PILOT_OPENCV_MODE,
  buildDiagnosticPlayableVideoIds,
  buildLeafDiagnostics,
  createCommandMonitor,
  createLiveDependencies,
  inspectAndValidateStudentPilotOpenCvScope,
  safeFailure,
  selectDiagnosticSameVideoAdjacentContext,
} = require('./phase2_2_hierarchical_e2e_runner');
const {
  CANDIDATE_DEPTH,
  CONTEXT_LIMIT,
  ROUND6_PROFILE,
  ROUND6_SCHEMA_VERSION,
  classifyContext,
  compareContextSets,
  runRound6Diagnostic,
} = require('./phase3c_round6_per_facet_quota_diagnostic');

const ROUND7_SCHEMA_VERSION = 'phase3c-round7-annotated-anchor-upper-bound-v1';
const ROUND7_PROFILE = 'annotated-correct-anchor-adjacent-one-hop-context15-v1';
const QUESTION_IDS = Object.freeze(['Q11', 'Q08']);
const DIAGNOSTIC_EMBEDDING_MIN_INTERVAL_MS = 25000;

function chunkId(videoId, ordinal) {
  return `${videoId}_chunk_${String(ordinal).padStart(4, '0')}`;
}

const Q11_G2_VIDEO_ID = '6a02f48c17c615e872035cea';
const Q08_VIDEO_ID = '6a02f46317c615e872035c93';

const ROUND7_ANNOTATED_ANCHORS = Object.freeze({
  Q11: Object.freeze({
    targetGroupId: 'G2',
    videoId: Q11_G2_VIDEO_ID,
    anchorChunkId: chunkId(Q11_G2_VIDEO_ID, 5),
    lookupSeedChunkId: chunkId(Q11_G2_VIDEO_ID, 4),
    expectedOneHopChunkIds: Object.freeze([
      chunkId(Q11_G2_VIDEO_ID, 4),
      chunkId(Q11_G2_VIDEO_ID, 6),
    ]),
    rationale: 'required central Leaf 0005 exposes required one-hop Leaves 0004 and 0006',
  }),
  Q08: Object.freeze({
    targetGroupId: 'G1',
    videoId: Q08_VIDEO_ID,
    anchorChunkId: chunkId(Q08_VIDEO_ID, 5),
    lookupSeedChunkId: chunkId(Q08_VIDEO_ID, 4),
    expectedOneHopChunkIds: Object.freeze([
      chunkId(Q08_VIDEO_ID, 4),
      chunkId(Q08_VIDEO_ID, 6),
    ]),
    rationale: 'required Leaf 0005 exposes auxiliary 0004 and required one-hop Leaf 0006',
  }),
});

function matchChunkId(match) {
  return String(match?.chunkId || '');
}

function createThrottledDiagnosticEmbed({
  embed = embedQuery,
  minimumIntervalMs = DIAGNOSTIC_EMBEDDING_MIN_INTERVAL_MS,
} = {}) {
  let previousStartedAt = 0;
  return async (text) => {
    const waitMs = Math.max(0, previousStartedAt + minimumIntervalMs - Date.now());
    if (waitMs > 0) {
      await new Promise((resolve) => { setTimeout(resolve, waitMs); });
    }
    previousStartedAt = Date.now();
    return embed(text);
  };
}

function hydrateStrategyMatches(strategy) {
  return (Array.isArray(strategy?.leaves) ? strategy.leaves : []).map((leaf) => ({
    score: leaf.score,
    chunkId: leaf.chunkId,
    segmentId: leaf.segmentId,
    videoId: leaf.videoId,
    startSec: leaf.startSec,
    endSec: leaf.endSec,
  }));
}

function targetGroup(expectedLeafGroups, groupId) {
  return (Array.isArray(expectedLeafGroups) ? expectedLeafGroups : [])
    .find((group) => group.groupId === groupId) || null;
}

function validateAnnotation(questionId, annotation, expectedLeafGroups) {
  const group = targetGroup(expectedLeafGroups, annotation?.targetGroupId);
  if (!group || String(group.videoId) !== String(annotation?.videoId)
      || !(group.requiredChunkIds || []).includes(annotation?.anchorChunkId)) {
    throw new IsolatedE2EError(
      `Round 7 annotation for ${questionId} does not identify a required Leaf in its target group.`,
      'E2E_ANNOTATED_ANCHOR_INVALID',
    );
  }
  return group;
}

function validateRound6Evidence(round6) {
  const questionIds = new Set((Array.isArray(round6?.questions) ? round6.questions : [])
    .map((question) => question.id));
  if (round6?.schemaVersion !== ROUND6_SCHEMA_VERSION
      || round6?.profile !== ROUND6_PROFILE
      || round6?.productionRuntimeAffected !== false
      || round6?.safety?.mongoWrites !== 0
      || round6?.safety?.writeDetected !== false
      || round6?.safety?.callCounts?.answerGenerationCalls !== 0
      || QUESTION_IDS.some((id) => !questionIds.has(id))) {
    throw new IsolatedE2EError(
      'The supplied Round 6 evidence does not satisfy the diagnostic safety contract.',
      'E2E_ROUND6_EVIDENCE_INVALID',
    );
  }
  return round6;
}

async function loadAnnotatedAnchor({
  annotation,
  loadStudentPilotAdjacentLeaves,
  scope,
  courseId,
  commandMonitor,
}) {
  const leaves = await loadStudentPilotAdjacentLeaves({
    anchors: [{
      videoId: annotation.videoId,
      chunkId: annotation.lookupSeedChunkId,
    }],
    scope,
    courseId,
  });
  commandMonitor.assertNoWrites();
  const anchor = (Array.isArray(leaves) ? leaves : []).find((leaf) => (
    matchChunkId(leaf) === annotation.anchorChunkId
    && String(leaf?.videoId || '') === annotation.videoId
  ));
  if (!anchor) {
    throw new IsolatedE2EError(
      `The annotated anchor ${annotation.anchorChunkId} was not found in the read-only scope.`,
      'E2E_ANNOTATED_ANCHOR_NOT_FOUND',
    );
  }
  return anchor;
}

function selectAnnotatedAnchorUpperBound({
  baseMatches,
  anchor,
  adjacentLeaves,
  annotation,
  scope,
  playableVideoIds,
  limit = CONTEXT_LIMIT,
}) {
  const allowedVideoIds = scope?.allowedVideoIds instanceof Set
    ? scope.allowedVideoIds : new Set();
  const playableIds = playableVideoIds instanceof Set ? playableVideoIds : new Set();
  if (matchChunkId(anchor) !== annotation.anchorChunkId
      || String(anchor?.videoId || '') !== annotation.videoId
      || !allowedVideoIds.has(annotation.videoId)
      || !playableIds.has(annotation.videoId)) {
    throw new IsolatedE2EError(
      'The annotated anchor failed exact-id, scope, or playable-source validation.',
      'E2E_ANNOTATED_ANCHOR_UNSAFE',
    );
  }

  const base = Array.isArray(baseMatches) ? baseMatches : [];
  const anchorWasInBase = base.some((match) => matchChunkId(match) === annotation.anchorChunkId);
  const seededBase = [];
  const seededIds = new Set();
  for (const match of [anchor, ...base]) {
    const id = matchChunkId(match);
    if (!id || seededIds.has(id)) continue;
    seededIds.add(id);
    seededBase.push(match);
    if (seededBase.length >= limit) break;
  }

  const allowedAdjacentIds = new Set(annotation.expectedOneHopChunkIds);
  const exactAdjacentLeaves = (Array.isArray(adjacentLeaves) ? adjacentLeaves : [])
    .filter((leaf) => allowedAdjacentIds.has(matchChunkId(leaf))
      && String(leaf?.videoId || '') === annotation.videoId);
  const candidatePool = [...seededBase];
  const candidateIds = new Set(candidatePool.map(matchChunkId));
  for (const leaf of exactAdjacentLeaves) {
    const id = matchChunkId(leaf);
    if (candidateIds.has(id)) continue;
    candidateIds.add(id);
    candidatePool.push(leaf);
  }

  const selected = selectDiagnosticSameVideoAdjacentContext({
    matches: candidatePool,
    adjacentLeaves: exactAdjacentLeaves,
    limit,
    scope,
    playableVideoIds,
  });
  if (!selected.matches.some((match) => matchChunkId(match) === annotation.anchorChunkId)) {
    throw new IsolatedE2EError(
      'The annotated anchor was not retained in Context15.',
      'E2E_ANNOTATED_ANCHOR_DROPPED',
    );
  }
  const unexpectedAddition = selected.diagnostics.added.find(
    (item) => !allowedAdjacentIds.has(item.chunkId),
  );
  if (unexpectedAddition) {
    throw new IsolatedE2EError(
      'Annotated expansion selected a Leaf outside the fixed one-hop annotation.',
      'E2E_ANNOTATED_ADJACENT_OUT_OF_RANGE',
    );
  }

  return {
    matches: selected.matches,
    diagnostics: {
      ...selected.diagnostics,
      added: selected.diagnostics.added.map((item) => ({
        ...item,
        source: 'annotated_same_video_adjacent_lookup',
      })),
      strategy: ROUND7_PROFILE,
      anchorPolicy: 'annotated_exact_required_leaf',
      annotatedAnchor: {
        chunkId: annotation.anchorChunkId,
        videoId: annotation.videoId,
        targetGroupId: annotation.targetGroupId,
        wasInCurrentBestContext: anchorWasInBase,
        injectedIntoContext: !anchorWasInBase,
      },
      fixedOneHopChunkIds: [...annotation.expectedOneHopChunkIds],
    },
  };
}

function buildTargetGroupCoverage(expectedLeafGroups, groupId, matches) {
  const group = targetGroup(expectedLeafGroups, groupId);
  if (!group) return null;
  return evaluateRetrievalCandidates({
    expectedLeafGroups: [group],
    candidates: matches,
    k: CONTEXT_LIMIT,
  }).groupCoverage[0];
}

function addTargetGroupCoverage(strategy, expectedLeafGroups, groupId) {
  const matches = hydrateStrategyMatches(strategy);
  return {
    ...strategy,
    targetGroupCoverage: buildTargetGroupCoverage(expectedLeafGroups, groupId, matches),
  };
}

function buildUpperBoundStrategy({
  expectedLeafGroups,
  annotation,
  currentBestMatches,
  baselineMatches,
  selection,
}) {
  const evaluation = evaluateRetrievalCandidates({
    expectedLeafGroups,
    candidates: selection.matches,
    k: CONTEXT_LIMIT,
  });
  const currentCoverage = buildTargetGroupCoverage(
    expectedLeafGroups,
    annotation.targetGroupId,
    currentBestMatches,
  );
  const upperCoverage = buildTargetGroupCoverage(
    expectedLeafGroups,
    annotation.targetGroupId,
    selection.matches,
  );
  const currentHits = new Set(currentCoverage.requiredHitChunkIds);
  return {
    strategy: ROUND7_PROFILE,
    leafCount: selection.matches.length,
    leaves: buildLeafDiagnostics(selection.matches),
    evaluation,
    targetGroupCoverage: upperCoverage,
    composition: classifyContext(expectedLeafGroups, selection.matches),
    annotation: {
      ...annotation,
      classification: 'required',
    },
    selection: selection.diagnostics,
    coreLeafRecovery: {
      recoveredRequiredChunkIds: upperCoverage.requiredHitChunkIds
        .filter((id) => !currentHits.has(id)),
      stillMissingRequiredChunkIds: [...upperCoverage.requiredMissingChunkIds],
    },
    deltaFromBaseline: compareContextSets(
      expectedLeafGroups,
      baselineMatches,
      selection.matches,
    ),
    deltaFromCurrentBest: compareContextSets(
      expectedLeafGroups,
      currentBestMatches,
      selection.matches,
    ),
    cost: {
      queryEmbeddingCalls: 0,
      atlasVectorSearchCalls: 0,
      annotatedAnchorLookupReadCalls: 1,
      annotatedAdjacentLeafReadCalls: 1,
    },
  };
}

function evaluateGoNoGo(questions) {
  const q11 = questions.find((question) => question.id === 'Q11');
  const upper = q11?.comparisons?.annotatedCorrectAnchorAdjacent;
  const requiredHitCount = upper?.targetGroupCoverage?.requiredHitCountAtK || 0;
  const requiredCount = upper?.targetGroupCoverage?.requiredCount || 4;
  const upperBounds = questions.map((question) => ({
    questionId: question.id,
    strategy: question?.comparisons?.annotatedCorrectAnchorAdjacent,
  }));
  const addedNoiseByQuestion = Object.fromEntries(upperBounds.map(({ questionId, strategy }) => [
    questionId,
    strategy?.deltaFromCurrentBest?.added?.noiseLeafCount ?? Number.POSITIVE_INFINITY,
  ]));
  const addedNoiseAtMostOnePerQuestion = Object.values(addedNoiseByQuestion)
    .every((count) => count <= 1);
  const fixedContext15 = upperBounds.every(({ strategy }) => strategy?.leafCount === CONTEXT_LIMIT);
  const oneHopPreserved = upperBounds.every(({ strategy }) => (
    strategy?.selection?.adjacentRadius === 1
    && strategy?.selection?.maxAdditions === 2
    && strategy?.selection?.sameVideoOnly === true
    && strategy?.selection?.scopeValidated === true
    && strategy?.selection?.playableSourceValidated === true
  ));
  const go = requiredHitCount >= 3 && addedNoiseAtMostOnePerQuestion
    && fixedContext15 && oneHopPreserved;
  return {
    decision: go ? 'GO' : 'NO-GO',
    primaryQuestion: 'Q11',
    targetGroupId: 'G2',
    observed: {
      requiredHitCount,
      requiredCount,
      addedNoiseVersusCurrentBestByQuestion: addedNoiseByQuestion,
      contextLeafCountByQuestion: Object.fromEntries(upperBounds.map(
        ({ questionId, strategy }) => [questionId, strategy?.leafCount || 0],
      )),
      oneHopSafetyPreserved: oneHopPreserved,
    },
    frozenThresholds: {
      minimumQ11G2RequiredHitCount: 3,
      q11G2RequiredCount: 4,
      maximumAddedNoisePerQuestion: 1,
      fixedContextLeafCount: CONTEXT_LIMIT,
      maximumAdjacentRadius: 1,
    },
    checks: {
      q11G2AtLeastThreeOfFour: requiredHitCount >= 3,
      addedNoiseAtMostOnePerQuestion,
      context15PreservedForEveryQuestion: fixedContext15,
      existingAdjacentSafetyPreserved: oneHopPreserved,
    },
  };
}

async function runRound7Diagnostic(dependencies = {}) {
  const commandMonitor = dependencies.commandMonitor || createCommandMonitor();
  const loadStudentPilotAdjacentLeaves = dependencies.loadStudentPilotAdjacentLeaves;
  if (typeof loadStudentPilotAdjacentLeaves !== 'function') {
    throw new IsolatedE2EError(
      'Round 7 requires the read-only same-video adjacent Leaf dependency.',
      'E2E_ADJACENT_LOOKUP_UNAVAILABLE',
    );
  }

  const round6EvidenceReused = Boolean(dependencies.round6Result);
  const round6 = validateRound6Evidence(
    dependencies.round6Result
      || await runRound6Diagnostic({ ...dependencies, commandMonitor }),
  );
  const options = {
    mode: STUDENT_PILOT_OPENCV_MODE,
    courseId: STUDENT_PILOT_OPENCV_COURSE_ID,
    excludedVideoId: STUDENT_PILOT_OPENCV_EXCLUDED_VIDEO_ID,
    expectedVideoCount: STUDENT_PILOT_OPENCV_EXPECTED_VIDEO_COUNT,
    expectedSegmentCount: STUDENT_PILOT_OPENCV_EXPECTED_SEGMENT_COUNT,
  };
  const { allowedVideoIds, inspection } = await inspectAndValidateStudentPilotOpenCvScope(
    options,
    {
      inspectStudentPilotOpenCvScope: dependencies.inspectStudentPilotOpenCvScope,
      commandMonitor,
    },
  );
  const scope = {
    allowedCourseIds: new Set([options.courseId]),
    allowedVideoIds: new Set(allowedVideoIds),
  };
  const playableVideoIds = buildDiagnosticPlayableVideoIds(inspection.scopedVideos);

  const questions = [];
  let annotatedAnchorLookupReadCalls = 0;
  let annotatedAdjacentLeafReadCalls = 0;
  for (const questionId of QUESTION_IDS) {
    const annotation = ROUND7_ANNOTATED_ANCHORS[questionId];
    const expectedLeafGroups = STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH[questionId]
      .expectedLeafGroups;
    validateAnnotation(questionId, annotation, expectedLeafGroups);
    const round6Question = round6.questions.find((question) => question.id === questionId);
    const baseline = round6Question.comparisons.singleQueryCandidate30Context15;
    const currentBest = round6Question.comparisons.perFacetQuotaAdjacent;
    const baselineMatches = hydrateStrategyMatches(baseline);
    const currentBestMatches = hydrateStrategyMatches(currentBest);

    annotatedAnchorLookupReadCalls += 1;
    const anchor = await loadAnnotatedAnchor({
      annotation,
      loadStudentPilotAdjacentLeaves,
      scope,
      courseId: options.courseId,
      commandMonitor,
    });
    annotatedAdjacentLeafReadCalls += 1;
    const adjacentLeaves = await loadStudentPilotAdjacentLeaves({
      anchors: [anchor],
      scope,
      courseId: options.courseId,
    });
    commandMonitor.assertNoWrites();
    const selection = selectAnnotatedAnchorUpperBound({
      baseMatches: currentBestMatches,
      anchor,
      adjacentLeaves,
      annotation,
      scope,
      playableVideoIds,
    });
    const upper = buildUpperBoundStrategy({
      expectedLeafGroups,
      annotation,
      currentBestMatches,
      baselineMatches,
      selection,
    });

    questions.push({
      id: questionId,
      question: round6Question.question,
      comparisons: {
        baselineCandidate30Context15: addTargetGroupCoverage(
          baseline,
          expectedLeafGroups,
          annotation.targetGroupId,
        ),
        currentBestRound6PerFacetQuotaAdjacent: addTargetGroupCoverage(
          currentBest,
          expectedLeafGroups,
          annotation.targetGroupId,
        ),
        annotatedCorrectAnchorAdjacent: upper,
      },
    });
  }

  commandMonitor.assertNoWrites();
  const result = {
    schemaVersion: ROUND7_SCHEMA_VERSION,
    profile: ROUND7_PROFILE,
    productionRuntimeAffected: false,
    baselineEvidenceSource: {
      mode: round6EvidenceReused ? 'reused_complete_round6_raw_json' : 'fresh_round6_live_run',
      schemaVersion: round6.schemaVersion,
      profile: round6.profile,
      sourceMongoWrites: round6.safety.mongoWrites,
      sourceAnswerGenerationCalls: round6.safety.callCounts.answerGenerationCalls,
    },
    retrieval: {
      backend: 'atlas',
      leafOnly: true,
      candidateDepth: CANDIDATE_DEPTH,
      contextLimit: CONTEXT_LIMIT,
      thresholdChanged: false,
      atlasRankingChanged: false,
      embeddingModelChanged: false,
      parentRetrievalEnabled: false,
      answerGenerationExecuted: false,
    },
    annotatedAnchorRule: {
      source: 'fixed diagnostic annotation',
      anchorMustBeRequiredLeaf: true,
      adjacentRadius: 1,
      maximumAdjacentAdditions: 2,
      maxBoundaryGapSec: 2,
      sameVideoOnly: true,
      scopeAndPlayableSourceRequired: true,
      fixedContextLeafCount: CONTEXT_LIMIT,
      annotations: ROUND7_ANNOTATED_ANCHORS,
    },
    liveProviderControl: {
      diagnosticOnly: true,
      embeddingMinimumIntervalMs: DIAGNOSTIC_EMBEDDING_MIN_INTERVAL_MS,
      retryEnabled: false,
      retrievalSemanticsChanged: false,
    },
    questions,
    goNoGo: null,
    safety: {
      ...commandMonitor.snapshot(),
      databaseAccess: inspection.databaseAccess || round6.safety.databaseAccess || null,
      callCounts: {
        queryEmbeddingCalls: round6EvidenceReused
          ? 0 : round6.safety.callCounts.queryEmbeddingCalls,
        atlasRetrievalCalls: round6EvidenceReused
          ? 0 : round6.safety.callCounts.atlasRetrievalCalls,
        round6AdjacentLeafReadCalls: round6EvidenceReused ? 0 : QUESTION_IDS.length * 2,
        annotatedAnchorLookupReadCalls,
        annotatedAdjacentLeafReadCalls,
        answerGenerationCalls: 0,
      },
      sourceEvidenceCallCounts: round6EvidenceReused
        ? round6.safety.callCounts : null,
      credentialsIncluded: false,
    },
  };
  result.goNoGo = evaluateGoNoGo(result.questions);
  return result;
}

async function main() {
  const commandMonitor = createCommandMonitor();
  let dependencies;
  try {
    dependencies = await createLiveDependencies(commandMonitor, {
      mode: STUDENT_PILOT_OPENCV_MODE,
    });
    const result = await runRound7Diagnostic({
      ...dependencies,
      commandMonitor,
      embed: createThrottledDiagnosticEmbed(),
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify(safeFailure(error)));
    process.exitCode = 1;
  } finally {
    if (dependencies?.close) await dependencies.close();
  }
}

if (require.main === module) main();

module.exports = {
  ROUND7_ANNOTATED_ANCHORS,
  ROUND7_PROFILE,
  ROUND7_SCHEMA_VERSION,
  buildTargetGroupCoverage,
  createThrottledDiagnosticEmbed,
  evaluateGoNoGo,
  loadAnnotatedAnchor,
  runRound7Diagnostic,
  selectAnnotatedAnchorUpperBound,
  validateAnnotation,
  validateRound6Evidence,
};
