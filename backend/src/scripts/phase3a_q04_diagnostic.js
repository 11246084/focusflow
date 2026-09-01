const fs = require('node:fs');
const path = require('node:path');
const env = require('../config/env');
const { generateAnswer } = require('../services/answerGeneration.service');
const {
  IsolatedE2EError,
  STUDENT_PILOT_OPENCV_COURSE_ID,
  STUDENT_PILOT_OPENCV_EXCLUDED_VIDEO_ID,
  STUDENT_PILOT_OPENCV_EXPECTED_SEGMENT_COUNT,
  STUDENT_PILOT_OPENCV_EXPECTED_VIDEO_COUNT,
  STUDENT_PILOT_OPENCV_MODE,
  createCommandMonitor,
  createLiveDependencies,
  inspectAndValidateStudentPilotOpenCvScope,
  safeFailure,
} = require('./phase2_2_hierarchical_e2e_runner');

const Q04_ID = 'Q04';
const Q04_CORRECT_CHUNK_IDS = Object.freeze([
  '6a02f34d17c615e872035b3d_chunk_0006',
  '6a02f34d17c615e872035b3d_chunk_0007',
]);
const DEFAULT_QUESTION_BANK = path.resolve(
  __dirname,
  '../../../docs/2026-09_Student_Pilot_Backend/evidence/2026-09-01_baseline_questions.json',
);
const DEFAULT_BASELINE_RESULTS = path.resolve(
  __dirname,
  '../../../docs/2026-09_Student_Pilot_Backend/evidence/2026-09-01_baseline_raw-results.json',
);

function readJson(filePath, code) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
  } catch {
    throw new IsolatedE2EError('Q04 diagnostic input could not be read.', code);
  }
}

function loadQ04DiagnosticInputs({
  questionBankPath = DEFAULT_QUESTION_BANK,
  baselineResultsPath = DEFAULT_BASELINE_RESULTS,
} = {}) {
  const questionBank = readJson(questionBankPath, 'Q04_QUESTION_BANK_READ_FAILED');
  const baseline = readJson(baselineResultsPath, 'Q04_BASELINE_RESULTS_READ_FAILED');
  const question = (questionBank.questions || []).find((item) => item.id === Q04_ID);
  const baselineQuestion = (baseline.questions || []).find((item) => item.id === Q04_ID);
  const baselineChunkIds = (baselineQuestion?.citations || [])
    .map((citation) => String(citation.chunkId || '').trim())
    .filter(Boolean);

  if (!question?.question || baselineQuestion?.success !== true || !baselineChunkIds.length
      || Q04_CORRECT_CHUNK_IDS.some((chunkId) => !baselineChunkIds.includes(chunkId))) {
    throw new IsolatedE2EError(
      'Q04 diagnostic inputs do not contain the accepted baseline contexts.',
      'Q04_BASELINE_CONTEXT_INVALID',
    );
  }

  return {
    question: String(question.question),
    baselineChunkIds,
  };
}

function toAnswerMatch(leaf) {
  const value = typeof leaf?.toObject === 'function' ? leaf.toObject() : leaf;
  return {
    chunkId: value.chunkId,
    segmentId: value.segmentId || value.chunkId,
    videoId: String(value.videoId || ''),
    videoTitle: null,
    startSec: value.startSec,
    endSec: value.endSec,
    transcript: value.text || value.transcript || '',
    score: typeof value.score === 'number' ? value.score : null,
  };
}

function buildQ04Contexts({ baselineChunkIds, leaves }) {
  const leafByChunkId = new Map(
    (Array.isArray(leaves) ? leaves : []).map((leaf) => {
      const match = toAnswerMatch(leaf);
      return [String(match.chunkId || ''), match];
    }),
  );
  const baselineContext = baselineChunkIds.map((chunkId) => leafByChunkId.get(chunkId));
  const focusedContext = Q04_CORRECT_CHUNK_IDS.map((chunkId) => leafByChunkId.get(chunkId));

  if (baselineContext.some((match) => !match?.transcript)
      || focusedContext.some((match) => !match?.transcript)) {
    throw new IsolatedE2EError(
      'One or more Q04 baseline Leaves are unavailable in the read-only scope.',
      'Q04_LEAF_CONTEXT_INCOMPLETE',
    );
  }

  return { focusedContext, baselineContext };
}

