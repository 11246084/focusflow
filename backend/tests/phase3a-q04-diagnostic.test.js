const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { createCommandMonitor } = require('../src/scripts/phase2_2_hierarchical_e2e_runner');
const {
  Q04_CORRECT_CHUNK_IDS,
  buildQ04Contexts,
  defaultOptions,
  runQ04Diagnostic,
} = require('../src/scripts/phase3a_q04_diagnostic');

function leaf(chunkId, index) {
  return {
    chunkId,
    segmentId: chunkId,
    videoId: chunkId.slice(0, 24),
    startSec: index * 10,
    endSec: index * 10 + 9,
    text: `context ${index}`,
  };
}

function diagnosticFixture() {
  const baselineChunkIds = [
    Q04_CORRECT_CHUNK_IDS[0],
    '69fb5c8db52433fda32dbab5_chunk_0005',
    Q04_CORRECT_CHUNK_IDS[1],
  ];
  const leaves = baselineChunkIds.map(leaf);
  const allowedVideoIds = Array.from({ length: 15 }, (_, index) => (
    (index + 1).toString(16).padStart(24, '0')
  ));
  const commandMonitor = createCommandMonitor();

  return {
    baselineChunkIds,
    leaves,
    commandMonitor,
    dependencies: {
      commandMonitor,
      async inspectStudentPilotOpenCvScope() {
        return {
          allowedVideoIds,
          excludedVideoPresent: true,
          segmentCount: 129,
          databaseAccess: { databaseName: 'focusflow', roles: ['read'] },
        };
      },
      leafRepositoryFactory() {
        return {
          async findLeavesByChunkIds() { return leaves; },
        };
      },
    },
  };
}

describe('Phase 3A Q04 read-only diagnostic', () => {
  it('builds focused A and baseline B contexts in their accepted order', () => {
    const fixture = diagnosticFixture();
    const contexts = buildQ04Contexts(fixture);

    assert.deepEqual(
      contexts.focusedContext.map((match) => match.chunkId),
      Q04_CORRECT_CHUNK_IDS,
    );
    assert.deepEqual(
      contexts.baselineContext.map((match) => match.chunkId),
      fixture.baselineChunkIds,
    );
  });

  it('runs exactly two answer generations without retrieval or MongoDB writes', async () => {
    const fixture = diagnosticFixture();
    const answerContexts = [];
    const result = await runQ04Diagnostic({
      ...defaultOptions(),
      inputs: {
        question: '半導體瑕疵檢測與肺部 CT 疾病判斷各屬於物件偵測還是物件分類？',
        baselineChunkIds: fixture.baselineChunkIds,
      },
    }, {
      ...fixture.dependencies,
      async answer(question, matches) {
        answerContexts.push({ question, chunkIds: matches.map((match) => match.chunkId) });
        return { text: `answer-${answerContexts.length}`, provider: 'gemini', fallback: null };
      },
    });

    assert.equal(answerContexts.length, 2);
    assert.deepEqual(answerContexts[0].chunkIds, Q04_CORRECT_CHUNK_IDS);
    assert.deepEqual(answerContexts[1].chunkIds, fixture.baselineChunkIds);
    assert.equal(result.contexts.focused.count, 2);
    assert.equal(result.contexts.baseline.count, 3);
    assert.equal(result.safety.mongoWrites, 0);
    assert.equal(result.writesAllowed, false);
  });

  it('fails closed when an accepted baseline Leaf is missing', () => {
    const fixture = diagnosticFixture();
    assert.throws(
      () => buildQ04Contexts({
        baselineChunkIds: fixture.baselineChunkIds,
        leaves: fixture.leaves.slice(0, -1),
      }),
      (error) => error.code === 'Q04_LEAF_CONTEXT_INCOMPLETE',
    );
  });
});
