const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { afterEach, describe, it } = require('node:test');
const env = require('../src/config/env');
const {
  IsolatedE2EError,
  STUDENT_PILOT_OPENCV_COURSE_ID,
  STUDENT_PILOT_OPENCV_EXCLUDED_VIDEO_ID,
  STUDENT_PILOT_OPENCV_EXPECTED_SEGMENT_COUNT,
  STUDENT_PILOT_QUESTION_BANK_SCHEMA,
  STUDENT_PILOT_QUESTION_IDS,
  assertRunnerRuntimeConfiguration,
  assertStrictReadOnlyRoles,
  buildPhase3BRuntimeSettings,
  createCommandMonitor,
  hasRequiredCollections,
  parseCliArgs,
  runIsolatedE2E,
  runStudentPilotBaseline,
  runStudentPilotOpenCvValidation,
  safeFailure,
  validateStudentPilotRetrievalGroundTruth,
  validateStudentPilotQuestionBank,
} = require('../src/scripts/phase2_2_hierarchical_e2e_runner');

const originalGate = env.hierarchicalRetrievalEnabled;
const originalProvider = env.qaQueryEmbeddingProvider;
const originalGeminiEmbeddingModelName = env.geminiEmbeddingModelName;
const courseId = '6a6da68456dd124511ec5196';
const videoId = '6a6da69556dd124511ec51eb';

function vector() {
  return Array.from({ length: 3072 }, (_, index) => (index === 0 ? 1 : 0));
}

function questionBank(overrides = {}) {
  return {
    schemaVersion: STUDENT_PILOT_QUESTION_BANK_SCHEMA,
    questions: STUDENT_PILOT_QUESTION_IDS.map((id) => ({ id, question: `Question ${id}` })),
    ...overrides,
  };
}

function studentPilotOptions(overrides = {}) {
  return {
    ...parseCliArgs([
      '--mode', 'student-pilot-opencv', '--questions-file', 'questions.json', '--json',
    ]),
    ...overrides,
  };
}

function studentPilotDependencies(overrides = {}) {
  const monitor = createCommandMonitor();
  const allowedVideoIds = Array.from(
    { length: 15 },
    (_, index) => `6a00000000000000000000${index.toString(16).padStart(2, '0')}`,
  );
  return {
    commandMonitor: monitor,
    questionBank: questionBank(),
    async inspectStudentPilotOpenCvScope() {
      return {
        allowedVideoIds,
        excludedVideoPresent: true,
        segmentCount: 129,
        scopedVideos: {
          videos: allowedVideoIds.map((_id, index) => ({
            _id,
            youtubeVideoId: `opencv-${index + 1}`,
            filePath: null,
          })),
        },
        databaseAccess: { verified: true, role: 'read', database: 'focusflow' },
      };
    },
    async embed() { return vector(); },
    async searchStudentPilotLeaves() {
      return {
        backend: 'atlas',
        fallbackUsed: false,
        fallbacks: [],
        matches: [{
          chunkId: 'chunk-1', segmentId: 'segment-1', videoId: allowedVideoIds[0],
          startSec: 10, endSec: 20, transcript: 'safe leaf transcript', score: 0.9,
        }],
      };
    },
    async answer() { return { text: 'safe answer', provider: 'mock', fallback: null }; },
    runtimeConfig: {
      qaMatchLimit: 15,
      qaVectorSearchMode: 'atlas',
      qaQueryEmbeddingProvider: 'gemini',
      geminiEmbeddingModelName: 'gemini-embedding-2',
      qaAnswerProvider: 'gemini',
      geminiChatModel: 'gemini-3.5-flash',
      faqCacheEnabled: false,
      hierarchicalRetrievalEnabled: false,
      hierarchicalRetrievalRolloutMode: 'off',
    },
    ...overrides,
  };
}

const stableParentMetadata = {
  isActive: true,
  embeddingProvider: 'gemini', embeddingModel: 'gemini-embedding-2', embeddingDimension: 3072,
  embeddingTaskType: null, embeddingInstructionVersion: 'gemini_embedding_2_asymmetric_retrieval_v2',
  generationVersion: 'text_search_generation_v2', normalizationVersion: 'unit_l2_v1',
  embeddingContractVersion: 'gemini_embedding_2_text_v2', embeddingSchemaVersion: 'parent_embedding_v2',
};

