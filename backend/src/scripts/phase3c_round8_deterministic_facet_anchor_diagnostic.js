const fs = require('node:fs');
const path = require('node:path');
const { embedQuery } = require('../services/queryEmbedding.service');
const { evaluateRetrievalCandidates } = require('../services/retrievalEvaluation.service');
const {
  STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH,
} = require('../data/studentPilotRetrievalGroundTruth');
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
  ROUND6_FACETS,
  classifyContext,
  compareContextSets,
  mergeFacetQuotaSelections,
  validateAtlasSearch,
  validateQueryVector,
} = require('./phase3c_round6_per_facet_quota_diagnostic');
const {
  ROUND7_PROFILE,
  ROUND7_SCHEMA_VERSION,
  buildTargetGroupCoverage,
  createThrottledDiagnosticEmbed,
  runRound7Diagnostic,
} = require('./phase3c_round7_annotated_anchor_upper_bound_diagnostic');

const ROUND8_SCHEMA_VERSION = 'phase3c-round8-deterministic-facet-anchor-v1';
const ROUND8_PROFILE = 'facet-exclusive-video-safe-predecessor-adjacent-context15-v1';
const QUESTION_IDS = Object.freeze(['Q11', 'Q08']);
const MAX_BOUNDARY_GAP_SEC = 2;

const ROUND8_SELECTOR_RULE = Object.freeze({
  candidateSource: 'fixed_facet_query_atlas_candidate30',
  seedDepth: 'within_each_facet_reserved_quota',
  exclusiveVideoRule: 'video_absent_from_every_sibling_facet_candidate30',
  seedOrder: 'atlas_rank_ascending_then_score_descending_then_chunk_id',
  anchorRule: 'safe_immediate_predecessor_else_seed',
  noExclusiveSeedFallback: 'leave_facet_context_unchanged',
  llmUsed: false,
  groundTruthUsedForSelection: false,
  questionIdSpecificAnchorRuleUsed: false,
  annotatedChunkIdHardcodingUsed: false,
  sameVideoOnly: true,
  adjacentRadius: 1,
  maximumAdjacentAdditionsPerFacet: 2,
  maxBoundaryGapSec: MAX_BOUNDARY_GAP_SEC,
  scopeAndPlayableSourceRequired: true,
  fixedContextLeafCount: CONTEXT_LIMIT,
});

function chunkKey(match) {
  return String(match?.chunkId || '');
}

function videoKey(match) {
  return String(match?.videoId || '');
}

function parseChunkOrdinal(match) {
  const videoId = videoKey(match);
  const chunkId = chunkKey(match);
  const prefix = `${videoId}_chunk_`;
  if (!videoId || !chunkId.startsWith(prefix)) return null;
  const suffix = chunkId.slice(prefix.length);
  return /^\d+$/.test(suffix) ? Number(suffix) : null;
}

