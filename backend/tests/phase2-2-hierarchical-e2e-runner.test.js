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
  assertStrictReadOnlyRoles,
  createCommandMonitor,
  hasRequiredCollections,
  parseCliArgs,
  runIsolatedE2E,
  runStudentPilotOpenCvValidation,
  safeFailure,
} = require('../src/scripts/phase2_2_hierarchical_e2e_runner');

const originalGate = env.hierarchicalRetrievalEnabled;
const originalProvider = env.qaQueryEmbeddingProvider;
const originalGeminiEmbeddingModelName = env.geminiEmbeddingModelName;
const courseId = '6a6da68456dd124511ec5196';
const videoId = '6a6da69556dd124511ec51eb';

function vector() {
  return Array.from({ length: 3072 }, (_, index) => (index === 0 ? 1 : 0));
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
    const parsed = parseCliArgs(['--mode', 'student-pilot-opencv', '--json']);

    assert.equal(parsed.mode, 'student-pilot-opencv');
    assert.equal(parsed.courseId, STUDENT_PILOT_OPENCV_COURSE_ID);
    assert.equal(parsed.excludedVideoId, STUDENT_PILOT_OPENCV_EXCLUDED_VIDEO_ID);
    assert.equal(parsed.expectedSegmentCount, STUDENT_PILOT_OPENCV_EXPECTED_SEGMENT_COUNT);
    assert.deepEqual(parsed.allowedVideoIds, []);
    assert.throws(
      () => parseCliArgs([
        '--mode', 'student-pilot-opencv', '--course-id', courseId,
      ]),
      (error) => error.code === 'E2E_CLI_INVALID',
    );
  });

  it('validates the fixed OpenCV scope at 15 videos and 129 segments without writes', async () => {
    const parsed = parseCliArgs(['--mode', 'student-pilot-opencv']);
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
    const parsed = parseCliArgs(['--mode', 'student-pilot-opencv']);
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
