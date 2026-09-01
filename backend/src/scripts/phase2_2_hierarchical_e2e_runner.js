const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const env = require('../config/env');
const VideoSegment = require('../models/videoSegment.model');
const VideoSegmentParent = require('../models/videoSegmentParent.model');
const { embedQuery } = require('../services/queryEmbedding.service');
const { buildGeminiTextSearchContract } = require('../services/embeddingContract.service');
const { createParentSearchRepository } = require('../services/parentSearchAdapter.service');
const { searchParents } = require('../services/parentSearch.service');
const { expandParentHits } = require('../services/childExpansion.service');
const { assembleLeafContext } = require('../services/leafContextAssembly.service');
const { generateAnswer, isNoAnswerReply } = require('../services/answerGeneration.service');
const {
  buildAnswerStatus,
  buildCitations,
  buildUserFacingCitations,
} = require('../services/qa.service');
const {
  buildSegmentLookupQuery,
  normalizeSegment,
} = require('../services/bridgeScope.service');
const { filterCandidatesByScope } = require('../services/qaScopeMonitoring.service');
const {
  evaluateActiveDataEvidence,
} = require('../services/hierarchicalDataReadiness.service');
const {
  aggregateRetrievalEvaluations,
  evaluateRetrievalCandidates,
} = require('../services/retrievalEvaluation.service');
const {
  STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH,
  STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH_SCHEMA,
  STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH_SOURCE,
} = require('../data/studentPilotRetrievalGroundTruth');

// This runner is an isolated, read-only acceptance harness. Command monitoring
// rejects MongoDB writes, and answer generation stays disabled unless requested.

const WRITE_COMMANDS = new Set([
  'insert', 'update', 'delete', 'findandmodify', 'bulkwrite', 'create',
  'createindexes', 'dropindexes', 'drop', 'dropdatabase', 'collmod', 'renamecollection',
]);
const READ_COMMANDS = new Set([
  'find', 'aggregate', 'getmore', 'explain', 'ping', 'count', 'distinct',
  'listcollections', 'listindexes', 'listsearchindexes', 'connectionstatus',
]);

const STANDARD_RUNNER_MODE = 'standard';
const STUDENT_PILOT_OPENCV_MODE = 'student-pilot-opencv';
const STUDENT_PILOT_OPENCV_COURSE_ID = '69fb4d4c069e21f4e65b74dc';
const STUDENT_PILOT_OPENCV_EXCLUDED_VIDEO_ID = '6a5deabebece4943079410bd';
const STUDENT_PILOT_OPENCV_EXPECTED_VIDEO_COUNT = 15;
const STUDENT_PILOT_OPENCV_EXPECTED_SEGMENT_COUNT = 129;
const STUDENT_PILOT_QUESTION_BANK_SCHEMA = 'student-pilot-baseline-v1';
const STUDENT_PILOT_QUESTION_IDS = Object.freeze([
  'Q01', 'Q02', 'Q03', 'Q04', 'Q05', 'Q06',
  'Q07', 'Q08', 'Q09', 'Q10', 'Q11', 'Q12',
  'N01', 'N02',
]);

class IsolatedE2EError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'IsolatedE2EError';
    this.code = code;
    this.details = details;
  }
}

function createCommandMonitor() {
  const state = { mongoReads: 0, mongoWrites: 0, writeCommands: [] };

  return {
    observe(event = {}) {
      const commandName = String(event.commandName || '').toLowerCase();
      if (WRITE_COMMANDS.has(commandName)) {
        state.mongoWrites += 1;
        state.writeCommands.push(commandName);
      } else if (READ_COMMANDS.has(commandName)) {
        state.mongoReads += 1;
      }
    },
    assertNoWrites() {
      if (state.mongoWrites) {
        throw new IsolatedE2EError(
          'The isolated E2E runner detected a forbidden MongoDB write command.',
          'WRITE_OPERATION_DETECTED',
        );
      }
    },
    snapshot() {
      return {
        mongoReads: state.mongoReads,
        mongoWrites: state.mongoWrites,
        writeDetected: state.mongoWrites > 0,
      };
    },
  };
}

function assertStrictReadOnlyRoles(authenticatedUserRoles, databaseName) {
  const roles = Array.isArray(authenticatedUserRoles) ? authenticatedUserRoles : [];
  const expectedDatabase = String(databaseName || '').trim();
  const isStrictReadOnly = expectedDatabase
    && roles.length === 1
    && roles[0]?.role === 'read'
    && roles[0]?.db === expectedDatabase;

  if (!isStrictReadOnly) {
    throw new IsolatedE2EError(
      'The isolated E2E runner requires a dedicated MongoDB user with only the read role on the target database.',
      'E2E_DATABASE_ROLE_NOT_READ_ONLY',
    );
  }

  return { verified: true, role: 'read', database: expectedDatabase };
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new IsolatedE2EError(`${flag} must be a positive integer.`, 'E2E_CLI_INVALID');
  }
  return parsed;
}