async function runQ04Diagnostic(options, dependencies) {
  const {
    commandMonitor = createCommandMonitor(),
    inspectStudentPilotOpenCvScope,
    leafRepositoryFactory,
    answer = generateAnswer,
  } = dependencies;
  const inputs = options.inputs || loadQ04DiagnosticInputs(options);
  const { allowedVideoIds, inspection } = await inspectAndValidateStudentPilotOpenCvScope(
    options,
    { inspectStudentPilotOpenCvScope, commandMonitor },
  );
  const scope = {
    allowedCourseIds: new Set([options.courseId]),
    allowedVideoIds: new Set(allowedVideoIds),
  };

  commandMonitor.assertNoWrites();
  const leaves = await leafRepositoryFactory().findLeavesByChunkIds(
    inputs.baselineChunkIds,
    { scope },
  );
  commandMonitor.assertNoWrites();
  const { focusedContext, baselineContext } = buildQ04Contexts({
    baselineChunkIds: inputs.baselineChunkIds,
    leaves,
  });

  const focusedAnswer = await answer(inputs.question, focusedContext);
  commandMonitor.assertNoWrites();
  const baselineAnswer = await answer(inputs.question, baselineContext);
  commandMonitor.assertNoWrites();
  if (focusedAnswer?.fallback || baselineAnswer?.fallback) {
    throw new IsolatedE2EError(
      'Q04 diagnosis requires two Gemini answers without fallback.',
      'Q04_ANSWER_FALLBACK_NOT_ALLOWED',
    );
  }

  return {
    success: true,
    runMode: 'phase3a_q04_readonly_diagnostic',
    writesAllowed: false,
    question: { id: Q04_ID, text: inputs.question },
    contexts: {
      focused: {
        label: 'A_correct_chunks_only',
        count: focusedContext.length,
        chunkIds: focusedContext.map((match) => match.chunkId),
      },
      baseline: {
        label: 'B_original_baseline_context',
        count: baselineContext.length,
        chunkIds: baselineContext.map((match) => match.chunkId),
      },
    },
    answers: {
      focused: { provider: focusedAnswer.provider, text: focusedAnswer.text },
      baseline: { provider: baselineAnswer.provider, text: baselineAnswer.text },
    },
    safety: {
      ...commandMonitor.snapshot(),
      databaseAccess: inspection.databaseAccess || null,
      sensitiveOutput: false,
    },
  };
}

function defaultOptions() {
  return {
    mode: STUDENT_PILOT_OPENCV_MODE,
    courseId: STUDENT_PILOT_OPENCV_COURSE_ID,
    excludedVideoId: STUDENT_PILOT_OPENCV_EXCLUDED_VIDEO_ID,
    expectedVideoCount: STUDENT_PILOT_OPENCV_EXPECTED_VIDEO_COUNT,
    expectedSegmentCount: STUDENT_PILOT_OPENCV_EXPECTED_SEGMENT_COUNT,
  };
}

async function main() {
  const commandMonitor = createCommandMonitor();
  let dependencies;
  try {
    if (env.qaAnswerProvider !== 'gemini' || !env.geminiApiKey) {
      throw new IsolatedE2EError(
        'Q04 diagnosis requires the configured Gemini answer provider.',
        'Q04_GEMINI_NOT_CONFIGURED',
      );
    }
    const options = defaultOptions();
    dependencies = await createLiveDependencies(commandMonitor, options);
    const result = await runQ04Diagnostic(options, { ...dependencies, commandMonitor });
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
  Q04_CORRECT_CHUNK_IDS,
  Q04_ID,
  buildQ04Contexts,
  defaultOptions,
  loadQ04DiagnosticInputs,
  main,
  runQ04Diagnostic,
};
