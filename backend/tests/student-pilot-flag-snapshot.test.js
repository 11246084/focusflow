const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const {
  buildRuntimeFlagSnapshotRecord,
  runStudentPilotFlagSnapshot,
} = require('../src/scripts/printStudentPilotFlagSnapshot');

function buildConfig(overrides = {}) {
  return {
    studentPilotMode: true,
    qaVectorSearchMode: 'atlas',
    qaLeafAdjacentContextEnabled: false,
    faqCacheEnabled: false,
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

describe('student pilot flag snapshot CLI', () => {
  it('validates the actual config contract and emits one runtime.flag_snapshot JSON record', () => {
    const output = [];
    const record = runStudentPilotFlagSnapshot({
      config: buildConfig(),
      writeOutput: (value) => output.push(value),
    });

    assert.equal(record.event, 'runtime.flag_snapshot');
    assert.equal(Object.keys(record.flags).length, 13);
    assert.deepEqual(JSON.parse(output[0]), record);
    assert.equal('GEMINI_API_KEY' in record.flags, false);
    assert.equal('MONGODB_URI' in record.flags, false);
  });

  it('fails without output when student pilot mode is disabled or validation fails', () => {
    assert.throws(
      () => buildRuntimeFlagSnapshotRecord(buildConfig({ studentPilotMode: false })),
      (error) => error.code === 'STUDENT_PILOT_MODE_DISABLED',
    );
    assert.throws(
      () => buildRuntimeFlagSnapshotRecord(buildConfig({ qaVectorSearchMode: 'memory' })),
      /QA_VECTOR_SEARCH_MODE=atlas/,
    );
  });

  it('does not import or start the server, database, scheduler, recovery, cleanup, seed, or batch work', () => {
    const source = fs.readFileSync(path.join(
      __dirname,
      '..',
      'src',
      'scripts',
      'printStudentPilotFlagSnapshot.js',
    ), 'utf8');

    for (const forbidden of [
      "require('../server')",
      "require('mongoose')",
      'connectDatabase',
      'startSchedulers',
      'runRecovery',
      'cleanup',
      'seedDemo',
      'reconcileVideoBatches',
    ]) {
      assert.equal(source.includes(forbidden), false, `${forbidden} must stay outside the snapshot CLI`);
    }
  });
});
