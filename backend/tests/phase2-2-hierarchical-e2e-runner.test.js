const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { afterEach, describe, it } = require('node:test');
const env = require('../src/config/env');
const {
  IsolatedE2EError,
  createCommandMonitor,
  parseCliArgs,
  runIsolatedE2E,
  safeFailure,
} = require('../src/scripts/phase2_2_hierarchical_e2e_runner');

const originalGate = env.hierarchicalRetrievalEnabled;
const courseId = '6a6da68456dd124511ec5196';
const videoId = '6a6da69556dd124511ec51eb';

function vector() {
  return Array.from({ length: 3072 }, (_, index) => (index === 0 ? 1 : 0));
}

function options(overrides = {}) {
  return {
    question: 'safe test question',
    courseId,
    videoId,
    allowedVideoIds: [videoId],
    withAnswer: false,
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
});

describe('Phase 2-2 isolated hierarchical E2E runner', () => {
  it('parses a safe CLI contract with answer generation disabled by default', () => {
    const parsed = parseCliArgs([
      '--question', 'question', '--course-id', courseId, '--video-id', videoId, '--json',
    ]);
    assert.equal(parsed.withAnswer, false);
    assert.deepEqual(parsed.allowedVideoIds, [videoId]);
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

  it('does not import known write-side services used by askQuestion', () => {
    const source = fs.readFileSync(path.join(
      __dirname, '..', 'src', 'scripts', 'phase2_2_hierarchical_e2e_runner.js',
    ), 'utf8');
    for (const forbidden of [
      'usageLog.service', 'questionRecording.service', 'faqCache.service', 'findCachedClip', 'askQuestion(',
    ]) {
      assert.equal(source.includes(forbidden), false, `${forbidden} must remain outside the isolated runner`);
    }
  });

  it('keeps the safety-oriented output schema stable', async () => {
    const result = await runIsolatedE2E(options(), dependencies());
    assert.deepEqual(Object.keys(result), [
      'runMode', 'writesAllowed', 'gate', 'query', 'parentSearch', 'childExpansion',
      'context', 'answer', 'citations', 'safety',
    ]);
    assert.equal(result.runMode, 'phase2_2_isolated_e2e');
    assert.equal(result.writesAllowed, false);
  });
});