function parseCliArgs(argv = []) {
  const options = {
    mode: STANDARD_RUNNER_MODE,
    question: '',
    courseId: '',
    videoId: '',
    allowedVideoIds: [],
    withAnswer: false,
    preflightOnly: false,
    maxParents: env.hierarchicalParentLimit,
    maxChildren: env.hierarchicalChildExpansionLimit,
    questionsFile: '',
    candidateDepth: null,
    retrievalOnly: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--with-answer') options.withAnswer = true;
    else if (flag === '--preflight-only') options.preflightOnly = true;
    else if (flag === '--retrieval-only') options.retrievalOnly = true;
    else if (flag === '--json') options.json = true;
    else if (flag === '--mode') options.mode = argv[++index] || '';
    else if (flag === '--question') options.question = argv[++index] || '';
    else if (flag === '--course-id') options.courseId = argv[++index] || '';
    else if (flag === '--video-id') options.videoId = argv[++index] || '';
    else if (flag === '--allowed-video-id') options.allowedVideoIds.push(argv[++index] || '');
    else if (flag === '--questions-file') options.questionsFile = argv[++index] || '';
    else if (flag === '--candidate-depth') {
      options.candidateDepth = parsePositiveInteger(argv[++index], flag);
    }
    else if (flag === '--max-parents') options.maxParents = parsePositiveInteger(argv[++index], flag);
    else if (flag === '--max-children') options.maxChildren = parsePositiveInteger(argv[++index], flag);
    else throw new IsolatedE2EError('Unsupported CLI option.', 'E2E_CLI_INVALID');
  }

  options.question = String(options.question).trim();
  options.mode = String(options.mode).trim();
  options.courseId = String(options.courseId).trim();
  options.videoId = String(options.videoId).trim();
  options.questionsFile = String(options.questionsFile).trim();
  options.allowedVideoIds = [...new Set(options.allowedVideoIds.map((id) => String(id).trim()).filter(Boolean))];

  if (options.mode === STUDENT_PILOT_OPENCV_MODE) {
    if (options.question || options.courseId || options.videoId || options.allowedVideoIds.length
        || options.withAnswer || options.preflightOnly || !options.questionsFile) {
      throw new IsolatedE2EError(
        'student-pilot-opencv requires --questions-file and cannot be combined with question, scope, answer, or preflight options.',
        'E2E_CLI_INVALID',
      );
    }
    return {
      ...options,
      courseId: STUDENT_PILOT_OPENCV_COURSE_ID,
      excludedVideoId: STUDENT_PILOT_OPENCV_EXCLUDED_VIDEO_ID,
      expectedVideoCount: STUDENT_PILOT_OPENCV_EXPECTED_VIDEO_COUNT,
      expectedSegmentCount: STUDENT_PILOT_OPENCV_EXPECTED_SEGMENT_COUNT,
    };
  }

  if (options.mode !== STANDARD_RUNNER_MODE) {
    throw new IsolatedE2EError('Unsupported runner mode.', 'E2E_CLI_INVALID');
  }
  if (options.candidateDepth != null) {
    throw new IsolatedE2EError(
      '--candidate-depth is available only in student-pilot-opencv mode.',
      'E2E_CLI_INVALID',
    );
  }
  if (options.retrievalOnly) {
    throw new IsolatedE2EError(
      '--retrieval-only is available only in student-pilot-opencv mode.',
      'E2E_CLI_INVALID',
    );
  }
  if (options.questionsFile) {
    throw new IsolatedE2EError(
      '--questions-file is available only in student-pilot-opencv mode.',
      'E2E_CLI_INVALID',
    );
  }
  if (!options.allowedVideoIds.includes(options.videoId)) options.allowedVideoIds.push(options.videoId);

  if ((!options.preflightOnly && !options.question) || !/^[0-9a-f]{24}$/i.test(options.courseId)
      || !/^[0-9a-f]{24}$/i.test(options.videoId)) {
    throw new IsolatedE2EError(
      '--question (except preflight-only), a canonical --course-id, and --video-id are required.',
      'E2E_CLI_INVALID',
    );
  }
  if (options.preflightOnly && options.withAnswer) {
    throw new IsolatedE2EError(
      '--preflight-only cannot be combined with --with-answer.',
      'E2E_CLI_INVALID',
    );
  }
  return options;
}

function validateStudentPilotQuestionBank(payload) {
  if (!payload || payload.schemaVersion !== STUDENT_PILOT_QUESTION_BANK_SCHEMA
      || !Array.isArray(payload.questions)) {
    throw new IsolatedE2EError(
      'The student-pilot question bank does not match the required JSON schema.',
      'E2E_QUESTION_BANK_INVALID',
    );
  }

  const questionsById = new Map();
  for (const item of payload.questions) {
    const id = String(item?.id || '').trim();
    const question = String(item?.question || '').trim();
    if (!id || !question || questionsById.has(id) || !STUDENT_PILOT_QUESTION_IDS.includes(id)) {
      throw new IsolatedE2EError(
        'The student-pilot question bank contains an invalid, duplicate, or unexpected question.',
        'E2E_QUESTION_BANK_INVALID',
      );
    }
    questionsById.set(id, { id, question });
  }

  if (questionsById.size !== STUDENT_PILOT_QUESTION_IDS.length
      || STUDENT_PILOT_QUESTION_IDS.some((id) => !questionsById.has(id))) {
    throw new IsolatedE2EError(
      'The student-pilot question bank must contain exactly Q01-Q12, N01, and N02.',
      'E2E_QUESTION_BANK_INCOMPLETE',
    );
  }

  return {
    schemaVersion: STUDENT_PILOT_QUESTION_BANK_SCHEMA,
    questions: STUDENT_PILOT_QUESTION_IDS.map((id) => questionsById.get(id)),
  };
}

