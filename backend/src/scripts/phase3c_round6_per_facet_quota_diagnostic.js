const path = require('node:path');
const { embedQuery } = require('../services/queryEmbedding.service');
const { evaluateRetrievalCandidates } = require('../services/retrievalEvaluation.service');
const {
  STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH,
} = require('../data/studentPilotRetrievalGroundTruth');
const {
  STUDENT_PILOT_Q11_G2_QUERY_WORDINGS,
  STUDENT_PILOT_QUERY_DECOMPOSITIONS,
} = require('../data/studentPilotQueryDecomposition');
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
  findDiagnosticReliableAdjacentAnchors,
  inspectAndValidateStudentPilotOpenCvScope,
  loadStudentPilotQuestionBank,
  mergeDiagnosticSubqueryCandidates,
  safeFailure,
  selectDiagnosticSameVideoAdjacentContext,
} = require('./phase2_2_hierarchical_e2e_runner');

const ROUND6_SCHEMA_VERSION = 'phase3c-round6-per-facet-quota-v1';
const ROUND6_PROFILE = 'fixed-facets-quota-6-9-adjacent-one-hop-v1';
const CANDIDATE_DEPTH = 30;
const CONTEXT_LIMIT = 15;
const QUESTION_IDS = Object.freeze(['Q11', 'Q08']);
const DEFAULT_QUESTION_BANK_PATH = path.resolve(
  __dirname,
  '../../../docs/2026-09_Student_Pilot_Backend/evidence/2026-09-01_baseline_questions.json',
);

const q11G2FixedQuery = STUDENT_PILOT_Q11_G2_QUERY_WORDINGS.find(
  (query) => query.id === 'Q11-G2-THREE-VS-ONE',
);

const ROUND6_FACETS = Object.freeze({
  Q11: Object.freeze([
    Object.freeze({
      ...STUDENT_PILOT_QUERY_DECOMPOSITIONS.Q11[0],
      facetId: 'Q11-G1-HARDWARE',
      expectedGroupId: 'G1',
      quota: 6,
    }),
    Object.freeze({
      ...q11G2FixedQuery,
      facetId: 'Q11-G2-MULTI-OBJECT',
      expectedGroupId: 'G2',
      quota: 9,
    }),
  ]),
  Q08: Object.freeze([
    Object.freeze({
      ...STUDENT_PILOT_QUERY_DECOMPOSITIONS.Q08[0],
      facetId: 'Q08-F1-SEPARATE-DETECTORS',
      expectedGroupId: 'G1',
      quota: 6,
    }),
    Object.freeze({
      ...STUDENT_PILOT_QUERY_DECOMPOSITIONS.Q08[1],
      facetId: 'Q08-F2-REPEATED-COST',
      expectedGroupId: 'G1',
      quota: 9,
    }),
  ]),
});

function chunkKey(match) {
  return String(match?.chunkId || '');
}

function validateQueryVector(queryVector) {
  if (!Array.isArray(queryVector) || queryVector.length !== 3072
      || queryVector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new IsolatedE2EError(
      'The Round 6 query embedding does not match the active Leaf index contract.',
      'E2E_QUERY_EMBEDDING_INVALID',
    );
  }
}

function validateAtlasSearch(searchResult) {
  if (searchResult?.backend !== 'atlas' || searchResult?.fallbackUsed === true
      || (Array.isArray(searchResult?.fallbacks) && searchResult.fallbacks.length)) {
    throw new IsolatedE2EError(
      'Round 6 requires Atlas Leaf search without fallback.',
      'E2E_FALLBACK_NOT_ALLOWED',
    );
  }
  return Array.isArray(searchResult.matches) ? searchResult.matches : [];
}

function groupById(expectedLeafGroups, groupId) {
  return (Array.isArray(expectedLeafGroups) ? expectedLeafGroups : [])
    .find((group) => group.groupId === groupId) || null;
}

