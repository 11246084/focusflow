const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  validateStudentPilotRuntime,
} = require('../src/services/studentPilotRuntime.service');

function buildConfig(overrides = {}) {
  return {
    studentPilotMode: true,
    qaVectorSearchMode: 'atlas',
    qaLeafAdjacentContextEnabled: false,
    faqCacheEnabled: true,
    hierarchicalRetrievalEnabled: false,
    hierarchicalRetrievalRolloutMode: 'off',
    videoBatchPipelineEnabled: false,
    youtubeUploadEnabled: true,
    youtubeUploadRecoveryEnabled: false,
    youtubeUploadCleanupEnabled: false,
    youtubePrivatizeOnDelete: true,
    demoSeedEnabled: false,
    maxConversationTurns: 4,
    ...overrides,
  };
}

function captureLogger() {
  const entries = [];
  return {
    entries,
    logger: {
      warn(event, metadata) {
        entries.push({ event, metadata });
      },
    },
  };
}

describe('student pilot startup validation', () => {
  it('keeps existing startup behavior when student pilot mode is disabled', () => {
    const captured = captureLogger();
    const result = validateStudentPilotRuntime(
      buildConfig({
        studentPilotMode: false,
        qaVectorSearchMode: 'memory',
        youtubeUploadEnabled: false,
      }),
      captured.logger,
    );

    assert.deepEqual(result, { enabled: false, snapshot: null });
    assert.deepEqual(captured.entries, []);
  });

  it('rejects memory search mode before startup in student pilot mode', () => {
    assert.throws(
      () => validateStudentPilotRuntime(buildConfig({ qaVectorSearchMode: 'memory' })),
      /QA_VECTOR_SEARCH_MODE=atlas/,
    );
  });

  it('rejects disabled YouTube upload before startup with the required reason', () => {
    assert.throws(
      () => validateStudentPilotRuntime(buildConfig({ youtubeUploadEnabled: false })),
      /新上傳影片將無播放來源/,
    );
  });

  it('accepts Atlas plus YouTube and logs the thirteen effective Backend flags', () => {
    const captured = captureLogger();
    const result = validateStudentPilotRuntime(buildConfig(), captured.logger);

    assert.equal(result.enabled, true);
    assert.equal(captured.entries.length, 1);
    assert.equal(captured.entries[0].event, 'runtime.flag_snapshot');
    assert.equal(Object.keys(captured.entries[0].metadata).length, 13);
    assert.deepEqual(captured.entries[0].metadata, result.snapshot);
    assert.equal('ENABLE_GEMINI_EMBEDDING' in result.snapshot, false);
  });
});