function loadStudentPilotQuestionBank(filePath) {
  let payload;
  try {
    const resolvedPath = path.resolve(String(filePath || ''));
    payload = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch {
    throw new IsolatedE2EError(
      'The student-pilot question bank could not be read as JSON.',
      'E2E_QUESTION_BANK_READ_FAILED',
    );
  }
  return validateStudentPilotQuestionBank(payload);
}

async function inspectAndValidateStudentPilotOpenCvScope(options, dependencies) {
  const {
    inspectStudentPilotOpenCvScope,
    commandMonitor = createCommandMonitor(),
  } = dependencies;

  commandMonitor.assertNoWrites();
  const inspection = await inspectStudentPilotOpenCvScope(options);
  commandMonitor.assertNoWrites();

  const allowedVideoIds = [...new Set(
    (inspection.allowedVideoIds || []).map((id) => String(id)).filter(Boolean),
  )];
  if (allowedVideoIds.includes(options.excludedVideoId)
      || inspection.excludedVideoPresent !== true
      || allowedVideoIds.length !== options.expectedVideoCount) {
    throw new IsolatedE2EError(
      'The fixed OpenCV student-pilot video scope is invalid.',
      'E2E_STUDENT_PILOT_SCOPE_INVALID',
    );
  }
  if (inspection.segmentCount !== options.expectedSegmentCount) {
    throw new IsolatedE2EError(
      'The fixed OpenCV student-pilot segment count does not match the expected value.',
      'E2E_STUDENT_PILOT_SEGMENT_COUNT_MISMATCH',
    );
  }

  return { allowedVideoIds, inspection, commandMonitor };
}

async function runStudentPilotOpenCvValidation(options, dependencies) {
  const { allowedVideoIds, inspection, commandMonitor } = await inspectAndValidateStudentPilotOpenCvScope(
    options,
    dependencies,
  );

  return {
    runMode: STUDENT_PILOT_OPENCV_MODE,
    writesAllowed: false,
    courseId: options.courseId,
    scope: {
      videoCount: allowedVideoIds.length,
      excludedVideoId: options.excludedVideoId,
      excludedVideoPresent: true,
      expectedSegmentCount: options.expectedSegmentCount,
      segmentCount: inspection.segmentCount,
    },
    safety: {
      ...commandMonitor.snapshot(),
      databaseAccess: inspection.databaseAccess || null,
      externalCalls: 0,
      sensitiveOutput: false,
    },
  };
}

function normalizeFallbackValue(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  if (/authorization|bearer|token|secret|api[_-]?key|mongodb(?:\+srv)?:\/\//i.test(normalized)) {
    return '[redacted]';
  }
  return normalized.slice(0, 120);
}

function normalizeFallbackEvidence(value, defaultStage) {
  const entries = value == null ? [] : (Array.isArray(value) ? value : [value]);
  return entries.map((entry) => {
    if (entry && typeof entry === 'object') {
      const stage = normalizeFallbackValue(entry.stage) || defaultStage;
      const from = normalizeFallbackValue(entry.from);
      const to = normalizeFallbackValue(entry.to);
      return {
        stage,
        type: normalizeFallbackValue(entry.type || entry.code) || 'unspecified',
        path: normalizeFallbackValue(entry.path) || (from || to ? `${from || 'unknown'}->${to || 'unknown'}` : null),
        code: normalizeFallbackValue(entry.code),
      };
    }

    const type = normalizeFallbackValue(entry) || 'unspecified';
    return {
      stage: defaultStage,
      type,
      path: defaultStage === 'retrieval' ? `atlas->${type}` : null,
      code: null,
    };
  });
}

function buildSearchFallbackEvidence(searchResult) {
  const fallbacks = normalizeFallbackEvidence(searchResult?.fallbacks, 'retrieval');
  const backend = normalizeFallbackValue(searchResult?.backend);

  if (backend && backend !== 'atlas'
      && !fallbacks.some((fallback) => fallback.path === `atlas->${backend}`)) {
    fallbacks.push({
      stage: 'retrieval',
      type: 'search_backend',
      path: `atlas->${backend}`,
      code: null,
    });
  }
  if (searchResult?.fallbackUsed === true && fallbacks.length === 0) {
    fallbacks.push({
      stage: 'retrieval',
      type: 'unspecified',
      path: 'atlas->unknown',
      code: null,
    });
  }

  return fallbacks;
}

function resolveQueryEmbeddingModel(config) {
  if (config.qaQueryEmbeddingProvider === 'gemini') return config.geminiEmbeddingModelName;
  if (config.qaQueryEmbeddingProvider === 'openai') return config.openaiEmbeddingModel;
  return config.qaQueryEmbeddingProvider || null;
}

function resolveAnswerModel(config) {
  if (config.qaAnswerProvider === 'gemini') return config.geminiChatModel;
  if (config.qaAnswerProvider === 'openai') return config.openaiChatModel;
  return config.qaAnswerProvider || null;
}

function buildPhase3BRuntimeSettings(config = env) {
  return {
    QA_MATCH_LIMIT: config.qaMatchLimit,
    QA_VECTOR_SEARCH_MODE: config.qaVectorSearchMode,
    QA_QUERY_EMBEDDING_PROVIDER: config.qaQueryEmbeddingProvider,
    QA_QUERY_EMBEDDING_MODEL: resolveQueryEmbeddingModel(config),
    QA_ANSWER_PROVIDER: config.qaAnswerProvider,
    QA_ANSWER_MODEL: resolveAnswerModel(config),
    FAQ_CACHE_ENABLED: Boolean(config.faqCacheEnabled),
    HIERARCHICAL_RETRIEVAL_ENABLED: Boolean(config.hierarchicalRetrievalEnabled),
    HIERARCHICAL_RETRIEVAL_ROLLOUT_MODE: config.hierarchicalRetrievalRolloutMode || 'off',
    QA_MINIMUM_SCORE_THRESHOLD: {
      status: 'not_configured',
      value: null,
      environmentVariable: null,
      candidateValidation: 'finite_score_greater_than_zero',
    },
  };
}

function buildLeafDiagnostics(matches, { includeTranscript = false } = {}) {
  return (Array.isArray(matches) ? matches : []).map((match, index) => ({
    rank: index + 1,
    score: safeScore(match.score),
    chunkId: match.chunkId == null ? null : String(match.chunkId),
    segmentId: match.segmentId == null ? null : String(match.segmentId),
    videoId: match.videoId == null ? null : String(match.videoId),
    startSec: match.startSec != null && Number.isFinite(Number(match.startSec))
      ? Number(match.startSec) : null,
    endSec: match.endSec != null && Number.isFinite(Number(match.endSec))
      ? Number(match.endSec) : null,
    ...(includeTranscript ? {
      videoTitle: match.videoTitle || null,
      transcript: String(match.transcript || ''),
    } : {}),
  }));
}

function sameLeafOrder(candidates, contextLeaves) {
  if (candidates.length !== contextLeaves.length) return false;
  return candidates.every((candidate, index) => (
    candidate.rank === contextLeaves[index].rank
    && candidate.chunkId === contextLeaves[index].chunkId
    && candidate.segmentId === contextLeaves[index].segmentId
    && candidate.videoId === contextLeaves[index].videoId
  ));
}

function validateStudentPilotRetrievalGroundTruth(groundTruth) {
  const positiveIds = STUDENT_PILOT_QUESTION_IDS.filter((id) => id.startsWith('Q'));
  const keys = Object.keys(groundTruth || {}).sort();
  if (keys.length !== positiveIds.length || positiveIds.some((id) => !groundTruth?.[id])) {
    throw new IsolatedE2EError(
      'The student-pilot retrieval ground truth must cover exactly Q01-Q12.',
      'E2E_RETRIEVAL_GROUND_TRUTH_INCOMPLETE',
    );
  }

  for (const id of positiveIds) {
    const groups = groundTruth[id]?.expectedLeafGroups;
    if (!Array.isArray(groups) || !groups.length || groups.some((group) => (
      !group?.groupId || !group?.videoId || !Array.isArray(group.chunkIds) || !group.chunkIds.length
      || group.chunkIds.some((chunkId) => !String(chunkId).startsWith(`${group.videoId}_chunk_`))
    ))) {
      throw new IsolatedE2EError(
        'The student-pilot retrieval ground truth contains an invalid Leaf group.',
        'E2E_RETRIEVAL_GROUND_TRUTH_INVALID',
      );
    }
  }
  return groundTruth;
}

function buildQuestionFailure(question, error, writeCommandCount, diagnostics = {}) {
  const fallbacks = Array.isArray(error?.details?.fallbacks) ? error.details.fallbacks : [];
  return {
    id: question.id,
    question: question.question,
    success: false,
    search: {
      backend: error?.details?.searchBackend
        || (error?.code === 'E2E_ATLAS_LEAF_SEARCH_FAILED' ? 'atlas' : null),
      fallbackUsed: fallbacks.length > 0,
      matchCount: diagnostics.candidates?.length || 0,
      candidates: diagnostics.candidates || [],
    },
    answerContext: diagnostics.answerContext || null,
    retrievalEvaluation: diagnostics.retrievalEvaluation || null,
    fallbacks,
    answer: null,
    citations: [],
    writeCommandCount,
    manualReview: { status: 'pending', correctness: null, citationQuality: null, notes: null },
    error: {
      code: error?.code || 'E2E_QUESTION_FAILED',
      message: error instanceof IsolatedE2EError
        ? error.message
        : 'The baseline question failed safely.',
    },
  };
}

async function runStudentPilotBaseline(options, dependencies) {
  const {
    questionBank,
    embed = embedQuery,
    searchStudentPilotLeaves,
    answer = generateAnswer,
    citationBuilder = buildUserFacingCitations,
    commandMonitor = createCommandMonitor(),
    retrievalGroundTruth = STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH,
    runtimeConfig = env,
  } = dependencies;
  const validatedQuestionBank = validateStudentPilotQuestionBank(questionBank);
  const validatedGroundTruth = validateStudentPilotRetrievalGroundTruth(retrievalGroundTruth);
  const runtimeSettings = buildPhase3BRuntimeSettings(runtimeConfig);
  const candidateDepth = options.candidateDepth || runtimeSettings.QA_MATCH_LIMIT;
  const answerContextLimit = Math.min(runtimeSettings.QA_MATCH_LIMIT, candidateDepth);
  const { allowedVideoIds, inspection } = await inspectAndValidateStudentPilotOpenCvScope(
    options,
    { ...dependencies, commandMonitor },
  );
  const scope = {
    allowedCourseIds: new Set([options.courseId]),
    allowedVideoIds: new Set(allowedVideoIds),
  };
  const questionResults = [];
  let externalCalls = 0;

  for (const question of validatedQuestionBank.questions) {
    const before = commandMonitor.snapshot();
    const diagnostics = {
      candidates: [],
      answerContext: null,
      retrievalEvaluation: null,
    };
    try {
      commandMonitor.assertNoWrites();
      externalCalls += 1;
      const queryVector = await embed(question.question);
      if (!Array.isArray(queryVector) || queryVector.length !== 3072
          || queryVector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
        throw new IsolatedE2EError(
          'Query embedding does not match the active Leaf index contract.',
          'E2E_QUERY_EMBEDDING_INVALID',
        );
      }

      const searchResult = await searchStudentPilotLeaves({
        queryVector,
        scope,
        courseId: options.courseId,
        candidateDepth,
      });
      commandMonitor.assertNoWrites();
      const searchFallbacks = buildSearchFallbackEvidence(searchResult);
      if (searchResult?.backend !== 'atlas' || searchResult?.fallbackUsed === true
          || searchFallbacks.length) {
        throw new IsolatedE2EError(
          'The student-pilot baseline requires Atlas Leaf search without fallback.',
          'E2E_FALLBACK_NOT_ALLOWED',
          {
            searchBackend: searchResult?.backend || null,
            fallbacks: searchFallbacks,
          },
        );
      }

      const matches = Array.isArray(searchResult.matches) ? searchResult.matches : [];
      diagnostics.candidates = buildLeafDiagnostics(matches);
      const answerContextMatches = matches.slice(0, answerContextLimit);
      const contextLeaves = buildLeafDiagnostics(answerContextMatches, { includeTranscript: true });
      diagnostics.answerContext = {
        source: 'retrieval_candidates',
        limit: answerContextLimit,
        generationExecuted: !options.retrievalOnly,
        leafCount: contextLeaves.length,
        sameOrderAsCandidates: sameLeafOrder(diagnostics.candidates, contextLeaves),
        leaves: contextLeaves,
      };
      const expectedLeafGroups = validatedGroundTruth[question.id]?.expectedLeafGroups || [];
      diagnostics.retrievalEvaluation = evaluateRetrievalCandidates({
        expectedLeafGroups,
        candidates: diagnostics.candidates,
        k: candidateDepth,
      });
      if (question.id.startsWith('N')) {
        diagnostics.retrievalEvaluation.groundTruthStatus = 'not_applicable_negative_question';
      }
      let generated = null;
      let citations = [];
      let answerStatus = null;
      if (!options.retrievalOnly) {
        externalCalls += 1;
        generated = await answer(question.question, answerContextMatches);
        if (generated?.fallback) {
          const answerFallbacks = normalizeFallbackEvidence(generated.fallback, 'answer');
          throw new IsolatedE2EError(
            'The student-pilot baseline does not allow answer fallback.',
            'E2E_FALLBACK_NOT_ALLOWED',
            { searchBackend: 'atlas', fallbacks: answerFallbacks },
          );
        }
        const noAnswerReply = isNoAnswerReply(generated?.text);
        citations = citationBuilder({
          answer: generated?.text,
          matches: answerContextMatches,
          scopedVideos: inspection.scopedVideos,
          requirePlayableSource: true,
          courseId: options.courseId,
        }).map((citation) => ({
          citationId: citation.citationId,
          chunkId: citation.chunkId,
          segmentId: citation.segmentId,
          videoId: citation.videoId,
          timestamp: citation.timestamp,
        }));
        answerStatus = buildAnswerStatus(
          { matchStatus: answerContextMatches.length ? 'matched' : 'no_relevant_match' },
          citations,
          { noAnswerReply },
        );
      }
      commandMonitor.assertNoWrites();
      const after = commandMonitor.snapshot();

      questionResults.push({
        id: question.id,
        question: question.question,
        success: true,
        search: {
          backend: 'atlas',
          fallbackUsed: false,
          matchCount: matches.length,
          candidates: diagnostics.candidates,
        },
        answerContext: diagnostics.answerContext,
        retrievalEvaluation: diagnostics.retrievalEvaluation,
        fallbacks: [],
        answer: generated ? {
          text: String(generated?.text || ''),
          provider: generated?.provider || null,
        } : null,
        answerStatus,
        citations,
        writeCommandCount: after.mongoWrites - before.mongoWrites,
        manualReview: { status: 'pending', correctness: null, citationQuality: null, notes: null },
        error: null,
      });
    } catch (error) {
      const after = commandMonitor.snapshot();
      if (error?.code === 'WRITE_OPERATION_DETECTED') throw error;
      questionResults.push(buildQuestionFailure(
        question,
        error,
        after.mongoWrites - before.mongoWrites,
        diagnostics,
      ));
    }
  }

  commandMonitor.assertNoWrites();
  const safety = commandMonitor.snapshot();
  return {
    schemaVersion: 'student-pilot-baseline-evidence-v1',
    runMode: STUDENT_PILOT_OPENCV_MODE,
    success: questionResults.every((result) => result.success),
    generatedAt: new Date().toISOString(),
    writesAllowed: false,
    courseId: options.courseId,
    questionBank: {
      schemaVersion: validatedQuestionBank.schemaVersion,
      expectedCount: STUDENT_PILOT_QUESTION_IDS.length,
      ids: [...STUDENT_PILOT_QUESTION_IDS],
    },
    scope: {
      videoCount: allowedVideoIds.length,
      excludedVideoId: options.excludedVideoId,
      excludedVideoPresent: true,
      expectedSegmentCount: options.expectedSegmentCount,
      segmentCount: inspection.segmentCount,
    },
    retrieval: {
      backend: 'atlas',
      leafOnly: true,
      faqEnabled: false,
      parentEnabled: false,
      fallbackAllowed: false,
      candidateDepth,
      answerContextLimit,
      diagnosticOverrideActive: candidateDepth !== runtimeSettings.QA_MATCH_LIMIT,
      answerGenerationExecuted: !options.retrievalOnly,
    },
    runtimeSettings,
    retrievalEvaluation: {
      schemaVersion: STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH_SCHEMA,
      groundTruthSource: STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH_SOURCE,
      k: candidateDepth,
      metrics: aggregateRetrievalEvaluations(
        questionResults.map((result) => result.retrievalEvaluation),
      ),
    },
    questions: questionResults,
    safety: {
      ...safety,
      databaseAccess: inspection.databaseAccess || null,
      externalCalls,
      credentialsIncluded: false,
    },
  };
}

function safeScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Number(score.toFixed(6)) : null;
}