function classifyContext(expectedLeafGroups, matches) {
  const required = new Set();
  const auxiliary = new Set();
  for (const group of Array.isArray(expectedLeafGroups) ? expectedLeafGroups : []) {
    for (const chunkId of group.requiredChunkIds || group.chunkIds || []) required.add(chunkId);
    for (const chunkId of group.auxiliaryChunkIds || []) auxiliary.add(chunkId);
  }
  const leaves = (Array.isArray(matches) ? matches : []).map((match) => {
    const chunkId = chunkKey(match);
    const classification = required.has(chunkId)
      ? 'required' : auxiliary.has(chunkId) ? 'auxiliary' : 'noise';
    return { chunkId, videoId: String(match?.videoId || ''), classification };
  });
  return {
    requiredLeafCount: leaves.filter((leaf) => leaf.classification === 'required').length,
    auxiliaryLeafCount: leaves.filter((leaf) => leaf.classification === 'auxiliary').length,
    noiseLeafCount: leaves.filter((leaf) => leaf.classification === 'noise').length,
    leaves,
  };
}

function compareContextSets(expectedLeafGroups, baselineMatches, selectedMatches) {
  const baselineChunkIds = new Set((baselineMatches || []).map(chunkKey));
  const selectedChunkIds = new Set((selectedMatches || []).map(chunkKey));
  const addedMatches = (selectedMatches || []).filter(
    (match) => !baselineChunkIds.has(chunkKey(match)),
  );
  const removedMatches = (baselineMatches || []).filter(
    (match) => !selectedChunkIds.has(chunkKey(match)),
  );
  return {
    added: classifyContext(expectedLeafGroups, addedMatches),
    removed: classifyContext(expectedLeafGroups, removedMatches),
  };
}

function mergeFacetQuotaSelections({ facets, contextLimit = CONTEXT_LIMIT }) {
  const selected = [];
  const selectedChunkIds = new Set();
  const ownerCounts = new Map(facets.map((facet) => [facet.facetId, 0]));
  const cursors = new Map(facets.map((facet) => [facet.facetId, 0]));
  const preferences = new Map(facets.map((facet) => {
    const preferred = [];
    const seen = new Set();
    for (const match of [...facet.selection.matches, ...facet.matches]) {
      const chunkId = chunkKey(match);
      if (!chunkId || seen.has(chunkId)) continue;
      seen.add(chunkId);
      preferred.push(match);
    }
    return [facet.facetId, preferred];
  }));

  const takeNextUnique = (facet) => {
    const candidates = preferences.get(facet.facetId);
    let cursor = cursors.get(facet.facetId);
    while (cursor < candidates.length) {
      const match = candidates[cursor];
      cursor += 1;
      cursors.set(facet.facetId, cursor);
      const chunkId = chunkKey(match);
      if (selectedChunkIds.has(chunkId)) continue;
      selectedChunkIds.add(chunkId);
      selected.push({ match, quotaOwner: facet.facetId });
      ownerCounts.set(facet.facetId, ownerCounts.get(facet.facetId) + 1);
      return true;
    }
    return false;
  };

  let madeProgress = true;
  while (selected.length < contextLimit && madeProgress) {
    madeProgress = false;
    for (const facet of facets) {
      if (selected.length >= contextLimit) break;
      if (ownerCounts.get(facet.facetId) >= facet.quota) continue;
      madeProgress = takeNextUnique(facet) || madeProgress;
    }
  }
  while (selected.length < contextLimit) {
    let spilloverProgress = false;
    for (const facet of facets) {
      if (selected.length >= contextLimit) break;
      spilloverProgress = takeNextUnique(facet) || spilloverProgress;
    }
    if (!spilloverProgress) break;
  }

  const sourcesByChunkId = new Map();
  for (const facet of facets) {
    for (let index = 0; index < facet.matches.length; index += 1) {
      const chunkId = chunkKey(facet.matches[index]);
      if (!sourcesByChunkId.has(chunkId)) sourcesByChunkId.set(chunkId, []);
      sourcesByChunkId.get(chunkId).push({ facetId: facet.facetId, rank: index + 1 });
    }
  }

  return {
    matches: selected.map((entry) => entry.match),
    diagnostics: {
      strategy: 'per_facet_quota_round_robin_chunk_dedupe',
      contextLimit,
      quotaSum: facets.reduce((sum, facet) => sum + facet.quota, 0),
      distribution: facets.map((facet) => ({
        facetId: facet.facetId,
        quota: facet.quota,
        contextLeafCount: ownerCounts.get(facet.facetId),
      })),
      leaves: selected.map((entry, index) => ({
        contextPosition: index + 1,
        chunkId: chunkKey(entry.match),
        videoId: String(entry.match?.videoId || ''),
        quotaOwner: entry.quotaOwner,
        sources: sourcesByChunkId.get(chunkKey(entry.match)) || [],
      })),
    },
  };
}