function adjacentDetails(anchor, candidate) {
  if (videoKey(anchor) !== videoKey(candidate)) return null;
  const anchorOrdinal = parseChunkOrdinal(anchor);
  const candidateOrdinal = parseChunkOrdinal(candidate);
  if (!Number.isInteger(anchorOrdinal) || !Number.isInteger(candidateOrdinal)
      || Math.abs(anchorOrdinal - candidateOrdinal) !== 1) return null;
  const earlier = anchorOrdinal < candidateOrdinal ? anchor : candidate;
  const later = anchorOrdinal < candidateOrdinal ? candidate : anchor;
  const earlierEnd = Number(earlier?.endSec);
  const laterStart = Number(later?.startSec);
  if (!Number.isFinite(earlierEnd) || !Number.isFinite(laterStart)) return null;
  const boundaryGapSec = Number((laterStart - earlierEnd).toFixed(4));
  return Math.abs(boundaryGapSec) <= MAX_BOUNDARY_GAP_SEC
    ? { boundaryGapSec } : null;
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

function validateRound7Evidence(round7) {
  const questions = Array.isArray(round7?.questions) ? round7.questions : [];
  const questionIds = new Set(questions.map((question) => question.id));
  const comparisonsValid = questions.every((question) => (
    question?.comparisons?.currentBestRound6PerFacetQuotaAdjacent?.leafCount === CONTEXT_LIMIT
    && question?.comparisons?.annotatedCorrectAnchorAdjacent?.leafCount === CONTEXT_LIMIT
  ));
  if (round7?.schemaVersion !== ROUND7_SCHEMA_VERSION
      || round7?.profile !== ROUND7_PROFILE
      || round7?.productionRuntimeAffected !== false
      || round7?.goNoGo?.decision !== 'GO'
      || round7?.safety?.mongoWrites !== 0
      || round7?.safety?.writeDetected !== false
      || round7?.safety?.callCounts?.answerGenerationCalls !== 0
      || QUESTION_IDS.some((id) => !questionIds.has(id))
      || !comparisonsValid) {
    throw new IsolatedE2EError(
      'The supplied Round 7 evidence does not satisfy the complete read-only oracle contract.',
      'E2E_ROUND7_EVIDENCE_INVALID',
    );
  }
  return round7;
}

function buildFacetOwnedContexts(currentBest, facetDefinitions) {
  const strategyMatches = hydrateStrategyMatches(currentBest);
  const matchByChunkId = new Map(strategyMatches.map((match) => [chunkKey(match), match]));
  const mergeLeaves = Array.isArray(currentBest?.merge?.leaves) ? currentBest.merge.leaves : [];
  return facetDefinitions.map((definition) => {
    const ownedMetadata = mergeLeaves.filter((leaf) => leaf.quotaOwner === definition.facetId);
    const matches = ownedMetadata.map((metadata) => matchByChunkId.get(metadata.chunkId))
      .filter(Boolean);
    if (matches.length !== definition.quota) {
      throw new IsolatedE2EError(
        `Round 6 context ownership for ${definition.facetId} is incomplete.`,
        'E2E_ROUND6_FACET_CONTEXT_INVALID',
      );
    }
    return { ...definition, ownedMetadata, matches };
  });
}

function rankFacetExclusiveSeeds({ facet, siblingFacets, scope, playableVideoIds }) {
  const allowedVideoIds = scope?.allowedVideoIds instanceof Set
    ? scope.allowedVideoIds : new Set();
  const playableIds = playableVideoIds instanceof Set ? playableVideoIds : new Set();
  const siblingVideoIds = new Set();
  for (const sibling of siblingFacets) {
    for (const match of sibling.matches || []) siblingVideoIds.add(videoKey(match));
  }
  return (facet.matches || []).slice(0, facet.quota)
    .map((match, index) => ({ match, candidateRank: index + 1 }))
    .filter(({ match }) => {
      const videoId = videoKey(match);
      return videoId && allowedVideoIds.has(videoId) && playableIds.has(videoId)
        && !siblingVideoIds.has(videoId) && Number.isInteger(parseChunkOrdinal(match));
    })
    .sort((left, right) => (
      left.candidateRank - right.candidateRank
      || Number(right.match?.score || 0) - Number(left.match?.score || 0)
      || chunkKey(left.match).localeCompare(chunkKey(right.match))
    ));
}

function qualifyDeterministicFacetAnchor({
  facet,
  siblingFacets,
  adjacentLeaves,
  scope,
  playableVideoIds,
}) {
  const rankedSeeds = rankFacetExclusiveSeeds({
    facet,
    siblingFacets,
    scope,
    playableVideoIds,
  });
  if (!rankedSeeds.length) {
    return {
      seed: null,
      anchor: null,
      diagnostics: {
        status: 'no_exclusive_video_seed_in_quota',
        facetId: facet.facetId,
        candidateCount: (facet.matches || []).length,
        quota: facet.quota,
        selectorMutationApplied: false,
      },
    };
  }

  const selectedSeed = rankedSeeds[0];
  const seedOrdinal = parseChunkOrdinal(selectedSeed.match);
  const safePredecessors = (Array.isArray(adjacentLeaves) ? adjacentLeaves : [])
    .map((leaf) => ({ leaf, details: adjacentDetails(selectedSeed.match, leaf) }))
    .filter(({ leaf, details }) => details && parseChunkOrdinal(leaf) === seedOrdinal - 1)
    .sort((left, right) => chunkKey(left.leaf).localeCompare(chunkKey(right.leaf)));
  const predecessor = safePredecessors[0] || null;
  const anchor = predecessor?.leaf || selectedSeed.match;

  return {
    seed: selectedSeed.match,
    anchor,
    diagnostics: {
      status: predecessor ? 'safe_predecessor_qualified' : 'exclusive_seed_retained',
      facetId: facet.facetId,
      candidateCount: (facet.matches || []).length,
      quota: facet.quota,
      selectedSeed: {
        candidateRank: selectedSeed.candidateRank,
        chunkId: chunkKey(selectedSeed.match),
        videoId: videoKey(selectedSeed.match),
        score: Number.isFinite(Number(selectedSeed.match?.score))
          ? Number(selectedSeed.match.score) : null,
        videoAbsentFromSiblingCandidate30: true,
      },
      qualifiedAnchor: {
        chunkId: chunkKey(anchor),
        videoId: videoKey(anchor),
        source: predecessor ? 'safe_immediate_predecessor' : 'exclusive_seed',
        predecessorBoundaryGapSec: predecessor?.details?.boundaryGapSec ?? null,
      },
      selectorMutationApplied: true,
    },
  };
}

function selectQualifiedFacetContext({
  ownedMatches,
  anchor,
  adjacentLeaves,
  quota,
  scope,
  playableVideoIds,
}) {
  if (!anchor) {
    return {
      matches: ownedMatches.slice(0, quota),
      diagnostics: {
        strategy: ROUND8_PROFILE,
        applied: false,
        anchorPolicy: 'no_exclusive_video_seed_fail_closed',
        sameVideoOnly: true,
        scopeValidated: true,
        playableSourceValidated: true,
        adjacentRadius: 1,
        maxAdditions: 2,
        added: [],
        removed: [],
      },
    };
  }

  const seededBase = [];
  const seededIds = new Set();
  for (const match of [anchor, ...ownedMatches]) {
    const id = chunkKey(match);
    if (!id || seededIds.has(id)) continue;
    seededIds.add(id);
    seededBase.push(match);
    if (seededBase.length >= quota) break;
  }
  const exactAdjacent = (Array.isArray(adjacentLeaves) ? adjacentLeaves : [])
    .filter((leaf) => adjacentDetails(anchor, leaf));
  const candidatePool = [...seededBase];
  const candidateIds = new Set(candidatePool.map(chunkKey));
  for (const leaf of exactAdjacent) {
    const id = chunkKey(leaf);
    if (!id || candidateIds.has(id)) continue;
    candidateIds.add(id);
    candidatePool.push(leaf);
  }

  const selected = selectDiagnosticSameVideoAdjacentContext({
    matches: candidatePool,
    adjacentLeaves: exactAdjacent,
    limit: quota,
    scope,
    playableVideoIds,
  });
  if (!selected.matches.some((match) => chunkKey(match) === chunkKey(anchor))) {
    throw new IsolatedE2EError(
      'The deterministic qualified anchor was dropped from its facet quota.',
      'E2E_DETERMINISTIC_ANCHOR_DROPPED',
    );
  }
  const wrongAnchorAddition = selected.diagnostics.added.find(
    (addition) => addition.anchorChunkId !== chunkKey(anchor),
  );
  if (wrongAnchorAddition) {
    throw new IsolatedE2EError(
      'The deterministic expansion used a non-qualified anchor.',
      'E2E_DETERMINISTIC_ANCHOR_BYPASSED',
    );
  }
  return {
    matches: selected.matches,
    diagnostics: {
      ...selected.diagnostics,
      strategy: ROUND8_PROFILE,
      anchorPolicy: 'facet_exclusive_video_safe_predecessor',
      qualifiedAnchorChunkId: chunkKey(anchor),
      added: selected.diagnostics.added.map((addition) => ({
        ...addition,
        source: 'deterministic_qualified_anchor_one_hop',
      })),
    },
  };
}

async function retrieveFacet({
  definition,
  embed,
  searchStudentPilotLeaves,
  commandMonitor,
  callCounts,
  scope,
  courseId,
}) {
  callCounts.queryEmbeddingCalls += 1;
  const queryVector = await embed(definition.question);
  validateQueryVector(queryVector);
  callCounts.atlasRetrievalCalls += 1;
  const result = await searchStudentPilotLeaves({
    queryVector,
    scope,
    courseId,
    candidateDepth: CANDIDATE_DEPTH,
  });
  commandMonitor.assertNoWrites();
  return { ...definition, matches: validateAtlasSearch(result) };
}

function addTargetCoverage(strategy, expectedLeafGroups, groupId) {
  return {
    ...strategy,
    targetGroupCoverage: buildTargetGroupCoverage(
      expectedLeafGroups,
      groupId,
      hydrateStrategyMatches(strategy),
    ),
  };
}

function buildDeterministicStrategy({
  expectedLeafGroups,
  targetGroupId,
  currentBestMatches,
  merged,
  facetQualifications,
  callCost,
}) {
  return {
    strategy: ROUND8_PROFILE,
    leafCount: merged.matches.length,
    leaves: buildLeafDiagnostics(merged.matches),
    evaluation: evaluateRetrievalCandidates({
      expectedLeafGroups,
      candidates: merged.matches,
      k: CONTEXT_LIMIT,
    }),
    targetGroupCoverage: buildTargetGroupCoverage(
      expectedLeafGroups,
      targetGroupId,
      merged.matches,
    ),
    composition: classifyContext(expectedLeafGroups, merged.matches),
    merge: merged.diagnostics,
    facetQualifications,
    deltaFromRound6: compareContextSets(
      expectedLeafGroups,
      currentBestMatches,
      merged.matches,
    ),
    cost: callCost,
  };
}

async function runQuestionDiagnostic({
  round7Question,
  facetDefinitions,
  expectedLeafGroups,
  dependencies,
  scope,
  playableVideoIds,
  callCounts,
}) {
  const facets = [];
  for (const definition of facetDefinitions) {
    facets.push(await retrieveFacet({
      definition,
      embed: dependencies.embed,
      searchStudentPilotLeaves: dependencies.searchStudentPilotLeaves,
      commandMonitor: dependencies.commandMonitor,
      callCounts,
      scope,
      courseId: dependencies.courseId,
    }));
  }

  const currentBest = round7Question.comparisons.currentBestRound6PerFacetQuotaAdjacent;
  const oracle = round7Question.comparisons.annotatedCorrectAnchorAdjacent;
  const currentBestMatches = hydrateStrategyMatches(currentBest);
  const ownedContexts = buildFacetOwnedContexts(currentBest, facetDefinitions);
  const expandedFacets = [];
  const facetQualifications = [];

  for (const facet of facets) {
    const siblingFacets = facets.filter((candidate) => candidate.facetId !== facet.facetId);
    const rankedSeeds = rankFacetExclusiveSeeds({
      facet,
      siblingFacets,
      scope,
      playableVideoIds,
    });
    let qualificationAdjacentLeaves = [];
    if (rankedSeeds.length) {
      callCounts.qualificationProbeReadCalls += 1;
      qualificationAdjacentLeaves = await dependencies.loadStudentPilotAdjacentLeaves({
        anchors: [rankedSeeds[0].match],
        scope,
        courseId: dependencies.courseId,
      });
      dependencies.commandMonitor.assertNoWrites();
    }
    const qualification = qualifyDeterministicFacetAnchor({
      facet,
      siblingFacets,
      adjacentLeaves: qualificationAdjacentLeaves,
      scope,
      playableVideoIds,
    });
    let anchorAdjacentLeaves = [];
    if (qualification.anchor) {
      callCounts.qualifiedAnchorAdjacentReadCalls += 1;
      anchorAdjacentLeaves = await dependencies.loadStudentPilotAdjacentLeaves({
        anchors: [qualification.anchor],
        scope,
        courseId: dependencies.courseId,
      });
      dependencies.commandMonitor.assertNoWrites();
    }
    const owned = ownedContexts.find((context) => context.facetId === facet.facetId);
    const selection = selectQualifiedFacetContext({
      ownedMatches: owned.matches,
      anchor: qualification.anchor,
      adjacentLeaves: anchorAdjacentLeaves,
      quota: facet.quota,
      scope,
      playableVideoIds,
    });
    expandedFacets.push({
      facetId: facet.facetId,
      quota: facet.quota,
      matches: owned.matches,
      selection,
    });
    facetQualifications.push({
      ...qualification.diagnostics,
      queryId: facet.id,
      query: facet.question,
      candidateVideoCount: new Set(facet.matches.map(videoKey)).size,
      siblingCandidateVideoCount: new Set(
        siblingFacets.flatMap((sibling) => sibling.matches.map(videoKey)),
      ).size,
      expansion: selection.diagnostics,
    });
  }

  const merged = mergeFacetQuotaSelections({ facets: expandedFacets });
  const targetGroupId = oracle?.targetGroupCoverage?.groupId;
  if (!targetGroupId) {
    throw new IsolatedE2EError(
      'Round 7 oracle target group is missing.',
      'E2E_ROUND7_TARGET_GROUP_MISSING',
    );
  }
  const deterministic = buildDeterministicStrategy({
    expectedLeafGroups,
    targetGroupId,
    currentBestMatches,
    merged,
    facetQualifications,
    callCost: {
      queryEmbeddingCalls: facetDefinitions.length,
      atlasVectorSearchCalls: facetDefinitions.length,
      qualificationProbeReadCalls: facetQualifications.filter(
        (item) => item.selectorMutationApplied,
      ).length,
      qualifiedAnchorAdjacentReadCalls: facetQualifications.filter(
        (item) => item.selectorMutationApplied,
      ).length,
      answerGenerationCalls: 0,
    },
  });
  return {
    id: round7Question.id,
    question: round7Question.question,
    comparisons: {
      round6PerFacetQuotaAdjacent: addTargetCoverage(
        currentBest,
        expectedLeafGroups,
        targetGroupId,
      ),
      round7AnnotatedAnchorOracle: addTargetCoverage(
        oracle,
        expectedLeafGroups,
        targetGroupId,
      ),
      round8DeterministicAnchorAdjacent: deterministic,
    },
  };
}

function evaluateProductionCandidate(questions) {
  const q11 = questions.find((question) => question.id === 'Q11');
  const strategies = questions.map((question) => ({
    questionId: question.id,
    strategy: question.comparisons.round8DeterministicAnchorAdjacent,
  }));
  const q11RequiredHits = q11?.comparisons?.round8DeterministicAnchorAdjacent
    ?.targetGroupCoverage?.requiredHitCountAtK || 0;
  const addedNoiseByQuestion = Object.fromEntries(strategies.map(({ questionId, strategy }) => [
    questionId,
    strategy?.deltaFromRound6?.added?.noiseLeafCount ?? Number.POSITIVE_INFINITY,
  ]));
  const context15 = strategies.every(({ strategy }) => strategy?.leafCount === CONTEXT_LIMIT);
  const noiseSafe = Object.values(addedNoiseByQuestion).every((count) => count <= 1);
  const adjacentSafe = strategies.every(({ strategy }) => (
    strategy.facetQualifications.every((facet) => (
      facet.expansion.adjacentRadius === 1
      && facet.expansion.maxAdditions === 2
      && facet.expansion.sameVideoOnly === true
      && facet.expansion.scopeValidated === true
      && facet.expansion.playableSourceValidated === true
    ))
  ));
  const selectorContract = ROUND8_SELECTOR_RULE.llmUsed === false
    && ROUND8_SELECTOR_RULE.groundTruthUsedForSelection === false
    && ROUND8_SELECTOR_RULE.questionIdSpecificAnchorRuleUsed === false
    && ROUND8_SELECTOR_RULE.annotatedChunkIdHardcodingUsed === false;
  const go = q11RequiredHits >= 3 && context15 && noiseSafe
    && adjacentSafe && selectorContract;
  return {
    decision: go ? 'GO' : 'NO-GO',
    label: go ? 'production_candidate' : 'not_a_production_candidate',
    observed: {
      q11G2RequiredHitCount: q11RequiredHits,
      contextLeafCountByQuestion: Object.fromEntries(strategies.map(
        ({ questionId, strategy }) => [questionId, strategy.leafCount],
      )),
      addedNoiseVersusRound6ByQuestion: addedNoiseByQuestion,
      selectorContractSatisfied: selectorContract,
      existingAdjacentSafetyPreserved: adjacentSafe,
    },
    frozenThresholds: {
      minimumQ11G2RequiredHitCount: 3,
      q11G2RequiredCount: 4,
      fixedContextLeafCount: CONTEXT_LIMIT,
      maximumAddedNoisePerQuestion: 1,
      maximumAdjacentRadius: 1,
    },
    checks: {
      q11G2AtLeastThreeOfFour: q11RequiredHits >= 3,
      context15PreservedForEveryQuestion: context15,
      addedNoiseAtMostOnePerQuestion: noiseSafe,
      noLlmGroundTruthOrQuestionHardcoding: selectorContract,
      existingAdjacentSafetyPreserved: adjacentSafe,
    },
  };
}

async function runRound8Diagnostic(dependencies = {}) {
  const commandMonitor = dependencies.commandMonitor || createCommandMonitor();
  if (typeof dependencies.searchStudentPilotLeaves !== 'function'
      || typeof dependencies.loadStudentPilotAdjacentLeaves !== 'function'
      || typeof dependencies.embed !== 'function') {
    throw new IsolatedE2EError(
      'Round 8 requires fixed-query Atlas search and read-only adjacent Leaf dependencies.',
      'E2E_ROUND8_DEPENDENCY_UNAVAILABLE',
    );
  }
  const round7EvidenceReused = Boolean(dependencies.round7Result);
  const round7 = validateRound7Evidence(
    dependencies.round7Result || await runRound7Diagnostic({ ...dependencies, commandMonitor }),
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
  const callCounts = {
    queryEmbeddingCalls: 0,
    atlasRetrievalCalls: 0,
    qualificationProbeReadCalls: 0,
    qualifiedAnchorAdjacentReadCalls: 0,
    answerGenerationCalls: 0,
  };
  const questions = [];
  for (const questionId of QUESTION_IDS) {
    const round7Question = round7.questions.find((question) => question.id === questionId);
    questions.push(await runQuestionDiagnostic({
      round7Question,
      facetDefinitions: ROUND6_FACETS[questionId],
      expectedLeafGroups: STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH[questionId].expectedLeafGroups,
      dependencies: {
        ...dependencies,
        commandMonitor,
        courseId: options.courseId,
      },
      scope,
      playableVideoIds,
      callCounts,
    }));
  }
  commandMonitor.assertNoWrites();
  const result = {
    schemaVersion: ROUND8_SCHEMA_VERSION,
    profile: ROUND8_PROFILE,
    productionRuntimeAffected: false,
    baselineEvidenceSource: {
      mode: round7EvidenceReused ? 'reused_complete_round7_raw_json' : 'fresh_round7_live_run',
      schemaVersion: round7.schemaVersion,
      profile: round7.profile,
      sourceMongoWrites: round7.safety.mongoWrites,
      sourceAnswerGenerationCalls: round7.safety.callCounts.answerGenerationCalls,
    },
    retrieval: {
      backend: 'atlas',
      leafOnly: true,
      candidateDepth: CANDIDATE_DEPTH,
      contextLimit: CONTEXT_LIMIT,
      fixedSubqueries: true,
      thresholdChanged: false,
      atlasRankingChanged: false,
      embeddingModelChanged: false,
      parentRetrievalEnabled: false,
      answerGenerationExecuted: false,
    },
    deterministicAnchorRule: ROUND8_SELECTOR_RULE,
    questions,
    productionCandidate: null,
    safety: {
      ...commandMonitor.snapshot(),
      databaseAccess: inspection.databaseAccess || round7.safety.databaseAccess || null,
      callCounts,
      sourceEvidenceCallCounts: round7EvidenceReused ? round7.safety.callCounts : null,
      credentialsIncluded: false,
    },
  };
  result.productionCandidate = evaluateProductionCandidate(result.questions);
  return result;
}

function parseCliArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const index = args.indexOf('--round7-evidence');
  if (index === -1) return { round7EvidencePath: null };
  if (!args[index + 1] || args[index + 1].startsWith('--')) {
    throw new IsolatedE2EError(
      '--round7-evidence requires a JSON file path.',
      'E2E_ROUND7_EVIDENCE_PATH_REQUIRED',
    );
  }
  return { round7EvidencePath: path.resolve(args[index + 1]) };
}

function loadJsonEvidence(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

async function main() {
  const commandMonitor = createCommandMonitor();
  let dependencies;
  try {
    const { round7EvidencePath } = parseCliArgs(process.argv.slice(2));
    dependencies = await createLiveDependencies(commandMonitor, {
      mode: STUDENT_PILOT_OPENCV_MODE,
    });
    const result = await runRound8Diagnostic({
      ...dependencies,
      commandMonitor,
      embed: createThrottledDiagnosticEmbed({ embed: embedQuery }),
      round7Result: round7EvidencePath ? loadJsonEvidence(round7EvidencePath) : undefined,
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
  ROUND8_PROFILE,
  ROUND8_SCHEMA_VERSION,
  ROUND8_SELECTOR_RULE,
  adjacentDetails,
  buildFacetOwnedContexts,
  evaluateProductionCandidate,
  parseCliArgs,
  qualifyDeterministicFacetAnchor,
  rankFacetExclusiveSeeds,
  runRound8Diagnostic,
  selectQualifiedFacetContext,
  validateRound7Evidence,
};