function hasIxscan(plan) {
  if (!plan || typeof plan !== 'object') return false;
  if (plan.stage === 'IXSCAN') return true;
  return Object.values(plan).some((value) => value && typeof value === 'object' && hasIxscan(value));
}

function collectIndexNames(plan, names = new Set()) {
  if (!plan || typeof plan !== 'object') return names;
  if (plan.stage === 'IXSCAN' && plan.indexName) names.add(String(plan.indexName));
  for (const value of Object.values(plan)) {
    if (value && typeof value === 'object') collectIndexNames(value, names);
  }
  return names;
}

function buildLeafLookupQuery(childChunkIds, scope) {
  const identity = {
    $or: [
      { chunkId: { $in: childChunkIds } },
      { segmentId: { $in: childChunkIds } },
    ],
  };
  const scopeQuery = buildSegmentLookupQuery(scope);
  return Object.keys(scopeQuery).length ? { $and: [identity, scopeQuery] } : identity;
}

function hasRequiredCollections(collections, requiredCollections) {
  const available = new Set((collections || []).map((item) => String(item?.name || '')).filter(Boolean));
  return requiredCollections.every((name) => available.has(name));
}

async function runIsolatedE2E(options, dependencies) {
  const {
    preflight,
    embed = embedQuery,
    parentRepositoryFactory,
    leafRepositoryFactory,
    verifyChildLookupPlan,
    answer = generateAnswer,
    citationBuilder = buildCitations,
    commandMonitor = createCommandMonitor(),
  } = dependencies;

  commandMonitor.assertNoWrites();
  const preflightResult = await preflight(options);
  commandMonitor.assertNoWrites();

  if (options.preflightOnly) {
    return {
      runMode: 'phase2_2_readonly_preflight',
      writesAllowed: false,
      gate: { sharedValue: false, isolatedValue: false },
      activeDataReadiness: preflightResult.activeDataReadiness || null,
      execution: {
        queryEmbedding: false,
        parentSearch: false,
        childExpansion: false,
        answerGeneration: false,
        externalCalls: 0,
      },
      safety: {
        ...commandMonitor.snapshot(),
        databaseAccess: preflightResult.databaseAccess || null,
        externalCalls: 0,
        sensitiveOutput: false,
      },
    };
  }

  const queryVector = await embed(options.question);
  if (!Array.isArray(queryVector) || queryVector.length !== 3072
      || queryVector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new IsolatedE2EError('Query embedding does not match the Parent index.', 'E2E_QUERY_EMBEDDING_INVALID');
  }

  const parentHits = await searchParents({
    repository: parentRepositoryFactory(),
    queryEmbedding: queryVector,
    courseId: options.courseId,
    videoId: options.videoId,
    allowedVideoIds: options.allowedVideoIds,
    limit: options.maxParents,
    timeoutMs: env.hierarchicalParentTimeoutMs,
    expectedContract: buildGeminiTextSearchContract(env.geminiEmbeddingModelName),
  });
  if (!parentHits.length) {
    throw new IsolatedE2EError('Parent search returned no hits.', 'E2E_PARENT_NO_HITS');
  }

  const requestedIds = [...new Set(parentHits.flatMap((hit) => hit.childChunkIds))];
  const lookupPlan = await verifyChildLookupPlan(requestedIds, preflightResult.scope);
  if (!lookupPlan.usesIxscan || !(lookupPlan.indexNames || []).includes('chunkId_1')) {
    throw new IsolatedE2EError('The canonical chunkId index is not queryable.', 'E2E_CHUNK_ID_INDEX_NOT_READY');
  }

  const expansion = await expandParentHits({
    parentHits,
    leafRepository: leafRepositoryFactory(),
    scope: preflightResult.scope,
    courseId: options.courseId,
    videoId: options.videoId,
    limit: options.maxChildren,
  });
  const context = assembleLeafContext({
    leaves: expansion.leaves,
    maxLeaves: env.hierarchicalContextMaxLeaves,
    maxCharacters: env.hierarchicalContextMaxCharacters,
  });
  const citations = citationBuilder(context.matches);

  let answerResult = { executed: false, provider: null, status: 'skipped' };
  if (options.withAnswer) {
    const generated = await answer(options.question, context.matches);
    answerResult = {
      executed: true,
      provider: generated.provider,
      status: generated.fallback ? 'fallback' : 'success',
      length: String(generated.text || '').length,
    };
  }

  commandMonitor.assertNoWrites();
  const safety = commandMonitor.snapshot();
  const queryContract = env.qaQueryEmbeddingProvider === 'gemini'
    ? buildGeminiTextSearchContract(env.geminiEmbeddingModelName)
    : {
      provider: env.qaQueryEmbeddingProvider,
      model: env.qaQueryEmbeddingProvider,
      instructionVersion: null,
      generationVersion: null,
      normalizationVersion: null,
      contractVersion: null,
      schemaVersion: null,
      taskType: null,
    };
  return {
    runMode: 'phase2_2_isolated_e2e',
    writesAllowed: false,
    gate: { sharedValue: false, isolatedValue: true },
    activeDataReadiness: preflightResult.activeDataReadiness || null,
    query: {
      length: options.question.length,
      embeddingProvider: queryContract.provider,
      embeddingModel: queryContract.model,
      instructionVersion: queryContract.instructionVersion,
      generationVersion: queryContract.generationVersion,
      normalizationVersion: queryContract.normalizationVersion,
      contractVersion: queryContract.contractVersion,
      schemaVersion: queryContract.schemaVersion,
      taskType: queryContract.taskType,
      dimension: queryVector.length,
      apiCalls: 1,
    },
    parentSearch: {
      hitCount: parentHits.length,
      parentIds: parentHits.map((hit) => hit.parentId),
      scores: parentHits.map((hit) => safeScore(hit.score)),
      lineage: parentHits.map((hit) => ({
        parentId: hit.parentId,
        childChunkIds: [...hit.childChunkIds],
      })),
    },
    childExpansion: {
      requested: expansion.diagnostics.requestedChildCount,
      found: expansion.leaves.length,
      missing: expansion.diagnostics.missingChildCount,
      duplicate: expansion.diagnostics.duplicateChildCount,
      scopeMismatch: expansion.diagnostics.scopeMismatchCount,
      truncated: expansion.diagnostics.truncatedChildCount,
    },
    context: {
      leafCount: context.matches.length,
      chunkIds: context.matches.map((match) => match.chunkId),
      videoIds: [...new Set(context.matches.map((match) => match.videoId))],
      contextTruncated: context.diagnostics.contextTruncated,
    },
    answer: answerResult,
    citations: {
      count: citations.length,
      chunkIds: citations.map((citation) => citation.chunkId),
      segmentIds: citations.map((citation) => citation.segmentId),
      videoIds: [...new Set(citations.map((citation) => citation.videoId))],
      timestamps: citations.map((citation) => citation.timestamp),
    },
    safety: {
      ...safety,
      databaseAccess: preflightResult.databaseAccess || null,
      externalCalls: options.withAnswer ? 2 : 1,
      sensitiveOutput: false,
    },
  };
}