function buildStrategyResult(expectedLeafGroups, matches, extra = {}) {
  return {
    leafCount: matches.length,
    leaves: buildLeafDiagnostics(matches),
    evaluation: evaluateRetrievalCandidates({
      expectedLeafGroups,
      candidates: matches,
      k: CONTEXT_LIMIT,
    }),
    composition: classifyContext(expectedLeafGroups, matches),
    ...extra,
  };
}

function buildAnchorRetention(facets, contextMatches, expectedLeafGroups) {
  const retained = new Set(contextMatches.map(chunkKey));
  return facets.map((facet) => {
    const group = groupById(expectedLeafGroups, facet.expectedGroupId);
    const required = new Set(group?.requiredChunkIds || group?.chunkIds || []);
    const anchors = facet.matches
      .map((match, index) => ({ chunkId: chunkKey(match), candidateRank: index + 1 }))
      .filter((candidate) => required.has(candidate.chunkId));
    return {
      facetId: facet.facetId,
      expectedGroupId: facet.expectedGroupId,
      requiredCandidateAnchors: anchors,
      retainedRequiredCandidateAnchors: anchors.filter((anchor) => retained.has(anchor.chunkId)),
      allRequiredCandidateAnchorsRetained: anchors.every((anchor) => retained.has(anchor.chunkId)),
    };
  });
}

async function retrieveQuery({
  id,
  question,
  embed,
  searchStudentPilotLeaves,
  commandMonitor,
  callCounts,
  scope,
  courseId,
}) {
  callCounts.queryEmbeddingCalls += 1;
  const queryVector = await embed(question);
  validateQueryVector(queryVector);
  callCounts.atlasRetrievalCalls += 1;
  const searchResult = await searchStudentPilotLeaves({
    queryVector,
    scope,
    courseId,
    candidateDepth: CANDIDATE_DEPTH,
  });
  commandMonitor.assertNoWrites();
  return { id, question, matches: validateAtlasSearch(searchResult) };
}