function options(overrides = {}) {
  return {
    question: 'safe test question',
    courseId,
    videoId,
    allowedVideoIds: [videoId],
    withAnswer: false,
    preflightOnly: false,
    maxParents: 3,
    maxChildren: 10,
    json: true,
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  const monitor = createCommandMonitor();
  return {
    commandMonitor: monitor,
    async preflight() {
      return {
        activeDataReadiness: {
          status: 'verified', ready: true, reason: null,
          evidence: { contractHash: 'test-contract-hash' },
        },
        scope: {
          allowedCourseIds: new Set([courseId]),
          allowedVideoIds: new Set([videoId]),
        },
      };
    },
    async embed() { return vector(); },
    parentRepositoryFactory: () => ({
      async searchParents() {
        return [{
          parentId: `${videoId}_parent_0001`, courseId, videoId,
          childChunkIds: ['child-1', 'missing-child'], score: 0.91,
          startSec: 0, endSec: 30, order: 1, hierarchyLevel: 1, documentType: 'parent_chunk',
          ...stableParentMetadata,
        }];
      },
    }),
    leafRepositoryFactory: () => ({
      async findLeavesByChunkIds() {
        return [{
          chunkId: 'child-1', segmentId: 'segment-1', videoId, courseId,
          startSec: 10, endSec: 20, text: 'private leaf transcript',
        }];
      },
    }),
    async verifyChildLookupPlan() { return { usesIxscan: true, indexNames: ['chunkId_1'] }; },
    async answer() { return { text: 'safe answer', provider: 'mock', fallback: null }; },
    ...overrides,
  };
}

afterEach(() => {
  env.hierarchicalRetrievalEnabled = originalGate;
  env.qaQueryEmbeddingProvider = originalProvider;
  env.geminiEmbeddingModelName = originalGeminiEmbeddingModelName;
});

describe('Phase 2-2 isolated hierarchical E2E runner', () => {
  it('checks required collection names without relying on an Atlas listCollections name filter', () => {
    const required = ['video_segments_text', 'video_segments_parent', 'videos', 'courses'];
    assert.equal(hasRequiredCollections(required.map((name) => ({ name })), required), true);
    assert.equal(hasRequiredCollections(required.slice(1).map((name) => ({ name })), required), false);
    assert.equal(hasRequiredCollections([...required.map((name) => ({ name })), { name: 'extra' }], required), true);
  });

  it('accepts only one built-in read role on the target database', () => {
    assert.deepEqual(
      assertStrictReadOnlyRoles([{ role: 'read', db: 'focusflow' }], 'focusflow'),
      { verified: true, role: 'read', database: 'focusflow' },
    );
    for (const roles of [
      [],
      [{ role: 'atlasAdmin', db: 'admin' }],
      [{ role: 'readWrite', db: 'focusflow' }],
      [{ role: 'read', db: 'another_database' }],
      [{ role: 'read', db: 'focusflow' }, { role: 'read', db: 'another_database' }],
    ]) {
      assert.throws(
        () => assertStrictReadOnlyRoles(roles, 'focusflow'),
        (error) => error.code === 'E2E_DATABASE_ROLE_NOT_READ_ONLY',
      );
    }
  });

  it('parses a safe CLI contract with answer generation disabled by default', () => {
    const parsed = parseCliArgs([
      '--question', 'question', '--course-id', courseId, '--video-id', videoId, '--json',
    ]);
    assert.equal(parsed.withAnswer, false);
    assert.equal(parsed.preflightOnly, false);
    assert.deepEqual(parsed.allowedVideoIds, [videoId]);
  });

  it('allows a question-free preflight-only CLI and rejects answer generation in that mode', () => {
    const parsed = parseCliArgs([
      '--preflight-only', '--course-id', courseId, '--video-id', videoId, '--json',
    ]);
    assert.equal(parsed.question, '');
    assert.equal(parsed.preflightOnly, true);
    assert.equal(parsed.withAnswer, false);
    assert.throws(
      () => parseCliArgs([
        '--preflight-only', '--with-answer', '--course-id', courseId, '--video-id', videoId,
      ]),
      (error) => error.code === 'E2E_CLI_INVALID',
    );
  });

  it('parses the fixed student-pilot-opencv scope without changing standard mode inputs', () => {
    const parsed = parseCliArgs([
      '--mode', 'student-pilot-opencv', '--questions-file', 'questions.json', '--json',
    ]);

    assert.equal(parsed.mode, 'student-pilot-opencv');
    assert.equal(parsed.courseId, STUDENT_PILOT_OPENCV_COURSE_ID);
    assert.equal(parsed.excludedVideoId, STUDENT_PILOT_OPENCV_EXCLUDED_VIDEO_ID);
    assert.equal(parsed.expectedSegmentCount, STUDENT_PILOT_OPENCV_EXPECTED_SEGMENT_COUNT);
    assert.equal(parsed.questionsFile, 'questions.json');
    assert.equal(parsed.candidateDepth, null);
    assert.equal(parsed.retrievalOnly, false);
    assert.deepEqual(parsed.allowedVideoIds, []);
    assert.throws(
      () => parseCliArgs([
        '--mode', 'student-pilot-opencv', '--course-id', courseId,
      ]),
      (error) => error.code === 'E2E_CLI_INVALID',
    );
  });

  it('allows candidate depth only as an isolated student-pilot diagnostic override', () => {
    const parsed = parseCliArgs([
      '--mode', 'student-pilot-opencv', '--questions-file', 'questions.json',
      '--candidate-depth', '50', '--retrieval-only', '--json',
    ]);

    assert.equal(parsed.candidateDepth, 50);
    assert.equal(parsed.retrievalOnly, true);
    assert.throws(
      () => parseCliArgs([
        '--question', 'question', '--course-id', courseId, '--video-id', videoId,
        '--candidate-depth', '50',
      ]),
      (error) => error.code === 'E2E_CLI_INVALID',
    );
    assert.throws(
      () => parseCliArgs([
        '--question', 'question', '--course-id', courseId, '--video-id', videoId,
        '--retrieval-only',
      ]),
      (error) => error.code === 'E2E_CLI_INVALID',
    );
    assert.throws(
      () => parseCliArgs([
        '--mode', 'student-pilot-opencv', '--questions-file', 'questions.json',
        '--candidate-depth', '0',
      ]),
      (error) => error.code === 'E2E_CLI_INVALID',
    );
  });

  it('validates the fixed OpenCV scope at 15 videos and 129 segments without writes', async () => {
    const parsed = studentPilotOptions();
    const monitor = createCommandMonitor();
    const allowedVideoIds = Array.from(
      { length: 15 },
      (_, index) => `6a00000000000000000000${index.toString(16).padStart(2, '0')}`,
    );
    const result = await runStudentPilotOpenCvValidation(parsed, {
      commandMonitor: monitor,
      async inspectStudentPilotOpenCvScope() {
        return {
          allowedVideoIds,
          excludedVideoPresent: true,
          segmentCount: 129,
          databaseAccess: { verified: true, role: 'read', database: 'focusflow' },
        };
      },
    });

    assert.equal(result.runMode, 'student-pilot-opencv');
    assert.equal(result.scope.videoCount, 15);
    assert.equal(result.scope.excludedVideoId, STUDENT_PILOT_OPENCV_EXCLUDED_VIDEO_ID);
    assert.equal(result.scope.segmentCount, 129);
    assert.equal(result.safety.mongoWrites, 0);
    assert.equal(result.safety.externalCalls, 0);
  });

  it('fails the fixed OpenCV mode when TEST_0720 remains or the count is not 129', async () => {
    const parsed = studentPilotOptions();
    const allowedVideoIds = Array.from(
      { length: 14 },
      (_, index) => `6a00000000000000000000${index.toString(16).padStart(2, '0')}`,
    );

    await assert.rejects(
      runStudentPilotOpenCvValidation(parsed, {
        async inspectStudentPilotOpenCvScope() {
          return {
            allowedVideoIds: [...allowedVideoIds, STUDENT_PILOT_OPENCV_EXCLUDED_VIDEO_ID],
            excludedVideoPresent: true,
            segmentCount: 129,
          };
        },
      }),
      (error) => error.code === 'E2E_STUDENT_PILOT_SCOPE_INVALID',
    );
    await assert.rejects(
      runStudentPilotOpenCvValidation(parsed, {
        async inspectStudentPilotOpenCvScope() {
          return {
            allowedVideoIds: [...allowedVideoIds, '6a00000000000000000000ff'],
            excludedVideoPresent: true,
            segmentCount: 132,
          };
        },
      }),
      (error) => error.code === 'E2E_STUDENT_PILOT_SEGMENT_COUNT_MISMATCH',
    );
  });

  it('requires an exact Q01-Q12 plus N01-N02 question bank', () => {
    const validated = validateStudentPilotQuestionBank(questionBank());
    assert.deepEqual(validated.questions.map((item) => item.id), STUDENT_PILOT_QUESTION_IDS);

    assert.throws(
      () => validateStudentPilotQuestionBank(questionBank({
        questions: questionBank().questions.slice(0, -1),
      })),
      (error) => error.code === 'E2E_QUESTION_BANK_INCOMPLETE',
    );
    assert.throws(
      () => validateStudentPilotQuestionBank(questionBank({
        questions: [...questionBank().questions, { id: 'Q01', question: 'duplicate' }],
      })),
      (error) => error.code === 'E2E_QUESTION_BANK_INVALID',
    );
  });

  it('runs all 14 questions through Leaf-only Atlas, answer generation, citations, and evidence JSON', async () => {
    let embedCalls = 0;
    let searchCalls = 0;
    let answerCalls = 0;
    const result = await runStudentPilotBaseline(studentPilotOptions(), studentPilotDependencies({
      async embed() { embedCalls += 1; return vector(); },
      async searchStudentPilotLeaves(...args) {
        searchCalls += 1;
        return studentPilotDependencies().searchStudentPilotLeaves(...args);
      },
      async answer() { answerCalls += 1; return { text: 'safe answer', provider: 'mock', fallback: null }; },
    }));

    assert.equal(result.success, true);
    assert.equal(result.questions.length, 14);
    assert.equal(embedCalls, 14);
    assert.equal(searchCalls, 14);
    assert.equal(answerCalls, 14);
    assert.deepEqual(result.retrieval, {
      backend: 'atlas', leafOnly: true, faqEnabled: false, parentEnabled: false, fallbackAllowed: false,
      candidateDepth: 15, answerContextLimit: 15, diagnosticOverrideActive: false,
      answerGenerationExecuted: true,
    });
    assert.equal(result.questions[0].search.backend, 'atlas');
    assert.equal(result.questions[0].search.fallbackUsed, false);
    assert.deepEqual(result.questions[0].search.candidates[0], {
      rank: 1, score: 0.9, chunkId: 'chunk-1', segmentId: 'segment-1',
      videoId: '6a0000000000000000000000', startSec: 10, endSec: 20,
    });
    assert.deepEqual(result.questions[0].answerContext, {
      source: 'retrieval_candidates',
      limit: 15,
      generationExecuted: true,
      leafCount: 1,
      sameOrderAsCandidates: true,
      leaves: [{
        rank: 1, score: 0.9, chunkId: 'chunk-1', segmentId: 'segment-1',
        videoId: '6a0000000000000000000000', startSec: 10, endSec: 20,
        videoTitle: null, transcript: 'safe leaf transcript',
      }],
    });
    assert.equal(result.questions[0].retrievalEvaluation.groundTruthStatus, 'annotated');
    assert.equal(result.questions[0].retrievalEvaluation.metrics.hitAtK, 0);
    assert.deepEqual(result.runtimeSettings, {
      QA_MATCH_LIMIT: 15,
      QA_VECTOR_SEARCH_MODE: 'atlas',
      QA_QUERY_EMBEDDING_PROVIDER: 'gemini',
      QA_QUERY_EMBEDDING_MODEL: 'gemini-embedding-2',
      QA_ANSWER_PROVIDER: 'gemini',
      QA_ANSWER_MODEL: 'gemini-3.5-flash',
      FAQ_CACHE_ENABLED: false,
      HIERARCHICAL_RETRIEVAL_ENABLED: false,
      HIERARCHICAL_RETRIEVAL_ROLLOUT_MODE: 'off',
      QA_MINIMUM_SCORE_THRESHOLD: {
        status: 'not_configured', value: null, environmentVariable: null,
        candidateValidation: 'finite_score_greater_than_zero',
      },
    });
    assert.equal(result.retrievalEvaluation.metrics.annotatedQuestionCount, 12);
    assert.equal(result.retrievalEvaluation.metrics.hitAtK, 0);
    assert.equal(result.retrievalEvaluation.metrics.mrr, 0);
    assert.equal(result.retrievalEvaluation.metrics.expectedLeafRecallAtK, 0);
    assert.equal(result.retrievalEvaluation.metrics.completeGroupCoverageAtK, 0);
    assert.deepEqual(result.questions[0].fallbacks, []);
    assert.equal(result.questions[0].answer.text, 'safe answer');
    assert.equal(result.questions[0].citations[0].videoId != null, true);
    assert.deepEqual(result.questions[0].citations[0].timestamp, {
      startSec: 10, endSec: 20, label: '0:10', jumpUrl: null,
    });
    assert.equal(result.questions[0].writeCommandCount, 0);
    assert.equal(result.safety.mongoWrites, 0);
  });

  it('keeps answer context at QA_MATCH_LIMIT while evaluating a deeper diagnostic candidate list', async () => {
    const candidates = Array.from({ length: 30 }, (_, index) => ({
      chunkId: `candidate-${index + 1}`,
      segmentId: `segment-${index + 1}`,
      videoId: '6a0000000000000000000000',
      startSec: index,
      endSec: index + 1,
      transcript: `transcript ${index + 1}`,
      score: 0.9 - (index / 100),
    }));
    let observedCandidateDepth = null;
    const result = await runStudentPilotBaseline(
      studentPilotOptions({ candidateDepth: 30, retrievalOnly: true }),
      studentPilotDependencies({
        async searchStudentPilotLeaves({ candidateDepth }) {
          observedCandidateDepth = candidateDepth;
          return { backend: 'atlas', fallbackUsed: false, fallbacks: [], matches: candidates };
        },
        async answer() { throw new Error('answer generation must stay disabled'); },
        citationBuilder() { throw new Error('citations must stay disabled'); },
      }),
    );

    assert.equal(observedCandidateDepth, 30);
    assert.equal(result.retrieval.candidateDepth, 30);
    assert.equal(result.retrieval.answerContextLimit, 15);
    assert.equal(result.retrieval.diagnosticOverrideActive, true);
    assert.equal(result.retrieval.answerGenerationExecuted, false);
    assert.equal(result.retrievalEvaluation.k, 30);
    assert.equal(result.questions[0].search.candidates.length, 30);
    assert.equal(result.questions[0].answerContext.leafCount, 15);
    assert.equal(result.questions[0].answerContext.generationExecuted, false);
    assert.deepEqual(
      result.questions[0].answerContext.leaves.map((leaf) => leaf.chunkId),
      candidates.slice(0, 15).map((candidate) => candidate.chunkId),
    );
    assert.equal(result.questions[0].answer, null);
    assert.equal(result.questions[0].answerStatus, null);
    assert.deepEqual(result.questions[0].citations, []);
  });

  it('shows Q03 expected Leaf ranks, scores, misses, and the exact answer context', async () => {
    const q03VideoId = '69fb5c8db52433fda32dbab5';
    let q03AnswerInput = null;
    const candidates = [
      {
        chunkId: 'unrelated_chunk_0001', segmentId: 'unrelated-segment',
        videoId: '6a0000000000000000000000', startSec: 0, endSec: 5,
        transcript: 'unrelated', score: 0.91,
      },
      {
        chunkId: `${q03VideoId}_chunk_0002`, segmentId: 'q03-2', videoId: q03VideoId,
        startSec: 5, endSec: 10, transcript: 'expected two', score: 0.82,
      },
      {
        chunkId: `${q03VideoId}_chunk_0003`, segmentId: 'q03-3', videoId: q03VideoId,
        startSec: 10, endSec: 15, transcript: 'expected three', score: 0.74,
      },
    ];
    const result = await runStudentPilotBaseline(studentPilotOptions(), studentPilotDependencies({
      async searchStudentPilotLeaves() {
        return { backend: 'atlas', fallbackUsed: false, fallbacks: [], matches: candidates };
      },
      async answer(question, matches) {
        if (question === 'Question Q03') q03AnswerInput = matches;
        return { text: 'safe answer', provider: 'mock', fallback: null };
      },
    }));
    const q03 = result.questions.find((question) => question.id === 'Q03');

    assert.deepEqual(q03.retrievalEvaluation.expectedLeaves.map((leaf) => ({
      chunkId: leaf.chunkId, rank: leaf.rank, score: leaf.score, hitAtK: leaf.hitAtK,
    })), [
      { chunkId: `${q03VideoId}_chunk_0002`, rank: 2, score: 0.82, hitAtK: true },
      { chunkId: `${q03VideoId}_chunk_0003`, rank: 3, score: 0.74, hitAtK: true },
      { chunkId: `${q03VideoId}_chunk_0004`, rank: null, score: null, hitAtK: false },
    ]);
    assert.equal(q03.retrievalEvaluation.groupCoverage[0].completeAtK, false);
    assert.deepEqual(q03.retrievalEvaluation.groupCoverage[0].missingChunkIds,
      [`${q03VideoId}_chunk_0004`]);
    assert.equal(q03.answerContext.sameOrderAsCandidates, true);
    assert.deepEqual(q03.answerContext.leaves.map((leaf) => leaf.chunkId),
      candidates.map((candidate) => candidate.chunkId));
    assert.deepEqual(q03AnswerInput, candidates);
  });

  it('validates the Q01-Q12 ground-truth boundary and reports missing configuration explicitly', () => {
    assert.doesNotThrow(() => validateStudentPilotRetrievalGroundTruth(
      require('../src/data/studentPilotRetrievalGroundTruth').STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH,
    ));
    assert.throws(
      () => validateStudentPilotRetrievalGroundTruth({ Q01: { expectedLeafGroups: [] } }),
      (error) => error.code === 'E2E_RETRIEVAL_GROUND_TRUTH_INCOMPLETE',
    );
    assert.equal(buildPhase3BRuntimeSettings({}).QA_MINIMUM_SCORE_THRESHOLD.status, 'not_configured');
  });

  it('marks the batch failed instead of accepting Atlas or answer fallback', async () => {
    const result = await runStudentPilotBaseline(studentPilotOptions(), studentPilotDependencies({
      async searchStudentPilotLeaves() {
        return { backend: 'memory', fallbackUsed: true, fallbacks: ['memory'], matches: [] };
      },
    }));

    assert.equal(result.success, false);
    assert.equal(result.questions.every((item) => item.success === false), true);
    assert.equal(result.questions.every((item) => item.error.code === 'E2E_FALLBACK_NOT_ALLOWED'), true);
    assert.equal(result.questions.every((item) => item.search.fallbackUsed === true), true);
    assert.deepEqual(result.questions[0].fallbacks, [{
      stage: 'retrieval', type: 'memory', path: 'atlas->memory', code: null,
    }]);
  });

  it('records answer fallback stage and path before failing the baseline', async () => {
    const result = await runStudentPilotBaseline(studentPilotOptions(), studentPilotDependencies({
      async answer() {
        return {
          text: 'template answer',
          provider: 'template',
          fallback: { stage: 'answer', from: 'gemini', to: 'template', code: 'ANSWER_PROVIDER_ERROR' },
        };
      },
    }));

    assert.equal(result.success, false);
    assert.equal(result.questions[0].search.fallbackUsed, true);
    assert.deepEqual(result.questions[0].fallbacks, [{
      stage: 'answer',
      type: 'ANSWER_PROVIDER_ERROR',
      path: 'gemini->template',
      code: 'ANSWER_PROVIDER_ERROR',
    }]);
  });

  it('drops baseline citations when the scoped video has no playable source', async () => {
    const dependencies = studentPilotDependencies();
    const originalInspect = dependencies.inspectStudentPilotOpenCvScope;
    dependencies.inspectStudentPilotOpenCvScope = async (...args) => {
      const inspection = await originalInspect(...args);
      return {
        ...inspection,
        scopedVideos: {
          videos: inspection.scopedVideos.videos.map((video) => ({
            ...video,
            youtubeVideoId: null,
            filePath: null,
          })),
        },
      };
    };

    const result = await runStudentPilotBaseline(studentPilotOptions(), dependencies);

    assert.equal(result.success, true);
    assert.deepEqual(result.questions[0].citations, []);
  });

  it('keeps baseline retrieval counts but emits no citations for a final no-answer reply', async () => {
    const result = await runStudentPilotBaseline(studentPilotOptions(), studentPilotDependencies({
      async answer() {
        return {
          text: '目前資料庫片段不足以回答這個問題。',
          provider: 'mock',
          fallback: null,
        };
      },
    }));

    assert.equal(result.success, true);
    assert.equal(result.questions[0].search.matchCount > 0, true);
    assert.deepEqual(result.questions[0].citations, []);
    assert.deepEqual(result.questions[0].answerStatus, {
      status: 'no_answer',
      isAnswerable: false,
      matchStatus: 'no_relevant_match',
      confidence: 'none',
      noAnswerReason: 'NO_RELEVANT_MATCH',
    });
  });

  it('fails the whole batch immediately when a MongoDB write command is observed', async () => {
    const deps = studentPilotDependencies();
    deps.searchStudentPilotLeaves = async () => {
      deps.commandMonitor.observe({ commandName: 'update' });
      return { backend: 'atlas', fallbackUsed: false, fallbacks: [], matches: [] };
    };

    await assert.rejects(
      runStudentPilotBaseline(studentPilotOptions(), deps),
      (error) => error.code === 'WRITE_OPERATION_DETECTED',
    );
  });

  it('enforces Atlas, FAQ-off, and Parent-off for student-pilot mode without changing standard mode', () => {
    const base = {
      hierarchicalRetrievalEnabled: false,
      hierarchicalRetrievalFallbackToLeaf: true,
      faqCacheEnabled: false,
      qaVectorSearchMode: 'atlas',
      qaAtlasVectorIndexName: 'text_embedding_index',
    };
    assert.doesNotThrow(() => assertRunnerRuntimeConfiguration('student-pilot-opencv', base));
    assert.throws(
      () => assertRunnerRuntimeConfiguration('student-pilot-opencv', { ...base, qaVectorSearchMode: 'memory' }),
      (error) => error.code === 'E2E_ATLAS_MODE_REQUIRED',
    );
    assert.throws(
      () => assertRunnerRuntimeConfiguration('student-pilot-opencv', { ...base, faqCacheEnabled: true }),
      (error) => error.code === 'E2E_FAQ_CACHE_NOT_DISABLED',
    );
    assert.throws(
      () => assertRunnerRuntimeConfiguration('student-pilot-opencv', { ...base, hierarchicalRetrievalEnabled: true }),
      (error) => error.code === 'E2E_SHARED_GATE_NOT_DISABLED',
    );
    assert.doesNotThrow(() => assertRunnerRuntimeConfiguration('standard', base));
  });

  it('rejects a non-canonical video scope before creating live dependencies', () => {
    assert.throws(
      () => parseCliArgs(['--question', 'question', '--course-id', courseId, '--video-id', 'temporary-file-name']),
      (error) => error.code === 'E2E_CLI_INVALID',
    );
  });

  it('runs Parent to Citation with no answer call, preserves chunkId, and reports missing Child diagnostics', async () => {
    let answerCalls = 0;
    const result = await runIsolatedE2E(options(), dependencies({
      async answer() { answerCalls += 1; throw new Error('must not run'); },
    }));

    assert.equal(answerCalls, 0);
    assert.equal(result.answer.executed, false);
    assert.equal(result.childExpansion.requested, 2);
    assert.equal(result.childExpansion.found, 1);
    assert.equal(result.childExpansion.missing, 1);
    assert.deepEqual(result.citations.chunkIds, ['child-1']);
    assert.deepEqual(result.citations.segmentIds, ['segment-1']);
    assert.equal(result.safety.mongoWrites, 0);
    assert.equal(result.activeDataReadiness.ready, true);
    assert.equal(JSON.stringify(result).includes('private leaf transcript'), false);
    assert.equal(Object.hasOwn(result.query, 'embedding'), false);
  });

  it('calls answer generation only when --with-answer is enabled', async () => {
    let answerCalls = 0;
    const result = await runIsolatedE2E(options({ withAnswer: true }), dependencies({
      async answer() { answerCalls += 1; return { text: 'answer', provider: 'mock', fallback: null }; },
    }));
    assert.equal(answerCalls, 1);
    assert.deepEqual(result.answer, { executed: true, provider: 'mock', status: 'success', length: 6 });
    assert.equal(result.safety.externalCalls, 2);
  });

  it('blocks before Parent Search when chunkId index preflight fails', async () => {
    let parentCalls = 0;
    await assert.rejects(
      runIsolatedE2E(options(), dependencies({
        async preflight() {
          throw new IsolatedE2EError('index unavailable', 'E2E_CHUNK_ID_INDEX_NOT_READY');
        },
        parentRepositoryFactory: () => ({ async searchParents() { parentCalls += 1; return []; } }),
      })),
      (error) => error.code === 'E2E_CHUNK_ID_INDEX_NOT_READY',
    );
    assert.equal(parentCalls, 0);
  });

  it('blocks when explain does not use IXSCAN', async () => {
    await assert.rejects(
      runIsolatedE2E(options(), dependencies({
        async verifyChildLookupPlan() { return { usesIxscan: false, indexNames: [] }; },
      })),
      (error) => error.code === 'E2E_CHUNK_ID_INDEX_NOT_READY',
    );
  });

  it('blocks when explain uses an unrelated index instead of chunkId_1', async () => {
    await assert.rejects(
      runIsolatedE2E(options(), dependencies({
        async verifyChildLookupPlan() { return { usesIxscan: true, indexNames: ['videoId_1'] }; },
      })),
      (error) => error.code === 'E2E_CHUNK_ID_INDEX_NOT_READY',
    );
  });

  it('detects forbidden MongoDB commands and returns a safe error', () => {
    const monitor = createCommandMonitor();
    monitor.observe({ commandName: 'find' });
    monitor.observe({ commandName: 'update' });
    assert.throws(() => monitor.assertNoWrites(), (error) => error.code === 'WRITE_OPERATION_DETECTED');
    assert.deepEqual(monitor.snapshot(), { mongoReads: 1, mongoWrites: 1, writeDetected: true });
    const sensitiveMessage = ['mongodb+srv:', '//secret'].join('');
    assert.equal(JSON.stringify(safeFailure(new Error(sensitiveMessage))).includes('secret'), false);
  });

  it('does not mutate the shared Gate', async () => {
    env.hierarchicalRetrievalEnabled = false;
    const result = await runIsolatedE2E(options(), dependencies());
    assert.deepEqual(result.gate, { sharedValue: false, isolatedValue: true });
    assert.equal(env.hierarchicalRetrievalEnabled, false);
  });

  it('includes stable embedding-contract evidence without changing the shared Gate', async () => {
    env.qaQueryEmbeddingProvider = 'gemini';
    env.geminiEmbeddingModelName = 'gemini-embedding-2';
    const result = await runIsolatedE2E(options(), dependencies());
    assert.equal(result.gate.sharedValue, false);
    assert.deepEqual(result.query, {
      length: options().question.length, embeddingProvider: 'gemini', embeddingModel: 'gemini-embedding-2',
      instructionVersion: 'gemini_embedding_2_asymmetric_retrieval_v2', generationVersion: 'text_search_generation_v2',
      normalizationVersion: 'unit_l2_v1', contractVersion: 'gemini_embedding_2_text_v2',
      schemaVersion: 'gemini_embedding_2_text_v2', taskType: null, dimension: 3072, apiCalls: 1,
    });
  });

  it('does not import known write-side services used by askQuestion', () => {
    const source = fs.readFileSync(path.join(
      __dirname, '..', 'src', 'scripts', 'phase2_2_hierarchical_e2e_runner.js',
    ), 'utf8');
    for (const forbidden of [
      'usageLog.service', 'questionRecording.service', 'faqCache.service', 'findCachedClip', 'askQuestion(',
    ]) {
      assert.equal(source.includes(forbidden), false, `${forbidden} must remain outside the isolated runner`);
    }
    assert.equal(source.includes('PHASE2_2_READONLY_MONGODB_URI'), true);
    assert.equal(source.includes('mongoose.createConnection(env.mongodbUri'), false);
  });

  it('does not reflect an unsupported CLI value into the safe error message', () => {
    const sensitiveValue = ['--mongodb+srv:', '//reader:secret@example'].join('');
    assert.throws(
      () => parseCliArgs([sensitiveValue]),
      (error) => error.code === 'E2E_CLI_INVALID'
        && error.message === 'Unsupported CLI option.'
        && !error.message.includes('secret'),
    );
  });

  it('runs read-only preflight without embedding, Parent Search, Child Expansion, or external calls', async () => {
    let embedCalls = 0;
    let parentCalls = 0;
    let leafCalls = 0;
    const result = await runIsolatedE2E(
      options({ question: '', preflightOnly: true }),
      dependencies({
        async embed() { embedCalls += 1; return vector(); },
        parentRepositoryFactory: () => ({
          async searchParents() { parentCalls += 1; return []; },
        }),
        leafRepositoryFactory: () => ({
          async findLeavesByChunkIds() { leafCalls += 1; return []; },
        }),
      }),
    );

    assert.equal(embedCalls, 0);
    assert.equal(parentCalls, 0);
    assert.equal(leafCalls, 0);
    assert.equal(result.runMode, 'phase2_2_readonly_preflight');
    assert.equal(result.activeDataReadiness.ready, true);
    assert.deepEqual(result.execution, {
      queryEmbedding: false,
      parentSearch: false,
      childExpansion: false,
      answerGeneration: false,
      externalCalls: 0,
    });
    assert.equal(result.safety.externalCalls, 0);
    assert.equal(result.safety.mongoWrites, 0);
  });

  it('keeps the safety-oriented output schema stable', async () => {
    const result = await runIsolatedE2E(options(), dependencies());
    assert.deepEqual(Object.keys(result), [
      'runMode', 'writesAllowed', 'gate', 'activeDataReadiness', 'query', 'parentSearch', 'childExpansion',
      'context', 'answer', 'citations', 'safety',
    ]);
    assert.equal(result.runMode, 'phase2_2_isolated_e2e');
    assert.equal(result.writesAllowed, false);
  });
});