function assertRunnerRuntimeConfiguration(mode, config = env) {
  if (config.hierarchicalRetrievalEnabled) {
    throw new IsolatedE2EError(
      'The shared Hierarchical Retrieval Gate must remain disabled.',
      'E2E_SHARED_GATE_NOT_DISABLED',
    );
  }
  if (mode === STANDARD_RUNNER_MODE && !config.hierarchicalRetrievalFallbackToLeaf) {
    throw new IsolatedE2EError('Leaf fallback must remain enabled.', 'E2E_FALLBACK_NOT_ENABLED');
  }
  if (config.faqCacheEnabled) {
    throw new IsolatedE2EError('FAQ cache must be disabled for the isolated runner.', 'E2E_FAQ_CACHE_NOT_DISABLED');
  }
  if (mode === STUDENT_PILOT_OPENCV_MODE && config.qaVectorSearchMode !== 'atlas') {
    throw new IsolatedE2EError(
      'student-pilot-opencv requires QA_VECTOR_SEARCH_MODE=atlas.',
      'E2E_ATLAS_MODE_REQUIRED',
    );
  }
  if (mode === STUDENT_PILOT_OPENCV_MODE && !String(config.qaAtlasVectorIndexName || '').trim()) {
    throw new IsolatedE2EError(
      'student-pilot-opencv requires QA_ATLAS_VECTOR_INDEX_NAME.',
      'E2E_ATLAS_INDEX_REQUIRED',
    );
  }
}