async function runQuestionDiagnostic({
  question,
  facetDefinitions,
  expectedLeafGroups,
  dependencies,
  scope,
  playableVideoIds,
  callCounts,
}) {
  const {
    embed,
    searchStudentPilotLeaves,
    loadStudentPilotAdjacentLeaves,
    commandMonitor,
    courseId,
  } = dependencies;
  const single = await retrieveQuery({
    id: question.id,
    question: question.question,
    embed,
    searchStudentPilotLeaves,
    commandMonitor,
    callCounts,
    scope,
    courseId,
  });
  const facets = [];
  for (const definition of facetDefinitions) {
    const retrieved = await retrieveQuery({
      id: definition.facetId,
      question: definition.question,
      embed,
      searchStudentPilotLeaves,
      commandMonitor,
      callCounts,
      scope,
      courseId,
    });
    facets.push({ ...definition, matches: retrieved.matches });
  }

  const merged = mergeDiagnosticSubqueryCandidates(facets.map((facet) => ({
    id: facet.facetId,
    matches: facet.matches,
  })));
  const noQuotaContext = merged.matches.slice(0, CONTEXT_LIMIT);

  const expandedFacets = [];
  for (const facet of facets) {
    const reliableAnchors = findDiagnosticReliableAdjacentAnchors(facet.matches, facet.quota);
    const adjacentLeaves = await loadStudentPilotAdjacentLeaves({
      anchors: reliableAnchors,
      scope,
      courseId,
    });
    commandMonitor.assertNoWrites();
    expandedFacets.push({
      ...facet,
      selection: selectDiagnosticSameVideoAdjacentContext({
        matches: facet.matches,
        adjacentLeaves,
        limit: facet.quota,
        scope,
        playableVideoIds,
      }),
    });
  }
  const quotaContext = mergeFacetQuotaSelections({ facets: expandedFacets });

  const singleResult = buildStrategyResult(
    expectedLeafGroups,
    single.matches.slice(0, CONTEXT_LIMIT),
    {
      strategy: 'single_query_candidate_rank_prefix',
      candidateCount: single.matches.length,
      candidateEvaluation: evaluateRetrievalCandidates({
        expectedLeafGroups,
        candidates: single.matches,
        k: CANDIDATE_DEPTH,
      }),
      cost: { queryEmbeddingCalls: 1, atlasVectorSearchCalls: 1, adjacentLeafReadCalls: 0 },
    },
  );
  const noQuotaResult = buildStrategyResult(
    expectedLeafGroups,
    noQuotaContext,
    {
      strategy: merged.diagnostics.strategy,
      candidateCount: merged.matches.length,
      candidateEvaluation: evaluateRetrievalCandidates({
        expectedLeafGroups,
        candidates: merged.matches,
        k: merged.matches.length,
      }),
      merge: merged.diagnostics,
      anchorRetention: buildAnchorRetention(facets, noQuotaContext, expectedLeafGroups),
      cost: { queryEmbeddingCalls: 2, atlasVectorSearchCalls: 2, adjacentLeafReadCalls: 0 },
    },
  );
  const quotaResult = buildStrategyResult(
    expectedLeafGroups,
    quotaContext.matches,
    {
      strategy: ROUND6_PROFILE,
      merge: quotaContext.diagnostics,
      facets: expandedFacets.map((facet) => ({
        facetId: facet.facetId,
        queryId: facet.id,
        question: facet.question,
        expectedGroupId: facet.expectedGroupId,
        quota: facet.quota,
        candidateCount: facet.matches.length,
        reliableAnchorChunkIds: facet.selection.diagnostics.reliableAnchorChunkIds,
        adjacentAdded: facet.selection.diagnostics.added,
        adjacentRemoved: facet.selection.diagnostics.removed,
      })),
      anchorRetention: buildAnchorRetention(facets, quotaContext.matches, expectedLeafGroups),
      targetVideoDistribution: expectedLeafGroups.map((group) => ({
        groupId: group.groupId,
        videoId: group.videoId,
        contextLeafCount: quotaContext.matches.filter(
          (match) => String(match?.videoId || '') === String(group.videoId),
        ).length,
      })),
      deltaFromSingleQuery: compareContextSets(
        expectedLeafGroups,
        single.matches.slice(0, CONTEXT_LIMIT),
        quotaContext.matches,
      ),
      deltaFromNoQuotaDecomposition: compareContextSets(
        expectedLeafGroups,
        noQuotaContext,
        quotaContext.matches,
      ),
      cost: { queryEmbeddingCalls: 2, atlasVectorSearchCalls: 2, adjacentLeafReadCalls: 2 },
    },
  );

  return {
    id: question.id,
    question: question.question,
    comparisons: {
      singleQueryCandidate30Context15: singleResult,
      queryDecompositionNoQuotaNoAdjacent: noQuotaResult,
      perFacetQuotaAdjacent: quotaResult,
    },
  };
}

