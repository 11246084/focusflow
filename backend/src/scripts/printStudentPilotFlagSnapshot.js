const env = require('../config/env');
const { validateStudentPilotRuntime } = require('../services/studentPilotRuntime.service');

class StudentPilotSnapshotError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'StudentPilotSnapshotError';
    this.code = code;
  }
}

function buildRuntimeFlagSnapshotRecord(config = env) {
  let record = null;
  const result = validateStudentPilotRuntime(config, {
    warn(event, flags) {
      record = { event, flags };
    },
  });

  if (!result.enabled || !record) {
    throw new StudentPilotSnapshotError(
      'STUDENT_PILOT_MODE must be enabled before capturing the baseline flag snapshot.',
      'STUDENT_PILOT_MODE_DISABLED',
    );
  }

  return record;
}

function runStudentPilotFlagSnapshot({
  config = env,
  writeOutput = (value) => console.log(value),
} = {}) {
  const record = buildRuntimeFlagSnapshotRecord(config);
  writeOutput(JSON.stringify(record, null, 2));
  return record;
}

function safeFailure(error) {
  return {
    success: false,
    code: error?.code || 'STUDENT_PILOT_SNAPSHOT_FAILED',
    message: error instanceof StudentPilotSnapshotError
      ? error.message
      : 'The student-pilot runtime snapshot failed safely.',
  };
}

function main() {
  try {
    runStudentPilotFlagSnapshot();
  } catch (error) {
    console.error(JSON.stringify(safeFailure(error)));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  StudentPilotSnapshotError,
  buildRuntimeFlagSnapshotRecord,
  main,
  runStudentPilotFlagSnapshot,
  safeFailure,
};