async function createLiveDependencies(commandMonitor, options = {}) {
  assertRunnerRuntimeConfiguration(options.mode || STANDARD_RUNNER_MODE, env);

  const readOnlyMongoUri = String(process.env.PHASE2_2_READONLY_MONGODB_URI || '').trim();
  if (!readOnlyMongoUri) {
    throw new IsolatedE2EError(
      'PHASE2_2_READONLY_MONGODB_URI is required for the isolated E2E runner.',
      'E2E_READONLY_DATABASE_URI_REQUIRED',
    );
  }

  const connection = await mongoose.createConnection(readOnlyMongoUri, {
    autoCreate: false,
    autoIndex: false,
    monitorCommands: true,
    readPreference: 'secondaryPreferred',
    retryWrites: false,
    serverSelectionTimeoutMS: 10000,
  }).asPromise();
  connection.getClient().on('commandStarted', (event) => commandMonitor.observe(event));

  let databaseAccess;
  try {
    const connectionStatus = await connection.db.admin().command({
      connectionStatus: 1,
      showPrivileges: false,
    });
    databaseAccess = assertStrictReadOnlyRoles(
      connectionStatus?.authInfo?.authenticatedUserRoles,
      connection.name,
    );
    commandMonitor.assertNoWrites();
  } catch (error) {
    await connection.close();
    throw error;
  }

  const leafModel = connection.model('Phase22RunnerLeaf', VideoSegment.schema, env.videoSegmentCollection);
  const parentModel = connection.model(
    'Phase22RunnerParent',
    VideoSegmentParent.schema,
    env.videoSegmentParentCollection,
  );
  const leafCollection = connection.db.collection(env.videoSegmentCollection);
  const parentCollection = connection.db.collection(env.videoSegmentParentCollection);
  const videoCollection = connection.db.collection('videos');
  const courseCollection = connection.db.collection('courses');

  return {
    commandMonitor,
    async inspectStudentPilotOpenCvScope(options) {
      const courseObjectId = new mongoose.Types.ObjectId(options.courseId);
      const excludedVideoObjectId = new mongoose.Types.ObjectId(options.excludedVideoId);
      const course = await courseCollection.findOne(
        { _id: courseObjectId },
        { projection: { _id: 1, videoIds: 1, status: 1, deletedAt: 1 } },
      );
      if (!course || course.deletedAt != null || course.status !== 'published') {
        throw new IsolatedE2EError(
          'The fixed OpenCV student-pilot course is not publishable.',
          'E2E_STUDENT_PILOT_SCOPE_INVALID',
        );
      }

      const listedVideoIds = (Array.isArray(course.videoIds) ? course.videoIds : [])
        .map((id) => String(id))
        .filter((id) => /^[0-9a-f]{24}$/i.test(id));
      const listedVideoObjectIds = listedVideoIds.map((id) => new mongoose.Types.ObjectId(id));
      const videos = await videoCollection.find(
        {
          $or: [
            { _id: { $in: listedVideoObjectIds } },
            { courseId: courseObjectId },
          ],
          deletedAt: null,
        },
        { projection: { _id: 1, youtubeVideoId: 1, filePath: 1, file_path: 1 } },
      ).toArray();
      const allVideoIds = [...new Set(videos.map((video) => String(video._id)))];
      const excludedVideoPresent = allVideoIds.includes(String(excludedVideoObjectId));
      const allowedVideoIds = allVideoIds.filter((id) => id !== options.excludedVideoId);
      const allowedVideoIdSet = new Set(allowedVideoIds);
      const segmentCount = await leafCollection.countDocuments({ videoId: { $in: allowedVideoIds } });
      commandMonitor.assertNoWrites();

      return {
        allowedVideoIds,
        excludedVideoPresent,
        segmentCount,
        scopedVideos: {
          videos: videos.filter((video) => allowedVideoIdSet.has(String(video._id))),
        },
        databaseAccess,
      };
    },
    async searchStudentPilotLeaves({ queryVector, scope, courseId, candidateDepth }) {
      const safeCandidateDepth = Number.isInteger(candidateDepth) && candidateDepth > 0
        ? candidateDepth
        : env.qaMatchLimit;
      let results;
      try {
        results = await leafCollection.aggregate([
          {
            $vectorSearch: {
              index: env.qaAtlasVectorIndexName,
              path: 'embedding',
              queryVector,
              numCandidates: Math.max(safeCandidateDepth * 5, 10),
              limit: safeCandidateDepth,
              filter: buildSegmentLookupQuery(scope),
            },
          },
          {
            $project: {
              _id: 1,
              courseId: 1,
              chunkId: 1,
              segmentId: 1,
              videoId: 1,
              startSec: 1,
              endSec: 1,
              text: 1,
              score: { $meta: 'vectorSearchScore' },
            },
          },
        ]).toArray();
        commandMonitor.assertNoWrites();
      } catch (error) {
        if (error?.code === 'WRITE_OPERATION_DETECTED') throw error;
        throw new IsolatedE2EError(
          'Atlas Leaf search failed; the runner did not use a fallback.',
          'E2E_ATLAS_LEAF_SEARCH_FAILED',
        );
      }

      const scoredResults = results
        .map((item) => ({ score: Number(item.score), segment: normalizeSegment(item) }))
        .filter((item) => Number.isFinite(item.score) && item.score > 0);
      const scopedResults = filterCandidatesByScope(scoredResults, {
        scope,
        courseId,
        getSegment: (item) => item.segment,
      });
      return {
        backend: 'atlas',
        fallbackUsed: false,
        fallbacks: [],
        matches: scopedResults.map(({ segment, score }) => ({
          chunkId: segment.chunkId,
          segmentId: segment.segmentId,
          videoId: segment.videoId,
          videoTitle: null,
          startSec: segment.startSec,
          endSec: segment.endSec,
          transcript: segment.transcript,
          score: Number(score.toFixed(4)),
        })),
      };
    },
    async preflight(options) {
      const requiredCollections = [
        env.videoSegmentCollection, env.videoSegmentParentCollection, 'videos', 'courses',
      ];
      const courseObjectId = new mongoose.Types.ObjectId(options.courseId);
      const videoObjectId = new mongoose.Types.ObjectId(options.videoId);
      const [collections, indexes, searchIndexes, video, course] = await Promise.all([
        // Atlas does not consistently accept `$in` in a listCollections name filter.
        // Read name-only metadata and enforce the required set in application code.
        connection.db.listCollections({}, { nameOnly: true }).toArray(),
        leafCollection.listIndexes().toArray(),
        parentCollection.listSearchIndexes(env.videoSegmentParentVectorIndexName).toArray(),
        videoCollection.findOne(
          { _id: videoObjectId },
          { projection: { _id: 1, courseId: 1, deletedAt: 1 } },
        ),
        courseCollection.findOne(
          { _id: courseObjectId },
          { projection: { _id: 1, videoIds: 1, status: 1, deletedAt: 1 } },
        ),
      ]);
      commandMonitor.assertNoWrites();
      if (!hasRequiredCollections(collections, requiredCollections)) {
        throw new IsolatedE2EError('Required Parent or Leaf collection is unavailable.', 'E2E_COLLECTION_NOT_READY');
      }
      const courseContainsVideo = Array.isArray(course?.videoIds)
        && course.videoIds.some((id) => String(id) === options.videoId);
      const directCourseRelation = String(video?.courseId || '') === options.courseId;
      const allowedMountedRelation = courseContainsVideo && options.allowedVideoIds.includes(options.videoId);
      if (!video || video.deletedAt != null || !course || course.deletedAt != null
          || course.status !== 'published' || (!directCourseRelation && !allowedMountedRelation)) {
        throw new IsolatedE2EError('The requested course and video scope is not publishable.', 'E2E_SCOPE_INVALID');
      }
      const chunkIndex = indexes.find((index) => index.name === 'chunkId_1'
        && index.key?.chunkId === 1 && Object.keys(index.key).length === 1);
      if (!chunkIndex || chunkIndex.hidden) {
        throw new IsolatedE2EError('The canonical chunkId index is unavailable.', 'E2E_CHUNK_ID_INDEX_NOT_READY');
      }
      const vectorIndex = searchIndexes.find((index) => index.name === env.videoSegmentParentVectorIndexName);
      if (!vectorIndex || vectorIndex.status !== 'READY' || vectorIndex.queryable === false) {
        throw new IsolatedE2EError('The Parent vector index is unavailable.', 'E2E_PARENT_INDEX_NOT_READY');
      }
      const parents = await parentCollection.find(
        { videoId: { $in: options.allowedVideoIds }, isActive: true },
        { projection: {
          _id: 0, videoId: 1, childChunkIds: 1, isActive: 1,
          embeddingProvider: 1, embeddingModel: 1, embeddingDimension: 1,
          embeddingTaskType: 1, embeddingInstructionVersion: 1, generationVersion: 1,
          normalizationVersion: 1, embeddingContractVersion: 1, embeddingSchemaVersion: 1,
        } },
      ).toArray();
      const leaves = await leafCollection.find(
        { videoId: { $in: options.allowedVideoIds } },
        { projection: {
          _id: 0, chunkId: 1, videoId: 1,
          embeddingProvider: 1, embeddingModel: 1, embeddingDimension: 1,
          embeddingTaskType: 1, embeddingInstructionVersion: 1, generationVersion: 1,
          normalizationVersion: 1, embeddingContractVersion: 1, embeddingSchemaVersion: 1,
        } },
      ).toArray();
      const activeDataReadiness = {
        ...evaluateActiveDataEvidence({
        allowedVideoIds: options.allowedVideoIds,
        parents,
        leaves,
        leafIndexes: indexes,
        parentSearchIndexes: searchIndexes,
        parentIndexName: env.videoSegmentParentVectorIndexName,
        }),
        checkedAt: new Date().toISOString(),
        source: 'live_read_only',
      };
      if (!activeDataReadiness.ready) {
        throw new IsolatedE2EError(
          'Active Parent or Leaf data does not satisfy the stable generation contract.',
          'E2E_ACTIVE_DATA_NOT_READY',
        );
      }
      return {
        activeDataReadiness,
        databaseAccess,
        scope: {
          allowedCourseIds: new Set([options.courseId]),
          allowedVideoIds: new Set(options.allowedVideoIds),
        },
      };
    },
    parentRepositoryFactory: () => createParentSearchRepository({ model: parentModel }),
    leafRepositoryFactory: () => ({
      async findLeavesByChunkIds(chunkIds, { scope }) {
        return leafModel.find(buildLeafLookupQuery(chunkIds, scope)).lean();
      },
    }),
    async verifyChildLookupPlan(childChunkIds, scope) {
      const explain = await leafCollection.find(buildLeafLookupQuery(childChunkIds, scope)).explain('executionStats');
      commandMonitor.assertNoWrites();
      const indexNames = [...collectIndexNames(explain.queryPlanner?.winningPlan)];
      return {
        usesIxscan: hasIxscan(explain.queryPlanner?.winningPlan),
        indexNames,
        docsExamined: explain.executionStats?.totalDocsExamined ?? null,
        keysExamined: explain.executionStats?.totalKeysExamined ?? null,
      };
    },
    async close() {
      await connection.close();
    },
  };
}