async function runRound6Diagnostic(dependencies = {}) {
  const {
    commandMonitor = createCommandMonitor(),
    inspectStudentPilotOpenCvScope,
    searchStudentPilotLeaves,
    loadStudentPilotAdjacentLeaves,
    embed = embedQuery,
    questionBank = loadStudentPilotQuestionBank(DEFAULT_QUESTION_BANK_PATH),
  } = dependencies;
  if (typeof loadStudentPilotAdjacentLeaves !== 'function') {
    throw new IsolatedE2EError(
      'Round 6 requires the read-only same-video adjacent Leaf dependency.',
      'E2E_ADJACENT_LOOKUP_UNAVAILABLE',
    );
  }
  const options = {
    mode: STUDENT_PILOT_OPENCV_MODE,
    courseId: STUDENT_PILOT_OPENCV_COURSE_ID,
    excludedVideoId: STUDENT_PILOT_OPENCV_EXCLUDED_VIDEO_ID,
    expectedVideoCount: STUDENT_PILOT_OPENCV_EXPECTED_VIDEO_COUNT,
    expectedSegmentCount: STUDENT_PILOT_OPENCV_EXPECTED_SEGMENT_COUNT,
  };
  const { allowedVideoIds, inspection } = await inspectAndValidateStudentPilotOpenCvScope(
    options,
    { inspectStudentPilotOpenCvScope, commandMonitor },
  );
  const scope = {
    allowedCourseIds: new Set([options.courseId]),
    allowedVideoIds: new Set(allowedVideoIds),
  };
  const playableVideoIds = buildDiagnosticPlayableVideoIds(inspection.scopedVideos);
  const callCounts = {
    queryEmbeddingCalls: 0,
    atlasRetrievalCalls: 0,
    answerGenerationCalls: 0,
  };
  const questionsById = new Map(questionBank.questions.map((question) => [question.id, question]));
  const questions = [];
  for (const questionId of QUESTION_IDS) {
    questions.push(await runQuestionDiagnostic({
      question: questionsById.get(questionId),
      facetDefinitions: ROUND6_FACETS[questionId],
      expectedLeafGroups: STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH[questionId].expectedLeafGroups,
      dependencies: {
        embed,
        searchStudentPilotLeaves,
        loadStudentPilotAdjacentLeaves,
        commandMonitor,
        courseId: options.courseId,
      },
      scope,
      playableVideoIds,
      callCounts,
    }));
  }
  commandMonitor.assertNoWrites();
  return {
    schemaVersion: ROUND6_SCHEMA_VERSION,
    profile: ROUND6_PROFILE,
    productionRuntimeAffected: false,
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
    quota: {
      rule: 'facet-1 reserves 6, facet-2 reserves 9; per-facet one-hop adjacent adds at most 2; round-robin chunk dedupe',
      maximumFacetShare: 0.6,
      fixedContextLeafCount: CONTEXT_LIMIT,
    },
    questions,
    safety: {
      ...commandMonitor.snapshot(),
      databaseAccess: inspection.databaseAccess || null,
      callCounts,
      credentialsIncluded: false,
    },
  };
}

async function main() {
  const commandMonitor = createCommandMonitor();
  let dependencies;
  try {
    dependencies = await createLiveDependencies(commandMonitor, {
      mode: STUDENT_PILOT_OPENCV_MODE,
    });
    const result = await runRound6Diagnostic({ ...dependencies, commandMonitor });
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
  CANDIDATE_DEPTH,
  CONTEXT_LIMIT,
  ROUND6_FACETS,
  ROUND6_PROFILE,
  ROUND6_SCHEMA_VERSION,
  buildAnchorRetention,
  classifyContext,
  compareContextSets,
  mergeFacetQuotaSelections,
  runRound6Diagnostic,
  validateAtlasSearch,
  validateQueryVector,
};
