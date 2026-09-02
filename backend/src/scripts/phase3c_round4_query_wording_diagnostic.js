const { embedQuery } = require('../services/queryEmbedding.service');
const { evaluateRetrievalCandidates } = require('../services/retrievalEvaluation.service');
const {
  STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH,
} = require('../data/studentPilotRetrievalGroundTruth');
const {
  STUDENT_PILOT_Q11_G2_QUERY_WORDINGS,
  STUDENT_PILOT_Q11_G2_WORDING_PROFILE,
} = require('../data/studentPilotQueryDecomposition');
const {
  IsolatedE2EError,
  STUDENT_PILOT_OPENCV_COURSE_ID,
  STUDENT_PILOT_OPENCV_EXCLUDED_VIDEO_ID,
  STUDENT_PILOT_OPENCV_EXPECTED_SEGMENT_COUNT,
  STUDENT_PILOT_OPENCV_EXPECTED_VIDEO_COUNT,
  STUDENT_PILOT_OPENCV_MODE,
  buildLeafDiagnostics,
  createCommandMonitor,
  createLiveDependencies,
  inspectAndValidateStudentPilotOpenCvScope,
  safeFailure,
} = require('./phase2_2_hierarchical_e2e_runner');

const CANDIDATE_DEPTHS = Object.freeze([30, 50]);
const Q11_G2_FORMAL_GROUP = STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH.Q11.expectedLeafGroups[1];
const Q11_G2_AUDITED_CORE_GROUP = Object.freeze({
  groupId: 'G2_AUDITED_CORE_INTERPRETATION_ONLY',
  videoId: Q11_G2_FORMAL_GROUP.videoId,
  chunkIds: Object.freeze(Q11_G2_FORMAL_GROUP.chunkIds.slice(2, 6)),
});

function validateQueryVector(queryVector) {
  if (!Array.isArray(queryVector) || queryVector.length !== 3072
      || queryVector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new IsolatedE2EError(
      'Query embedding does not match the active Leaf index contract.',
      'E2E_QUERY_EMBEDDING_INVALID',
    );
  }
}

function validateAtlasSearch(searchResult) {
  if (searchResult?.backend !== 'atlas' || searchResult?.fallbackUsed === true
      || (Array.isArray(searchResult?.fallbacks) && searchResult.fallbacks.length)) {
    throw new IsolatedE2EError(
      'The query-wording diagnostic requires Atlas Leaf search without fallback.',
      'E2E_FALLBACK_NOT_ALLOWED',
    );
  }
  return Array.isArray(searchResult.matches) ? searchResult.matches : [];
}

async function runQueryWordingDiagnostic(dependencies = {}) {
  const {
    commandMonitor = createCommandMonitor(),
    inspectStudentPilotOpenCvScope,
    searchStudentPilotLeaves,
    embed = embedQuery,
  } = dependencies;
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
  const callCounts = {
    queryEmbeddingCalls: 0,
    atlasRetrievalCalls: 0,
    answerGenerationCalls: 0,
  };
  const queries = [];

  for (const wording of STUDENT_PILOT_Q11_G2_QUERY_WORDINGS) {
    callCounts.queryEmbeddingCalls += 1;
    const queryVector = await embed(wording.question);
    validateQueryVector(queryVector);
    const depthResults = [];
    for (const candidateDepth of CANDIDATE_DEPTHS) {
      callCounts.atlasRetrievalCalls += 1;
      const searchResult = await searchStudentPilotLeaves({
        queryVector,
        scope,
        courseId: options.courseId,
        candidateDepth,
      });
      commandMonitor.assertNoWrites();
      const matches = validateAtlasSearch(searchResult);
      depthResults.push({
        candidateDepth,
        matchCount: matches.length,
        expectedCandidates: buildLeafDiagnostics(matches).filter(
          (candidate) => Q11_G2_FORMAL_GROUP.chunkIds.includes(candidate.chunkId),
        ),
        formalEvaluation: evaluateRetrievalCandidates({
          expectedLeafGroups: [Q11_G2_FORMAL_GROUP],
          candidates: matches,
          k: candidateDepth,
        }),
        auditedCoreEvaluation: evaluateRetrievalCandidates({
          expectedLeafGroups: [Q11_G2_AUDITED_CORE_GROUP],
          candidates: matches,
          k: candidateDepth,
        }),
      });
    }
    queries.push({ id: wording.id, question: wording.question, depthResults });
  }

  commandMonitor.assertNoWrites();
  return {
    schemaVersion: 'phase3c-round4-query-wording-diagnostic-v1',
    profile: STUDENT_PILOT_Q11_G2_WORDING_PROFILE,
    productionRuntimeAffected: false,
    retrieval: {
      backend: 'atlas',
      leafOnly: true,
      candidateDepths: [...CANDIDATE_DEPTHS],
      thresholdChanged: false,
      rankingChanged: false,
      answerGenerationExecuted: false,
    },
    groundTruth: {
      formalGroup: Q11_G2_FORMAL_GROUP,
      auditedCoreInterpretation: {
        ...Q11_G2_AUDITED_CORE_GROUP,
        persistedToFormalGroundTruth: false,
      },
    },
    queries,
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
    const result = await runQueryWordingDiagnostic(dependencies);
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
  CANDIDATE_DEPTHS,
  Q11_G2_AUDITED_CORE_GROUP,
  Q11_G2_FORMAL_GROUP,
  runQueryWordingDiagnostic,
  validateAtlasSearch,
  validateQueryVector,
};