function safeFailure(error) {
  return {
    success: false,
    code: error?.code || 'E2E_RUNNER_FAILED',
    message: error instanceof IsolatedE2EError
      ? error.message
      : 'The isolated E2E runner failed safely.',
  };
}

async function main(argv = process.argv.slice(2)) {
  const commandMonitor = createCommandMonitor();
  let dependencies;
  try {
    const options = parseCliArgs(argv);
    const questionBank = options.mode === STUDENT_PILOT_OPENCV_MODE
      ? loadStudentPilotQuestionBank(options.questionsFile)
      : null;
    dependencies = await createLiveDependencies(commandMonitor, options);
    const result = options.mode === STUDENT_PILOT_OPENCV_MODE
      ? await runStudentPilotBaseline(options, { ...dependencies, questionBank })
      : await runIsolatedE2E(options, dependencies);
    console.log(JSON.stringify(result, null, options.json ? 2 : 0));
    if (result.success === false) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify(safeFailure(error)));
    process.exitCode = 1;
  } finally {
    if (dependencies?.close) await dependencies.close();
  }
}

if (require.main === module) main();

module.exports = {
  IsolatedE2EError,
  STANDARD_RUNNER_MODE,
  STUDENT_PILOT_OPENCV_MODE,
  STUDENT_PILOT_OPENCV_COURSE_ID,
  STUDENT_PILOT_OPENCV_EXCLUDED_VIDEO_ID,
  STUDENT_PILOT_OPENCV_EXPECTED_SEGMENT_COUNT,
  STUDENT_PILOT_OPENCV_EXPECTED_VIDEO_COUNT,
  STUDENT_PILOT_QUESTION_BANK_SCHEMA,
  STUDENT_PILOT_QUESTION_IDS,
  WRITE_COMMANDS,
  assertRunnerRuntimeConfiguration,
  assertStrictReadOnlyRoles,
  buildLeafDiagnostics,
  buildLeafLookupQuery,
  buildPhase3BRuntimeSettings,
  createCommandMonitor,
  createLiveDependencies,
  collectIndexNames,
  hasIxscan,
  hasRequiredCollections,
  inspectAndValidateStudentPilotOpenCvScope,
  main,
  loadStudentPilotQuestionBank,
  parseCliArgs,
  runIsolatedE2E,
  runStudentPilotBaseline,
  runStudentPilotOpenCvValidation,
  safeFailure,
  validateStudentPilotRetrievalGroundTruth,
  validateStudentPilotQuestionBank,
};
